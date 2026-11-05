"""
Unit and Integration Tests for Karnataka ML External Service Integration (Stage 1).

Covers:
1. Treatment Package Cost Prediction (success, upstream 400, Sakhii Hospital warning preservation).
2. Hospital Anomaly Detection (11 numeric features, NOT_FLAGGED vs REVIEW, IsolationForest contract).
3. Hospital Directory Evidence Assessment (15 directory features, completeness percentage & category).
4. Hospital Recommendation (district/specialty filtering, distance/price status preservation).
5. Upstream error & resilience handling:
   - Upstream timeout / Render cold start (504)
   - Connection failure / offline host (503)
   - Upstream server error (500)
   - Non-JSON / HTML response (502 / invalid_external_response)
6. FastAPI Route Endpoint verification:
   - predict_treatment_cost_endpoint
   - predict_hospital_anomaly_endpoint
   - assess_hospital_evidence_endpoint
   - recommend_hospitals_endpoint
   - hospital_ml_health_endpoint
7. Pydantic request schema validation:
   - Mandatory field enforcement
   - Limit range enforcement (1 <= limit <= 50)
   - Type coercion and validation failure handling
"""

import inspect
import time
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import pydantic
import pytest

from app.api.routes import (
    assess_hospital_evidence_endpoint,
    hospital_ml_health_endpoint,
    predict_hospital_anomaly_endpoint,
    predict_treatment_cost_endpoint,
    recommend_hospitals_endpoint,
)
from app.models.schemas import (
    KarnatakaAnomalyPredictRequest,
    KarnatakaCostPredictRequest,
    KarnatakaEvidenceAssessRequest,
    KarnatakaHospitalRecommendRequest,
    KarnatakaMLResponseEnvelope,
)
from app.services.karnataka_ml import KarnatakaMLService, karnataka_ml_service


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
            raise TimeoutError(
                f"Coroutine exceeded {timeout_seconds}s timeout: {coro}"
            )
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


def _create_mock_client(mock_response=None, side_effect=None):
    """Helper to create an AsyncMock client for httpx without socket initialization."""
    mock_client = AsyncMock()
    if side_effect:
        mock_client.post = AsyncMock(side_effect=side_effect)
    else:
        mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


# ============================================================================
# 1. Cost Prediction Tests
# ============================================================================

def test_cost_prediction_success():
    """Verify cost prediction parses upstream fields and attaches Sakhii scope warning."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "data": {
            "hospital": "Sakhii Hospital",
            "district": "Bengaluru",
            "package": "Normal Delivery",
            "room_category": "Deluxe",
            "published_reference_price_inr": 35000.0,
            "experimental_ml_estimate_inr": 36200.0,
            "difference_inr": 1200.0,
            "price_type": "Published hospital package tariff",
            "model_status": "Experimental",
            "karnataka_wide_prediction": False,
            "package_scope_verified": False
        }
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        payload = KarnatakaCostPredictRequest(
            package_name="Normal Delivery",
            room_category="Deluxe"
        )
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_treatment_cost(payload)
        )

    assert res["status"] == "success"
    assert res["upstream_status_code"] == 200
    assert res["data"]["hospital"] == "Sakhii Hospital"
    assert res["data"]["published_reference_price_inr"] == 35000.0
    assert res["data"]["experimental_ml_estimate_inr"] == 36200.0
    assert res["data"]["difference_inr"] == 1200.0
    assert res["data"]["karnataka_wide_prediction"] is False
    assert "Sakhii Hospital" in res["warning"]


def test_cost_prediction_upstream_validation_error():
    """Verify 400 Bad Request from upstream returns validation_error."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 400
    mock_response.json.return_value = {
        "success": False,
        "error": "No published reference price for this package-room combination."
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_treatment_cost({
                "package_name": "Unpublished Surgery",
                "room_category": "Deluxe"
            })
        )

    assert res["status"] == "validation_error"
    assert res["upstream_status_code"] == 400
    assert "No published reference price" in res["error"]
    assert res["data"] is None


# ============================================================================
# 2. Hospital Anomaly Detection Tests
# ============================================================================

