"""
Unit and integration tests for Feature 1 (Live Hospital Doctor Availability)
and Feature 2 (Emergency SOS System).
"""

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app.main import app
from app.services.storage import storage_service
from app.services.emergency_guidelines import EMERGENCY_PROTOCOLS, get_emergency_protocol


@pytest.fixture
def test_client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Feature 1 Tests: Live Hospital Doctor Availability
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_storage_hospital_availability_flow():
    """Verify storing, retrieving, and listing hospital availability in storage."""
    hosp_id = "hosp_davg_shree_institute"
    
    # 1. Initially no record
    initial = await storage_service.get_hospital_availability("non_existent_hosp_999")
    assert initial is None

    # 2. Save availability
    res = await storage_service.save_hospital_availability(
        hospital_id=hosp_id,
        hospital_name="Shree Medical Institute",
        doctors_available=15,
        emergency_doctors=4,
        nurses_available=32,
        duty_status="Accepting Patients",
        notes="Trauma Bay 1 ready; 3 ventilators available",
        updated_by="Dr. Ramanath",
    )
    assert res["hospital_id"] == hosp_id
    assert res["doctors_available"] == 15
    assert res["emergency_doctors"] == 4
    assert res["nurses_available"] == 32
    assert res["duty_status"] == "Accepting Patients"
    assert res["notes"] == "Trauma Bay 1 ready; 3 ventilators available"
    assert isinstance(res["last_updated"], datetime)

    # 3. Retrieve single hospital availability
    fetched = await storage_service.get_hospital_availability(hosp_id)
    assert fetched is not None
    assert fetched["hospital_id"] == hosp_id
    assert fetched["doctors_available"] == 15

    # 4. List all hospital availabilities
    all_list = await storage_service.get_all_hospital_availabilities()
    assert len(all_list) >= 1
    found = [h for h in all_list if h["hospital_id"] == hosp_id]
    assert len(found) == 1
    assert found[0]["doctors_available"] == 15


def test_api_hospital_availability_endpoints(test_client):
    """Verify FastAPI routes for updating and getting hospital availability."""
    hosp_id = "hosp_blr_manipal"

    # 1. Update availability via API
    payload = {
        "hospital_id": hosp_id,
        "hospital_name": "Manipal Hospital Old Airport Road",
        "doctors_available": 22,
        "emergency_doctors": 6,
        "nurses_available": 45,
        "duty_status": "Accepting Patients",
        "notes": "ER operating at normal capacity",
    }
    post_res = test_client.post(f"/hospitals/{hosp_id}/availability", json=payload)
    assert post_res.status_code == 200, post_res.text
    data = post_res.json()
    assert data["hospital_id"] == hosp_id
    assert data["doctors_available"] == 22
    assert data["emergency_doctors"] == 6
    assert data["duty_status"] == "Accepting Patients"

    # 2. Get single availability via API
    get_res = test_client.get(f"/hospitals/{hosp_id}/availability")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["hospital_id"] == hosp_id
    assert get_data["doctors_available"] == 22

    # 3. Query un-updated hospital returns 404 (requirement: do not return fake 0)
    missing_res = test_client.get("/hospitals/hosp_unregistered_xyz/availability")
    assert missing_res.status_code == 404

    # 4. Get all updated availabilities
    all_res = test_client.get("/hospitals-availability/all")
    assert all_res.status_code == 200
    all_data = all_res.json()
    assert any(h["hospital_id"] == hosp_id for h in all_data)


# ---------------------------------------------------------------------------
# Feature 2 Tests: Emergency SOS System & Clinical Protocols
# ---------------------------------------------------------------------------

def test_emergency_guidelines_reviewed_protocols():
    """Verify authoritative clinical protocols exist for all required emergency types."""
    required_types = [
        "Accident / Trauma",
        "Breathing Difficulty",
        "Chest Pain",
        "Other Emergency",
    ]
    for em_type in required_types:
        proto = get_emergency_protocol(em_type)
        assert proto is not None
        assert "protocol_name" in proto
        assert "primary_action" in proto
        assert len(proto["primary_action"]) > 10
        assert "abcde_protocol" in proto
        assert len(proto["abcde_protocol"]) >= 4
        assert "immediate_diagnostics" in proto
        assert len(proto["immediate_diagnostics"]) >= 2
        assert "critical_precautions" in proto


