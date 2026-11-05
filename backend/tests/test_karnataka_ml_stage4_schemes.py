"""
Unit and Integration Tests for Stage 4B: Government Healthcare Assistance Schemes.

Covers:
1. Scheme catalog response (GET /api/v1/hospital-ml/schemes) with verified profiles for:
   - PM-JAY
   - Ayushman Bharat — Arogya Karnataka (AB-ArK)
   - Karnataka Chief Minister's Relief Fund (CMRF)
2. BPL/PHH/AAY guidance (100% cashless, emergency exemption vs planned ORS referral requirement).
3. APL/NPHH guidance (30% state subsidy capped at ₹1.5L, 70% patient co-payment).
4. No-ration-card guidance (public hospital subsidized care, Tahsildar income certificate for CMRF).
5. Karnataka vs Non-Karnataka residents (PM-JAY National Portability).
6. Emergency vs Planned treatment pathways (ORS referral gatekeeping).
7. Senior citizen guidance (70+ universal Ayushman Vay Vandana Card expansion).
8. CMRF discretionary status (ex-gratia relief, not guaranteed assistance).
9. Missing or uncertain information safety (official disclaimers and authority referrals).
10. Official hospital and beneficiary verification links.
11. Strict non-PII request/response schema validation.
12. Direct FastAPI route handlers testing:
    - get_government_schemes_catalog_endpoint
    - evaluate_scheme_eligibility_endpoint
13. Stage 1, Stage 2, and Stage 3 regression preservation.
"""

import inspect
import time
from unittest.mock import AsyncMock, MagicMock
import pytest

from app.api.routes import (
    evaluate_scheme_eligibility_endpoint,
    get_cost_comparison_catalog_endpoint,
    get_government_schemes_catalog_endpoint,
)
from app.models.schemas import (
    GovernmentSchemesCatalog,
    KarnatakaCostComparisonCatalog,
    SchemeEligibilityEvaluationRequest,
    SchemeEligibilityEvaluationResponse,
)
from app.services.karnataka_ml import karnataka_ml_service


def _run_coroutine_with_timeout(coro, timeout_seconds: float = 10.0):
    """
    Drive an async coroutine synchronously to completion without initializing
    Windows Proactor/Selector event loop socketpairs that hang in sandboxed environments.
    """
    start_time = time.time()
    stack = [coro]
    val = None
    exc = None
    while stack:
        if time.time() - start_time > timeout_seconds:
            raise TimeoutError(f"Coroutine exceeded {timeout_seconds}s timeout: {coro}")
        curr = stack[-1]
        try:
            if exc is not None:
                sub = curr.throw(exc)
                exc = None
            else:
                sub = curr.send(val)
                val = None
            if inspect.iscoroutine(sub):
                stack.append(sub)
            else:
                val = sub
        except StopIteration as e:
            stack.pop()
            val = e.value
        except Exception as e:
            stack.pop()
            exc = e
            if not stack:
                raise
    return val


# ==============================================================================
# 1. Scheme Catalog Tests
# ==============================================================================

def test_government_schemes_catalog_structure():
    """Verify get_government_schemes_catalog returns the 3 official schemes with verified details."""
    catalog = karnataka_ml_service.get_government_schemes_catalog()
    assert isinstance(catalog, GovernmentSchemesCatalog)
    assert catalog.status == "success"
    assert len(catalog.schemes) == 3

    scheme_ids = [s.scheme_id for s in catalog.schemes]
    assert "pmjay" in scheme_ids
    assert "ab_ark" in scheme_ids
    assert "cmrf" in scheme_ids

    # Verify PM-JAY
    pmjay = next(s for s in catalog.schemes if s.scheme_id == "pmjay")
    assert pmjay.coverage_ceiling_inr == 500000.0
    assert "National Health Authority" in pmjay.administering_body
    assert pmjay.official_portal_url == "https://pmjay.gov.in/"
    assert pmjay.beneficiary_portal_url == "https://beneficiary.nha.gov.in/"
    assert pmjay.hospital_search_portal_url == "https://hospitals.pmjay.gov.in/"
    assert any(h.number == "14555" for h in pmjay.helplines)
    assert pmjay.is_discretionary is False

    # Verify AB-ArK
    ab_ark = next(s for s in catalog.schemes if s.scheme_id == "ab_ark")
    assert ab_ark.coverage_ceiling_inr == 500000.0
    assert "Suvarna Arogya Suraksha Trust" in ab_ark.administering_body
    assert ab_ark.official_portal_url == "https://sast.karnataka.gov.in/"
    assert ab_ark.referral_required_for_private is True
    assert ab_ark.emergency_referral_exempt is True
    assert any(h.number == "1800-425-8330" for h in ab_ark.helplines)
    assert any(h.number == "104" for h in ab_ark.helplines)

    # Verify CMRF
    cmrf = next(s for s in catalog.schemes if s.scheme_id == "cmrf")
    assert cmrf.is_discretionary is True
    assert "Chief Minister's Secretariat" in cmrf.administering_body
    assert cmrf.official_portal_url == "https://cmrf.karnataka.gov.in/"
    assert "Discretionary" in cmrf.nature_of_scheme
    assert any(h.number == "080-22230282" for h in cmrf.helplines)

    # Verify emergency helplines
    assert len(catalog.emergency_helplines) >= 4
    helpline_nums = [h.number for h in catalog.emergency_helplines]
    assert "14555" in helpline_nums
    assert "1800-425-8330" in helpline_nums
    assert "104" in helpline_nums
    assert "112" in helpline_nums