def test_anomaly_predict_not_flagged():
    """Verify anomaly detection contract with 11 features returning NOT_FLAGGED."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "data": {
            "anomaly_prediction": 1,
            "anomaly_score": 0.045123,
            "review_flag": "NOT_FLAGGED",
            "model": "IsolationForest",
            "model_purpose": "Hospital directory data-quality review",
            "records_used_for_training": 2226,
            "warning": "A review flag indicates an unusual directory record. It is not proof of fraud or poor hospital quality."
        }
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        payload = KarnatakaAnomalyPredictRequest(
            name_length=24.0,
            name_word_count=3.0,
            name_digit_count=0.0,
            normalized_name_duplicate_count=1.0,
            Hospital_Category_frequency=0.45,
            Hospital_Care_Type_frequency=0.60,
            Discipline_Systems_of_Medicine_frequency=0.85,
            district_record_count=142.0,
            pincode_valid_format=1.0,
            coordinates_valid_format=1.0,
            valid_contact_count=3.0
        )
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_hospital_anomaly(payload)
        )

    assert res["status"] == "success"
    assert res["data"]["anomaly_prediction"] == 1
    assert res["data"]["review_flag"] == "NOT_FLAGGED"
    assert res["data"]["anomaly_score"] == 0.045123
    assert res["data"]["records_used_for_training"] == 2226
    assert "unusual directory record" in res["warning"]


def test_anomaly_predict_review_flagged():
    """Verify anomaly detection contract returning REVIEW flag."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "data": {
            "anomaly_prediction": -1,
            "anomaly_score": 0.2854,
            "review_flag": "REVIEW",
            "model": "IsolationForest",
            "model_purpose": "Hospital directory data-quality review",
            "records_used_for_training": 2226,
            "warning": "A review flag indicates an unusual directory record. It is not proof of fraud or poor hospital quality."
        }
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_hospital_anomaly({
                "name_length": 5.0,
                "name_word_count": 1.0,
                "name_digit_count": 2.0,
                "normalized_name_duplicate_count": 8.0,
                "Hospital_Category_frequency": 0.05,
                "Hospital_Care_Type_frequency": 0.1,
                "Discipline_Systems_of_Medicine_frequency": 0.1,
                "district_record_count": 12.0,
                "pincode_valid_format": 0.0,
                "coordinates_valid_format": 0.0,
                "valid_contact_count": 0.0
            })
        )

    assert res["status"] == "success"
    assert res["data"]["anomaly_prediction"] == -1
    assert res["data"]["review_flag"] == "REVIEW"


def test_anomaly_predict_missing_features():
    """Verify missing features error from upstream is parsed and reported."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 400
    mock_response.json.return_value = {
        "success": False,
        "error": "Missing required features",
        "missing_features": ["name_length", "valid_contact_count"]
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_hospital_anomaly({})
        )

    assert res["status"] == "validation_error"
    assert res["upstream_status_code"] == 400
    assert "Missing required features" in res["error"]


# ============================================================================
# 3. Evidence Assessment Tests
# ============================================================================

def test_evidence_assess_success():
    """Verify evidence completeness scoring across 15 directory fields."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "data": {
            "Hospital_Name": "Victoria Hospital",
            "District": "Bengaluru Urban",
            "name_available": 1,
            "district_available": 1,
            "pincode_available": 1,
            "coordinates_available": 1,
            "telephone_available": 1,
            "mobile_available": 0,
            "email_available": 1,
            "website_available": 1,
            "specialties_available": 1,
            "facilities_available": 1,
            "care_type_available": 1,
            "category_available": 1,
            "emergency_info_available": 1,
            "established_year_available": 1,
            "empanelment_info_available": 0,
            "evidence_fields_present": 13,
            "evidence_completeness_percentage": 86.67,
            "completeness_category": "HIGH_COMPLETENESS",
            "assessment_note": "Directory information completeness only; not a hospital quality, accreditation or trust rating."
        },
        "assessment_scope": "Directory information completeness only"
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        payload = KarnatakaEvidenceAssessRequest(
            Hospital_Name="Victoria Hospital",
            District="Bengaluru Urban",
            Pincode="560002",
            Location_Coordinates="12.9644, 77.5756",
            Telephone="080-26701150",
            Mobile_Number="",
            Hospital_Primary_Email_Id="info@victoria.kar.nic.in",
            Website="http://victoriahospitalblr.org",
            Specialties="General Medicine, General Surgery",
            Facilities="ICU, Operation Theatre, Blood Bank",
            Hospital_Care_Type="Tertiary",
            Hospital_Category="Government",
            Emergency_Services="Yes - 24/7",
            Establised_Year="1900",
            Empanelment_or_Collaboration_with=""
        )
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.assess_hospital_evidence(payload)
        )

    assert res["status"] == "success"
    assert res["data"]["completeness_category"] == "HIGH_COMPLETENESS"
    assert res["data"]["evidence_completeness_percentage"] == 86.67
    assert res["data"]["evidence_fields_present"] == 13
    assert "Directory information completeness" in res["warning"]


