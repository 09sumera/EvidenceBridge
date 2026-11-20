"""
Regression test for Aarav Sharma prescription document processing in EvidenceBridge.

Verifies:
1. Document is classified and routed as a 'prescription'.
2. Prescriptions do not enter billing reconciliation (billing_reconciliation is None).
3. Table row and column relationships are preserved during OCR extraction.
4. Medicine name, dosage, frequency, and duration are accurately extracted:
   - Row 1: Cetirizine 10 mg Tablet | 1 tablet | Once daily (at night) | 5 days
   - Row 2: Fluticasone Nasal Spray | 1 spray in each nostril | Twice daily | 7 days
5. Serial numbers (1, 2) and clinical descriptors ('Duration', 'Spray') are never interpreted as monetary amounts.
6. Genuine invoices and hospital bills continue to reconcile correctly.
"""

from pathlib import Path
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services.ocr_service import ocr_service
from app.services.ner import ner_service
from app.services.billing_reconciliation import billing_reconciliation_service
from app.services.claim_context import ClaimContextService
from app.models.schemas import Claim, ProvenanceMetadata, ExtractedFields, BillingClassification


@pytest.fixture(scope="module")
def aarav_prescription_image_path(tmp_path_factory) -> Path:
    """Generate synthetic image matching the exact Aarav Sharma prescription layout."""
    tmp_dir = tmp_path_factory.mktemp("rx_images")
    img_path = tmp_dir / "aarav_prescription.png"

    img = Image.new("RGB", (900, 600), color="white")
    draw = ImageDraw.Draw(img)

    try:
        font_title = ImageFont.truetype("arial.ttf", 22)
        font_bold = ImageFont.truetype("arialbd.ttf", 16)
        font_body = ImageFont.truetype("arial.ttf", 15)
    except Exception:
        font_title = ImageFont.load_default()
        font_bold = ImageFont.load_default()
        font_body = ImageFont.load_default()

    # Header
    draw.text((50, 30), "GREEN VALLEY FAMILY CLINIC", fill="black", font=font_title)
    draw.text((50, 65), "Outpatient Prescription", fill="navy", font=font_bold)
    draw.line([(50, 95), (850, 95)], fill="gray", width=2)

    draw.text((50, 110), "Patient Name: Aarav Sharma", fill="black", font=font_body)
    draw.text((550, 110), "Date: 18 Nov 2026", fill="black", font=font_body)
    draw.text((50, 140), "Age / Gender: 32 years / Male", fill="black", font=font_body)
    draw.text((50, 170), "Diagnosis: Seasonal allergic rhinitis", fill="black", font=font_body)

    # Table Header
    y_table = 220
    draw.line([(50, y_table), (850, y_table)], fill="black", width=2)
    draw.text((60, y_table + 8), "Sl. No.", fill="black", font=font_bold)
    draw.text((140, y_table + 8), "Medicine", fill="black", font=font_bold)
    draw.text((400, y_table + 8), "Dosage", fill="black", font=font_bold)
    draw.text((550, y_table + 8), "Frequency", fill="black", font=font_bold)
    draw.text((720, y_table + 8), "Duration", fill="black", font=font_bold)
    draw.line([(50, y_table + 35), (850, y_table + 35)], fill="black", width=1)

    # Row 1
    y_r1 = y_table + 45
    draw.text((70, y_r1), "1", fill="black", font=font_body)
    draw.text((140, y_r1), "Cetirizine 10 mg Tablet", fill="black", font=font_body)
    draw.text((400, y_r1), "1 tablet", fill="black", font=font_body)
    draw.text((550, y_r1), "Once daily (at night)", fill="black", font=font_body)
    draw.text((730, y_r1), "5 days", fill="black", font=font_body)
    draw.line([(50, y_r1 + 30), (850, y_r1 + 30)], fill="lightgray", width=1)

    # Row 2 (with multi-line dosage text)
    y_r2 = y_r1 + 40
    draw.text((70, y_r2), "2", fill="black", font=font_body)
    draw.text((140, y_r2), "Fluticasone Nasal Spray", fill="black", font=font_body)
    draw.text((400, y_r2), "1 spray", fill="black", font=font_body)
    draw.text((400, y_r2 + 18), "in each nostril", fill="black", font=font_body)
    draw.text((550, y_r2 + 9), "Twice daily", fill="black", font=font_body)
    draw.text((730, y_r2 + 9), "7 days", fill="black", font=font_body)
    draw.line([(50, y_r2 + 45), (850, y_r2 + 45)], fill="black", width=2)

    draw.text((50, 380), "Advice: Drink fluids and follow up if symptoms persist.", fill="black", font=font_body)
    draw.text((650, 440), "Dr. R. Mehta, MBBS", fill="black", font=font_bold)

    img.save(img_path)
    return img_path


