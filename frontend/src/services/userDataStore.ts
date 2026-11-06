import type {
  Claim,
  VerificationResult,
  AuditTrail,
} from '../types'

export type UserRoleType = 'patient' | 'hospital_management'

export interface StoredUserProfile {
  id: string
  name: string
  email: string
  role: UserRoleType
  organization?: string
  password?: string
  createdAt: string
}

const USERS_REGISTRY_KEY = 'evidencebridge_registered_users'

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase()
}

/**
 * Retrieve all registered user accounts from localStorage
 */
export function getRegisteredUsers(): Record<string, StoredUserProfile> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(USERS_REGISTRY_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {}
}

/**
 * Save/update a user profile in the local registry
 */
export function saveRegisteredUser(profile: StoredUserProfile): void {
  if (typeof window === 'undefined') return
  try {
    const users = getRegisteredUsers()
    const emailKey = normalizeEmail(profile.email)
    users[emailKey] = {
      ...profile,
      email: emailKey,
    }
    localStorage.setItem(USERS_REGISTRY_KEY, JSON.stringify(users))
  } catch {
    // ignore
  }
}

/**
 * Look up a registered user by email
 */
export function findRegisteredUser(email: string): StoredUserProfile | null {
  const users = getRegisteredUsers()
  const emailKey = normalizeEmail(email)
  return users[emailKey] || null
}

// ---------------------------------------------------------------------------
// Per-Email Data Scoping: Claims, Verifications, and Decision Audit Trails
// ---------------------------------------------------------------------------

function getClaimsStorageKey(email: string): string {
  return `eb_claims_${normalizeEmail(email)}`
}

function getVerificationsStorageKey(email: string): string {
  return `eb_verifs_${normalizeEmail(email)}`
}

function getAuditsStorageKey(email: string): string {
  return `eb_audits_${normalizeEmail(email)}`
}

/**
 * Get all claims belonging strictly to the given email address
 */
export function getUserClaims(email: string): Claim[] {
  if (typeof window === 'undefined' || !email) return []
  const emailKey = normalizeEmail(email)
  const key = getClaimsStorageKey(emailKey)

  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      return JSON.parse(raw) as Claim[]
    }
  } catch {
    // fallback
  }

  // Pre-seed default claims for canonical demo accounts on first access
  if (emailKey === 'ramesh.kumar@patient.local') {
    const seeded = createPatientDemoClaims(emailKey)
    saveUserClaimsBatch(emailKey, seeded.claims, seeded.verifications, seeded.audits)
    return seeded.claims
  }

  if (emailKey === 'admin@shreemedical.local' || emailKey === 'vasavi.reviewer@evidencebridge.local') {
    const seeded = createHospitalDemoClaims(emailKey)
    saveUserClaimsBatch(emailKey, seeded.claims, seeded.verifications, seeded.audits)
    return seeded.claims
  }

  return []
}

/**
 * Get verification mapping for an email
 */
export function getUserVerifications(email: string): Record<string, VerificationResult> {
  if (typeof window === 'undefined' || !email) return {}
  const key = getVerificationsStorageKey(email)
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {}
}

/**
 * Save a single audited claim into the email owner's personal claims vault
 */
export function saveUserClaim(
  email: string,
  claim: Claim,
  verification?: VerificationResult | null,
  auditTrail?: AuditTrail | null,
): void {
  if (typeof window === 'undefined' || !email || !claim) return
  const emailKey = normalizeEmail(email)

  try {
    const existingClaims = getUserClaims(emailKey)
    const existingVerifs = getUserVerifications(emailKey)
    const auditsKey = getAuditsStorageKey(emailKey)
    let existingAudits: Record<string, AuditTrail> = {}
    try {
      const rawAudits = localStorage.getItem(auditsKey)
      if (rawAudits) existingAudits = JSON.parse(rawAudits)
    } catch {}

    // Upsert claim by claim_id
    const updatedClaims = [
      claim,
      ...existingClaims.filter((c) => c.claim_id !== claim.claim_id),
    ]

    localStorage.setItem(getClaimsStorageKey(emailKey), JSON.stringify(updatedClaims))

    if (verification) {
      existingVerifs[claim.claim_id] = verification
      localStorage.setItem(getVerificationsStorageKey(emailKey), JSON.stringify(existingVerifs))
    }

    if (auditTrail) {
      existingAudits[claim.claim_id] = auditTrail
      localStorage.setItem(auditsKey, JSON.stringify(existingAudits))
    }
  } catch {
    // storage error
  }
}

