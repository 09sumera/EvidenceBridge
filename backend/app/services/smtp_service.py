"""
EvidenceBridge SMTP Email Dispatch Service
Provides secure email delivery for OTP verification codes using Python's native smtplib.
Supports STARTTLS, SSL, custom SMTP relays (Gmail, SendGrid, Mailgun, Office365, AWS SES),
and dev-mode local simulation.
"""

import asyncio
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timezone
from typing import Optional

from app.config import get_settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _build_otp_email_html(
    recipient_name: str,
    otp_code: str,
    portal_label: str,
    expires_minutes: int = 10,
) -> str:
    """Generate responsive, secure HTML email template for OTP verification."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your EvidenceBridge Passcode</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
    }}
    .email-container {{
      max-width: 580px;
      margin: 30px auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }}
    .header {{
      background: linear-gradient(135deg, #0b101e 0%, #15203b 100%);
      padding: 28px 32px;
      text-align: center;
      color: #ffffff;
    }}
    .header h1 {{
      margin: 0;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }}
    .header p {{
      margin: 6px 0 0;
      font-size: 13px;
      color: #94a3b8;
    }}
    .content {{
      padding: 36px 32px 28px;
    }}
    .greeting {{
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 8px;
    }}
    .instruction {{
      font-size: 14px;
      color: #475569;
      line-height: 1.6;
      margin-bottom: 24px;
    }}
    .otp-card {{
      background: #f0f9ff;
      border: 2px dashed #0284c7;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }}
    .otp-code {{
      font-family: 'SF Mono', Consolas, Monaco, monospace;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #0369a1;
      margin: 4px 0;
      user-select: all;
    }}
    .otp-meta {{
      font-size: 12px;
      font-weight: 600;
      color: #0284c7;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 6px;
    }}
    .info-box {{
      background: #f8fafc;
      border-left: 4px solid #0ea5e9;
      border-radius: 6px;
      padding: 12px 16px;
      margin: 20px 0;
      font-size: 13px;
      color: #334155;
    }}
    .security-notice {{
      background: #fef2f2;
      border: 1px solid #fee2e2;
      border-radius: 8px;
      padding: 14px;
      margin-top: 24px;
      font-size: 12px;
      color: #991b1b;
      line-height: 1.5;
    }}
    .footer {{
      padding: 20px 32px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.5;
    }}
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>EvidenceBridge</h1>
      <p>Healthcare Claims Intelligence &amp; Verification Platform</p>
    </div>

    <div class="content">
      <div class="greeting">Hello {recipient_name},</div>
      <div class="instruction">
        You requested a one-time verification passcode (OTP) to securely access your EvidenceBridge <strong>{portal_label}</strong> account.
      </div>

      <div class="otp-card">
        <div class="otp-code">{otp_code}</div>
        <div class="otp-meta">&#9201; Valid for {expires_minutes} minutes</div>
      </div>

      <div class="info-box">
        <strong>Session Request Details:</strong><br>
        &bull; Portal Access: {portal_label}<br>
        &bull; Delivery Method: Secure SMTP Relay<br>
        &bull; Dispatched At: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}
      </div>

      <div class="security-notice">
        <strong>&#128274; Security Advisory:</strong> Never share this verification passcode with anyone. EvidenceBridge system administrators or support staff will never ask for your one-time passcode.
      </div>
    </div>

    <div class="footer">
      EvidenceBridge &bull; Automated Security Delivery Service &bull; Do Not Reply to this Email<br>
      This is a transactional security communication sent to authenticate your healthcare vault.
    </div>
  </div>
</body>
</html>
"""


def _build_otp_email_text(
    recipient_name: str,
    otp_code: str,
    portal_label: str,
    expires_minutes: int = 10,
) -> str:
    """Generate clean plain-text email fallback."""
    return f"""Hello {recipient_name},

Your EvidenceBridge one-time verification passcode (OTP) is:

    ======================
        {otp_code}
    ======================

This passcode is valid for {expires_minutes} minutes.
Portal: {portal_label}
Dispatched At: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

SECURITY NOTICE:
Never share this passcode with anyone. EvidenceBridge staff will never ask for your one-time passcode.
If you did not request this verification code, please ignore this email.

--
EvidenceBridge Healthcare Claims Intelligence & Verification Platform
"""


