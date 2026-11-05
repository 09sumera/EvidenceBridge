"""
Unit tests for EvidenceBridge SMTP OTP System.
Tests OTP generation, email validation, rate-limiting cooldown,
attempt limits/lockout, expiration, and verification.
"""

import pytest
import asyncio
from datetime import datetime, timezone, timedelta

from app.services.otp_service import OTPService
from app.services.smtp_service import _build_otp_email_html, _build_otp_email_text


@pytest.fixture
def otp_svc():
    """Provides a fresh, isolated OTPService instance for each test."""
    return OTPService()


def test_otp_generation(otp_svc):
    """Verify that generated OTP codes are 6-digit numeric strings."""
    codes = set()
    for _ in range(50):
        code = otp_svc.generate_secure_otp()
        assert len(code) == 6
        assert code.isdigit()
        assert int(code) >= 100000
        codes.add(code)
    # Ensure reasonable entropy/uniqueness
    assert len(codes) >= 45


def test_email_validation(otp_svc):
    """Validate email formatting rules."""
    assert otp_svc.is_valid_email("patient@evidencebridge.local") is True
    assert otp_svc.is_valid_email("admin@shreemedical.in") is True
    assert otp_svc.is_valid_email("user.name+tag@domain.co.in") is True

    assert otp_svc.is_valid_email("invalid-email") is False
    assert otp_svc.is_valid_email("missing-at.com") is False
    assert otp_svc.is_valid_email("@domain.com") is False
    assert otp_svc.is_valid_email("") is False


def test_request_otp_success_and_cooldown(otp_svc):
    """Test standard OTP request flow and resend cooldown rate-limiting."""
    async def _test():
        email = "test.patient@evidencebridge.local"

        # First request should succeed
        success, msg, meta = await otp_svc.request_otp(
            email=email,
            portal="patient",
            name="Ramesh Kumar",
            purpose="login",
        )
        assert success is True
        assert meta["email"] == email
        assert meta["expires_in_seconds"] > 0
        assert "dev_otp" in meta or meta["delivery_method"] in ("smtp", "dev_simulated")

        # Immediate second request should be blocked by rate limit cooldown
        success2, msg2, meta2 = await otp_svc.request_otp(
            email=email,
            portal="patient",
        )
        assert success2 is False
        assert "wait" in msg2.lower()
        assert meta2.get("resend_cooldown_seconds", 0) > 0

    asyncio.run(_test())


def test_verify_otp_success(otp_svc):
    """Test successful OTP verification."""
    async def _test():
        email = "test.verify@evidencebridge.local"
        success, _, meta = await otp_svc.request_otp(
            email=email,
            portal="patient",
            name="Ramesh Kumar",
        )
        assert success is True

        record = otp_svc._records[email]
        actual_code = record["code"]

        # Verify with correct code
        v_success, v_msg, user_ctx = await otp_svc.verify_otp(
            email=email,
            code=actual_code,
            portal="patient",
        )
        assert v_success is True
        assert "verified" in v_msg.lower()
        assert user_ctx["email"] == email
        assert user_ctx["portal"] == "patient"

        # Subsequent verification with the same code must fail (single-use)
        v_success2, _, _ = await otp_svc.verify_otp(
            email=email,
            code=actual_code,
        )
        assert v_success2 is False

    asyncio.run(_test())


def test_verify_otp_incorrect_code_and_lockout(otp_svc):
    """Test incorrect attempt decrementing and lockout after max attempts."""
    async def _test():
        email = "test.lockout@evidencebridge.local"
        await otp_svc.request_otp(email=email, portal="patient")

        # 4 incorrect attempts
        for attempt in range(1, 5):
            v_success, v_msg, _ = await otp_svc.verify_otp(
                email=email,
                code="000000",
            )
            assert v_success is False
            assert "attempt(s) remaining" in v_msg

        # 5th incorrect attempt -> triggers lockout
        v_success5, v_msg5, _ = await otp_svc.verify_otp(
            email=email,
            code="000000",
        )
        assert v_success5 is False
        assert "invalidated" in v_msg5.lower() or "too many" in v_msg5.lower()
        # Record must be purged
        assert email not in otp_svc._records

    asyncio.run(_test())


def test_verify_otp_expiration(otp_svc):
    """Test that expired OTPs are rejected."""
    async def _test():
        email = "test.expired@evidencebridge.local"
        await otp_svc.request_otp(email=email, portal="patient")

        # Artificially set expiration in the past
        otp_svc._records[email]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=10)

        v_success, v_msg, _ = await otp_svc.verify_otp(
            email=email,
            code=otp_svc._records[email]["code"],
        )
        assert v_success is False
        assert "expired" in v_msg.lower()
        assert email not in otp_svc._records

    asyncio.run(_test())


def test_email_template_rendering():
    """Verify HTML and plain-text templates render code and recipient properly."""
    html = _build_otp_email_html("Dr. Sunita", "584920", "Hospital Management", 10)
    assert "584920" in html
    assert "Dr. Sunita" in html
    assert "Hospital Management" in html
    assert "10 minutes" in html

    text = _build_otp_email_text("Dr. Sunita", "584920", "Hospital Management", 10)
    assert "584920" in text
    assert "Dr. Sunita" in text
    assert "10 minutes" in text


if __name__ == "__main__":
    print("Testing otp_generation...")
    s = OTPService()
    test_otp_generation(s)
    print("Testing email_validation...")
    test_email_validation(s)
    print("Testing request_otp_success_and_cooldown...")
    test_request_otp_success_and_cooldown(s)
    print("Testing verify_otp_success...")
    test_verify_otp_success(s)
    print("Testing verify_otp_incorrect_code_and_lockout...")
    test_verify_otp_incorrect_code_and_lockout(s)
    print("Testing verify_otp_expiration...")
    test_verify_otp_expiration(s)
    print("Testing email_template_rendering...")
    test_email_template_rendering()
    print("ALL TESTS PASSED SUCCESSFULLY!")
