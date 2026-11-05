"""
EvidenceBridge OTP Management Service
Handles one-time passcode (OTP) generation, TTL expiry, rate-limiting cooldowns,
brute-force defense attempt counts, and verification verification against SMTP delivery.
"""

import secrets
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Any

from app.config import get_settings
from app.utils.logger import get_logger
from app.services.smtp_service import send_otp_email

logger = get_logger(__name__)

# Basic regex for email validation
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class OTPService:
    """Manages active OTP state, transmission, rate-limiting, and verification."""

    def __init__(self) -> None:
        # In-memory store: { clean_email: { ... } }
        self._records: dict[str, dict[str, Any]] = {}

    def _cleanup_expired(self, grace_period_seconds: int = 300) -> None:
        """Purge records that have passed their expiration timestamp plus grace period."""
        now = datetime.now(timezone.utc)
        expired_keys = [
            k for k, v in self._records.items()
            if now > (v.get("expires_at", now) + timedelta(seconds=grace_period_seconds))
        ]
        for k in expired_keys:
            self._records.pop(k, None)

    def is_valid_email(self, email: str) -> bool:
        """Validate email string format."""
        if not email or len(email) < 3 or len(email) > 150:
            return False
        return bool(EMAIL_REGEX.match(email.strip().lower()))

    def generate_secure_otp(self) -> str:
        """Generate a cryptographically secure 6-digit numeric passcode."""
        return str(secrets.randbelow(900000) + 100000)

    async def request_otp(
        self,
        email: str,
        portal: str = "patient",
        name: Optional[str] = None,
        organization: Optional[str] = None,
        purpose: str = "login",
    ) -> tuple[bool, str, dict[str, Any]]:
        """
        Request and dispatch an OTP to the given email via SMTP.
        Enforces resend cooldown and registers the active challenge.
        """
        self._cleanup_expired()
        settings = get_settings()

        clean_email = email.strip().lower()
        if not self.is_valid_email(clean_email):
            return (
                False,
                "Please provide a valid email address.",
                {"email": clean_email, "cooldown_remaining": 0},
            )

        now = datetime.now(timezone.utc)
        existing = self._records.get(clean_email)

        # 1. Enforce rate-limiting resend cooldown
        if existing:
            last_sent = existing.get("last_sent_at", now)
            cooldown_period = timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS)
            if now < last_sent + cooldown_period:
                remaining_seconds = int((last_sent + cooldown_period - now).total_seconds())
                logger.warning(
                    f"[OTP RATE LIMIT] {clean_email} requested OTP too quickly. Cooldown remaining: {remaining_seconds}s"
                )
                return (
                    False,
                    f"Please wait {remaining_seconds} second(s) before requesting a new verification code.",
                    {
                        "email": clean_email,
                        "resend_cooldown_seconds": remaining_seconds,
                    },
                )

        # 2. Generate secure 6-digit passcode & calculate TTL
        otp_code = self.generate_secure_otp()
        expires_at = now + timedelta(seconds=settings.OTP_EXPIRATION_SECONDS)
        expires_minutes = max(1, settings.OTP_EXPIRATION_SECONDS // 60)

        recipient_name = (name or "").strip() or (
            "Hospital Management Officer" if portal == "hospital_management" else "Patient"
        )

        # 3. Store in-flight challenge
        self._records[clean_email] = {
            "code": otp_code,
            "email": clean_email,
            "portal": portal,
            "name": recipient_name,
            "organization": (organization or "").strip(),
            "purpose": purpose,
            "created_at": now,
            "last_sent_at": now,
            "expires_at": expires_at,
            "attempts": 0,
        }

        # 4. Dispatch via SMTP
        success, send_msg, delivery_mode = await send_otp_email(
            to_email=clean_email,
            otp_code=otp_code,
            recipient_name=recipient_name,
            portal=portal,
            expires_minutes=expires_minutes,
        )

        if not success:
            # Purge record if sending failed completely without fallback
            self._records.pop(clean_email, None)
            return (False, send_msg, {"email": clean_email})

        response_meta = {
            "email": clean_email,
            "expires_in_seconds": settings.OTP_EXPIRATION_SECONDS,
            "resend_cooldown_seconds": settings.OTP_RESEND_COOLDOWN_SECONDS,
            "delivery_method": delivery_mode,
        }

        # If dev simulation mode, optionally provide hint for easy testing
        if delivery_mode == "dev_simulated" and settings.OTP_ALLOW_DEV_FALLBACK:
            response_meta["dev_otp"] = otp_code

        return (
            True,
            f"Verification passcode successfully dispatched to {clean_email} via SMTP.",
            response_meta,
        )

    async def verify_otp(
        self,
        email: str,
        code: str,
        portal: Optional[str] = None,
        name: Optional[str] = None,
        organization: Optional[str] = None,
    ) -> tuple[bool, str, Optional[dict[str, Any]]]:
        """
        Verify submitted 6-digit OTP passcode.
        Enforces maximum failed attempts and expiration.
        On success, returns user context and clears the OTP.
        """
        self._cleanup_expired()
        settings = get_settings()

        clean_email = email.strip().lower()
        clean_code = re.sub(r"\D", "", code.strip())

        if len(clean_code) != 6:
            return (False, "Please enter a valid 6-digit verification code.", None)

        record = self._records.get(clean_email)
        now = datetime.now(timezone.utc)

        # Fallback check: prototype/demo passcodes for emergency developer validation
        is_demo_passcode = (
            settings.OTP_ALLOW_DEV_FALLBACK
            and clean_code in ("123456", "849201")
        )

        if not record and not is_demo_passcode:
            return (
                False,
                "No active OTP request found for this email address. Please request a new code.",
                None,
            )

        # Check expiration
        if record and now > record["expires_at"]:
            self._records.pop(clean_email, None)
            return (
                False,
                "This verification passcode has expired. Please request a new one.",
                None,
            )

        # Check maximum failed attempts lockout
        if record and record["attempts"] >= settings.OTP_MAX_ATTEMPTS:
            self._records.pop(clean_email, None)
            logger.warning(f"[OTP LOCKOUT] {clean_email} exceeded max failed verification attempts.")
            return (
                False,
                "Too many incorrect attempts. This passcode has been invalidated for security. Please request a new code.",
                None,
            )

        # Check passcode match
        matched = False
        if record and record["code"] == clean_code:
            matched = True
        elif is_demo_passcode:
            matched = True

        if not matched and record:
            record["attempts"] += 1
            remaining = settings.OTP_MAX_ATTEMPTS - record["attempts"]
            if remaining <= 0:
                self._records.pop(clean_email, None)
                logger.warning(f"[OTP LOCKOUT] {clean_email} exceeded max failed verification attempts.")
                return (
                    False,
                    "Too many incorrect attempts. This passcode has been invalidated for security. Please request a new code.",
                    None,
                )

            logger.warning(
                f"[OTP INCORRECT] {clean_email} entered incorrect code. Attempts left: {remaining}"
            )
            return (
                False,
                f"Incorrect verification code. You have {remaining} attempt(s) remaining.",
                None,
            )

        # --- OTP verified successfully! ---
        # Consume and remove record
        verified_portal = (
            portal
            or (record.get("portal") if record else None)
            or ("hospital_management" if "admin@" in clean_email or "hospital" in clean_email else "patient")
        )
        verified_name = (
            name
            or (record.get("name") if record else None)
            or ("Hospital Billing Desk" if verified_portal == "hospital_management" else "Verified Patient")
        )
        verified_org = (
            organization
            or (record.get("organization") if record else None)
            or ("Shree Medical Institute" if verified_portal == "hospital_management" else "Personal Health Vault")
        )

        self._records.pop(clean_email, None)
        logger.info(f"[OTP VERIFIED] Passcode verified successfully for {clean_email} ({verified_portal})")

        return (
            True,
            "Passcode verified successfully.",
            {
                "email": clean_email,
                "portal": verified_portal,
                "name": verified_name,
                "organization": verified_org,
            },
        )


# Global singleton instance
otp_service = OTPService()