/**
 * Save a batch of claims, verifications, and audit trails
 */
export function saveUserClaimsBatch(
  email: string,
  claims: Claim[],
  verifications: Record<string, VerificationResult>,
  audits: Record<string, AuditTrail>,
): void {
  if (typeof window === 'undefined' || !email) return
  const emailKey = normalizeEmail(email)
  try {
    localStorage.setItem(getClaimsStorageKey(emailKey), JSON.stringify(claims))
    localStorage.setItem(getVerificationsStorageKey(emailKey), JSON.stringify(verifications))
    localStorage.setItem(getAuditsStorageKey(emailKey), JSON.stringify(audits))
  } catch {
    // ignore
  }
}

/**
 * Retrieve a specific claim and its verification for an email
 */
export function getUserClaimById(
  email: string,
  claimId: string,
): { claim: Claim | null; verification: VerificationResult | null; auditTrail: AuditTrail | null } {
  const claims = getUserClaims(email)
  const verifs = getUserVerifications(email)
  const emailKey = normalizeEmail(email)

  const foundClaim = claims.find((c) => c.claim_id === claimId) || null
  const foundVerif = verifs[claimId] || null

  let foundAudit: AuditTrail | null = null
  try {
    const rawAudits = localStorage.getItem(getAuditsStorageKey(emailKey))
    if (rawAudits) {
      const audits = JSON.parse(rawAudits)
      foundAudit = audits[claimId] || null
    }
  } catch {}

  return {
    claim: foundClaim,
    verification: foundVerif,
    auditTrail: foundAudit,
  }
}

/**
 * Delete a claim from the email owner's vault
 */