def test_evidence_assess_missing_fields():
    """Verify upstream missing hospital fields error returns validation_error."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 400
    mock_response.json.return_value = {
        "success": False,
        "error": "Missing required hospital fields",
        "missing_fields": ["Hospital_Name", "District"]
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.assess_hospital_evidence({})
        )

    assert res["status"] == "validation_error"
    assert res["upstream_status_code"] == 400
    assert "Missing required hospital fields" in res["error"]


# ============================================================================
# 4. Hospital Recommendation Tests
# ============================================================================

def test_recommend_hospitals_success():
    """Verify recommendation filtering preserves candidate list, filters, and status markers."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "count": 2,
        "filters": {
            "district": "Bengaluru Urban",
            "specialty": "Cardiology",
            "require_coordinates": False
        },
        "data": [
            {
                "Hospital_Name": "Jayadeva Institute of Cardiovascular Sciences",
                "District": "Bengaluru Urban",
                "Specialties": "Cardiology, Cardiac Surgery",
                "evidence_completeness_percentage": 93.33,
                "distance_status": "NOT_CALCULATED",
                "price_status": "NOT_AVAILABLE_IN_SOURCE",
                "availability_status": "NOT_AVAILABLE_IN_SOURCE",
                "clinical_quality_status": "NOT_ASSESSED"
            },
            {
                "Hospital_Name": "Sri Jayadeva Hospital",
                "District": "Bengaluru Urban",
                "Specialties": "Cardiology",
                "evidence_completeness_percentage": 86.67,
                "distance_status": "NOT_CALCULATED",
                "price_status": "NOT_AVAILABLE_IN_SOURCE",
                "availability_status": "NOT_AVAILABLE_IN_SOURCE",
                "clinical_quality_status": "NOT_ASSESSED"
            }
        ],
        "warning": "These are directory-based candidates, not clinically validated hospital rankings. Independent verification is required."
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        payload = KarnatakaHospitalRecommendRequest(
            district="Bengaluru Urban",
            specialty="Cardiology",
            limit=2,
            require_coordinates=False
        )
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.recommend_hospitals(payload)
        )

    assert res["status"] == "success"
    assert res["data"]["count"] == 2
    assert len(res["data"]["hospitals"]) == 2
    first = res["data"]["hospitals"][0]
    assert first["Hospital_Name"] == "Jayadeva Institute of Cardiovascular Sciences"
    assert first["distance_status"] == "NOT_CALCULATED"
    assert first["price_status"] == "NOT_AVAILABLE_IN_SOURCE"
    assert "directory-based candidates" in res["warning"]