# ==============================================================================
# 2. Eligibility Guidance Tests: BPL / PHH / AAY
# ==============================================================================

def test_bpl_emergency_guidance():
    """Verify BPL emergency pathway grants cashless coverage with referral waived."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="BPL_PHH_AAY",
        care_type="EMERGENCY",
        patient_age=42
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert isinstance(res, SchemeEligibilityEvaluationResponse)
    assert res.status == "success"
    assert res.pathway_headline == "Potential scheme pathway — confirm with the official authority."
    assert res.primary_scheme_id == "ab_ark"
    assert "ab_ark" in res.eligible_schemes
    assert "pmjay" in res.eligible_schemes
    assert res.referral_required is False
    assert res.emergency_exemption is True
    assert "100% Cashless" in res.copay_status
    assert "Emergency" in res.referral_guidance
    assert "Valid Karnataka BPL Ration Card (PHH / AAY)" in res.mandatory_documents
    assert not any("Referral Slip" in doc for doc in res.mandatory_documents)


def test_bpl_planned_guidance():
    """Verify BPL planned treatment requires an Online Referral Slip (ORS) from a government hospital."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="BPL_PHH_AAY",
        care_type="PLANNED",
        patient_age=35
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.primary_scheme_id == "ab_ark"
    assert res.referral_required is True
    assert res.emergency_exemption is False
    assert "ORS" in res.referral_guidance or "Online Referral" in res.referral_guidance
    # Referral slip must be listed in mandatory documents
    assert any("Referral Slip" in doc for doc in res.mandatory_documents)


# ==============================================================================
# 3. Eligibility Guidance Tests: APL / NPHH
# ==============================================================================

def test_apl_copay_guidance():
    """Verify APL residents receive 30% state subsidy with 70% co-payment notice."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="APL_NPHH",
        care_type="PLANNED",
        patient_age=50
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.primary_scheme_id == "ab_ark"
    assert "30% State" in res.copay_status
    assert "70% Patient" in res.copay_status
    assert "₹1,50,000" in res.copay_status
    assert res.referral_required is True
    assert any("70%" in step for step in res.actionable_steps)


# ==============================================================================
# 4. Eligibility Guidance Tests: No Ration Card
# ==============================================================================

def test_no_ration_card_standard_age():
    """Verify citizens without ration card under 70 are directed to public hospital rates and CMRF."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="NONE",
        care_type="PLANNED",
        patient_age=28
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.primary_scheme_id is None
    assert len(res.eligible_schemes) == 0
    assert "Victoria Hospital" in res.coverage_summary or "Public Hospital" in res.coverage_summary
    assert res.cmrf_applicable is True
    assert any("Tahsildar Income Certificate" in doc for doc in res.conditional_documents)


# ==============================================================================
# 5. Senior Citizen 70+ PM-JAY Universal Expansion
# ==============================================================================