def _sync_send_smtp_email(
    to_email: str,
    otp_code: str,
    recipient_name: str,
    portal: str,
    expires_minutes: int,
) -> tuple[bool, str, str]:
    """
    Synchronous SMTP transmission.
    Returns (success: bool, message: str, delivery_mode: 'smtp' | 'dev_simulated').
    """
    settings = get_settings()
    portal_label = (
        "Hospital Billing & Staff Management"
        if portal == "hospital_management"
        else "Patient Health Vault"
    )

    clean_email = to_email.strip().lower()
    subject = f"{otp_code} is your EvidenceBridge verification passcode"
    html_content = _build_otp_email_html(recipient_name, otp_code, portal_label, expires_minutes)
    text_content = _build_otp_email_text(recipient_name, otp_code, portal_label, expires_minutes)

    # Check whether real SMTP credentials are provided
    has_credentials = bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD)

    if not has_credentials:
        if settings.OTP_ALLOW_DEV_FALLBACK:
            logger.info(
                f"[SMTP DEV SIMULATION] No SMTP credentials in environment. "
                f"Simulating delivery to {clean_email}.\n"
                f"==> Passcode: {otp_code} (Valid for {expires_minutes}m, Portal: {portal_label}) <=="
            )
            return (
                True,
                f"OTP dispatched to {clean_email} (Dev simulation mode). Code: {otp_code}",
                "dev_simulated",
            )
        else:
            msg = "SMTP credentials (SMTP_USERNAME / SMTP_PASSWORD) are not configured."
            logger.error(f"[SMTP ERROR] {msg}")
            return (False, msg, "failed")

    # Real SMTP Delivery
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = clean_email
        msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")

        # Attach text then HTML (HTML takes precedence in client)
        part_text = MIMEText(text_content, "plain", "utf-8")
        part_html = MIMEText(html_content, "html", "utf-8")
        msg.attach(part_text)
        msg.attach(part_html)

        timeout = settings.SMTP_TIMEOUT_SECONDS
        smtp_user = (settings.SMTP_USERNAME or "").strip()
        smtp_pass = (settings.SMTP_PASSWORD or "").replace(" ", "").strip()

        if settings.SMTP_SSL:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context, timeout=timeout) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout) as server:
                server.ehlo()
                if settings.SMTP_TLS:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)

        logger.info(f"[SMTP SUCCESS] Dispatched OTP code to {clean_email} via {settings.SMTP_HOST}:{settings.SMTP_PORT}")
        return (True, f"OTP verification passcode sent via SMTP to {clean_email}", "smtp")

    except Exception as exc:
        logger.warning(f"[SMTP WARNING] Live SMTP transmission failed ({exc}).")
        if settings.OTP_ALLOW_DEV_FALLBACK:
            logger.info(
                f"[SMTP DEV FALLBACK] Fallback activated for {clean_email}. "
                f"Passcode: {otp_code} (Valid for {expires_minutes}m)"
            )
            return (
                True,
                f"OTP dispatched to {clean_email} (Dev fallback). Code: {otp_code}",
                "dev_simulated",
            )
        return (False, f"Could not dispatch email via SMTP: {str(exc)}", "failed")


async def send_otp_email(
    to_email: str,
    otp_code: str,
    recipient_name: str = "User",
    portal: str = "patient",
    expires_minutes: int = 10,
) -> tuple[bool, str, str]:
    """
    Non-blocking async wrapper for sending an OTP email via SMTP.
    When SMTP credentials are present, runs network transmission in a worker thread.
    In dev simulation mode, returns immediately without thread pool overhead.
    """
    settings = get_settings()
    has_credentials = bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD)
    if not has_credentials:
        return _sync_send_smtp_email(
            to_email=to_email,
            otp_code=otp_code,
            recipient_name=recipient_name,
            portal=portal,
            expires_minutes=expires_minutes,
        )

    return await asyncio.to_thread(
        _sync_send_smtp_email,
        to_email=to_email,
        otp_code=otp_code,
        recipient_name=recipient_name,
        portal=portal,
        expires_minutes=expires_minutes,
    )