def test_recommend_hospitals_sanitizes_unsupported_gps_fields():
    """Verify unsupported GPS/radius fields are stripped before calling external model."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "count": 0, "data": []}

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        # Caller supplies extraneous lat, lon, radius
        ext_payload = {
            "district": "Ballari",
            "limit": 5,
            "latitude": 15.14,
            "longitude": 76.92,
            "radius_km": 10.0
        }
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.recommend_hospitals(ext_payload)
        )

    # Verify what was passed to mock_client.post
    called_payload = mock_client.post.call_args[1]["json"]
    assert "district" in called_payload
    assert "limit" in called_payload
    assert "latitude" not in called_payload
    assert "longitude" not in called_payload
    assert "radius_km" not in called_payload


# ============================================================================
# 5. Resilience & Fault Handling Tests
# ============================================================================

def test_timeout_handling():
    """Verify timeout scenario (e.g. Render cold start) returns structured 504 envelope."""
    mock_client = _create_mock_client(side_effect=httpx.TimeoutException("Read timed out"))
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_treatment_cost({
                "package_name": "Normal Delivery",
                "room_category": "Deluxe"
            })
        )

    assert res["status"] == "external_service_unavailable"
    assert res["upstream_status_code"] == 504
    assert "timed out" in res["error"].lower()
    assert "cold start" in res["error"].lower()


def test_connection_error_handling():
    """Verify connection failure returns structured 503 envelope."""
    mock_client = _create_mock_client(side_effect=httpx.ConnectError("Connection refused"))
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.predict_hospital_anomaly({
                "name_length": 10.0,
                "name_word_count": 2.0,
                "name_digit_count": 0.0,
                "normalized_name_duplicate_count": 1.0,
                "Hospital_Category_frequency": 0.5,
                "Hospital_Care_Type_frequency": 0.5,
                "Discipline_Systems_of_Medicine_frequency": 0.5,
                "district_record_count": 50.0,
                "pincode_valid_format": 1.0,
                "coordinates_valid_format": 1.0,
                "valid_contact_count": 2.0
            })
        )

    assert res["status"] == "external_service_unavailable"
    assert res["upstream_status_code"] == 503
    assert "connection" in res["error"].lower()


def test_upstream_500_error_handling():
    """Verify internal server error from upstream ML service is caught and wrapped."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 500
    mock_response.json.return_value = {
        "success": False,
        "error": "Prediction service internal crash in model.predict()"
    }

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.assess_hospital_evidence({
                "Hospital_Name": "Test Hospital",
                "District": "Ballari"
            })
        )

    assert res["status"] == "external_service_unavailable"
    assert res["upstream_status_code"] == 500
    assert "Prediction service internal crash" in res["error"]


def test_upstream_non_json_response_handling():
    """Verify upstream HTML or 502 Bad Gateway text returns invalid_external_response."""
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 502
    mock_response.json.side_effect = ValueError("No JSON")
    mock_response.text = "<html><body>502 Bad Gateway</body></html>"

    mock_client = _create_mock_client(mock_response)
    with patch("httpx.AsyncClient", return_value=mock_client):
        res = _run_coroutine_with_timeout(
            karnataka_ml_service.recommend_hospitals({"district": "Bengaluru Urban"})
        )

    assert res["status"] == "invalid_external_response"
    assert res["upstream_status_code"] == 502
    assert "non-JSON" in res["error"]


# ============================================================================
# 6. Route Endpoint Handler Tests (Direct Invocations)
# ============================================================================

def test_cost_endpoint_handler():
    """Verify predict_treatment_cost_endpoint delegates to service and returns envelope."""
    mock_return = {
        "status": "success",
        "data": {"hospital": "Sakhii Hospital", "published_reference_price_inr": 35000.0},
        "error": None,
        "warning": "Sakhii Hospital only",
        "upstream_status_code": 200,
        "service_name": "Treatment Package Cost Prediction"
    }

    with patch.object(karnataka_ml_service, "predict_treatment_cost", new_callable=AsyncMock) as mock_svc:
        mock_svc.return_value = mock_return
        payload = KarnatakaCostPredictRequest(package_name="Normal Delivery", room_category="Deluxe")
        envelope = _run_coroutine_with_timeout(predict_treatment_cost_endpoint(payload))

    assert isinstance(envelope, KarnatakaMLResponseEnvelope)
    assert envelope.status == "success"
    assert envelope.data["hospital"] == "Sakhii Hospital"
    assert envelope.upstream_status_code == 200


def test_anomaly_endpoint_handler():
    """Verify predict_hospital_anomaly_endpoint delegates to service and returns envelope."""
    mock_return = {
        "status": "success",
        "data": {"review_flag": "NOT_FLAGGED", "anomaly_prediction": 1},
        "error": None,
        "warning": None,
        "upstream_status_code": 200,
        "service_name": "Hospital Anomaly Detection"
    }

    with patch.object(karnataka_ml_service, "predict_hospital_anomaly", new_callable=AsyncMock) as mock_svc:
        mock_svc.return_value = mock_return
        payload = KarnatakaAnomalyPredictRequest(
            name_length=20.0, name_word_count=3.0, name_digit_count=0.0,
            normalized_name_duplicate_count=1.0, Hospital_Category_frequency=0.5,
            Hospital_Care_Type_frequency=0.5, Discipline_Systems_of_Medicine_frequency=0.5,
            district_record_count=100.0, pincode_valid_format=1.0,
            coordinates_valid_format=1.0, valid_contact_count=3.0
        )
        envelope = _run_coroutine_with_timeout(predict_hospital_anomaly_endpoint(payload))

    assert isinstance(envelope, KarnatakaMLResponseEnvelope)
    assert envelope.status == "success"
    assert envelope.data["review_flag"] == "NOT_FLAGGED"