export function deleteUserClaim(email: string, claimId: string): void {
  if (typeof window === 'undefined' || !email) return
  const emailKey = normalizeEmail(email)
  try {
    const claims = getUserClaims(emailKey).filter((c) => c.claim_id !== claimId)
    localStorage.setItem(getClaimsStorageKey(emailKey), JSON.stringify(claims))

    const verifs = getUserVerifications(emailKey)
    delete verifs[claimId]
    localStorage.setItem(getVerificationsStorageKey(emailKey), JSON.stringify(verifs))
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Pre-configured Starter Datasets for Demo Portals
// ---------------------------------------------------------------------------

function createPatientDemoClaims(email: string): {
  claims: Claim[]
  verifications: Record<string, VerificationResult>
  audits: Record<string, AuditTrail>
} {
  const claim1Id = 'CLM-PAT-2026-001'
  const claim2Id = 'CLM-PAT-2026-002'
  const claim3Id = 'CLM-PAT-2026-003'

  const claims: Claim[] = [
    {
      claim_id: claim1Id,
      original_text: `INPATIENT DISCHARGE BILL & FINAL INVOICE
SHREE MEDICAL INSTITUTE - DAVANGERE, KARNATAKA (577004)
Patient: Ramesh Kumar | Age/Gender: 52 Y / Male | IP No: SM12745
Admission: 10 Feb 2026 | Discharge: 14 Feb 2026 (4 Days)
Diagnosis: Community-Acquired Pneumonia

Line Items:
1. Room & Nursing Charges (4 Days): ₹10,000
2. Bedside Monitoring & Nursing Handover: ₹6,000
3. Physician Consultation: ₹5,000
4. Laboratory Investigations: ₹2,500
5. Medicines & Consumables: ₹3,800
6. Oxygen & Respiratory Support: ₹2,200

Total Stated Billed Amount: ₹30,000
Patient Payable: ₹30,000`,
      source_type: 'hospital_bill',
      source_url: null,
      timestamp: '2026-02-14T11:30:00Z',
      confidence: 0.94,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Davangere',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'davangere_karnataka_in',
        raw_mention: 'Davangere, Karnataka - 577004',
        latitude: 14.4644,
        longitude: 75.9218,
      },
      provenance: {
        source_hash: 'd6a8f102e3b7495bca7192837465019283746591823746581928374659182374',
        original_snippet: 'INPATIENT DISCHARGE BILL & FINAL INVOICE',
        text_length: 420,
        source_type: 'hospital_bill',
        source_url: null,
        source_timestamp: '2026-02-14T11:30:00Z',
        ingested_at: '2026-02-14T11:30:00Z',
      },
      extracted_fields: {
        entity: 'Community-Acquired Pneumonia Inpatient Care',
        effect_or_outcome: 'Recovered / Discharged after 4 Days',
        cost_range: '30,000',
        cost_currency: 'INR',
        location_city: 'Davangere',
        sentiment: 'neutral',
        reasoning: 'Inpatient admission for community-acquired pneumonia with 6 itemized billing line items.',
        raw_model_output: {
          provider_name: 'Shree Medical Institute',
          location: 'Davangere, Karnataka - 577004',
          diagnosis: 'Community-Acquired Pneumonia',
          condition: 'Community-Acquired Pneumonia',
          treatment: 'Oxygen support, IV Antibiotics, Inpatient Care',
          procedure_code: 'IPD-PNEUM-04D',
        },
      },
    },
    {
      claim_id: claim2Id,
      original_text: `APOLLO CLINIC - OUTPATIENT PRESCRIPTION
Davangere, Karnataka
Patient: Ramesh Kumar (52Y / M) | HbA1c: 7.8%
Rx: Tab. Metformin Hydrochloride 500 mg (Glycomet)
Take 1 tablet twice daily after food (morning and night) for 30 days (60 tablets).
Total Pharmacy Billed: ₹75.00`,
      source_type: 'clinical_note',
      source_url: null,
      timestamp: '2026-02-05T09:15:00Z',
      confidence: 0.98,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Davangere',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'davangere_karnataka_in',
        raw_mention: 'Davangere, Karnataka',
        latitude: 14.4644,
        longitude: 75.9218,
      },
      provenance: {
        source_hash: 'a918237465819283746591823746581928374659182374658192837465918237',
        original_snippet: 'APOLLO CLINIC - OUTPATIENT PRESCRIPTION',
        text_length: 220,
        source_type: 'clinical_note',
        source_url: null,
        source_timestamp: '2026-02-05T09:15:00Z',
        ingested_at: '2026-02-05T09:15:00Z',
      },
      extracted_fields: {
        entity: 'Metformin Hydrochloride 500 mg (Type 2 Diabetes)',
        effect_or_outcome: 'Glycemic control indicated',
        cost_range: '75',
        cost_currency: 'INR',
        location_city: 'Davangere',
        sentiment: 'positive',
        reasoning: 'Standard ICMR/RSSDI first-line diabetes monotherapy.',
        raw_model_output: {
          provider_name: 'Apollo Clinic',
          location: 'Davangere, Karnataka',
          diagnosis: 'Type 2 Diabetes Mellitus',
          condition: 'Type 2 Diabetes Mellitus',
          treatment: 'Metformin 500 mg BD',
          procedure_code: 'RX-METFORMIN-500',
        },
      },
    },
    {
      claim_id: claim3Id,
      original_text: `DISTRICT HOSPITAL - BALLARI, KARNATAKA
Patient: Ramesh Kumar (52Y / M)
Presenting: Cough & viral bronchitis for 3 days without fever.
Rx: Tab. Azithromycin 500 mg daily x 5 days.
Billed: ₹450.00`,
      source_type: 'clinical_note',
      source_url: null,
      timestamp: '2026-01-20T14:00:00Z',
      confidence: 0.91,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Ballari',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'ballari_karnataka_in',
        raw_mention: 'Ballari, Karnataka',
        latitude: 15.1394,
        longitude: 76.9214,
      },
      provenance: {
        source_hash: 'c819283746591823746581928374659182374658192837465918237465819283',
        original_snippet: 'DISTRICT HOSPITAL - BALLARI, KARNATAKA',
        text_length: 160,
        source_type: 'clinical_note',
        source_url: null,
        source_timestamp: '2026-01-20T14:00:00Z',
        ingested_at: '2026-01-20T14:00:00Z',
      },
      extracted_fields: {
        entity: 'Azithromycin 500 mg for Viral Bronchitis',
        effect_or_outcome: 'Inappropriate antibiotic prescription',
        cost_range: '450',
        cost_currency: 'INR',
        location_city: 'Ballari',
        sentiment: 'negative',
        reasoning: 'Antibiotic therapy not indicated for uncomplicated viral bronchitis.',
        raw_model_output: {
          provider_name: 'District Hospital Ballari',
          location: 'Ballari, Karnataka',
          diagnosis: 'Acute Viral Bronchitis',
          condition: 'Acute Viral Bronchitis',
          treatment: 'Empirical Azithromycin 500 mg',
          procedure_code: 'RX-AZITHRO-500',
        },
      },
    },
  ]

  const verifications: Record<string, VerificationResult> = {
    [claim1Id]: {
      verification_id: 'VER-PAT-001',
      claim_id: claim1Id,
      audit_trail_id: 'AUD-PAT-001',
      support_score: 0.88,
      verdict: 'supported',
      action: 'flag',
      reasoning:
        'Clinical care for Community-Acquired Pneumonia is medically supported. However, stated bill total ₹30,000 exceeds the itemized line item sum (₹29,500) by ₹500. Flagged for billing review.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: true,
      anomaly_details: {
        is_anomaly: true,
        extracted_amount: 30000,
        threshold_multiplier: 1.0,
        severity: 'medium',
        multiplier: 1.02,
        benchmark_min: 22000,
        benchmark_max: 29500,
        explanation: 'The stated bill is ₹500 higher than the sum of the listed charges (₹29,500). Please review the discrepancy.',
      },
      location: {
        city: 'Davangere',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'davangere_karnataka_in',
        raw_mention: 'Davangere, Karnataka - 577004',
        latitude: 14.4644,
        longitude: 75.9218,
      },
      abstain_reason: null,
      verified_at: '2026-02-14T11:32:00Z',
    },
    [claim2Id]: {
      verification_id: 'VER-PAT-002',
      claim_id: claim2Id,
      audit_trail_id: 'AUD-PAT-002',
      support_score: 0.96,
      verdict: 'supported',
      action: 'accept',
      reasoning:
        'First-line oral pharmacotherapy conforms strictly to ICMR and RSSDI clinical guidelines for Type 2 Diabetes maintenance. Price ₹75 conforms to NPPA ceiling benchmark.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: false,
      anomaly_details: null,
      location: {
        city: 'Davangere',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'davangere_karnataka_in',
        raw_mention: 'Davangere, Karnataka',
        latitude: 14.4644,
        longitude: 75.9218,
      },
      abstain_reason: null,
      verified_at: '2026-02-05T09:16:00Z',
    },
    [claim3Id]: {
      verification_id: 'VER-PAT-003',
      claim_id: claim3Id,
      audit_trail_id: 'AUD-PAT-003',
      support_score: 0.42,
      verdict: 'contradicted',
      action: 'flag',
      reasoning:
        'Antibiotic overprescription flagged: ICMR & WHO advise against routine antibiotics for uncomplicated acute viral bronchitis.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: false,
      anomaly_details: null,
      location: {
        city: 'Ballari',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'ballari_karnataka_in',
        raw_mention: 'Ballari, Karnataka',
        latitude: 15.1394,
        longitude: 76.9214,
      },
      abstain_reason: null,
      verified_at: '2026-01-20T14:02:00Z',
    },
  }

  const audits: Record<string, AuditTrail> = {}
  return { claims, verifications, audits }
}

