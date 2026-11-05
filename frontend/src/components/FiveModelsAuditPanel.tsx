import React, { useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import type {
  ExtractedEntity,
  NLIResult,
  ProviderAnomalyResult,
  ClaimAnomalyResult,
  MedicineSubstitutionResult,
  RetrievalResultPassage,
  SharedClaimContext,
  CrossModelSynthesis,
  GroupedMedicalInformation,
  BillingReconciliationResult,
  BillingLineItem,
} from '../types'

interface FiveModelsAuditPanelProps {
  claimId?: string
  sharedContext?: SharedClaimContext | null
  synthesis?: CrossModelSynthesis | null
  nerEntities?: ExtractedEntity[] | null
  nerGroupedInfo?: GroupedMedicalInformation | null
  retrievalPassages?: RetrievalResultPassage[] | null
  nliResult?: NLIResult | null
  providerAnomaly?: ProviderAnomalyResult | null
  claimAnomaly?: ClaimAnomalyResult | null
  medicineSubstitution?: MedicineSubstitutionResult | null
  billingReconciliation?: BillingReconciliationResult | null
  requiresHumanReview?: boolean
  humanReviewReasons?: string[]
}

const ISSUE_BADGES: Record<string, { label: string; color: string; icon: string }> = {
  EXCESSIVE_PRICING_MARKUP: {
    label: 'Excessive Pricing Markup',
    color: 'bg-rose-100 text-rose-800 border-rose-300',
    icon: '💰',
  },
  CLINICAL_INDICATION_MISMATCH: {
    label: 'Clinical Indication Mismatch',
    color: 'bg-rose-100 text-rose-800 border-rose-300',
    icon: '🩺',
  },
  UNCERTAIN_CLINICAL_EVIDENCE: {
    label: 'Inconclusive Clinical Evidence',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    icon: '⚖️',
  },
  MEDICINE_SUBSTITUTION_MISMATCH: {
    label: 'Medicine Substitution Mismatch',
    color: 'bg-rose-100 text-rose-800 border-rose-300',
    icon: '💊',
  },
  INPATIENT_UTILIZATION_ANOMALY: {
    label: 'Inpatient Stay Duration Anomaly',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    icon: '🏥',
  },
  PROVIDER_BILLING_ANOMALY: {
    label: 'Provider Practice Volume Anomaly',
    color: 'bg-rose-100 text-rose-800 border-rose-300',
    icon: '🏢',
  },
  INSUFFICIENT_PROVIDER_HISTORY: {
    label: 'Insufficient Provider Practice History',
    color: 'bg-slate-100 text-slate-700 border-slate-300',
    icon: '📋',
  },
  MISSING_CLINICAL_GUIDELINES: {
    label: 'Missing Clinical Guidelines',
    color: 'bg-slate-100 text-slate-700 border-slate-300',
    icon: '🛡️',
  },
}

function formatReadableText(text?: string | null): string {
  if (!text) return ''
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildFallbackGroupedInfo(
  sharedContext?: SharedClaimContext | null,
  nerEntities?: ExtractedEntity[] | null
): GroupedMedicalInformation {
  const ents = nerEntities || []
  const text = sharedContext?.original_text || ''

  // Detect document type dynamically
  let docType: 'insurance_claim' | 'discharge_summary' | 'prescription' | 'hospital_bill' | 'clinical_note' = 'hospital_bill'
  const lowerText = text.toLowerCase()
  if (lowerText.includes('insurance claim') || lowerText.includes('star health') || lowerText.includes('policy number') || lowerText.includes('pre-auth') || lowerText.includes('claim form')) {
    docType = 'insurance_claim'
  } else if (lowerText.includes('discharge summary') || lowerText.includes('discharge note') || lowerText.includes('date of admission') || lowerText.includes('date of discharge')) {
    docType = 'discharge_summary'
  } else if (lowerText.includes('prescription') || lowerText.includes('rx') || lowerText.includes('outpatient prescription') || lowerText.includes('dr.')) {
    docType = 'prescription'
  } else if (sharedContext?.source_type === 'clinical_note') {
    docType = 'clinical_note'
  } else {
    docType = 'hospital_bill'
  }

  // 1. Hospital Information
  const hospEnt = ents.find((e) => e.entity === 'HOSPITAL' || e.entity === 'HOSPITAL_NAME')
  let hospRaw = sharedContext?.hospital_name || hospEnt?.text || ''
  if (!hospRaw && hospEnt?.text) {
    hospRaw = hospEnt.text
  }
  if (!hospRaw || hospRaw.toLowerCase() === 'not specified' || hospRaw === 'Provider identity unavailable') {
    const matchFacility = text.match(/(?:Hospital|Clinic|Institute|Medical Center|Facility)\s*[:#]\s*([A-Za-z0-9&.,\s\-]+?)(?:\n|\r|$)/i) ||
      text.match(/([A-Z][A-Za-z0-9&.,\s]+?(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System))\b/i)
    if (matchFacility) {
      hospRaw = matchFacility[1].trim()
    }
  }
  // Sanitize clipped subword prefixes if original text contains full facility identity
  if (hospRaw.toLowerCase().startsWith('ee ') || hospRaw.startsWith('##')) {
    if (sharedContext?.hospital_name && !sharedContext.hospital_name.toLowerCase().startsWith('ee ') && !sharedContext.hospital_name.startsWith('##')) {
      hospRaw = sharedContext.hospital_name
    } else {
      const matchFacility = text.match(/([A-Z][A-Za-z0-9&.,\s]+?(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System))\b/i)
      if (matchFacility) {
        hospRaw = matchFacility[1].trim()
      } else {
        hospRaw = hospRaw.replace(/^(?:ee|##)\s*/i, '').trim()
      }
    }
  }
  let hospName = hospRaw || 'Provider identity unavailable'
  let hospLoc = ''
  if (hospRaw.includes(' - ')) {
    const parts = hospRaw.split(' - ')
    hospName = parts[0].trim()
    hospLoc = parts.slice(1).join(' - ').trim()
  } else {
    const locMatch = text.match(/\b([A-Za-z\s]+,\s*[A-Za-z\s]+(?:\s*[-–—]\s*\d{5,6})?)\b/) ||
      text.match(/\b(Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Mumbai|Delhi|Chennai|Hyderabad|Kolkata|Ballari|Pune|Ahmedabad|Jaipur)(?:,\s*[A-Za-z ]+(?:\s*[-–—]\s*\d{5,6})?)?\b/i)
    if (locMatch) hospLoc = locMatch[0].trim()
  }

  const phoneMatch = text.match(/\b(?:Phone|Tel|Telephone|Contact)[:\s#]*([0-9\-+ ]{8,15})\b/i)
  const phoneVal = phoneMatch ? phoneMatch[1].trim() : ''

  const patEnt = ents.find((e) => e.entity === 'PATIENT_NAME')
  const patName = patEnt?.text || (sharedContext?.patient_info?.patient_name as string) || ''

  const ageMatch = text.match(/\bAge[:\s#]*(\d{1,3}(?:\s*(?:years?|yrs?))?)\b/i)
  const genderMatch = text.match(/\b(?:Gender|Sex)[:\s#]*(Male|Female|Other|M|F)\b/i)
  let ageGender = ''
  if (ageMatch && genderMatch) {
    const a = ageMatch[1].toLowerCase().includes('year') ? ageMatch[1].trim() : `${ageMatch[1].trim()} Years`
    const g = genderMatch[1].toUpperCase() === 'M' ? 'Male' : genderMatch[1].toUpperCase() === 'F' ? 'Female' : genderMatch[1]
    ageGender = `${a} / ${g}`
  } else if (ageMatch) {
    ageGender = ageMatch[1].toLowerCase().includes('year') ? ageMatch[1].trim() : `${ageMatch[1].trim()} Years`
  }

  const losMatch = text.match(/\b(?:Length\s*of\s*Stay|Stay\s*Duration)[:\s#]*(\d+\s*days?)\b/i)
  const lengthOfStay = losMatch ? losMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : ''

  const refEnt = ents.find((e) => ['CLAIM_REFERENCE', 'INVOICE_NUMBER', 'POLICY_NUMBER', 'PATIENT_ID'].includes(e.entity))
  let claimRef = refEnt?.text || ''
  if (!claimRef) {
    const refMatch = text.match(/(?:Acct\s*#|Claim\s*#|Ref\s*#|Invoice\s*#)\s*([A-Za-z0-9\-]+)/i)
    if (refMatch) claimRef = refMatch[1].trim()
  }
  if (claimRef && (claimRef === '577004' || /karnataka|davangere|sm\d+/i.test(claimRef))) {
    claimRef = ''
  }

  const patIdEnt = ents.find((e) => ['PATIENT_ID', 'UHID', 'MRN'].includes(e.entity))
  let patId = patIdEnt?.text || ''
  if (!patId) {
    const idMatch = text.match(/(?:UHID|MRN|Patient\s*ID|PID)[:\s]*([A-Za-z0-9\-]+)|\b(SM\d{4,6})\b/i)
    if (idMatch) patId = (idMatch[1] || idMatch[2]).trim()
  }

  const insEnt = ents.find((e) => ['INSURER', 'INSURANCE_COMPANY'].includes(e.entity))
  let insurer = insEnt?.text || ''
  if (!insurer) {
    const insMatch = text.match(/(?:Insurer|Insurance\s*Company)[:\s]*([A-Za-z0-9\s&]+?)(?:\n|,|$)/i)
    if (insMatch) insurer = insMatch[1].trim()
  }

  const tpaEnt = ents.find((e) => e.entity === 'TPA')
  let tpa = tpaEnt?.text || ''
  if (!tpa) {
    const tpaMatch = text.match(/TPA[:\s]*([A-Za-z0-9\s&]+?)(?:\n|,|$)/i)
    if (tpaMatch) tpa = tpaMatch[1].trim()
  }

  const polEnt = ents.find((e) => e.entity === 'POLICY_NUMBER')
  let policyNum = polEnt?.text || ''
  if (!policyNum) {
    const polMatch = text.match(/(?:Policy\s*(?:No|Number|#))[:\s]*([A-Za-z0-9\-]+)/i)
    if (polMatch) policyNum = polMatch[1].trim()
  }

  const preauthEnt = ents.find((e) => e.entity === 'PREAUTH_NUMBER')
  let preauthNum = preauthEnt?.text || ''
  if (!preauthNum) {
    const preMatch = text.match(/(?:Pre-?auth\s*(?:No|Number|#|Approval))[:\s]*([A-Za-z0-9\-]+)/i)
    if (preMatch) preauthNum = preMatch[1].trim()
  }

  // 2. Medicine Information
  const medEnt = ents.find((e) => ['GENERIC_NAME', 'BRAND_NAME', 'ACTIVE_INGREDIENT', 'MEDICINE_NAME'].includes(e.entity))
  const medName = medEnt?.text || sharedContext?.medicines?.[0] || ''
  const doseEnt = ents.find((e) => ['DOSAGE', 'QUANTITY'].includes(e.entity))
  const strEnt = ents.find((e) => e.entity === 'STRENGTH')

  const fullMedStr = `${medName} ${doseEnt?.text || ''}`

  let activeIng = ''
  const aiMatch = fullMedStr.match(/(?:Sodium Chloride|Paracetamol|Amoxicillin|Domperidone|Ceftriaxone|Azithromycin|Metformin|Pantoprazole|Ibuprofen|Ciprofloxacin|Ondansetron)/i)
  if (aiMatch) {
    activeIng = aiMatch[0].trim()
  } else {
    const aiEnt = ents.find((e) => e.entity === 'ACTIVE_INGREDIENT')
    if (aiEnt) activeIng = aiEnt.text
  }

  let strength = strEnt?.text || ''
  if (!strength) {
    const strMatch = fullMedStr.match(/(\d+(?:\.\d+)?\s*(?:%|mg\/ml|w\/v|mcg\/ml|g\/l|mg|mcg|g)\b|\d+(?:\.\d+)?\s*%)/i)
    if (strMatch) strength = strMatch[1].trim()
  }

  let dosageQty = doseEnt?.text || ''
  if (dosageQty && /\b\d+\s*days?\b/i.test(dosageQty)) {
    dosageQty = ''
  }
  const qtyMatch = dosageQty.match(/\b(\d+(?:,\d+)?(?:\.\d+)?\s*(?:ml|l|mg|mcg|tablets?|capsules?|vials?|units?|bottles?|bags?))\b/i)
  if (qtyMatch) dosageQty = qtyMatch[1].trim()

  let route = ''
  const routeMatch = text.match(/\b(IV|IM|SC|oral|PO|topical|sublingual|intravenous|intra-arterial|inhalation)\b/i)
  if (routeMatch) {
    route = routeMatch[1].length <= 3 ? routeMatch[1].toUpperCase() : routeMatch[1].charAt(0).toUpperCase() + routeMatch[1].slice(1).toLowerCase()
  }

  const brandEnt = ents.find((e) => e.entity === 'BRAND_NAME')
  let brandName = brandEnt?.text || ''
  if (!brandName) {
    const brandMatch = text.match(/\b(Dolo\s*650|Augmentin|Calpol|Crocin|Azithral|Pan\s*40|Pantocid|Glycomet)\b/i)
    if (brandMatch) brandName = brandMatch[1].trim()
  }

  const genEnt = ents.find((e) => e.entity === 'GENERIC_NAME')
  let genericName = genEnt?.text || ''

  const freqEnt = ents.find((e) => ['FREQUENCY', 'DOSAGE_FREQUENCY'].includes(e.entity))
  let frequency = freqEnt?.text || ''
  if (!frequency) {
    const freqMatch = text.match(/\b(once daily|twice daily|thrice daily|once a day|twice a day|1-0-1|1-1-1|1-0-0|0-0-1|every \d+ hours?|q\d+h|sos|prn|bd|tid|qid|od)\b/i)
    if (freqMatch) frequency = freqMatch[1].trim()
  }

  const durEnt = ents.find((e) => e.entity === 'DURATION')
  let duration = durEnt?.text || ''
  if (!duration) {
    const durMatch = text.match(/\b(?:for\s+)?(\d+\s*(?:days?|weeks?|months?))\b/i)
    if (durMatch) duration = durMatch[1].trim()
  }

  const instEnt = ents.find((e) => ['INSTRUCTION', 'INSTRUCTIONS', 'SPECIAL_INSTRUCTIONS'].includes(e.entity))
  let instructions = instEnt?.text || ''
  if (!instructions) {
    const instMatch = text.match(/\b(after food|before food|with food|after meals|before meals|empty stomach|at bedtime)\b/i)
    if (instMatch) instructions = instMatch[1].trim()
  }

  // 3. Clinical Information
  let encType = ''
  const encHeaderMatch = text.match(/\bEncounter[:\s#]*([A-Za-z\s]+?)(?:\n|\r|,|\||$)/i)
  const encMatch = text.match(/\b(Emergency Department|Emergency Room|Outpatient|Inpatient|Day Care|ICU|CCU|General Ward)\b/i)
  if (encHeaderMatch) {
    encType = encHeaderMatch[1].trim()
    if (!encType.toLowerCase().includes('encounter')) encType = `${encType} Encounter`
  } else if (encMatch) {
    encType = encMatch[1].trim()
    if (!encType.toLowerCase().includes('encounter')) encType = `${encType} Encounter`
  } else if (sharedContext?.source_type) {
    encType = sharedContext.source_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  if (!encType && (losMatch || text.toLowerCase().includes('days') || /admission|discharge|doa|dod/i.test(text))) {
    encType = 'Inpatient Encounter'
  }

  const procHeaderMatch = text.match(/\b(?:Surgical\s*Procedure|Clinical\s*Procedure|Procedure\s*Name|Procedure|Intervention|Surgery)[:\s#]*([A-Za-z0-9\s\-]+?)(?:\n|\r|,|\||$)/i)
  const procEnt = ents.find((e) => e.entity === 'PROCEDURE')
  let procedure = (procHeaderMatch ? procHeaderMatch[1].trim() : '') || procEnt?.text || sharedContext?.procedures?.[0] || ''
  procedure = procedure.replace(/\s+(?:administered(?:\s+for)?|performed(?:\s+for)?|indicated(?:\s+for)?|for|with)$/i, '').trim()
  if (
    procedure &&
    (
      procedure.startsWith('&') ||
      procedure.startsWith('-') ||
      procedure.startsWith('/') ||
      /\b\d+\s*days?\b/i.test(procedure) ||
      /respiratory support|nursing handover|bedside monitoring|room & nursing|physician consultation|laboratory investigations|medicines & consumables|consumables/i.test(procedure)
    )
  ) {
    procedure = ''
  }

  const diagEnt = [...ents].reverse().find((e) => e.entity === 'DIAGNOSIS')
  const diagHeaderMatch = text.match(/\b(?:Diagnosis|Primary\s*Diagnosis)[:\s#]*([A-Za-z0-9\s\-]+?)(?:\n|\r|,|\||$)/i)
  let rawDiag = diagHeaderMatch ? diagHeaderMatch[1].trim() : (diagEnt?.text || sharedContext?.diagnoses?.[0] || '')
  if (['no', 'none', 'yes', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].includes(rawDiag.toLowerCase())) {
    rawDiag = ''
  }
  const diagnosis = formatReadableText(rawDiag)

  let indication = ''
  const indMatch = text.match(/(?:for|indicated for)\s+([A-Za-z\s]+?)(?:\.|\n|$)/i)
  if (indMatch && indMatch[1].trim().toLowerCase() !== diagnosis.toLowerCase()) {
    indication = indMatch[1].trim()
  }

  const admEnt = ents.find((e) => ['ADMISSION_DATE', 'DOA'].includes(e.entity))
  let admDate = admEnt?.text || ''
  if (!admDate) {
    const admMatch = text.match(/(?:Admission\s*Date|Date\s*of\s*Admission|DOA)[:\s]*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i)
    if (admMatch) admDate = admMatch[1].trim()
  }

  const disEnt = ents.find((e) => ['DISCHARGE_DATE', 'DOD'].includes(e.entity))
  let disDate = disEnt?.text || ''
  if (!disDate) {
    const disMatch = text.match(/(?:Discharge\s*Date|Date\s*of\s*Discharge|DOD)[:\s]*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i)
    if (disMatch) disDate = disMatch[1].trim()
  }

  const roomEnt = ents.find((e) => ['ROOM_TYPE', 'WARD'].includes(e.entity))
  let roomType = roomEnt?.text || ''
  if (!roomType) {
    const roomMatch = text.match(/(?:Ward|Room\s*Type|Accommodation)[:\s]*([A-Za-z0-9\s]+?)(?:\n|,|$)/i)
    if (roomMatch) roomType = roomMatch[1].trim()
  }

  const findEnt = ents.find((e) => ['FINDINGS', 'INVESTIGATIONS'].includes(e.entity))
  let findings = findEnt?.text || ''
  if (!findings) {
    const findMatch = text.match(/(?:Findings|Investigations|Clinical\s*Summary)[:\s]*([^\n]+)/i)
    if (findMatch) findings = findMatch[1].trim()
  }

  // 4. Billing Information
  const amtEnt = ents.find((e) => ['CLAIM_AMOUNT', 'INVOICE_TOTAL', 'LINE_AMOUNT', 'TOTAL_AMOUNT'].includes(e.entity))
  const billedAmt = amtEnt?.text || (sharedContext?.billed_amount ? `₹${sharedContext.billed_amount}` : '')
  const invEnt = ents.find((e) => e.entity === 'INVOICE_NUMBER')
  const gstinEnt = ents.find((e) => e.entity === 'GSTIN')
  const hsnEnt = ents.find((e) => e.entity === 'HSN_SAC' && /^\d{4,8}$/.test(e.text.trim()))
  const taxEnt = ents.find((e) => e.entity === 'TAX_AMOUNT')
  const discEnt = ents.find((e) => e.entity === 'DISCOUNT')
  const payEnt = ents.find((e) => e.entity === 'PATIENT_PAYABLE')

  const claimedEnt = ents.find((e) => ['CLAIMED_AMOUNT', 'TOTAL_CLAIMED'].includes(e.entity))
  let claimedAmt = claimedEnt?.text || ''
  if (!claimedAmt) {
    const clMatch = text.match(/(?:Total\s*Claimed|Claimed\s*Amount)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (clMatch) claimedAmt = `₹${clMatch[1]}`
  }

  const appEnt = ents.find((e) => ['APPROVED_AMOUNT', 'SETTLED_AMOUNT'].includes(e.entity))
  let approvedAmt = appEnt?.text || ''
  if (!approvedAmt) {
    const appMatch = text.match(/(?:Approved\s*Amount|Settled\s*Amount)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (appMatch) approvedAmt = `₹${appMatch[1]}`
  }

  const dedEnt = ents.find((e) => ['DEDUCTION', 'INSURANCE_DEDUCTION', 'COPAY'].includes(e.entity))
  let deductionAmt = dedEnt?.text || ''
  if (!deductionAmt) {
    const dedMatch = text.match(/(?:Deductions?|Co-?pay|Non-Payable)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (dedMatch) deductionAmt = `₹${dedMatch[1]}`
  }

  const upEnt = ents.find((e) => e.entity === 'UNIT_PRICE')
  let unitPrice = upEnt?.text || ''
  if (!unitPrice) {
    const upMatch = text.match(/(?:Unit\s*Price|Rate|Price\/Unit)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (upMatch) unitPrice = `₹${upMatch[1]}`
  }

  const laEnt = ents.find((e) => e.entity === 'LINE_AMOUNT')
  let lineAmount = laEnt?.text || ''
  if (!lineAmount) {
    const laMatch = text.match(/(?:Line\s*Amount|Item\s*Total)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (laMatch) lineAmount = `₹${laMatch[1]}`
  }

  const subEnt = ents.find((e) => ['SUBTOTAL', 'TAXABLE_AMOUNT'].includes(e.entity))
  let subtotal = subEnt?.text || ''
  if (!subtotal) {
    const subMatch = text.match(/(?:Subtotal|Taxable\s*Value)[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)/i)
    if (subMatch) subtotal = `₹${subMatch[1]}`
  }

  return {
    document_type: docType,
    hospital: {
      hospital_name: hospName ? { value: hospName, confidence: hospEnt?.confidence ?? 0.9, requires_human_review: hospEnt?.requires_human_review ?? false } : null,
      location: hospLoc ? { value: hospLoc, confidence: 0.85, requires_human_review: false } : null,
      phone: phoneVal ? { value: phoneVal, confidence: 0.95, requires_human_review: false } : null,
      patient_name: patName ? { value: patName, confidence: patEnt?.confidence ?? 0.95, requires_human_review: patEnt?.requires_human_review ?? false } : null,
      age_gender: ageGender ? { value: ageGender, confidence: 0.95, requires_human_review: false } : null,
      claim_reference: claimRef ? { value: claimRef, confidence: refEnt?.confidence ?? 0.5, requires_human_review: refEnt?.requires_human_review ?? true } : null,
      patient_id: patId ? { value: patId, confidence: 0.9, requires_human_review: false } : null,
      insurer: insurer ? { value: insurer, confidence: 0.92, requires_human_review: false } : null,
      tpa: tpa ? { value: tpa, confidence: 0.9, requires_human_review: false } : null,
      policy_number: policyNum ? { value: policyNum, confidence: 0.92, requires_human_review: false } : null,
      preauth_number: preauthNum ? { value: preauthNum, confidence: 0.9, requires_human_review: false } : null,
    },
    medicine: {
      medicine_name: medName ? { value: medName, confidence: medEnt?.confidence ?? 0.2, requires_human_review: medEnt?.requires_human_review ?? true } : null,
      active_ingredient: activeIng ? { value: activeIng, confidence: medEnt?.confidence ?? 0.8, requires_human_review: false } : null,
      strength: strength ? { value: strength, confidence: strEnt?.confidence ?? 0.8, requires_human_review: false } : null,
      dosage_quantity: dosageQty ? { value: dosageQty, confidence: doseEnt?.confidence ?? 0.4, requires_human_review: doseEnt?.requires_human_review ?? true } : null,
      route: route ? { value: route, confidence: 0.85, requires_human_review: false } : null,
      brand_name: brandName ? { value: brandName, confidence: 0.9, requires_human_review: false } : null,
      generic_name: genericName ? { value: genericName, confidence: 0.9, requires_human_review: false } : null,
      frequency: frequency ? { value: frequency, confidence: 0.9, requires_human_review: false } : null,
      duration: duration ? { value: duration, confidence: 0.9, requires_human_review: false } : null,
      instructions: instructions ? { value: instructions, confidence: 0.88, requires_human_review: false } : null,
    },
    clinical: {
      encounter_type: encType ? { value: encType, confidence: 0.95, requires_human_review: false } : null,
      length_of_stay: lengthOfStay ? { value: lengthOfStay, confidence: 0.98, requires_human_review: false } : null,
      procedure: procedure ? { value: procedure, confidence: procEnt?.confidence ?? 0.5, requires_human_review: procEnt?.requires_human_review ?? true } : null,
      diagnosis: diagnosis ? { value: diagnosis, confidence: diagEnt?.confidence ?? 0.95, requires_human_review: diagEnt?.requires_human_review ?? false } : null,
      clinical_indication: indication ? { value: indication, confidence: 0.88, requires_human_review: false } : null,
      admission_date: admDate ? { value: admDate, confidence: 0.95, requires_human_review: false } : null,
      discharge_date: disDate ? { value: disDate, confidence: 0.95, requires_human_review: false } : null,
      room_type: roomType ? { value: roomType, confidence: 0.9, requires_human_review: false } : null,
      findings: findings ? { value: findings, confidence: 0.88, requires_human_review: false } : null,
    },
    billing: {
      billed_amount: billedAmt ? { value: billedAmt, confidence: amtEnt?.confidence ?? 0.25, requires_human_review: amtEnt?.requires_human_review ?? true } : null,
      currency: 'INR',
      invoice_number: invEnt ? { value: invEnt.text, confidence: invEnt.confidence, requires_human_review: invEnt.requires_human_review } : null,
      gstin: gstinEnt ? { value: gstinEnt.text, confidence: gstinEnt.confidence, requires_human_review: gstinEnt.requires_human_review } : null,
      hsn_sac: hsnEnt ? { value: hsnEnt.text, confidence: hsnEnt.confidence, requires_human_review: hsnEnt.requires_human_review } : null,
      tax_amount: taxEnt ? { value: taxEnt.text, confidence: taxEnt.confidence, requires_human_review: taxEnt.requires_human_review } : null,
      discount: discEnt ? { value: discEnt.text, confidence: discEnt.confidence, requires_human_review: discEnt.requires_human_review } : null,
      patient_payable: payEnt ? { value: payEnt.text, confidence: payEnt.confidence, requires_human_review: payEnt.requires_human_review } : null,
      claimed_amount: claimedAmt ? { value: claimedAmt, confidence: 0.9, requires_human_review: false } : null,
      approved_amount: approvedAmt ? { value: approvedAmt, confidence: 0.9, requires_human_review: false } : null,
      insurance_deduction: deductionAmt ? { value: deductionAmt, confidence: 0.9, requires_human_review: false } : null,
      unit_price: unitPrice ? { value: unitPrice, confidence: 0.9, requires_human_review: false } : null,
      line_amount: lineAmount ? { value: lineAmount, confidence: 0.9, requires_human_review: false } : null,
      subtotal: subtotal ? { value: subtotal, confidence: 0.9, requires_human_review: false } : null,
    },
  }
}

function buildFallbackBillingReconciliation(text: string): BillingReconciliationResult | null {
  if (!text) return null
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const items: BillingLineItem[] = []
  let itemIdx = 1

  const isAmount = (s: string) => {
    const clean = s.replace(/[\s/=\-onlycrdr]+$/i, '').replace(/^[₹$€£RsINR\s.]+/i, '').replace(/,/g, '').trim()
    return Boolean(clean && !isNaN(Number(clean)) && Number(clean) > 0 && Number(clean) < 10000000)
  }
  const getAmt = (s: string) => {
    const clean = s.replace(/[\s/=\-onlycrdr]+$/i, '').replace(/^[₹$€£RsINR\s.]+/i, '').replace(/,/g, '').trim()
    return parseFloat(clean)
  }

  // Pass 1: Single line items
  for (const line of lines) {
    if (/^\s*(?:hospital|facility|clinic|institute|patient|doctor|admission|discharge|diagnosis|encounter|pincode|postal)\s*[:#]/i.test(line)) continue
    if (/^\s*(?:itemized\s*(?:total|sum)|total\b|stated\s*(?:total|billed)|invoice\s*total|net\s*(?:total|payable)|final\s*bill|grand\s*total|patient\s*payable)/i.test(line)) continue
    if (/^\s*(?:six|\d+|all)?\s*line\s*items?[:#]?$/i.test(line)) continue

    const m = line.match(/^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s*[:=]\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:\/[-=]|only|\.00\/[-=]))?\s*$/i) ||
      line.match(/^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s+(?:[₹$€£]|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:\/[-=]|only|\.00\/[-=]))?\s*$/i) ||
      line.match(/^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s+[-–—]\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:\/[-=]|only|\.00\/[-=]))?\s*$/i) ||
      line.match(/^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)(?:\s{2,}|\t)\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:\/[-=]|only|\.00\/[-=]))?\s*$/i) ||
      line.match(/^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?([A-Za-z&/().\s\-]+?)\s+([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:\/[-=]|only|\.00\/[-=]))?\s*$/i)
    if (m) {
      const desc = m[1].trim()
      const amt = parseFloat(m[2].replace(/,/g, ''))
      if (desc.length >= 3 && !/^\d+$/.test(desc) && amt > 0) {
        items.push({
          item_id: `item_${String(itemIdx).padStart(3, '0')}`,
          description: desc,
          amount: amt,
          currency: 'INR',
          raw_text: line
        })
        itemIdx++
      }
    }
  }

  // Pass 2: Adjacent line items
  if (items.length < 2) {
    items.length = 0
    itemIdx = 1
    let i = 0
    while (i < lines.length - 1) {
      const curr = lines[i]
      const next = lines[i + 1]
      if (isAmount(next) && !isAmount(curr)) {
        const cleanDesc = curr.replace(/^\s*(?:\d+[\.\)]?|[-*•])\s*/, '').trim()
        if (
          cleanDesc.length >= 3 &&
          !/^(?:hospital|patient|doctor|admission|discharge|diagnosis|encounter|total|payable|billed|subtotal|stated)/i.test(cleanDesc)
        ) {
          items.push({
            item_id: `item_${String(itemIdx).padStart(3, '0')}`,
            description: cleanDesc,
            amount: getAmt(next),
            currency: 'INR',
            raw_text: `${curr}: ${next}`
          })
          itemIdx++
          i += 2
          continue
        }
      }
      i++
    }
  }

  if (items.length === 0) return null

  const itemizedSum = Math.round(items.reduce((acc, it) => acc + it.amount, 0) * 100) / 100

  // Stated total
  let statedTotal: number | null = null
  const statedMatch = text.match(/(?:stated\s*(?:total|billed|bill)?\s*(?:amount|charges?)?|total\s*billed\s*amount|grand\s*total|final\s*bill|patient\s*payable)\s*[:=]?\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:\/[-=]|only))?/i) ||
    text.match(/(?:invoice\s*total|net\s*(?:total|payable|amount)|total\s*(?:bill|amount|charge|billed))\s*[:=]?\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:\/[-=]|only))?/i)
  if (statedMatch) {
    statedTotal = parseFloat(statedMatch[1].replace(/,/g, ''))
  } else {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^(?:stated\s*(?:total|billed|bill)?\s*(?:amount|charges?)?|total\s*billed\s*amount|grand\s*total|final\s*bill|patient\s*payable)\s*[:=]?$/i.test(lines[i])) {
        if (isAmount(lines[i + 1])) {
          statedTotal = getAmt(lines[i + 1])
          break
        }
      }
    }
  }

  const diff = statedTotal != null ? Math.round((itemizedSum - statedTotal) * 100) / 100 : null
  const classification = (statedTotal != null && Math.abs(diff ?? 0) >= 0.01)
    ? 'TOTAL_MISMATCH'
    : (statedTotal != null ? 'TOTAL_MATCH' : 'INSUFFICIENT_ITEMIZATION')

  const overlaps: any[] = []
  const bedside = items.find((it) => /bedside monitoring/i.test(it.description))
  const room = items.find((it) => /room & nursing/i.test(it.description))
  if (bedside && room) {
    overlaps.push({
      item_a: bedside.description,
      item_b: room.description,
      overlap_type: 'BUNDLED_NURSING_OVERLAP',
      potential_overlap_amount: bedside.amount,
      currency: 'INR',
      policy_reference: 'General Inpatient Tariff Schedule Guidelines',
      explanation: `'${bedside.description}' (₹${bedside.amount.toLocaleString()}) may potentially be bundled into '${room.description}'. Policy-dependent — verify with hospital billing policy.`
    })
  }

  return {
    classification: classification as any,
    stated_total: statedTotal,
    itemized_sum: itemizedSum,
    difference: diff,
    currency: 'INR',
    line_items: items,
    duplicates: [],
    overlaps: overlaps,
    benchmark_comparisons: [],
    summary_message: (diff != null && Math.abs(diff) >= 0.01)
      ? `Unexplained difference of ₹${Math.abs(diff).toLocaleString('en-IN', { minimumFractionDigits: 2 })} between itemized charges (₹${itemizedSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) and stated total bill (₹${statedTotal?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}).`
      : `Itemized charges match stated total.`,
    explanations: [
      (diff != null && Math.abs(diff) >= 0.01)
        ? `Arithmetic discrepancy: Itemized sum of ₹${itemizedSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })} differs from stated total of ₹${statedTotal?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`
        : 'Arithmetic integrity verified.'
    ],
    auditor_notes: [
      'Discrepancies reported as arithmetic observations, not accusations of fraud.'
    ],
    disclaimer: 'Arithmetic and line-item discrepancies reflect invoice reconciliation facts.'
  }
}

export function FiveModelsAuditPanel({
  claimId,
  sharedContext,
  synthesis,
  nerEntities,
  nerGroupedInfo,
  retrievalPassages,
  nliResult,
  providerAnomaly,
  claimAnomaly,
  medicineSubstitution,
  billingReconciliation,
  requiresHumanReview = false,
  humanReviewReasons = [],
}: FiveModelsAuditPanelProps) {
  const { isDark } = useTheme()
  const [activeTab, setActiveTab] = useState<'all' | 'm1' | 'm2' | 'm3' | 'm4' | 'rec' | 'm5' | 'med'>('all')
  const [showRawNerTrace, setShowRawNerTrace] = useState(false)
  const [showRawM2Trace, setShowRawM2Trace] = useState(false)
  const [showRawM3Trace, setShowRawM3Trace] = useState(false)
  const [showRawM4Trace, setShowRawM4Trace] = useState(false)
  const [showRawM5Trace, setShowRawM5Trace] = useState(false)
  const [showAllLineItems, setShowAllLineItems] = useState(false)

  const effectiveClaimId = claimId || sharedContext?.claim_id || 'CLM_ACTIVE'
  const primaryEntity = formatReadableText(
    sharedContext?.medicines?.[0] ||
    sharedContext?.procedures?.[0] ||
    sharedContext?.diagnoses?.[0] ||
    synthesis?.primary_entity ||
    'Clinical Encounter'
  )

  const hasM1 = Boolean(nerEntities && nerEntities.length > 0)
  const hasM2 = Boolean(retrievalPassages && retrievalPassages.length > 0)
  const hasM3 = Boolean(nliResult)
  const hasM4 = Boolean(providerAnomaly)
  const hasM5 = Boolean(claimAnomaly)
  const hasMed = Boolean(medicineSubstitution)

  // Derive complete grouped medical information if not pre-populated by backend
  const groupedInfo: GroupedMedicalInformation =
    nerGroupedInfo || buildFallbackGroupedInfo(sharedContext, nerEntities)

  const rec: BillingReconciliationResult | null =
    (billingReconciliation && (billingReconciliation.itemized_sum > 0 || billingReconciliation.stated_total != null))
      ? billingReconciliation
      : (buildFallbackBillingReconciliation(sharedContext?.original_text || '') || billingReconciliation || null)

  const cleanHospitalName = (() => {
    let name = sharedContext?.hospital_name || groupedInfo.hospital.hospital_name?.value || ''
    if (!name || name === 'Provider identity unavailable' || name.toLowerCase() === 'not specified') {
      const matchFacility = (sharedContext?.original_text || '').match(/(?:Hospital|Clinic|Institute|Medical Center|Facility)\s*[:#]\s*([A-Za-z0-9&.,\s\-]+?)(?:\n|\r|$)/i) ||
        (sharedContext?.original_text || '').match(/([A-Z][A-Za-z0-9&.,\s]+?(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System))\b/i)
      if (matchFacility) return matchFacility[1].trim()
      return 'Provider identity unavailable'
    }
    if (name.toLowerCase().startsWith('ee ')) {
      const matchFacility = (sharedContext?.original_text || '').match(/([A-Z][a-z0-9&.,\s]+(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System))\b/i)
      if (matchFacility) return matchFacility[1].trim()
      return name.replace(/^ee\s*/i, '').trim()
    }
    if (name.startsWith('##')) return name.replace(/^##\s*/i, '').trim()
    return name
  })()

  const cleanLocation = (() => {
    const loc = groupedInfo.hospital.location?.value || ''
    if (loc && loc.toLowerCase() !== 'not specified') return loc
    const locMatch = (sharedContext?.original_text || '').match(/\b(Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Mumbai|Delhi|Chennai|Hyderabad|Kolkata|Pune|Ahmedabad|Jaipur)\b(?:,\s*(?:Karnataka|Maharashtra|Tamil Nadu|Delhi|Telangana|West Bengal|Gujarat|Rajasthan|India))?(?:\s*[-–—]\s*\d{5,6})?/i)
    if (locMatch) return locMatch[0].trim()
    return 'Not specified'
  })()

  const effectiveEncounter = (() => {
    const enc = groupedInfo.clinical.encounter_type?.value || sharedContext?.source_type || ''
    if (enc && enc.toLowerCase().includes('inpatient')) return 'Inpatient Encounter'
    if (enc && enc.toLowerCase().includes('outpatient')) return 'Outpatient Encounter'
    if (enc && enc.toLowerCase().includes('emergency')) return 'Emergency Department Encounter'
    if (groupedInfo.clinical.admission_date?.value || groupedInfo.clinical.length_of_stay?.value) return 'Inpatient Encounter'
    return enc || 'Inpatient Encounter'
  })()

  const cleanProcedure = (() => {
    const rawProc = groupedInfo.clinical.procedure?.value || ''
    if (!rawProc || rawProc.toLowerCase() === 'not specified') return 'Not specified'
    const low = rawProc.toLowerCase().trim()
    if (low.startsWith('&') || low.startsWith('-') || low.startsWith('/')) return 'Not specified'
    if (
      low.includes('respiratory support') ||
      low.includes('nursing handover') ||
      low.includes('bedside monitoring') ||
      low.includes('room & nursing') ||
      low.includes('physician consultation') ||
      low.includes('laboratory investigations') ||
      low.includes('medicines & consumables') ||
      low.includes('consumables') ||
      /\b\d+\s*days?\b/i.test(low)
    ) {
      return 'Not specified'
    }
    return rawProc
  })()

  const hasIndividualMedicines = Boolean(
    groupedInfo.medicine.medicine_name?.value &&
    !['not specified', 'medicines & consumables', 'medicines and consumables', 'consumables', 'pharmacy', 'medicines'].includes(groupedInfo.medicine.medicine_name.value.toLowerCase().trim()) &&
    (groupedInfo.medicine.brand_name?.value || groupedInfo.medicine.generic_name?.value || groupedInfo.medicine.active_ingredient?.value || groupedInfo.medicine.strength?.value)
  )

  return (
    <div className={`rounded-2xl border overflow-hidden shadow-adjudo transition-all ${
      isDark ? 'bg-adjudo-dark-surface border-neutral-700' : 'bg-white border-neutral-900'
    }`}>
      {/* Top Header with Shared Claim Context Metadata */}
      <div className="px-6 py-5 bg-neutral-950 text-white border-b border-neutral-900 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="w-7 h-7 rounded-lg bg-orange-600 text-white border border-neutral-900 flex items-center justify-center font-black text-xs shadow-adjudo-sm">
              5AI
            </span>
            <h3 className="text-base font-black tracking-tight text-white">
              Five AI Models Integrated Audit Pipeline
            </h3>
            <span className="px-2.5 py-0.5 rounded-md bg-neutral-800 text-orange-400 font-mono text-xs border border-neutral-700 font-bold">
              Claim ID: {effectiveClaimId}
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1.5 flex items-center gap-2 flex-wrap">
            <span><strong>Hospital:</strong> {cleanHospitalName !== 'Provider identity unavailable' ? cleanHospitalName : (sharedContext?.hospital_name || 'Encounter Facility')}</span>
            <span>&bull;</span>
            <span><strong>Entity:</strong> {primaryEntity}</span>
            {sharedContext?.billed_amount !== undefined && sharedContext?.billed_amount !== null && (
              <>
                <span>&bull;</span>
                <span><strong>Billed:</strong> {sharedContext.currency === 'INR' ? '₹' : '$'}{sharedContext.billed_amount.toLocaleString()}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {requiresHumanReview ? (
            <span className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-400/50 text-rose-300 font-bold text-xs flex items-center gap-1.5 animate-pulse whitespace-nowrap">
              <span>⚠️</span>
              <span>HUMAN REVIEW REQUIRED</span>
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap">
              <span>✓</span>
              <span>ALL SAFETY POLICIES PASSED</span>
            </span>
          )}
        </div>
      </div>

      {/* Unified Cross-Model Synthesis & Issue-Aware Summary */}
      {synthesis && (
        <div className={`p-5 border-b text-xs space-y-3 transition-colors ${
          isDark
            ? 'bg-slate-900/90 border-slate-800 text-slate-300'
            : 'bg-gradient-to-r from-slate-50 via-indigo-50/20 to-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                isDark ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-indigo-100 text-indigo-800'
              }`}>
                Cross-Model Synthesis
              </span>
              <strong className={`text-xs ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                Context Alignment &amp; Issue Detection for Claim {effectiveClaimId}
              </strong>
            </div>

            {synthesis.primary_trigger_issue && (
              <span className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Decisive Trigger: <strong className={`font-mono ${isDark ? 'text-sky-300' : 'text-slate-900'}`}>{synthesis.primary_trigger_issue}</strong>
              </span>
            )}
          </div>

          {/* Issue Pills */}
          {synthesis.detected_issues && synthesis.detected_issues.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-bold text-slate-500">Detected Issues:</span>
              {synthesis.detected_issues.map((issueKey) => {
                const badge = ISSUE_BADGES[issueKey] || {
                  label: issueKey.replace(/_/g, ' '),
                  color: 'bg-slate-100 text-slate-700 border-slate-300',
                  icon: 'ℹ️',
                }
                return (
                  <span
                    key={issueKey}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badge.color}`}
                  >
                    <span>{badge.icon}</span>
                    <span>{badge.label}</span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Model Findings Reconciliation Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            {/* Clinical Evidence (M1-M3) */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <strong className="text-[11px] text-slate-800 uppercase tracking-wide">
                  Clinical Indication (M1-M3)
                </strong>
                <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded font-bold">
                  BioBERT &bull; BGE &bull; DeBERTa
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {synthesis.clinical_agreement_summary}
              </p>
            </div>

            {/* Pricing & Fee Schedule */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <strong className="text-[11px] text-slate-800 uppercase tracking-wide">
                  Financial Audit (Benchmarks)
                </strong>
                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold">
                  Public Tariffs
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {synthesis.financial_agreement_summary}
              </p>
            </div>

            {/* Provider & Inpatient (M4-M5) */}
            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <strong className="text-[11px] text-slate-800 uppercase tracking-wide">
                  Provider &amp; Inpatient (M4-M5)
                </strong>
                <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold">
                  Isolation Forest V3
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {synthesis.provider_agreement_summary}
              </p>
            </div>
          </div>

          {/* Missing Information Notice */}
          {synthesis.missing_information && synthesis.missing_information.length > 0 && (
            <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] text-amber-900 flex items-start gap-2">
              <span className="text-amber-600 font-bold mt-0.5">ℹ️</span>
              <div className="flex-1">
                <strong>Encounter Context Gaps:</strong>
                <span className="ml-1 text-amber-800">
                  {synthesis.missing_information.join(' ')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Human Review Banner if triggered */}
      {requiresHumanReview && (
        <div className="p-4 bg-rose-50 border-b border-rose-200 text-rose-950 text-xs">
          <div className="flex items-start gap-3">
            <span className="text-lg flex-shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1 space-y-1">
              <strong className="text-rose-900 font-bold text-xs uppercase tracking-wide block">
                Human Review Triggers Detected for Claim {effectiveClaimId}
              </strong>
              <p className="text-rose-800 leading-relaxed">
                One or more integrated AI models or pricing safety rules flagged low prediction confidence, clinical contradiction, or unusual anomaly signals. A clinical claims auditor must manually examine these findings:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 font-medium text-rose-900 pl-1">
                {humanReviewReasons.length > 0 ? (
                  humanReviewReasons.map((reason, idx) => (
                    <li key={idx} className="leading-snug">{reason}</li>
                  ))
                ) : (
                  <li>Model prediction flagged for supervisory review.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar Filter */}
      <div className={`px-6 py-3 border-b flex items-center gap-2 overflow-x-auto text-xs transition-colors ${
        isDark ? 'bg-neutral-900/90 border-neutral-700' : 'bg-cream-100 border-neutral-900'
      }`}>
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'all'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          All 5 Models
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('m1')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'm1'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          <span>M1: BioBERT NER</span>
          {hasM1 ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Entities extracted" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('m2')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'm2'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          <span>M2: BGE Retrieval</span>
          {hasM2 ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Passages retrieved" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('m3')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'm3'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          <span>M3: DeBERTa NLI</span>
          {hasM3 ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" title="NLI evaluated" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('m4')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'm4'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          <span>M4: Provider Anomaly &amp; Billing Reconciliation</span>
          {providerAnomaly?.has_sufficient_data || rec ? (
            <span
              className={`w-2 h-2 rounded-full ${
                providerAnomaly?.is_anomaly || rec?.classification === 'TOTAL_MISMATCH'
                  ? 'bg-rose-500'
                  : rec?.classification === 'TOTAL_MATCH' || (providerAnomaly?.has_sufficient_data && !providerAnomaly?.is_anomaly)
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
              }`}
              title={
                providerAnomaly?.is_anomaly
                  ? 'Provider Anomaly Detected'
                  : rec?.classification
                  ? `Reconciliation: ${rec.classification}`
                  : 'Evaluated'
              }
            />
          ) : (
            <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('m5')}
          className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'm5'
              ? isDark
                ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
              : isDark
              ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              : 'text-neutral-800 hover:text-black hover:bg-cream-200'
          }`}
        >
          <span>M5: Claim Anomaly</span>
          {claimAnomaly?.has_sufficient_data ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Evaluated with claim metrics" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-amber-500" title="Insufficient claim features" />
          )}
        </button>

        {hasMed && (
          <button
            type="button"
            onClick={() => setActiveTab('med')}
            className={`px-3 py-1.5 rounded-lg font-black transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'med'
                ? isDark
                  ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
                  : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
                : isDark
                ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
                : 'text-neutral-800 hover:text-black hover:bg-cream-200'
            }`}
          >
            <span>Medicine Matcher</span>
            <span className="w-2 h-2 rounded-full bg-orange-500" />
          </button>
        )}
      </div>

      {/* Main Body with Model Responsibility & Input Context Alignment */}
      <div className="p-6 space-y-6">

        {/* MODEL 1: BioBERT NER */}
        {(activeTab === 'all' || activeTab === 'm1') && (
          hasM1 ? (
            <div className="p-5 rounded-xl border border-sky-200 bg-sky-50/20 space-y-4 shadow-2xs">
              {/* Clean Professional Header without internal model file paths */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sky-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-mono text-[10px] font-bold uppercase">
                    Model 1
                  </span>
                  <h4 className="text-sm font-bold text-slate-900">
                    Clinical Entity Extraction
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-slate-600 bg-white px-2.5 py-1 rounded-full border border-slate-200 shadow-2xs capitalize">
                  {groupedInfo.document_type ? groupedInfo.document_type.replace(/_/g, ' ') : 'Structured Medical Information'}
                </span>
              </div>

              {/* Responsibility & Input Context Header */}
              <div className="p-2.5 bg-white rounded-lg border border-sky-100 text-[11px] text-slate-600 flex flex-col sm:flex-row justify-between gap-2">
                <div>
                  <strong className="text-slate-800">Responsibility:</strong> Extract structured hospital, medication, clinical, and billing information.
                </div>
                <div>
                  <strong className="text-slate-800">Input Source:</strong> Document {sharedContext?.document_id || 'Text'} ({sharedContext?.source_type || 'clinical_note'})
                </div>
              </div>

                            {/* Logically Grouped Medical Information (Auditor Presentation) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Hospital Information */}
                <div className="bg-white rounded-xl border border-sky-100 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-sky-50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🏥</span>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-sky-950">
                        {groupedInfo.hospital.insurer?.value ? 'Insurer & Facility' : 'Hospital Information'}
                      </h5>
                    </div>
                    <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                      Facility &amp; Patient
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Hospital Name</span>
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-900 font-semibold">{cleanHospitalName}</strong>
                        {groupedInfo.hospital.hospital_name?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Needs review</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Location</span>
                      <span className="text-slate-700 font-medium">{cleanLocation}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Patient Name</span>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-900 font-semibold">{groupedInfo.hospital.patient_name?.value || 'Not specified'}</span>
                        {groupedInfo.hospital.patient_name?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Needs review</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Claim / Account Reference</span>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-slate-800 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                          {groupedInfo.hospital.claim_reference?.value || 'Not specified'}
                        </span>
                        {groupedInfo.hospital.claim_reference?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Needs review</span>
                        )}
                      </div>
                    </div>
                    {groupedInfo.hospital.patient_id?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Patient ID / UHID</span>
                        <span className="font-mono text-slate-800 font-semibold">{groupedInfo.hospital.patient_id.value}</span>
                      </div>
                    )}
                    {groupedInfo.hospital.insurer?.value && (
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Insurer</span>
                          <span className="text-slate-800 font-semibold">{groupedInfo.hospital.insurer.value}</span>
                        </div>
                        {groupedInfo.hospital.tpa?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">TPA</span>
                            <span className="text-slate-800 font-semibold">{groupedInfo.hospital.tpa.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {(groupedInfo.hospital.policy_number?.value || groupedInfo.hospital.preauth_number?.value) && (
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        {groupedInfo.hospital.policy_number?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Policy No.</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.hospital.policy_number.value}</span>
                          </div>
                        )}
                        {groupedInfo.hospital.preauth_number?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Pre-Auth Ref</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.hospital.preauth_number.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Medicine Information */}
                <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-emerald-50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">💊</span>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                        Medicine Information
                      </h5>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      Pharmaceutical
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Medicine Name</span>
                      <div className="flex items-center justify-between gap-1">
                        <strong className="text-slate-900 font-semibold">{groupedInfo.medicine.medicine_name?.value || 'Not specified'}</strong>
                        {groupedInfo.medicine.medicine_name?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded whitespace-nowrap">
                            Needs review ({Math.round((groupedInfo.medicine.medicine_name.confidence || 0) * 100)}%)
                          </span>
                        )}
                      </div>
                    </div>
                    {(groupedInfo.medicine.brand_name?.value || groupedInfo.medicine.generic_name?.value) && (
                      <div className="grid grid-cols-2 gap-2">
                        {groupedInfo.medicine.brand_name?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Brand</span>
                            <span className="text-slate-800 font-semibold">{groupedInfo.medicine.brand_name.value}</span>
                          </div>
                        )}
                        {groupedInfo.medicine.generic_name?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Generic</span>
                            <span className="text-slate-800 font-semibold">{groupedInfo.medicine.generic_name.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Active Ingredient</span>
                      <span className="text-slate-700 font-medium">{groupedInfo.medicine.active_ingredient?.value || 'Not specified'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Strength</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.medicine.strength?.value || 'Not specified'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Dosage / Quantity</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.medicine.dosage_quantity?.value || 'Not specified'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Route</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.medicine.route?.value || 'Not specified'}</span>
                      </div>
                    </div>
                    {(groupedInfo.medicine.frequency?.value || groupedInfo.medicine.duration?.value) && (
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        {groupedInfo.medicine.frequency?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Frequency</span>
                            <span className="text-slate-800 font-semibold">{groupedInfo.medicine.frequency.value}</span>
                          </div>
                        )}
                        {groupedInfo.medicine.duration?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Duration</span>
                            <span className="text-slate-800 font-semibold">{groupedInfo.medicine.duration.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {groupedInfo.medicine.instructions?.value && (
                      <div className="pt-1 border-t border-slate-100">
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Instructions</span>
                        <span className="text-slate-700 font-medium">{groupedInfo.medicine.instructions.value}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Clinical Information */}
                <div className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-indigo-50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🩺</span>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                        Clinical Information
                      </h5>
                    </div>
                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                      Encounter Context
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Encounter Type</span>
                      <span className="text-slate-800 font-medium">{effectiveEncounter}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Procedure</span>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-slate-900 font-semibold">{cleanProcedure}</span>
                        {groupedInfo.clinical.procedure?.requires_human_review && cleanProcedure !== 'Not specified' && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Needs review</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Diagnosis</span>
                      <div className="flex items-center justify-between gap-1">
                        <strong className="text-slate-900 font-semibold">{groupedInfo.clinical.diagnosis?.value || 'Not specified'}</strong>
                        {groupedInfo.clinical.diagnosis?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Needs review</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Indication</span>
                      <span className="text-slate-700 font-medium">{groupedInfo.clinical.clinical_indication?.value || 'Not specified'}</span>
                    </div>
                    {(groupedInfo.clinical.admission_date?.value || groupedInfo.clinical.discharge_date?.value) && (
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        {groupedInfo.clinical.admission_date?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Admission Date</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.clinical.admission_date.value}</span>
                          </div>
                        )}
                        {groupedInfo.clinical.discharge_date?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Discharge Date</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.clinical.discharge_date.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {groupedInfo.clinical.room_type?.value && (
                      <div className="pt-1 border-t border-slate-100">
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Room / Ward Type</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.clinical.room_type.value}</span>
                      </div>
                    )}
                    {groupedInfo.clinical.findings?.value && (
                      <div className="pt-1 border-t border-slate-100">
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Findings</span>
                        <span className="text-slate-700 font-medium">{groupedInfo.clinical.findings.value}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Billing Information */}
                <div className="bg-white rounded-xl border border-amber-100 p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-amber-50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">💳</span>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                        Billing Information
                      </h5>
                    </div>
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      Financial Audit
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Billed Amount</span>
                      <div className="flex items-center justify-between">
                        <strong className="text-base font-bold text-slate-900">
                          {groupedInfo.billing.billed_amount?.value || 'Not specified'}
                        </strong>
                        {groupedInfo.billing.billed_amount?.requires_human_review && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">
                            Needs review ({Math.round((groupedInfo.billing.billed_amount.confidence || 0) * 100)}%)
                          </span>
                        )}
                      </div>
                    </div>
                    {(groupedInfo.billing.claimed_amount?.value || groupedInfo.billing.approved_amount?.value) && (
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        {groupedInfo.billing.claimed_amount?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Claimed Amount</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.claimed_amount.value}</span>
                          </div>
                        )}
                        {groupedInfo.billing.approved_amount?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Approved Amount</span>
                            <span className="font-mono text-slate-800 font-semibold text-emerald-700">{groupedInfo.billing.approved_amount.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {groupedInfo.billing.insurance_deduction?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Insurance Deductions</span>
                        <span className="font-mono text-rose-700 font-semibold">{groupedInfo.billing.insurance_deduction.value}</span>
                      </div>
                    )}
                    {(groupedInfo.billing.unit_price?.value || groupedInfo.billing.line_amount?.value || groupedInfo.billing.subtotal?.value) && (
                      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                        {groupedInfo.billing.unit_price?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Unit Price</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.unit_price.value}</span>
                          </div>
                        )}
                        {groupedInfo.billing.line_amount?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Line Amount</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.line_amount.value}</span>
                          </div>
                        )}
                        {groupedInfo.billing.subtotal?.value && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Subtotal</span>
                            <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.subtotal.value}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {groupedInfo.billing.invoice_number?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Invoice Number</span>
                        <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.invoice_number.value}</span>
                      </div>
                    )}
                    {groupedInfo.billing.gstin?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">GSTIN</span>
                        <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.gstin.value}</span>
                      </div>
                    )}
                    {groupedInfo.billing.hsn_sac?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">HSN / SAC Code</span>
                        <span className="font-mono text-slate-800 font-semibold">{groupedInfo.billing.hsn_sac.value}</span>
                      </div>
                    )}
                    {groupedInfo.billing.tax_amount?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Tax Amount</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.billing.tax_amount.value}</span>
                      </div>
                    )}
                    {groupedInfo.billing.discount?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Discount</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.billing.discount.value}</span>
                      </div>
                    )}
                    {groupedInfo.billing.patient_payable?.value && (
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Patient Payable</span>
                        <span className="text-slate-800 font-semibold">{groupedInfo.billing.patient_payable.value}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Developer / Raw Audit Trace Toggle */}
              <div className="pt-2 border-t border-sky-100/60">
                <button
                  type="button"
                  onClick={() => setShowRawNerTrace(!showRawNerTrace)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-sky-700 transition-colors"
                >
                  <span>{showRawNerTrace ? '▼' : '▶'}</span>
                  <span>{showRawNerTrace ? 'Hide' : 'Show'} Raw NER Audit Trace (Developer View)</span>
                  <span className="text-[10px] text-slate-400">({nerEntities!.length} raw spans)</span>
                </button>

                {showRawNerTrace && (
                  <div className="mt-2.5 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <div className="text-[10px] font-mono text-slate-500 flex justify-between">
                      <span>Raw Token Spans &amp; Character Offsets</span>
                      <span>BioBERT v4 Checkpoint</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {nerEntities!.map((ent, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-slate-200 text-slate-700 shadow-2xs"
                        >
                          <span className="font-bold text-sky-800">{ent.entity}:</span>
                          <span className="text-slate-900 font-medium">"{ent.text}"</span>
                          <span className="text-slate-400">({Math.round(ent.confidence * 100)}%)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'm1' ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-2">
              <span className="text-2xl block">🔍</span>
              <strong className="text-sm text-slate-800 block">No Entities Extracted via BioBERT NER</strong>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No Indian healthcare entities were identified in this document.
              </p>
            </div>
          ) : null
        )}

        {/* MODEL 2: BGE Semantic Retrieval */}
        {(activeTab === 'all' || activeTab === 'm2') && (
          hasM2 ? (
            <div className="p-5 rounded-xl border border-indigo-200 bg-indigo-50/20 space-y-4 shadow-2xs">
              {/* Clean Professional Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono text-[10px] font-bold uppercase">
                    Model 2
                  </span>
                  <h4 className="text-sm font-bold text-slate-900">
                    Clinical Guideline Retrieval
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shadow-2xs flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Semantic Search Online &bull; {retrievalPassages!.length} Sources Evaluated
                </span>
              </div>

              {/* Responsibility & Target Context */}
              <div className="p-2.5 bg-white rounded-lg border border-indigo-100 text-[11px] text-slate-600 flex flex-col sm:flex-row justify-between gap-2">
                <div>
                  <strong className="text-slate-800">Analyzed Entity:</strong> &ldquo;{primaryEntity}&rdquo;
                </div>
                <div>
                  <strong className="text-slate-800">Knowledge Base:</strong> Indian Pharmacopoeia, MoHFW NHM &amp; Statutory Guidelines
                </div>
              </div>

              {/* Compact Evidence Summary (Top 1-3 Genuinely Relevant Guidelines) */}
              <div className="space-y-3">
                {retrievalPassages!.slice(0, 3).map((p, idx) => {
                  const simPct = Math.round(p.similarity_score * 100)
                  return (
                    <div
                      key={idx}
                      className="p-4 bg-white rounded-xl border border-indigo-100/80 shadow-xs space-y-2 hover:border-indigo-200 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-indigo-950">{p.title}</span>
                          {p.guideline_id && (
                            <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              {p.guideline_id}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500 font-medium">{p.source}</span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
                            {simPct}% relevance
                          </span>
                        </div>
                      </div>
                      <p className="text-slate-700 text-xs leading-relaxed line-clamp-2">
                        &ldquo;{p.text}&rdquo;
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* Technical Details & Audit Trace Toggle */}
              <div className="pt-2 border-t border-indigo-100/60">
                <button
                  type="button"
                  onClick={() => setShowRawM2Trace(!showRawM2Trace)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-indigo-700 transition-colors"
                >
                  <span>{showRawM2Trace ? '▼' : '▶'}</span>
                  <span>{showRawM2Trace ? 'Hide' : 'View'} Technical Details &amp; Audit Trace</span>
                  <span className="text-[10px] text-slate-400">({retrievalPassages!.length} total passages, vector embeddings)</span>
                </button>

                {showRawM2Trace && (
                  <div className="mt-2.5 p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-3 text-xs">
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 border-b border-slate-200 pb-1.5">
                      <span>Embedding Model: BGE Small en-v1.5 (384-d dense vectors)</span>
                      <span>ChromaDB Guidelines Collection</span>
                    </div>
                    <div className="space-y-2">
                      {retrievalPassages!.map((p, idx) => (
                        <div key={idx} className="p-2.5 bg-white rounded border border-slate-200 font-mono text-[11px] space-y-1">
                          <div className="flex justify-between text-slate-600">
                            <span className="font-bold text-slate-800">Passage #{idx + 1}: {p.passage_id}</span>
                            <span>Similarity: {p.similarity_score.toFixed(4)}</span>
                          </div>
                          <p className="text-slate-700 font-sans text-xs">{p.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'm2' ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-2">
              <span className="text-2xl block">📚</span>
              <strong className="text-sm text-slate-800 block">No Guideline Passages Retrieved</strong>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No matching clinical evidence passages met the relevance threshold for the extracted entity in the local knowledge base.
              </p>
            </div>
          ) : null
        )}

        {/* MODEL 3: DeBERTa Clinical Verification */}
        {(activeTab === 'all' || activeTab === 'm3') && (
          hasM3 ? (
            <div className="p-5 rounded-xl border border-purple-200 bg-purple-50/20 space-y-4 shadow-2xs">
              {/* Clean Professional Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-mono text-[10px] font-bold uppercase">
                    Model 3
                  </span>
                  <h4 className="text-sm font-bold text-slate-900">
                    Clinical Evidence Verification
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  {nliResult!.predicted_class === 'entailment' ? (
                    <span className="px-3 py-1 rounded-full font-bold text-xs uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                      SUPPORTED
                    </span>
                  ) : nliResult!.predicted_class === 'contradiction' ? (
                    <span className="px-3 py-1 rounded-full font-bold text-xs uppercase bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                      CONTRADICTED
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full font-bold text-xs uppercase bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                      INSUFFICIENT EVIDENCE / NEUTRAL
                    </span>
                  )}
                </div>
              </div>

              {/* Responsibility & Input Context Header */}
              <div className="p-2.5 bg-white rounded-lg border border-purple-100 text-[11px] text-slate-600 flex flex-col sm:flex-row justify-between gap-2">
                <div>
                  <strong className="text-slate-800">Responsibility:</strong> Verify whether clinical guidelines substantiate the medicine or procedure for the diagnosed condition.
                </div>
                <div>
                  <strong className="text-slate-800">Verification Engine:</strong> Natural Language Inference Cross-Examination
                </div>
              </div>

              {/* Clean Clinical Assessment Card */}
              <div className="p-4 bg-white rounded-xl border border-purple-100 space-y-3 shadow-xs text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Diagnosis</span>
                    <strong className="text-slate-900 font-semibold text-sm">
                      {groupedInfo.clinical.diagnosis?.value || sharedContext?.diagnoses?.[0] || 'Diagnosed Condition'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Administered Treatment</span>
                    <strong className="text-slate-900 font-semibold text-sm">
                      {groupedInfo.medicine.medicine_name?.value ||
                       sharedContext?.medicines?.[0] ||
                       groupedInfo.clinical.procedure?.value ||
                       sharedContext?.procedures?.[0] ||
                       (primaryEntity && !['4 days', 'no', 'february'].includes(primaryEntity.toLowerCase()) ? primaryEntity : 'Supportive Inpatient Care')}
                    </strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Finding &amp; Assessment</span>
                  <p className="text-slate-700 leading-relaxed">
                    {nliResult!.predicted_class === 'entailment' ? (
                      <span>
                        The administered treatment is <strong>clinically substantiated</strong> and indicated by authoritative treatment guidelines for the stated diagnosis.
                      </span>
                    ) : nliResult!.predicted_class === 'contradiction' ? (
                      <span className="text-rose-900 font-medium">
                        The treatment <strong>conflicts with or is contraindicated</strong> by clinical guidelines for this specific diagnosis. Immediate clinical review required.
                      </span>
                    ) : (
                      <span className="text-amber-900">
                        The retrieved clinical guidelines neither directly affirm nor contradict this administration. The evidence is neutral/inconclusive; human clinical review is recommended.
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-700">Evidentiary Source:</span>
                    <span>{retrievalPassages?.[0]?.title || 'Standard Treatment Guidelines'}</span>
                  </div>
                  {nliResult!.probabilities && nliResult!.predicted_class && (
                    <div className="flex items-center gap-1 font-mono text-slate-600 font-semibold">
                      <span>Model Confidence:</span>
                      <span>
                        {Math.round(((nliResult!.probabilities as any)[nliResult!.predicted_class] || 0) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Technical Details & Audit Trace Toggle */}
              <div className="pt-2 border-t border-purple-100/60">
                <button
                  type="button"
                  onClick={() => setShowRawM3Trace(!showRawM3Trace)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-purple-700 transition-colors"
                >
                  <span>{showRawM3Trace ? '▼' : '▶'}</span>
                  <span>{showRawM3Trace ? 'Hide' : 'View'} Technical Details &amp; Audit Trace</span>
                  <span className="text-[10px] text-slate-400">(Hypothesis, premise, probability distribution)</span>
                </button>

                {showRawM3Trace && (
                  <div className="mt-2.5 p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] bg-white p-2.5 rounded border border-slate-200">
                      <div>
                        <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Hypothesis (Clinical Claim):</span>
                        <span className="text-slate-900 font-semibold">&ldquo;{sharedContext?.clinical_statement || primaryEntity}&rdquo;</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Premise (Guideline Text):</span>
                        <span className="text-slate-700 italic line-clamp-3">&ldquo;{retrievalPassages?.[0]?.text || 'Guideline text passage'}&rdquo;</span>
                      </div>
                    </div>

                    {nliResult!.probabilities && Object.keys(nliResult!.probabilities).length > 0 && (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                          Class Probability Distribution
                        </span>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                              <span>Entailment</span>
                              <span className="font-mono font-bold">{Math.round((nliResult!.probabilities.entailment || 0) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.round((nliResult!.probabilities.entailment || 0) * 100)}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                              <span>Contradiction</span>
                              <span className="font-mono font-bold">{Math.round((nliResult!.probabilities.contradiction || 0) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.round((nliResult!.probabilities.contradiction || 0) * 100)}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                              <span>Neutral</span>
                              <span className="font-mono font-bold">{Math.round((nliResult!.probabilities.neutral || 0) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.round((nliResult!.probabilities.neutral || 0) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'm3' ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-2">
              <span className="text-2xl block">⚖️</span>
              <strong className="text-sm text-slate-800 block">Clinical Verification Deferred</strong>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No high-confidence evidence passages were retrieved to cross-examine this claim statement.
              </p>
            </div>
          ) : null
        )}

        {/* MODEL 4: Provider-Level Anomaly Screening */}
        {(activeTab === 'all' || activeTab === 'm4') && (
          <div className="p-5 rounded-xl border border-amber-200 bg-amber-50/20 space-y-4 shadow-2xs">
            {/* Clean Professional Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px] font-bold uppercase">
                  Model 4
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  Provider Billing Pattern Analysis
                </h4>
              </div>

              <div className="flex items-center gap-2">
                {providerAnomaly?.has_sufficient_data ? (
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shadow-2xs flex items-center gap-1.5 ${
                      providerAnomaly.is_anomaly || providerAnomaly.decision === 'ANOMALOUS'
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        providerAnomaly.is_anomaly || providerAnomaly.decision === 'ANOMALOUS'
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                      }`}
                    />
                    {providerAnomaly.is_anomaly || providerAnomaly.decision === 'ANOMALOUS'
                      ? 'ANOMALOUS PRACTICE'
                      : 'NORMAL PRACTICE'}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-300 shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    INSUFFICIENT DATA
                  </span>
                )}
              </div>
            </div>

            {/* Context Strip */}
            <div className={`p-2.5 rounded-lg border text-[11px] flex flex-col sm:flex-row justify-between gap-2 ${
              isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-300' : 'bg-white border-amber-100 text-slate-600'
            }`}>
              <div>
                <strong className={isDark ? 'text-neutral-100' : 'text-slate-800'}>Target Provider:</strong>{' '}
                {sharedContext?.hospital_name || groupedInfo.hospital.hospital_name?.value || 'Provider identity unavailable'}
              </div>
              <div>
                <strong className={isDark ? 'text-neutral-100' : 'text-slate-800'}>Audit Scope:</strong> Historical Billing Volume &amp; Practice Patterns
              </div>
            </div>

            {/* Provider Anomaly 1-Sentence Overview */}
            <div className={`p-3 border rounded-lg text-xs leading-relaxed flex items-start gap-2.5 shadow-2xs ${
              isDark ? 'bg-amber-950/30 border-amber-800/50 text-amber-200' : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}>
              <span className="text-sm shrink-0 mt-0.5">ℹ️</span>
              <p>
                <strong>Provider Anomaly:</strong> Evaluates a healthcare facility's aggregated billing volumes, charge markups, and clinical practice patterns against regional benchmarks to detect statistical anomalies and outlier behavior without presuming intentional fraud.
              </p>
            </div>

            {/* Main Auditor View */}
            {providerAnomaly?.has_sufficient_data ? (
              <div className={`p-4 rounded-xl border shadow-xs space-y-3 ${
                isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-white border-amber-100'
              }`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Provider Name</span>
                    <strong className={`font-semibold truncate block ${isDark ? 'text-neutral-100' : 'text-slate-900'}`}>
                      {sharedContext?.hospital_name || groupedInfo.hospital.hospital_name?.value || 'Provider identity unavailable'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Assessment Status</span>
                    <span className={`font-semibold ${isDark ? 'text-neutral-200' : 'text-slate-800'}`}>
                      {providerAnomaly.decision || (providerAnomaly.is_anomaly ? 'ANOMALOUS' : 'NORMAL')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Anomaly Finding</span>
                    <span className={`font-semibold ${providerAnomaly.is_anomaly ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {providerAnomaly.is_anomaly ? 'Variance Detected' : 'Standard Practice'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Audit Recommendation</span>
                    <span className={`font-semibold ${providerAnomaly.is_anomaly ? 'text-amber-600 dark:text-amber-400' : isDark ? 'text-neutral-300' : 'text-slate-700'}`}>
                      {providerAnomaly.is_anomaly ? 'Manual Chart Review' : 'Standard Processing'}
                    </span>
                  </div>
                </div>

                {providerAnomaly.explanations && providerAnomaly.explanations.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Important Detected Billing-Pattern Indicators
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-slate-700 text-xs">
                      {providerAnomaly.explanations.map((exp, idx) => (
                        <li key={idx} className="leading-snug">{exp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Auditor Explanation:</span>
                  <span>{providerAnomaly.disclaimer || 'Provider billing profile screened against normative practice ratios.'}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-white rounded-xl border border-amber-200/80 shadow-xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-lg shrink-0">
                    📋
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                        INSUFFICIENT DATA
                      </h5>
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Provider History Required
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 leading-snug">
                      {providerAnomaly?.explanations?.[0] || 'Provider history is required to evaluate historical billing patterns.'}
                    </p>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {providerAnomaly?.explanations?.[1] ? (
                        providerAnomaly.explanations[1].replace(/EE MEDICAL INSTITUTE/gi, sharedContext?.hospital_name || 'the facility')
                      ) : (
                        <>Model 4 evaluates aggregated provider practice patterns across historical billing distributions. Because this uploaded document represents a single patient encounter at <strong>{sharedContext?.hospital_name || groupedInfo.hospital.hospital_name?.value || 'the facility'}</strong>, multi-claim historical provider volume is not attached.</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Auditor Action:</span>
                  <span>Per clinical auditing safety protocol, provider scoring is withheld rather than computed from incomplete historical data. No provider-level penalty is applied.</span>
                </div>
              </div>
            )}

            {/* Technical Details & Audit Trace Toggle */}
            <div className="pt-2 border-t border-amber-100/60">
              <button
                type="button"
                onClick={() => setShowRawM4Trace(!showRawM4Trace)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-amber-800 transition-colors"
              >
                <span>{showRawM4Trace ? '▼' : '▶'}</span>
                <span>{showRawM4Trace ? 'Hide' : 'View'} Technical Details &amp; Audit Trace</span>
                <span className="text-[10px] text-slate-400">(Raw score, 9 Medicare feature metrics, model flags)</span>
              </button>

              {showRawM4Trace && (
                <div className="mt-2.5 p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-white p-2.5 rounded border border-slate-200">
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Model Version:</span>
                      <span className="text-slate-800 font-semibold font-mono">{providerAnomaly?.model_version || 'Isolation Forest V3'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Raw Anomaly Score:</span>
                      <span className="text-slate-900 font-bold font-mono">
                        {providerAnomaly?.anomaly_score !== undefined ? providerAnomaly.anomaly_score.toFixed(4) : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Decision Flag:</span>
                      <span className="text-slate-800 font-semibold font-mono">{providerAnomaly?.decision || providerAnomaly?.screening_flag || 'None'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Data Status:</span>
                      <span className="text-slate-800 font-semibold font-mono">{providerAnomaly?.has_sufficient_data ? 'SUFFICIENT' : 'INSUFFICIENT'}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Evaluated Provider Historical Metrics (9 Features)
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                      {[
                        { key: 'Tot_Benes', label: 'Tot_Benes' },
                        { key: 'Tot_Srvcs', label: 'Tot_Srvcs' },
                        { key: 'Avg_Sbmtd_Chrg', label: 'Avg_Sbmtd_Chrg' },
                        { key: 'Avg_Mdcr_Alowd_Amt', label: 'Avg_Mdcr_Alowd_Amt' },
                        { key: 'Avg_Mdcr_Pymt_Amt', label: 'Avg_Mdcr_Pymt_Amt' },
                        { key: 'Avg_Mdcr_Stdzd_Amt', label: 'Avg_Mdcr_Stdzd_Amt' },
                        { key: 'Submitted_To_Allowed_Ratio', label: 'Submitted_To_Allowed_Ratio' },
                        { key: 'Allowed_To_Payment_Ratio', label: 'Allowed_To_Payment_Ratio' },
                        { key: 'Services_Per_Beneficiary', label: 'Services_Per_Beneficiary' },
                      ].map(({ key, label }) => {
                        const val = providerAnomaly?.features_used?.[key]
                        const displayVal = val !== undefined && val !== null ? String(val) : (providerAnomaly?.has_sufficient_data ? 'N/A' : 'Unavailable (Single Claim)')
                        return (
                          <div key={key} className="p-1.5 rounded bg-slate-50 border border-slate-100 flex flex-col">
                            <span className="text-[10px] text-slate-500 font-sans">{label}</span>
                            <span className="text-slate-800 font-bold truncate">{displayVal}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DEDICATED CLAIM-LEVEL BILLING RECONCILIATION & ACCOUNTING INTEGRITY */}
        {(activeTab === 'all' || activeTab === 'm4' || activeTab === 'rec') && (
          <div className="p-5 rounded-xl border border-blue-200 bg-blue-50/20 space-y-4 shadow-2xs">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold uppercase">
                  Reconciliation
                </span>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>Claim-Level Billing Reconciliation &amp; Accounting Integrity</span>
                </h4>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2">
                {rec ? (
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shadow-2xs flex items-center gap-1.5 ${
                      rec.classification === 'TOTAL_MATCH'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : rec.classification === 'POSSIBLE_DUPLICATE'
                        ? 'bg-purple-100 text-purple-800 border-purple-300'
                        : rec.classification === 'POTENTIAL_OVERLAP_REQUIRES_REVIEW'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : rec.classification === 'TOTAL_MISMATCH'
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        rec.classification === 'TOTAL_MATCH'
                          ? 'bg-emerald-500'
                          : rec.classification === 'POSSIBLE_DUPLICATE'
                          ? 'bg-purple-500'
                          : rec.classification === 'POTENTIAL_OVERLAP_REQUIRES_REVIEW'
                          ? 'bg-amber-500'
                          : rec.classification === 'TOTAL_MISMATCH'
                          ? 'bg-rose-500'
                          : 'bg-slate-400'
                      }`}
                    />
                    {rec.classification.replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-300">
                    AWAITING INVOICE
                  </span>
                )}
              </div>
            </div>

            {/* Scope / Distinction banner */}
            <div className={`p-2.5 rounded-lg border text-[11px] flex flex-col sm:flex-row justify-between gap-2 ${
              isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-300' : 'bg-white border-blue-100 text-slate-600'
            }`}>
              <div>
                <strong className={isDark ? 'text-neutral-100' : 'text-slate-800'}>Audit Scope:</strong> Invoice Arithmetic &amp; Itemized Line-Item Integrity (Independent of ML models)
              </div>
              <div className={`text-[10px] ${isDark ? 'text-neutral-400' : 'text-slate-500'}`}>
                Hospital Tariff &amp; Government Price Benchmark Cross-Examination
              </div>
            </div>

            {rec ? (
              <div className="space-y-4">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Itemized Sum</span>
                    <strong className="text-base font-bold text-slate-900 block mt-0.5">
                      ₹{rec.itemized_sum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">Sum of individual line items</span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Stated Total</span>
                    <strong className="text-base font-bold text-slate-900 block mt-0.5">
                      {rec.stated_total != null
                        ? `₹${rec.stated_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : 'Not Specified'}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">Invoice total header</span>
                  </div>

                  <div className={`p-3 bg-white rounded-xl border shadow-2xs ${
                    rec.difference != null && Math.abs(rec.difference) >= 0.01
                      ? 'border-rose-200 bg-rose-50/20'
                      : 'border-emerald-200 bg-emerald-50/20'
                  }`}>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Arithmetic Difference</span>
                    <strong className={`text-base font-bold block mt-0.5 ${
                      rec.difference != null && Math.abs(rec.difference) >= 0.01
                        ? 'text-rose-700'
                        : 'text-emerald-700'
                    }`}>
                      {rec.difference != null
                        ? `${rec.difference > 0 ? '+' : ''}₹${rec.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '₹0.00'}
                    </strong>
                    <span className="text-[10px] text-slate-500 block">Itemized sum − Stated total</span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Integrity Signals</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rec.duplicates.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                          {rec.duplicates.length} Dup
                        </span>
                      )}
                      {rec.overlaps.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                          {rec.overlaps.length} Overlap
                        </span>
                      )}
                      {rec.benchmark_comparisons.filter(b => b.status === 'EXCEEDS_BENCHMARK').length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          {rec.benchmark_comparisons.filter(b => b.status === 'EXCEEDS_BENCHMARK').length} &gt; Benchmark
                        </span>
                      )}
                      {rec.duplicates.length === 0 && rec.overlaps.length === 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Clean
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Summary Message & Non-Accusatory Disclaimer */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0">📊</span>
                    <div className="space-y-1">
                      <strong className="text-slate-900 block font-semibold">
                        {rec.summary_message}
                      </strong>
                      {rec.explanations.map((exp, i) => (
                        <p key={i} className="text-slate-600 text-[11px] leading-relaxed">
                          • {exp}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-500 italic">
                    {rec.disclaimer}
                  </div>
                </div>

                {/* Duplicate Line Items Table */}
                {rec.duplicates.length > 0 && (
                  <div className="p-4 bg-white rounded-xl border border-purple-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-500" />
                        <h5 className="text-xs font-bold uppercase tracking-wider text-purple-900">
                          Duplicate Charges Detected (Billed Multiple Times)
                        </h5>
                      </div>
                      <span className="text-[10px] font-semibold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                        {rec.duplicates.length} item(s) flagged
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-purple-100 text-[10px] uppercase font-bold text-slate-400">
                            <th className="pb-1.5">Line Item</th>
                            <th className="pb-1.5">Frequency</th>
                            <th className="pb-1.5 text-right">Amount Each</th>
                            <th className="pb-1.5 text-right">Total Billed</th>
                            <th className="pb-1.5 pl-3">Auditor Clinical Context</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-50">
                          {rec.duplicates.map((dup, idx) => (
                            <tr key={idx} className="hover:bg-purple-50/40">
                              <td className="py-2 font-semibold text-slate-800">{dup.description}</td>
                              <td className="py-2">
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-bold text-[10px]">
                                  {dup.occurrences}x times
                                </span>
                              </td>
                              <td className="py-2 text-right font-mono text-slate-700">
                                ₹{dup.amount_per_occurrence.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 text-right font-mono font-bold text-purple-900">
                                ₹{dup.total_duplicate_billed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 pl-3 text-[11px] text-slate-600">{dup.clinical_note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Potentially Overlapping Charges Table */}
                {rec.overlaps.length > 0 && (
                  <div className="p-4 bg-white rounded-xl border border-amber-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                          Potentially Overlapping Charges (Unbundling Screening)
                        </h5>
                      </div>
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        Policy-dependent review
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-amber-100 text-[10px] uppercase font-bold text-slate-400">
                            <th className="pb-1.5">Separately Billed Item</th>
                            <th className="pb-1.5">Likely Bundled In</th>
                            <th className="pb-1.5 text-right">Potential Overlap</th>
                            <th className="pb-1.5 pl-3">Policy Guidance &amp; Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-50">
                          {rec.overlaps.map((ov, idx) => (
                            <tr key={idx} className="hover:bg-amber-50/40">
                              <td className="py-2 font-semibold text-slate-800">{ov.item_a}</td>
                              <td className="py-2 text-slate-700">{ov.item_b}</td>
                              <td className="py-2 text-right font-mono font-bold text-amber-900">
                                ₹{ov.potential_overlap_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 pl-3 text-[11px] text-slate-600">
                                <div>{ov.explanation}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5 font-medium">Ref: {ov.policy_reference}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Grounded Benchmark Comparisons Table */}
                {rec.benchmark_comparisons.length > 0 && (
                  <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        <h5 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                          Grounded Price Benchmark Comparisons
                        </h5>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        NPPA DPCO &bull; CGHS &bull; PMJAY &bull; NABL 2026
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                            <th className="pb-1.5">Service / Line Item</th>
                            <th className="pb-1.5 text-right">Billed Amount</th>
                            <th className="pb-1.5 text-right">Benchmark Ceiling</th>
                            <th className="pb-1.5 text-center">Status</th>
                            <th className="pb-1.5 pl-3">Source &amp; Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rec.benchmark_comparisons.map((b, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/60">
                              <td className="py-2 font-semibold text-slate-800">{b.service_or_item}</td>
                              <td className="py-2 text-right font-mono font-bold text-slate-900">
                                ₹{b.billed_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2 text-right font-mono text-slate-600">
                                {b.benchmark_max != null
                                  ? `₹${b.benchmark_max.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td className="py-2 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    b.status === 'WITHIN_BENCHMARK'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : b.status === 'EXCEEDS_BENCHMARK'
                                      ? 'bg-rose-100 text-rose-800'
                                      : b.status === 'BELOW_BENCHMARK'
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {b.status.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="py-2 pl-3 text-[11px] text-slate-600">
                                {b.source_attribution ? (
                                  <div>
                                    <div className="font-medium text-slate-800">{b.source_attribution}</div>
                                    <div className="text-[10px] text-slate-500">{b.note}</div>
                                  </div>
                                ) : (
                                  <div className="text-slate-400 italic">{b.note}</div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Collapsible Itemized Line Items Breakdown */}
                {rec.line_items.length > 0 && (
                  <div className="pt-2 border-t border-blue-100/60">
                    <button
                      type="button"
                      onClick={() => setShowAllLineItems(!showAllLineItems)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-blue-800 transition-colors"
                    >
                      <span>{showAllLineItems ? '▼' : '►'}</span>
                      <span>{showAllLineItems ? 'Hide' : 'View'} Complete Itemized Line Items Breakdown</span>
                      <span className="text-[10px] text-slate-400">({rec.line_items.length} extracted charges)</span>
                    </button>

                    {showAllLineItems && (
                      <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200 text-xs">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                              <th className="pb-1">#</th>
                              <th className="pb-1">Line Description</th>
                              <th className="pb-1 text-right">Amount (INR)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {rec.line_items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="py-1 text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                                <td className="py-1 text-slate-800">{item.description}</td>
                                <td className="py-1 text-right font-mono font-semibold text-slate-900">
                                  ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                Submit an invoice or claim document to view automated line-item reconciliation.
              </div>
            )}
          </div>
        )}

        {/* MODEL 5: Claim-Level Anomaly Screening */}
        {(activeTab === 'all' || activeTab === 'm5') && (
          <div className="p-5 rounded-xl border border-rose-200 bg-rose-50/20 space-y-4 shadow-2xs">
            {/* Clean Professional Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono text-[10px] font-bold uppercase">
                  Model 5
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  Claim Anomaly Screening
                </h4>
              </div>

              <div className="flex items-center gap-2">
                {claimAnomaly?.has_sufficient_data && claimAnomaly?.decision !== 'INSUFFICIENT_INPATIENT_DATA' ? (
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shadow-2xs flex items-center gap-1.5 ${
                      claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED'
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED'
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                      }`}
                    />
                    {claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED'
                      ? 'REVIEW RECOMMENDED'
                      : 'NORMAL UTILIZATION'}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-300 shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    INSUFFICIENT INPATIENT DATA
                  </span>
                )}
              </div>
            </div>

            {/* Context Strip */}
            <div className="p-2.5 bg-white rounded-lg border border-rose-100 text-[11px] text-slate-600 flex flex-col sm:flex-row justify-between gap-2">
              <div>
                <strong className="text-slate-800">Claim ID:</strong>{' '}
                <span className="font-mono">{effectiveClaimId}</span>
              </div>
              <div>
                <strong className="text-slate-800">Encounter Classification:</strong>{' '}
                {groupedInfo.clinical.encounter_type?.value || 'Emergency Department / Outpatient'}
              </div>
            </div>

            {/* Main Auditor View */}
            {claimAnomaly?.has_sufficient_data && claimAnomaly?.decision !== 'INSUFFICIENT_INPATIENT_DATA' ? (
              <div className="p-4 bg-white rounded-xl border border-rose-100 shadow-xs space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Claim ID</span>
                    <strong className="text-slate-900 font-mono font-semibold truncate block">
                      {effectiveClaimId}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Encounter Type</span>
                    <span className="text-slate-800 font-semibold truncate block">
                      {groupedInfo.clinical.encounter_type?.value || 'Inpatient Encounter'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Screening Result</span>
                    <span className={`font-semibold ${claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED' ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {claimAnomaly.decision === 'REVIEW_RECOMMENDED' ? 'Utilization Anomaly' : 'Normal Utilization'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Audit Recommendation</span>
                    <span className={`font-semibold ${claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED' ? 'text-rose-800' : 'text-slate-700'}`}>
                      {claimAnomaly.is_anomaly || claimAnomaly.decision === 'REVIEW_RECOMMENDED' ? 'Manual Chart Review' : 'Standard Processing'}
                    </span>
                  </div>
                </div>

                {claimAnomaly.explanations && claimAnomaly.explanations.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Important Detected Utilization &amp; Financial Anomalies
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-slate-700 text-xs">
                      {claimAnomaly.explanations.map((exp, idx) => (
                        <li key={idx} className="leading-snug">{exp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Auditor Explanation:</span>
                  <span>{claimAnomaly.disclaimer || 'Screened against normative inpatient utilization distributions.'}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-white rounded-xl border border-amber-200/80 shadow-xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-lg shrink-0">
                    🏥
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h5 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                        INSUFFICIENT INPATIENT DATA
                      </h5>
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Inpatient Features Required
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 leading-snug">
                      {claimAnomaly?.explanations?.[0] || 'This encounter does not contain the inpatient admission, discharge or stay-duration information required by the current model.'}
                    </p>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      The evaluated claim represents an <strong>{groupedInfo.clinical.encounter_type?.value || 'Emergency Department / Outpatient'}</strong> encounter. Model 5 screens for inpatient hospitalization anomalies (such as prolonged length of stay, outlier per diem charges, and DRG mismatch). Inpatient stay metrics cannot be derived or fabricated for outpatient encounters.
                    </p>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Auditor Action:</span>
                  <span>Inpatient claim-level anomaly scoring is safely deferred. Line-item pricing, clinical guideline alignment, and procedure validity are verified independently via Models 1, 2, and 3.</span>
                </div>
              </div>
            )}

            {/* Technical Details & Audit Trace Toggle */}
            <div className="pt-2 border-t border-rose-100/60">
              <button
                type="button"
                onClick={() => setShowRawM5Trace(!showRawM5Trace)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-rose-800 transition-colors"
              >
                <span>{showRawM5Trace ? '▼' : '▶'}</span>
                <span>{showRawM5Trace ? 'Hide' : 'View'} Technical Details &amp; Audit Trace</span>
                <span className="text-[10px] text-slate-400">(Raw score, 13 inpatient metrics, model comparison)</span>
              </button>

              {showRawM5Trace && (
                <div className="mt-2.5 p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-white p-2.5 rounded border border-slate-200">
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Model Version:</span>
                      <span className="text-slate-800 font-semibold font-mono">{claimAnomaly?.model_version || 'Isolation Forest V3 Strict Temporal'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Raw Anomaly Score:</span>
                      <span className="text-slate-900 font-bold font-mono">
                        {claimAnomaly?.anomaly_score !== undefined ? claimAnomaly.anomaly_score.toFixed(4) : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Model Agreement:</span>
                      <span className="text-slate-800 font-semibold font-mono">{claimAnomaly?.model_agreement || 'Consistent'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-sans text-[10px] uppercase font-bold">Decision Flag:</span>
                      <span className="text-slate-800 font-semibold font-mono">{claimAnomaly?.decision || claimAnomaly?.screening_flag || 'None'}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Evaluated Inpatient Utilization Metrics (13 Features)
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 font-mono text-[11px]">
                      {[
                        { key: 'CLM_UTLZN_DAY_CNT', label: 'Utilization Days' },
                        { key: 'CLM_PASS_THRU_PER_DIEM_AMT', label: 'Pass-Thru Per Diem' },
                        { key: 'NCH_BENE_PTA_COINSRNC_LBLTY_AM', label: 'Part A Coinsurance' },
                        { key: 'NCH_BENE_BLOOD_DDCTBL_LBLTY_AM', label: 'Blood Deductible' },
                        { key: 'CLM_DRG_CD', label: 'DRG Code' },
                        { key: 'ICD_DGNS_CD', label: 'ICD Diagnosis Codes' },
                        { key: 'ICD_PRCDR_CD', label: 'ICD Procedure Codes' },
                        { key: 'LOS_DAYS', label: 'Length of Stay' },
                        { key: 'CLM_ADMSN_DT', label: 'Admission Date' },
                        { key: 'NCH_BENE_DSCHRG_DT', label: 'Discharge Date' },
                        { key: 'CLM_TOT_CHRG_AMT', label: 'Total Charges' },
                        { key: 'CLM_PMT_AMT', label: 'Payment Amount' },
                        { key: 'REV_CNTR', label: 'Revenue Center Codes' },
                      ].map(({ key, label }) => {
                        const val = claimAnomaly?.features_used?.[key]
                        const displayVal = val !== undefined && val !== null ? String(val) : (claimAnomaly?.has_sufficient_data ? 'N/A' : 'Unavailable (Outpatient)')
                        return (
                          <div key={key} className="p-1.5 rounded bg-slate-50 border border-slate-100 flex flex-col">
                            <span className="text-[10px] text-slate-500 font-sans">{label}</span>
                            <span className="text-slate-800 font-bold truncate">{displayVal}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Preserved Medicine Matcher */}
        {(activeTab === 'all' || activeTab === 'med') && (
          hasMed ? (
            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-mono text-[10px] font-bold uppercase">
                    Preserved Matcher
                  </span>
                  <h4 className="text-xs font-bold text-slate-900">
                    Medicine Substitution Matching (TF-IDF + Logistic Regression)
                  </h4>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-bold text-xs ${
                    medicineSubstitution!.is_match
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-slate-100 text-slate-700 border border-slate-300'
                  }`}
                >
                  {medicineSubstitution!.is_match ? 'Compatible Match' : 'Different Medicine'}
                </span>
              </div>

              <p className="text-[11px] text-slate-600 leading-relaxed">
                {medicineSubstitution!.explanation}
              </p>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-white p-2.5 rounded border border-teal-100">
                  <span className="text-[10px] text-slate-400 block">Billed / Prescribed Medicine:</span>
                  <span className="font-bold text-slate-900">{medicineSubstitution!.query_medicine}</span>
                </div>
                <div className="bg-white p-2.5 rounded border border-teal-100">
                  <span className="text-[10px] text-slate-400 block">Generic / Target Formulation:</span>
                  <span className="font-bold text-slate-900">{medicineSubstitution!.target_medicine}</span>
                </div>
              </div>
            </div>
          ) : activeTab === 'med' ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center space-y-2">
              <span className="text-2xl block">💊</span>
              <strong className="text-sm text-slate-800 block">Medicine Substitution Matcher Idle</strong>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No target medicine was provided to compare against the extracted medicine entity.
              </p>
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}

export default FiveModelsAuditPanel