def test_evidence_endpoint_handler():
    """Verify assess_hospital_evidence_endpoint delegates to service and returns envelope."""
    mock_return = {
        "status": "success",
        "data": {"completeness_category": "HIGH_COMPLETENESS", "evidence_completeness_percentage": 90.0},
        "error": None,
        "warning": "Directory completeness only",
        "upstream_status_code": 200,
        "service_name": "Hospital Directory Evidence Assessment"
    }

    with patch.object(karnataka_ml_service, "assess_hospital_evidence", new_callable=AsyncMock) as mock_svc:
        mock_svc.return_value = mock_return
        payload = KarnatakaEvidenceAssessRequest(
            Hospital_Name="Bowring & Lady Curzon Hospital",
            District="Bengaluru Urban"
        )
        envelope = _run_coroutine_with_timeout(assess_hospital_evidence_endpoint(payload))

    assert isinstance(envelope, KarnatakaMLResponseEnvelope)
    assert envelope.status == "success"
    assert envelope.data["completeness_category"] == "HIGH_COMPLETENESS"


def test_recommend_endpoint_handler():
    """Verify recommend_hospitals_endpoint delegates to service and returns envelope."""
    mock_return = {
        "status": "success",
        "data": {"count": 1, "hospitals": [{"Hospital_Name": "District Hospital Ballari"}]},
        "error": None,
        "warning": "Directory-based candidates",
        "upstream_status_code": 200,
        "service_name": "Hospital Recommendation"
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_svc:
        mock_svc.return_value = mock_return
        payload = KarnatakaHospitalRecommendRequest(district="Ballari", limit=5)
        envelope = _run_coroutine_with_timeout(recommend_hospitals_endpoint(payload))

    assert isinstance(envelope, KarnatakaMLResponseEnvelope)
    assert envelope.status == "success"
    assert envelope.data["count"] == 1


def test_health_endpoint_handler():
    """Verify hospital_ml_health_endpoint delegates to check_health."""
    with patch.object(karnataka_ml_service, "check_health", new_callable=AsyncMock) as mock_svc:
        mock_svc.return_value = {"status": "online", "upstream_status_code": 200}
        res = _run_coroutine_with_timeout(hospital_ml_health_endpoint())

    assert res["status"] == "online"
    assert res["upstream_status_code"] == 200


# ============================================================================
# 7. Pydantic Schema Validation Tests
# ============================================================================

def test_cost_schema_requires_fields():
    """Verify missing package_name or room_category raises ValidationError."""
    with pytest.raises(pydantic.ValidationError):
        KarnatakaCostPredictRequest(package_name="Only Package")

    with pytest.raises(pydantic.ValidationError):
        KarnatakaCostPredictRequest(room_category="Only Room")


def test_recommend_schema_limit_validation():
    """Verify limit must be between 1 and 50."""
    # Valid limits
    req1 = KarnatakaHospitalRecommendRequest(limit=1)
    assert req1.limit == 1
    req50 = KarnatakaHospitalRecommendRequest(limit=50)
    assert req50.limit == 50

    # Invalid limits: limit < 1 or limit > 50
    with pytest.raises(pydantic.ValidationError):
        KarnatakaHospitalRecommendRequest(limit=0)

    with pytest.raises(pydantic.ValidationError):
        KarnatakaHospitalRecommendRequest(limit=51)


def test_evidence_schema_defaults():
    """Verify optional directory evidence fields default to empty string."""
    req = KarnatakaEvidenceAssessRequest(
        Hospital_Name="Test Clinic",
        District="Mysuru"
    )
    assert req.Hospital_Name == "Test Clinic"
    assert req.District == "Mysuru"
    assert req.Pincode == ""
    assert req.Location_Coordinates == ""
    assert req.Website == ""