@pytest.mark.asyncio
async def test_storage_emergency_sos_flow():
    """Verify creating, tracking, and updating emergency SOS requests."""
    hosp_id = "hosp_davg_shree_institute"

    # 1. Create SOS request
    sos_record = await storage_service.create_sos_request(
        emergency_type="Chest Pain",
        hospital_id=hosp_id,
        hospital_name="Shree Medical Institute",
        patient_name="Mohan Rao",
        patient_phone="+91 98450 12345",
        description="Crushing substernal chest pressure with diaphoresis",
        latitude=14.4644,
        longitude=75.9218,
        address="MCC B Block, Davangere",
    )
    assert sos_record["sos_id"].startswith("sos_")
    assert sos_record["status"] == "PENDING"
    assert sos_record["emergency_type"] == "Chest Pain"
    assert sos_record["patient_name"] == "Mohan Rao"
    assert sos_record["clinical_protocol"] is not None
    assert "ACC/AHA" in sos_record["clinical_protocol"]["protocol_name"] or "Coronary" in sos_record["clinical_protocol"]["protocol_name"]

    sos_id = sos_record["sos_id"]

    # 2. Retrieve SOS
    fetched = await storage_service.get_sos_request(sos_id)
    assert fetched is not None
    assert fetched["sos_id"] == sos_id

    # 3. Transition: PENDING -> ACKNOWLEDGED
    ack_res = await storage_service.update_sos_status(
        sos_id=sos_id,
        new_status="ACKNOWLEDGED",
        response_notes="Triage desk acknowledged; preparing ECG & cath bay",
    )
    assert ack_res["status"] == "ACKNOWLEDGED"
    assert ack_res["acknowledged_at"] is not None

    # 4. Transition: ACKNOWLEDGED -> RESPONDING
    resp_res = await storage_service.update_sos_status(
        sos_id=sos_id,
        new_status="RESPONDING",
        response_notes="BLS Ambulance KA-17-EM-01 dispatched with paramedic",
    )
    assert resp_res["status"] == "RESPONDING"

    # 5. Transition: RESPONDING -> RESOLVED
    res_res = await storage_service.update_sos_status(
        sos_id=sos_id,
        new_status="RESOLVED",
        response_notes="Patient safely received at ER Bay 1; primary PCI underway",
    )
    assert res_res["status"] == "RESOLVED"
    assert res_res["resolved_at"] is not None


def test_api_emergency_sos_endpoints(test_client):
    """Verify FastAPI routes for submitting and managing emergency SOS requests."""
    hosp_id = "hosp_davg_chigateri"

    # 1. Submit SOS distress call (Patient)
    sos_payload = {
        "emergency_type": "Accident / Trauma",
        "hospital_id": hosp_id,
        "hospital_name": "Chigateri District Hospital",
        "patient_name": "Bystander - Ramesh",
        "patient_phone": "+91 99000 88888",
        "description": "Two-wheeler collision on PB Road; severe extremity bleed",
        "latitude": 14.4673,
        "longitude": 75.9250,
        "address": "PB Road, near Bus Stand, Davangere",
    }
    create_res = test_client.post("/sos", json=sos_payload)
    assert create_res.status_code == 201, create_res.text
    sos_data = create_res.json()
    assert sos_data["sos_id"].startswith("sos_")
    assert sos_data["status"] == "PENDING"
    assert sos_data["clinical_protocol"] is not None
    assert "ATLS" in sos_data["clinical_protocol"]["protocol_name"]

    sos_id = sos_data["sos_id"]

    # 2. Get single SOS (Live tracking for patient)
    track_res = test_client.get(f"/sos/{sos_id}")
    assert track_res.status_code == 200
    assert track_res.json()["sos_id"] == sos_id

    # 3. Hospital lists its incoming SOS alerts
    list_res = test_client.get(f"/hospitals/{hosp_id}/sos")
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(s["sos_id"] == sos_id for s in items)

    # 4. Hospital staff updates status to ACKNOWLEDGED
    patch_res = test_client.patch(
        f"/sos/{sos_id}/status",
        json={"status": "ACKNOWLEDGED", "response_notes": "Trauma team activated"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "ACKNOWLEDGED"

    # 5. Hospital staff updates status to RESPONDING
    patch_res2 = test_client.patch(
        f"/sos/{sos_id}/status",
        json={"status": "RESPONDING", "response_notes": "Ambulance en route"},
    )
    assert patch_res2.status_code == 200
    assert patch_res2.json()["status"] == "RESPONDING"
