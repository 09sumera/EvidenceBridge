"""
API Integration tests for EvidenceBridge SMTP OTP Authentication Endpoints.
Tests:
- POST /api/v1/auth/otp/send
- POST /api/v1/auth/otp/verify
- GET /api/v1/auth/otp/status
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.otp_service import otp_service


@pytest.fixture
def client():
    # Use FastAPI TestClient (sync HTTP client)
    return TestClient(app)


def test_get_otp_status_endpoint(client):
    """Verify public OTP and SMTP status metadata endpoint."""
    response = client.get("/api/v1/auth/otp/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "smtp_relay" in data
    assert "otp_expiry_seconds" in data
    assert "resend_cooldown_seconds" in data
    assert data["max_attempts"] == 5


def test_otp_send_and_verify_flow(client):
    """End-to-end test of sending OTP via SMTP and verifying the code."""
    test_email = "audit.specialist@shreemedical.in"

    # Clean in-flight challenge if any
    otp_service._records.pop(test_email, None)

    # 1. Request OTP
    send_payload = {
        "email": test_email,
        "portal": "hospital_management",
        "name": "Dr. Ramesh HOD",
        "organization": "Shree Medical Institute",
        "purpose": "login",
    }
    res_send = client.post("/api/v1/auth/otp/send", json=send_payload)
    assert res_send.status_code == 200
    send_data = res_send.json()
    assert send_data["success"] is True
    assert send_data["email"] == test_email
    assert send_data["expires_in_seconds"] == 600
    assert send_data["resend_cooldown_seconds"] == 30

    # 2. Immediate second request triggers rate limit (429)
    res_rate_limit = client.post("/api/v1/auth/otp/send", json=send_payload)
    assert res_rate_limit.status_code == 429
    assert "wait" in res_rate_limit.json()["detail"].lower()

    # 3. Fetch dispatched code from active challenge
    challenge = otp_service._records.get(test_email)
    assert challenge is not None
    code = challenge["code"]

    # 4. Incorrect code returns 401 with attempt countdown
    bad_verify_payload = {
        "email": test_email,
        "code": "000000",
        "portal": "hospital_management",
    }
    res_bad = client.post("/api/v1/auth/otp/verify", json=bad_verify_payload)
    assert res_bad.status_code == 401
    assert "remaining" in res_bad.json()["detail"]

    # 5. Correct code verifies and returns signed JWT access token and user session
    good_verify_payload = {
        "email": test_email,
        "code": code,
        "portal": "hospital_management",
        "name": "Shree Medical Institute",
    }
    res_good = client.post("/api/v1/auth/otp/verify", json=good_verify_payload)
    assert res_good.status_code == 200
    verify_data = res_good.json()
    assert verify_data["success"] is True
    assert verify_data["access_token"]
    assert verify_data["token_type"] == "bearer"
    assert verify_data["user"]["email"] == test_email
    assert verify_data["user"]["role"] == "HOSPITAL_MANAGEMENT"


def test_invalid_email_send(client):
    """Verify rejection of malformed email addresses."""
    res = client.post(
        "/api/v1/auth/otp/send",
        json={"email": "not-an-email", "portal": "patient"},
    )
    assert res.status_code == 400