function createHospitalDemoClaims(email: string): {
  claims: Claim[]
  verifications: Record<string, VerificationResult>
  audits: Record<string, AuditTrail>
} {
  const claim1Id = 'CLM-HOSP-2026-101'
  const claim2Id = 'CLM-HOSP-2026-102'
  const claim3Id = 'CLM-HOSP-2026-103'

  const claims: Claim[] = [
    {
      claim_id: claim1Id,
      original_text: `EMERGENCY DEPARTMENT CHARGE SUMMARY
MANIPAL HOSPITAL - BENGALURU, KARNATAKA
Patient: Ramesh Kumar (Acct #MH-BLR-2026-4412)

Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency rehydration.
Billed Charge: ₹1,800.00
Clinical Note: Emergency IV hydration administered for acute gastroenteritis dehydration.`,
      source_type: 'hospital_bill',
      source_url: null,
      timestamp: '2026-03-01T08:20:00Z',
      confidence: 0.95,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Bengaluru',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'bengaluru_karnataka_in',
        raw_mention: 'Bengaluru, Karnataka',
        latitude: 12.9716,
        longitude: 77.5946,
      },
      provenance: {
        source_hash: 'e192837465918237465819283746591823746581928374659182374658192837',
        original_snippet: 'EMERGENCY DEPARTMENT CHARGE SUMMARY',
        text_length: 270,
        source_type: 'hospital_bill',
        source_url: null,
        source_timestamp: '2026-03-01T08:20:00Z',
        ingested_at: '2026-03-01T08:20:00Z',
      },
      extracted_fields: {
        entity: 'Normal Saline IV Infusion 1,000 mL',
        effect_or_outcome: 'Emergency rehydration administered',
        cost_range: '1,800',
        cost_currency: 'INR',
        location_city: 'Bengaluru',
        sentiment: 'neutral',
        reasoning: 'Emergency rehydration with 17.1x markup over NPPA ceiling price benchmark.',
        raw_model_output: {
          provider_name: 'Manipal Hospital Bengaluru',
          location: 'Bengaluru, Karnataka',
          diagnosis: 'Acute Gastroenteritis Dehydration',
          condition: 'Acute Dehydration',
          treatment: 'IV Normal Saline 1,000 mL infusion',
          procedure_code: 'IV-SALINE-1000',
        },
      },
    },
    {
      claim_id: claim2Id,
      original_text: `NEUROLOGY CONSULTATION & IMAGING ORDER
KMC HOSPITAL (KASTURBA MEDICAL COLLEGE) - MANGALURU, KARNATAKA
Patient: 46-year-old female presenting with progressive unilateral headache, papilledema, and new focal neurological signs.

Procedure: CPT 70551 Magnetic Resonance Imaging (MRI) Brain without contrast.
Total Billed Charge: ₹5,500.00
Clinical Indication: Urgent neuroimaging indicated to evaluate focal intracranial pathology per clinical guidelines.`,
      source_type: 'hospital_bill',
      source_url: null,
      timestamp: '2026-02-22T10:45:00Z',
      confidence: 0.97,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Mangaluru',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'mangaluru_karnataka_in',
        raw_mention: 'Mangaluru, Karnataka',
        latitude: 12.9141,
        longitude: 74.856,
      },
      provenance: {
        source_hash: '1192837465918237465819283746591823746581928374659182374658192837',
        original_snippet: 'NEUROLOGY CONSULTATION & IMAGING ORDER',
        text_length: 330,
        source_type: 'hospital_bill',
        source_url: null,
        source_timestamp: '2026-02-22T10:45:00Z',
        ingested_at: '2026-02-22T10:45:00Z',
      },
      extracted_fields: {
        entity: 'Diagnostic Brain MRI Scan (CPT 70551)',
        effect_or_outcome: 'Focal intracranial pathology evaluated',
        cost_range: '5,500',
        cost_currency: 'INR',
        location_city: 'Mangaluru',
        sentiment: 'positive',
        reasoning: 'Appropriate neuroimaging conforming to CGHS benchmark tariff.',
        raw_model_output: {
          provider_name: 'KMC Hospital Mangaluru',
          location: 'Mangaluru, Karnataka',
          diagnosis: 'Progressive Unilateral Headache with Papilledema',
          condition: 'Focal Neurological Signs',
          treatment: 'MRI Brain without contrast',
          procedure_code: 'CPT-70551',
        },
      },
    },
    {
      claim_id: claim3Id,
      original_text: `REGENERATIVE MEDICINE SPECIALTY SUITE
CITY SUPER SPECIALITY HOSPITAL - BELAGAVI, KARNATAKA
Patient: 58-year-old with refractory degenerative musculoskeletal pain.

Administered: Autologous experimental cellular restorative therapy protocol.
Total Billed Charge: ₹85,000.00
Clinical Note: Off-label experimental regenerative restorative session administered without standard procedure code.`,
      source_type: 'hospital_bill',
      source_url: null,
      timestamp: '2026-02-18T16:10:00Z',
      confidence: 0.85,
      indexed_vector: true,
      user_id: email,
      location: {
        city: 'Belagavi',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'belagavi_karnataka_in',
        raw_mention: 'Belagavi, Karnataka',
        latitude: 15.8497,
        longitude: 74.4977,
      },
      provenance: {
        source_hash: '3192837465918237465819283746591823746581928374659182374658192837',
        original_snippet: 'REGENERATIVE MEDICINE SPECIALTY SUITE',
        text_length: 280,
        source_type: 'hospital_bill',
        source_url: null,
        source_timestamp: '2026-02-18T16:10:00Z',
        ingested_at: '2026-02-18T16:10:00Z',
      },
      extracted_fields: {
        entity: 'Uncoded Experimental Cellular Restorative Therapy',
        effect_or_outcome: 'Safe refusal: Uncoded experimental therapy',
        cost_range: '85,000',
        cost_currency: 'INR',
        location_city: 'Belagavi',
        sentiment: 'mixed',
        reasoning: 'Off-label high cost therapy without recognized tariff schedules.',
        raw_model_output: {
          provider_name: 'City Super Speciality Hospital Belagavi',
          location: 'Belagavi, Karnataka',
          diagnosis: 'Refractory Degenerative Musculoskeletal Pain',
          condition: 'Chronic Pain',
          treatment: 'Autologous cellular therapy',
          procedure_code: 'EXPERIMENTAL-REGEN',
        },
      },
    },
  ]

  const verifications: Record<string, VerificationResult> = {
    [claim1Id]: {
      verification_id: 'VER-HOSP-101',
      claim_id: claim1Id,
      audit_trail_id: 'AUD-HOSP-101',
      support_score: 0.95,
      verdict: 'supported',
      action: 'flag',
      reasoning:
        'Normal saline is clinically essential for acute dehydration. However, ₹1,800 billed charge is 17.1× the NPPA national ceiling price benchmark (₹105 incl 5% GST). Flagged for provider billing desk tariff reconciliation.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: true,
      anomaly_details: {
        is_anomaly: true,
        extracted_amount: 1800,
        threshold_multiplier: 1.0,
        severity: 'high',
        multiplier: 17.1,
        benchmark_min: 30,
        benchmark_max: 105,
        explanation:
          'Billed at ₹1,800.00, exceeding NPPA National Ceiling Price benchmark of ₹105.00 (17.1× markup). Audit desk review required prior to insurer settlement.',
      },
      location: {
        city: 'Bengaluru',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'bengaluru_karnataka_in',
        raw_mention: 'Bengaluru, Karnataka',
        latitude: 12.9716,
        longitude: 77.5946,
      },
      abstain_reason: null,
      verified_at: '2026-03-01T08:22:00Z',
    },
    [claim2Id]: {
      verification_id: 'VER-HOSP-102',
      claim_id: claim2Id,
      audit_trail_id: 'AUD-HOSP-102',
      support_score: 0.94,
      verdict: 'supported',
      action: 'accept',
      reasoning:
        'Clinical indications conform to American College of Radiology Appropriateness Criteria for progressive focal neurological symptoms. ₹5,500 billed aligns directly with CGHS non-NABH tariff benchmark.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: false,
      anomaly_details: null,
      location: {
        city: 'Mangaluru',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'mangaluru_karnataka_in',
        raw_mention: 'Mangaluru, Karnataka',
        latitude: 12.9141,
        longitude: 74.856,
      },
      abstain_reason: null,
      verified_at: '2026-02-22T10:47:00Z',
    },
    [claim3Id]: {
      verification_id: 'VER-HOSP-103',
      claim_id: claim3Id,
      audit_trail_id: 'AUD-HOSP-103',
      support_score: 0.3,
      verdict: 'insufficient_evidence',
      action: 'abstain',
      reasoning:
        'Safe abstention: Uncoded experimental therapy lacks recognized ICMR guideline standards and public CGHS/PM-JAY reimbursement schedules. Hospital billing desk must obtain pre-authorization tariff justification.',
      evidence_snippets: [],
      passages_considered: [],
      cost_anomaly_flag: false,
      anomaly_details: null,
      location: {
        city: 'Belagavi',
        state_or_region: 'Karnataka',
        country: 'India',
        normalized_key: 'belagavi_karnataka_in',
        raw_mention: 'Belagavi, Karnataka',
        latitude: 15.8497,
        longitude: 74.4977,
      },
      abstain_reason: 'Uncoded experimental therapy without recognized tariff schedules',
      verified_at: '2026-02-18T16:12:00Z',
    },
  }

  const audits: Record<string, AuditTrail> = {}
  return { claims, verifications, audits }
}