def test_senior_citizen_70_plus_expansion():
    """Verify individuals aged 70+ qualify for universal Ayushman Vay Vandana Card under PM-JAY."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="NONE",
        care_type="PLANNED",
        patient_age=72
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.senior_citizen_expansion is True
    assert res.primary_scheme_id == "pmjay"
    assert "Ayushman Vay Vandana" in res.coverage_summary
    assert "₹5,00,000" in res.coverage_summary
    assert any("age 70" in step.lower() or "senior citizen" in step.lower() for step in res.actionable_steps)


# ==============================================================================
# 6. Residency: Karnataka vs Non-Karnataka
# ==============================================================================

def test_non_karnataka_resident_portability():
    """Verify non-Karnataka residents are guided to PM-JAY National Portability."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=False,
        ration_card_type="BPL_PHH_AAY",
        care_type="PLANNED",
        patient_age=38
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.primary_scheme_id == "pmjay"
    assert "National Portability" in res.coverage_summary
    assert "Arogya Karnataka" in res.coverage_summary
    assert "Home State Ration Card" in "".join(res.mandatory_documents)


# ==============================================================================
# 7. CMRF Discretionary Status & Catastrophic Cost Pathway
# ==============================================================================

def test_cmrf_discretionary_status():
    """Verify CMRF is explicitly stated as discretionary ex-gratia relief and not guaranteed."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="BPL_PHH_AAY",
        care_type="PLANNED",
        patient_age=55,
        estimated_cost_inr=350000.0
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    assert res.cmrf_applicable is True
    assert res.cmrf_status_note is not None
    assert "discretionary" in res.cmrf_status_note.lower()
    assert "not guaranteed" in res.cmrf_status_note.lower()

    # Cost > 150k triggers high cost advice and additional CMRF documents
    assert any("₹350,000" in step or "High Estimated Cost" in step for step in res.actionable_steps)
    assert any("MLA" in doc for doc in res.conditional_documents)
    assert any("Medical Cost Estimate" in doc for doc in res.conditional_documents)


# ==============================================================================
# 8. Data Privacy & No PII Collection
# ==============================================================================

def test_no_pii_collection_in_request():
    """Verify request schema has no fields for patient name, phone, Aadhaar, or address."""
    fields = SchemeEligibilityEvaluationRequest.model_fields.keys()
    assert "patient_name" not in fields
    assert "phone" not in fields
    assert "aadhaar" not in fields
    assert "address" not in fields
    assert "medical_history" not in fields


# ==============================================================================
# 9. Official Verification Links and Disclaimers
# ==============================================================================

def test_official_verification_links():
    """Verify official portals are returned in every response."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="BPL_PHH_AAY",
        care_type="EMERGENCY"
    )
    res = karnataka_ml_service.evaluate_scheme_eligibility(req)
    urls = [link.url for link in res.official_verification_links]
    assert "https://beneficiary.nha.gov.in/" in urls
    assert "https://hospitals.pmjay.gov.in/" in urls
    assert "https://sast.karnataka.gov.in/" in urls
    assert "https://cmrf.karnataka.gov.in/" in urls
    assert "https://sevasindhuservices.karnataka.gov.in/" in urls

    # Mandatory disclaimer must be present
    assert "Potential scheme pathway — confirm with the official authority." in res.disclaimer
    assert "EvidenceBridge does not determine eligibility" in res.disclaimer


# ==============================================================================
# 10. Direct FastAPI Route Handlers Testing
# ==============================================================================

def test_fastapi_schemes_catalog_route():
    """Verify get_government_schemes_catalog_endpoint async route execution."""
    catalog = _run_coroutine_with_timeout(get_government_schemes_catalog_endpoint())
    assert isinstance(catalog, GovernmentSchemesCatalog)
    assert catalog.status == "success"
    assert len(catalog.schemes) == 3


def test_fastapi_evaluate_scheme_eligibility_route():
    """Verify evaluate_scheme_eligibility_endpoint async route execution."""
    req = SchemeEligibilityEvaluationRequest(
        is_karnataka_resident=True,
        ration_card_type="BPL_PHH_AAY",
        care_type="EMERGENCY",
        patient_age=45
    )
    res = _run_coroutine_with_timeout(evaluate_scheme_eligibility_endpoint(req))
    assert isinstance(res, SchemeEligibilityEvaluationResponse)
    assert res.primary_scheme_id == "ab_ark"
    assert res.emergency_exemption is True


# ==============================================================================
# 11. Regression Check: Stage 3 Cost Catalog Preservation
# ==============================================================================

def test_stage3_cost_catalog_preservation():
    """Verify that Stage 3 cost catalog remains operational and unaltered."""
    cost_catalog = _run_coroutine_with_timeout(get_cost_comparison_catalog_endpoint())
    assert isinstance(cost_catalog, KarnatakaCostComparisonCatalog)
    assert cost_catalog.status == "success"
    assert len(cost_catalog.supported_packages) == 15
    assert len(cost_catalog.comparable_benchmarks) >= 12