def test_aarav_prescription_ocr_reading_order_and_clustering(aarav_prescription_image_path):
    """Preserve table row and column relationships during OCR extraction."""
    image_bytes = aarav_prescription_image_path.read_bytes()
    res = ocr_service.extract_text_from_image_bytes(image_bytes)

    assert res["text"], "OCR extraction should yield non-empty text."
    lines = res["lines"]
    assert len(lines) >= 7

    # Find row 1 and row 2 in extracted OCR lines
    r1_line = next((l for l in lines if "Cetirizine" in l), None)
    r2_line = next((l for l in lines if "Fluticasone" in l), None)

    assert r1_line is not None, "Row 1 with Cetirizine should be extracted as a unified line."
    assert r2_line is not None, "Row 2 with Fluticasone should be extracted as a unified line."

    # Verify column reading order in row 2: serial number (2) -> medicine -> dosage -> frequency -> duration
    assert "2" in r2_line
    assert "Fluticasone Nasal Spray" in r2_line
    assert "1 spray" in r2_line
    assert "Twice daily" in r2_line
    assert "7 days" in r2_line


def test_aarav_prescription_biobert_extraction_and_routing(aarav_prescription_image_path):
    """Verify document type routing and structured field extraction."""
    image_bytes = aarav_prescription_image_path.read_bytes()
    ocr_res = ocr_service.extract_text_from_image_bytes(image_bytes)
    text = ocr_res["text"]

    ner_res = ner_service.extract_entities(text)

    # 1. Document type routed as prescription
    assert ner_res.document_type_detected == "prescription", (
        f"Expected 'prescription', got '{ner_res.document_type_detected}'"
    )

    # 2. Medicine count == 2
    assert ner_res.grouped_info is not None
    medicines = ner_res.grouped_info.medicines
    assert len(medicines) == 2, f"Expected 2 medicines, got {len(medicines)}"

    # 3. Medicine names
    m1 = medicines[0]
    m2 = medicines[1]
    assert m1.medicine_name and "Cetirizine" in m1.medicine_name.value
    assert m2.medicine_name and "Fluticasone" in m2.medicine_name.value

    # 4. Dosages
    assert m1.dosage_quantity and "1 tablet" in m1.dosage_quantity.value
    assert m2.dosage_quantity and "1 spray" in m2.dosage_quantity.value
    assert "in each nostril" in m2.dosage_quantity.value

    # 5. Frequencies
    assert m1.frequency and "Once daily" in m1.frequency.value
    assert m2.frequency and "Twice daily" in m2.frequency.value

    # 6. Durations
    assert m1.duration and "5 days" in m1.duration.value
    assert m2.duration and "7 days" in m2.duration.value


def test_aarav_prescription_never_enters_billing_reconciliation(aarav_prescription_image_path):
    """Ensure prescriptions do not enter billing reconciliation and amounts are Not Applicable."""
    image_bytes = aarav_prescription_image_path.read_bytes()
    ocr_res = ocr_service.extract_text_from_image_bytes(image_bytes)
    text = ocr_res["text"]

    # 1. Billing reconciliation directly called with prescription text
    rec_result = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert rec_result is None, "Billing reconciliation must return None (Not Applicable) for prescriptions."

    # 2. Line item extraction should reject prescription rows as monetary bill items
    line_items = billing_reconciliation_service.parse_line_items(text)
    assert len(line_items) == 0, f"Expected 0 billing line items, got {len(line_items)}"

    # 3. Serial numbers and clinical terms must never be monetary amounts
    from datetime import datetime, timezone
    from app.services.provenance import ProvenanceService

    prov = ProvenanceService.create_provenance(
        original_text=text,
        source_type="prescription",
        source_url=None,
        source_timestamp=datetime.now(timezone.utc)
    )
    claim = Claim(
        claim_id="clm_aarav_test",
        original_text=text,
        source_type="prescription",
        timestamp=datetime.now(timezone.utc),
        extracted_fields=ExtractedFields(entity="Cetirizine"),
        confidence=0.95,
        provenance=prov
    )
    rec_from_claim = billing_reconciliation_service.reconcile_claim_billing(claim=claim)
    assert rec_from_claim is None, "Prescription Claim must not enter billing reconciliation."


def test_genuine_medical_bill_reconciliation_still_works():
    """Preserve existing billing functionality for genuine invoices and medical bills."""
    genuine_invoice_text = (
        "Hospital: Shree Medical Institute\n"
        "Patient: Ramesh Kumar | Age: 52\n"
        "Tax Invoice / Hospital Bill No: INV-2026-9041\n\n"
        "Line items:\n"
        "1. Room & Nursing Charges (4 Days): ₹10,000\n"
        "2. Operation Theatre Tariffs: ₹6,000\n"
        "3. Physician Consultation: ₹5,000\n"
        "4. Laboratory Investigations: ₹2,500\n\n"
        "Total (Itemized): ₹23,500\n"
        "Stated Total Billed Amount: ₹23,500\n"
        "Patient Payable: ₹23,500"
    )

    rec = billing_reconciliation_service.reconcile_claim_billing(text=genuine_invoice_text)
    assert rec is not None, "Genuine medical bill must produce a valid BillingReconciliationResult."
    assert len(rec.line_items) == 4
    assert rec.itemized_sum == 23500.0
    assert rec.stated_total == 23500.0
    assert rec.difference == 0.0
    assert rec.classification == BillingClassification.TOTAL_MATCH
