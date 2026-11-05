"""
Authoritative Clinical Emergency Protocols for Hospital Emergency & Trauma Desks.

Provides standardized, peer-reviewed clinical emergency guidelines (ATLS, ACLS, BLS)
for triage and emergency staff responding to citizen SOS distress calls.
"""

from typing import Any

EMERGENCY_PROTOCOLS: dict[str, dict[str, Any]] = {
    "Accident / Trauma": {
        "emergency_code": "TRAUMA_RED",
        "protocol_name": "Advanced Trauma Life Support (ATLS) Primary Survey",
        "primary_action": "Activate Trauma Resuscitation Team immediately (General Surgeon, Orthopedic Surgeon, Emergency Physician, Anesthetist/Intensivist).",
        "abcde_protocol": [
            {
                "step": "A - Airway & Cervical Spine",
                "action": "Maintain rigid in-line cervical collar immobilization. Clear airway using jaw-thrust without head extension. Suction blood/vomitus. Prepare rapid-sequence intubation if GCS <= 8."
            },
            {
                "step": "B - Breathing & Ventilation",
                "action": "High-flow 100% O2 via non-rebreather mask (15 L/min). Auscultate bilateral breath sounds. Immediately decompress if tension pneumothorax is suspected (needle thoracostomy 5th intercostal space anterior-axillary line)."
            },
            {
                "step": "C - Circulation & Hemorrhage",
                "action": "Apply direct mechanical pressure to active hemorrhage. Secure two large-bore (14G or 16G) peripheral IV cannulas. Administer IV Tranexamic Acid (1 g bolus over 10 min) within 3 hours of injury. Initiate warm balanced crystalloids or O-negative uncrossed blood if hemorrhagic shock."
            },
            {
                "step": "D - Disability & Neurological",
                "action": "Assess baseline GCS (Eye, Verbal, Motor). Check pupillary size and light reactivity. Check immediate capillary blood glucose to rule out hypoglycemia."
            },
            {
                "step": "E - Exposure & Environment",
                "action": "Log-roll patient with spinal precautions to examine posterior torso. Remove wet clothing. Apply warm blankets and warmed fluids to prevent trauma triad of death (hypothermia, acidosis, coagulopathy)."
            }
        ],
        "stat_diagnostics": [
            "eFAST (Extended Focused Assessment with Sonography for Trauma)",
            "Portable AP Chest & Pelvic X-rays",
            "Trauma Bloods: Type & Cross-match 4 Units, CBC, PT/INR, Serum Lactate, ABG",
            "Urgent non-contrast CT Brain & Cervical Spine once hemodynamically stable"
        ],
        "immediate_diagnostics": [
            "eFAST (Extended Focused Assessment with Sonography for Trauma)",
            "Portable AP Chest & Pelvic X-rays",
            "Trauma Bloods: Type & Cross-match 4 Units, CBC, PT/INR, Serum Lactate, ABG",
            "Urgent non-contrast CT Brain & Cervical Spine once hemodynamically stable"
        ],
        "stat_medications": [
            {"name": "Tranexamic Acid (TXA)", "dose": "1 g IV bolus over 10 min", "indication": "Hemorrhage control within 3 hours of trauma"},
            {"name": "Warm Balanced Crystalloid", "dose": "1,000 mL IV bolus", "indication": "Initial volume resuscitation in hypovolemia"},
            {"name": "Cefazolin / Amoxicillin-Clavulanate", "dose": "1.5 g IV stat", "indication": "Open fracture antibiotic prophylaxis"},
            {"name": "Tetanus Toxoid", "dose": "0.5 mL IM stat", "indication": "Tetanus prophylaxis for contaminated wounds"}
        ],
        "precautions": "Do not remove cervical collar until clinical/radiological clearance. Avoid femoral vein cannulation if pelvic fracture suspected.",
        "critical_precautions": [
            "Do not remove cervical collar until radiological and clinical clearance.",
            "Avoid femoral vein cannulation if pelvic ring fracture is suspected.",
            "Permissive hypotension (target SBP 80-90 mmHg) until definitive surgical surgical hemostasis, unless traumatic brain injury present."
        ],
        "specialist_consult_needed": "Immediate activation: General Surgeon, Orthopedic Surgeon, Neurosurgeon, Anesthetist."
    },
    "Breathing Difficulty": {
        "emergency_code": "RESP_RED",
        "protocol_name": "Acute Respiratory Distress Resuscitation Protocol (ACLS / BTS)",
        "primary_action": "Triage immediately to Red Resuscitation Bay. Place patient in upright sitting position (orthopnea position).",
        "abcde_protocol": [
            {
                "step": "A - Airway Evaluation",
                "action": "Check for upper airway stridor, angioedema, foreign body obstruction. If anaphylaxis: administer Epinephrine 0.5 mg IM (1:1000) in anterolateral thigh immediately."
            },
            {
                "step": "B - Oxygenation & Ventilation",
                "action": "Target SpO2: 94–98% for acute hypoxemia; 88–92% in confirmed COPD/hypercapnic respiratory failure. In severe bronchospasm/asthma: Nebulize Salbutamol (5 mg) + Ipratropium Bromide (0.5 mg) driven by oxygen. In acute cardiogenic pulmonary edema: Trial CPAP / BiPAP non-invasive ventilation."
            },
            {
                "step": "C - Hemodynamic Circulation",
                "action": "Attach continuous 3-lead cardiac monitor & pulse oximetry. Secure 18G IV access. In pulmonary edema: Sublingual Nitroglycerin spray/tablet (if SBP > 100 mmHg), IV Furosemide (40–80 mg)."
            },
            {
                "step": "D - Differential Assessment",
                "action": "Rule out tension pneumothorax, massive pulmonary embolism, acute severe asthma, cardiogenic pulmonary edema, and acute foreign body aspiration."
            },
            {
                "step": "E - Emergency Escalation",
                "action": "If patient develops respiratory muscle exhaustion, silent chest, severe acidosis (pH < 7.25), or worsening hypercapnia: assemble intubation team for endotracheal airway."
            }
        ],
        "stat_diagnostics": [
            "Bedside Arterial Blood Gas (ABG) analysis within 15 minutes",
            "12-Lead ECG to evaluate ischemic cardiac trigger or right-heart strain",
            "Portable Chest X-Ray (AP view)",
            "Point-of-Care Ultrasound (POCUS Lung: B-lines vs sliding lung signs)",
            "D-Dimer, Cardiac Troponin, and Serum Electrolytes"
        ],
        "immediate_diagnostics": [
            "Bedside Arterial Blood Gas (ABG) analysis within 15 minutes",
            "12-Lead ECG to evaluate ischemic cardiac trigger or right-heart strain",
            "Portable Chest X-Ray (AP view)",
            "Point-of-Care Ultrasound (POCUS Lung: B-lines vs sliding lung signs)",
            "D-Dimer, Cardiac Troponin, and Serum Electrolytes"
        ],
        "stat_medications": [
            {"name": "Salbutamol Nebulization", "dose": "5 mg via O2 driven neb", "indication": "Bronchospasm, acute asthma, COPD exacerbation"},
            {"name": "Ipratropium Bromide", "dose": "500 mcg nebulized", "indication": "Adjunct anticholinergic bronchodilation"},
            {"name": "Hydrocortisone IV", "dose": "100–200 mg IV stat", "indication": "Systemic corticosteroid anti-inflammatory"},
            {"name": "Furosemide (Lasix)", "dose": "40–80 mg IV slow bolus", "indication": "Acute cardiogenic pulmonary edema (volume overload)"}
        ],
        "precautions": "Never administer high-concentration uncontrolled oxygen to known hypercapnic COPD without monitoring PaCO2. Do not sedate acutely dyspneic patients without definitive airway equipment ready.",
        "critical_precautions": [
            "Never administer high-concentration uncontrolled oxygen to known hypercapnic COPD without PaCO2 monitoring.",
            "Do not administer sedatives or anxiolytics without definitive endotracheal airway equipment ready.",
            "Decompress immediately if unilateral absent breath sounds with hypotension indicate tension pneumothorax."
        ],
        "specialist_consult_needed": "Pulmonologist, Intensivist / ICU Team, Cardiologist."
    },
    "Chest Pain": {
        "emergency_code": "CARDIAC_CODE_STEMI",
        "protocol_name": "Acute Coronary Syndrome (ACS) & High-Risk Chest Pain Protocol (ACC/AHA/ESC)",
        "primary_action": "STAT Door-to-ECG within 10 minutes. Continuous cardiac telemetry & defibrillator pads on standby.",
        "abcde_protocol": [
            {
                "step": "A & B - Airway & Supplemental O2",
                "action": "Administer supplemental O2 only if SpO2 < 90% or patient in respiratory distress (hyperoxia may increase myocardial infarct size)."
            },
            {
                "step": "Antiplatelet Loading",
                "action": "Administer soluble Chewable Aspirin 300 mg PO immediately (unless anaphylactic). Administer second antiplatelet (Ticagrelor 180 mg or Clopidogrel 300–600 mg) per interventional protocol."
            },
            {
                "step": "Vasodilator & Analgesia",
                "action": "Sublingual Nitroglycerin 0.4 mg every 5 min (max 3 doses). CONTRAINDICATIONS: SBP < 90 mmHg, HR < 50 bpm, right ventricular infarction (inferior STEMI with V4R elevation), or PDE-5 inhibitor use within 24–48 hours."
            },
            {
                "step": "Stat Revascularization Pathway",
                "action": "If ECG reveals ST-Elevation Myocardial Infarction (STEMI): Activate Cath Lab immediately for Primary PCI (Door-to-Balloon target < 90 min) or prepare thrombolytic (Tenecteplase) if PCI transfer > 120 min."
            },
            {
                "step": "Critical Differential Screening",
                "action": "Screen for 'Big 5' life-threatening chest pain causes: STEMI/NSTEMI, Aortic Dissection, Pulmonary Embolism, Tension Pneumothorax, and Esophageal Rupture."
            }
        ],
        "stat_diagnostics": [
            "Immediate 12-Lead ECG (with V3R/V4R if inferior changes noted)",
            "STAT High-Sensitivity Troponin I or T",
            "Electrolyte panel (Potassium, Magnesium to prevent ventricular fibrillation)",
            "Portable Chest Radiograph (check mediastinal widening for dissection)",
            "Bedside Echocardiography (regional wall motion abnormalities, pericardial effusion)"
        ],
        "immediate_diagnostics": [
            "Immediate 12-Lead ECG (with V3R/V4R if inferior changes noted)",
            "STAT High-Sensitivity Troponin I or T",
            "Electrolyte panel (Potassium, Magnesium to prevent ventricular fibrillation)",
            "Portable Chest Radiograph (check mediastinal widening for dissection)",
            "Bedside Echocardiography (regional wall motion abnormalities, pericardial effusion)"
        ],
        "stat_medications": [
            {"name": "Soluble Aspirin", "dose": "300 mg chewed orally", "indication": "Immediate platelet COX-1 inhibition"},
            {"name": "Ticagrelor or Clopidogrel", "dose": "180 mg or 300 mg PO", "indication": "P2Y12 platelet receptor antagonist loading"},
            {"name": "Sublingual Nitroglycerin", "dose": "0.4 mg SL tab/spray", "indication": "Coronary vasodilation & ischemia relief"},
            {"name": "Unfractionated Heparin", "dose": "60 units/kg IV bolus (max 4000 U)", "indication": "Anticoagulation prior to primary PCI"}
        ],
        "precautions": "Do NOT give antiplatelets or anticoagulants if clinical suspicion or pulse differential suggests Acute Aortic Dissection.",
        "critical_precautions": [
            "Do NOT administer antiplatelets or anticoagulants if pulse differential or tearing back pain suggests Acute Aortic Dissection.",
            "Avoid Nitroglycerin if patient has right-ventricular infarction (inferior STEMI with V4R elevation) or took PDE5 inhibitors.",
            "Keep defibrillator pads attached during transport; high risk of ventricular tachycardia / fibrillation in first 2 hours."
        ],
        "specialist_consult_needed": "Interventional Cardiologist, Cath Lab Team, Cardiac Care Unit (CCU)."
    },
    "Other Emergency": {
        "emergency_code": "GENERAL_EMERGENCY",
        "protocol_name": "Universal Emergency Bedside Assessment & Stabilization Protocol",
        "primary_action": "Triage to Emergency Treatment Area. Senior Emergency Physician bedside evaluation within 5 minutes.",
        "abcde_protocol": [
            {
                "step": "Vital Signs Baseline",
                "action": "Obtain full set of vital signs: Heart Rate, Non-Invasive Blood Pressure, SpO2, Respiratory Rate, Tympanic Temperature, and Point-of-Care Capillary Blood Glucose."
            },
            {
                "step": "A & B - Airway & Breathing",
                "action": "Ensure patent airway. Suction secretions if altered sensorium. Administer supplemental oxygen if SpO2 < 94%."
            },
            {
                "step": "C - Circulatory Access",
                "action": "Establish secure 18G or 20G intravenous access. Draw baseline emergency laboratory investigations. Initiate crystalloid infusion if hypotensive (MAP < 65 mmHg)."
            },
            {
                "step": "D - Neurological Check",
                "action": "Evaluate Glasgow Coma Scale, motor power in 4 limbs, and pupillary symmetry. If blood glucose < 70 mg/dL: administer 50 mL of 50% Dextrose IV immediately."
            },
            {
                "step": "E - Targeted Examination",
                "action": "Perform focused clinical examination based on reported symptoms (abdominal tenderness, severe allergic rash, focal neurological deficits, acute fever)."
            }
        ],
        "stat_diagnostics": [
            "Point-of-Care Blood Glucose & 12-Lead ECG",
            "Complete Blood Count (CBC) with Platelet Count",
            "Serum Creatinine, Blood Urea Nitrogen, Serum Electrolytes",
            "Venous / Arterial Blood Gas if clinically unstable"
        ],
        "immediate_diagnostics": [
            "Point-of-Care Blood Glucose & 12-Lead ECG",
            "Complete Blood Count (CBC) with Platelet Count",
            "Serum Creatinine, Blood Urea Nitrogen, Serum Electrolytes",
            "Venous / Arterial Blood Gas if clinically unstable"
        ],
        "stat_medications": [
            {"name": "50% Dextrose (D50)", "dose": "50 mL IV slow bolus", "indication": "Hypoglycemia (blood glucose < 70 mg/dL)"},
            {"name": "Normal Saline (0.9% NaCl)", "dose": "500–1000 mL IV bolus", "indication": "Fluid resuscitation for dehydration/hypotension"},
            {"name": "Ondansetron", "dose": "4 mg IV slow push", "indication": "Severe nausea, vomiting, or acute vertigo"},
            {"name": "Paracetamol (Acetaminophen)", "dose": "1 g IV infusion", "indication": "High-grade fever (> 38.5°C) or acute analgesia"}
        ],
        "precautions": "Do not leave unstable patients unmonitored. Escalate immediately to specialty on-call teams once clinical diagnosis is established.",
        "critical_precautions": [
            "Do not leave unstable patients unmonitored at triage.",
            "Re-assess vitals every 15 minutes until definitive stabilization.",
            "Ensure prompt escalation to specialty on-call teams once primary diagnosis is made."
        ],
        "specialist_consult_needed": "Emergency Medicine Consultant, General Physician on duty."
    }
}


def get_emergency_protocol(emergency_type: str) -> dict[str, Any]:
    """Retrieve reviewed clinical protocol for an emergency classification."""
    normalized = emergency_type.strip()
    if "trauma" in normalized.lower() or "accident" in normalized.lower():
        return EMERGENCY_PROTOCOLS["Accident / Trauma"]
    if "breath" in normalized.lower() or "respiratory" in normalized.lower():
        return EMERGENCY_PROTOCOLS["Breathing Difficulty"]
    if "chest" in normalized.lower() or "cardiac" in normalized.lower() or "heart" in normalized.lower():
        return EMERGENCY_PROTOCOLS["Chest Pain"]
    return EMERGENCY_PROTOCOLS["Other Emergency"]
