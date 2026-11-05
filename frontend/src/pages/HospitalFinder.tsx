import React, { useState, useEffect, useCallback, useRef } from 'react'
import { formatCurrency } from '../utils/currency'
import {
  API_BASE,
  getAllHospitalAvailabilities,
  updateHospitalAvailability,
  createEmergencySOS,
  getEmergencySOS,
  listHospitalSOS,
  updateSOSStatus,
  type HospitalAvailabilityResponse,
  type EmergencySOSRecord,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

export interface HospitalProcedurePrice {
  service_name: string
  cpt_code?: string | null
  min_price: number
  max_price: number
  typical_price?: number | null
  currency: string
  price_type: string
  source: string
  last_updated: string
}

export interface HospitalDetail {
  id: string
  name: string
  address: string
  neighborhood?: string | null
  city: string
  state_or_region?: string | null
  country: string
  lat: number
  lon: number
  distance_km?: number | null
  distance_miles?: number | null
  distance_label: string
  facility_type: string
  verified_services: string[]
  phone?: string | null
  website?: string | null
  directions_url?: string | null
  price_available: boolean
  consultation_fee?: number | null
  consultation_fee_currency: string
  consultation_fee_source?: string | null
  consultation_fee_date?: string | null
  price_type: string
  procedure_prices: HospitalProcedurePrice[]
  public_rating?: number | null
  review_count?: number | null
  review_source?: string | null
  review_date?: string | null
  accreditations: string[]
  trust_score?: number | null
  trust_score_explanation?: string | null
  why_appears: string
  data_source: string
  last_updated: string
}

export interface EmergencyAlert {
  is_emergency: boolean
  warning_title?: string | null
  warning_message?: string | null
  emergency_phone?: string | null
  action_advice?: string | null
}

export interface HospitalSearchResponse {
  query_city: string
  search_coordinates?: { lat: number; lon: number } | null
  total_results: number
  symptom_filter?: string | null
  symptom_guidance?: string | null
  emergency_alert?: EmergencyAlert | null
  hospitals: HospitalDetail[]
  data_sources_used: string[]
  disclaimer: string
}

// ============================================================================
// Stage 2: GPS-Based Nearby Hospital Data Models
// ============================================================================

export interface KarnatakaNearbyHospital {
  id: string
  name: string
  district: string
  lat: number
  lon: number
  distance_km: number
  distance_miles: number
  distance_status: string
  data_source: string
  address?: string | null
  pincode?: string | null
  category?: string | null
  care_type?: string | null
  specialties: string[]
  facilities: string[]
  phone?: string | null
  mobile?: string | null
  email?: string | null
  website?: string | null
  emergency_services?: string | null
  established_year?: string | null
  evidence_completeness_percentage?: number | null
  completeness_category?: string | null
  directions_url?: string | null
  source_warning?: string | null
}

export interface KarnatakaNearbyResponse {
  status: string
  resolved_district?: string | null
  is_in_karnataka: boolean
  user_coordinates: { lat: number; lon: number }
  radius_km: number
  count: number
  hospitals: KarnatakaNearbyHospital[]
  karnataka_dataset_count: number
  osm_fallback_count: number
  warning?: string | null
  disclaimer: string
}

// ============================================================================
// Stage 3: Treatment Package Cost Prediction & Price Comparison Models
// ============================================================================

export interface TreatmentPackageInfo {
  package_name: string
  category: string
  available_rooms: string[]
  hospital_name: string
  district: string
  published_prices_inr: Record<string, number>
  price_type: string
  model_status: string
  karnataka_wide_prediction: boolean
  package_scope_verified: boolean
  scope_note: string
}

export interface ComparableBenchmark {
  id: string
  service_or_procedure: string
  category: string
  hospital_or_source: string
  price_display: string
  min_price_inr: number
  max_price_inr: number
  typical_price_inr?: number | null
  currency: string
  price_type: string
  data_source: string
  last_updated?: string | null
  relevance_tag?: string | null
}

export interface CostComparisonCatalog {
  status: string
  hospital_name: string
  district: string
  model_algorithm: string
  supported_packages: TreatmentPackageInfo[]
  available_room_categories: string[]
  comparable_benchmarks: ComparableBenchmark[]
  disclaimer: string
}

export interface CostPredictionResult {
  hospital: string
  district?: string
  package: string
  room_category: string
  published_reference_price_inr: number
  experimental_ml_estimate_inr: number
  difference_inr: number
  price_type: string
  model_status: string
  karnataka_wide_prediction: boolean
  package_scope_verified: boolean
}

export const DEFAULT_TREATMENT_PACKAGES: TreatmentPackageInfo[] = [
  {
    package_name: 'Normal Delivery',
    category: 'Obstetrics & Maternity',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 66400, Deluxe: 74200, Suite: 88000 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'LSCS',
    category: 'Obstetrics & Maternity (Cesarean Section)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 91800, Deluxe: 99500, Suite: 116600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'LSCS + Tubectomy',
    category: 'Obstetrics & Maternity (Cesarean + Sterilization)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 106800, Deluxe: 117500, Suite: 136600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'D & C',
    category: 'Gynecological Daycare Procedure',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 30600, Deluxe: 37400, Suite: 44400 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Hysteroscopic Polypectomy, D&C',
    category: 'Minimally Invasive Gynecological Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 50200, Deluxe: 57300, Suite: 61400 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Open Ruptured Ectopic Pregnancy',
    category: 'Gynecological Emergency Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 92900, Deluxe: 117400, Suite: 122600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Laparoscopic Ectopic Pregnancy',
    category: 'Minimally Invasive Gynecological Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 113200, Deluxe: 126300, Suite: 145400 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Diagnostic',
    category: 'Diagnostic Laparoscopy & Assessment',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 77200, Deluxe: 90500, Suite: 104400 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Open Myomectomy',
    category: 'Gynecological Surgery (Fibroid Removal)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 95400, Deluxe: 119400, Suite: 130800 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Laparoscopic Myomectomy',
    category: 'Minimally Invasive Gynecological Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 117200, Deluxe: 127400, Suite: 136600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Open Ovarian Cystectomy',
    category: 'Gynecological Surgery (Cyst Excision)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 103900, Deluxe: 118200, Suite: 124600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Laparoscopic Ovarian Cystectomy Endometriosis',
    category: 'Minimally Invasive Gynecological Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 118400, Deluxe: 130500, Suite: 144200 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Vaginal Hysterectomy',
    category: 'Gynecological Surgery (Uterine Removal)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 108400, Deluxe: 126500, Suite: 138200 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Pelvic Floor Repair (Vaginal Hysterectomy)',
    category: 'Gynecological Reconstructive Surgery',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 120400, Deluxe: 134300, Suite: 148600 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
  {
    package_name: 'Open Hysterectomy (BSO)',
    category: 'Gynecological Surgery (Total Hysterectomy + BSO)',
    available_rooms: ['Private', 'Deluxe', 'Suite'],
    hospital_name: 'Sakhii Hospital',
    district: 'Bengaluru',
    published_prices_inr: { Private: 112000, Deluxe: 130500, Suite: 136200 },
    price_type: 'Published hospital package tariff',
    model_status: 'Experimental',
    karnataka_wide_prediction: false,
    package_scope_verified: false,
    scope_note: 'Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only.',
  },
]

export const DEFAULT_COMPARABLE_BENCHMARKS: ComparableBenchmark[] = [
  {
    id: 'bench_mat_01',
    service_or_procedure: 'Normal Delivery & Postnatal Care (General Ward)',
    category: 'Maternity & Obstetrics',
    hospital_or_source: 'Vanivilas Women & Children Hospital (BMCRI), Bengaluru',
    price_display: '₹20 OPD (Universal Free Inpatient under JSSK / AB-ArK)',
    min_price_inr: 0.0,
    max_price_inr: 20.0,
    typical_price_inr: 20.0,
    currency: 'INR',
    price_type: 'Government Subsidized OPD Tariff',
    data_source: 'Government of Karnataka Health & Family Welfare Universal OPD Tariff & JSSK Scheme',
    last_updated: '2026-01-01',
    relevance_tag: 'Normal Delivery',
  },
  {
    id: 'bench_mat_02',
    service_or_procedure: 'Cesarean Section (LSCS) Inpatient Care',
    category: 'Maternity & Obstetrics',
    hospital_or_source: 'Victoria Hospital & Vanivilas Hospital (BMCRI), Bengaluru',
    price_display: 'Subsidized (Covered under AB-ArK / JSSK)',
    min_price_inr: 0.0,
    max_price_inr: 500.0,
    typical_price_inr: 20.0,
    currency: 'INR',
    price_type: 'Government Subsidized OPD Tariff',
    data_source: 'BMCRI Hospital Directory Tariff Schedule',
    last_updated: '2026-01-01',
    relevance_tag: 'LSCS',
  },
  {
    id: 'bench_opd_01',
    service_or_procedure: 'General Outpatient Consultation & Vital Check',
    category: 'Outpatient Consultation Tariff',
    hospital_or_source: 'Victoria Hospital (BMCRI), Bengaluru',
    price_display: '₹20 (Subsidized OPD)',
    min_price_inr: 20.0,
    max_price_inr: 20.0,
    typical_price_inr: 20.0,
    currency: 'INR',
    price_type: 'Government Subsidized OPD Tariff',
    data_source: 'Government of Karnataka Health & Family Welfare Subsidized OPD Schedule',
    last_updated: '2026-01-01',
    relevance_tag: 'OPD',
  },
  {
    id: 'bench_opd_02',
    service_or_procedure: 'Specialist OPD Consultation',
    category: 'Outpatient Consultation Tariff',
    hospital_or_source: 'Narayana Health (Mazumdar Shaw Medical Center), Bengaluru',
    price_display: '₹450',
    min_price_inr: 450.0,
    max_price_inr: 450.0,
    typical_price_inr: 450.0,
    currency: 'INR',
    price_type: 'Official Published Benchmark',
    data_source: 'Narayana Health Affordable Quality Care Published Tariff 2026',
    last_updated: '2026-01-01',
    relevance_tag: 'OPD',
  },
  {
    id: 'bench_opd_03',
    service_or_procedure: 'Comprehensive Specialist Consultation',
    category: 'Outpatient Consultation Tariff',
    hospital_or_source: 'Manipal Hospital (HAL Airport Road), Bengaluru',
    price_display: '₹850',
    min_price_inr: 850.0,
    max_price_inr: 850.0,
    typical_price_inr: 850.0,
    currency: 'INR',
    price_type: 'Official Published Benchmark',
    data_source: 'Manipal Health Enterprises Published OPD Tariff Schedule 2026',
    last_updated: '2026-01-10',
    relevance_tag: 'OPD',
  },
  {
    id: 'bench_diag_01',
    service_or_procedure: 'Complete Blood Count with Differential (CPT 85025)',
    category: 'Pathology & Blood Tests',
    hospital_or_source: 'CGHS & NABL National Diagnostic Schedule',
    price_display: '₹150 – ₹450',
    min_price_inr: 150.0,
    max_price_inr: 450.0,
    typical_price_inr: 250.0,
    currency: 'INR',
    price_type: 'Standard Diagnostic Benchmark',
    data_source: 'CGHS Diagnostic Rates & NABL National Benchmark 2026',
    last_updated: '2026-02-01',
    relevance_tag: 'Diagnostic',
  },
  {
    id: 'bench_diag_02',
    service_or_procedure: 'Chest X-Ray 2 Views (CPT 71046)',
    category: 'Diagnostic Imaging',
    hospital_or_source: 'CGHS Radiology Schedule',
    price_display: '₹250 – ₹600',
    min_price_inr: 250.0,
    max_price_inr: 600.0,
    typical_price_inr: 350.0,
    currency: 'INR',
    price_type: 'Standard Diagnostic Benchmark',
    data_source: 'CGHS Radiology Schedule & State Health Insurance Tariff 2026',
    last_updated: '2026-02-01',
    relevance_tag: 'Diagnostic',
  },
  {
    id: 'bench_diag_03',
    service_or_procedure: 'MRI Brain without contrast (CPT 70551)',
    category: 'Diagnostic Imaging',
    hospital_or_source: 'CGHS / PMJAY Diagnostic Tariff',
    price_display: '₹3,500 – ₹8,500',
    min_price_inr: 3500.0,
    max_price_inr: 8500.0,
    typical_price_inr: 5000.0,
    currency: 'INR',
    price_type: 'Standard Diagnostic Benchmark',
    data_source: 'CGHS / PMJAY Diagnostic Tariff 2026',
    last_updated: '2026-02-01',
    relevance_tag: 'Diagnostic',
  },
  {
    id: 'bench_diag_04',
    service_or_procedure: 'MRI Brain without contrast (Private Tertiary)',
    category: 'Diagnostic Imaging',
    hospital_or_source: 'Manipal Hospital, Bengaluru',
    price_display: '₹7,500 – ₹9,500',
    min_price_inr: 7500.0,
    max_price_inr: 9500.0,
    typical_price_inr: 8500.0,
    currency: 'INR',
    price_type: 'Official Published Benchmark',
    data_source: 'Manipal Diagnostic Imaging Tariff List 2026',
    last_updated: '2026-01-20',
    relevance_tag: 'Diagnostic',
  },
  {
    id: 'bench_med_01',
    service_or_procedure: '0.9% Sodium Chloride (Normal Saline) 1,000 mL IV',
    category: 'Essential Inpatient Consumables',
    hospital_or_source: 'National Pharmaceutical Pricing Authority (NPPA)',
    price_display: '₹35 – ₹105 (Ceiling ₹105.00 incl. 5% GST)',
    min_price_inr: 35.0,
    max_price_inr: 105.0,
    typical_price_inr: 105.0,
    currency: 'INR',
    price_type: 'National Statutory Ceiling (NPPA)',
    data_source: 'NPPA DPCO National Ceiling Price Schedule (S.O. 1499(E) / S.O. 1290(E))',
    last_updated: '2026-01-01',
    relevance_tag: 'Consumable',
  },
  {
    id: 'bench_med_02',
    service_or_procedure: 'Paracetamol 500mg Oral Tablet',
    category: 'Essential Inpatient Consumables',
    hospital_or_source: 'NPPA / Pradhan Mantri Jan Aushadhi',
    price_display: '₹1.00 – ₹5.00 per tablet',
    min_price_inr: 1.0,
    max_price_inr: 5.0,
    typical_price_inr: 2.0,
    currency: 'INR',
    price_type: 'National Statutory Ceiling (NPPA)',
    data_source: 'NPPA / Jan Aushadhi Generic Medicine Pricing Schedule 2026',
    last_updated: '2026-01-01',
    relevance_tag: 'Drug',
  },
  {
    id: 'bench_emer_01',
    service_or_procedure: 'Emergency Department Visit Level 5 (CPT 99285)',
    category: 'Emergency Visit',
    hospital_or_source: 'Indian Medical Council & CGHS',
    price_display: '₹500 – ₹2,500',
    min_price_inr: 500.0,
    max_price_inr: 2500.0,
    typical_price_inr: 1200.0,
    currency: 'INR',
    price_type: 'Standard Diagnostic Benchmark',
    data_source: 'Indian Medical Council & CGHS Emergency Service Tariff 2026',
    last_updated: '2026-02-01',
    relevance_tag: 'Emergency',
  },
]

// ============================================================================
// Stage 4B: Government Healthcare Schemes & Financial Aid Models
// ============================================================================

export interface GovernmentSchemeHelpline {
  name: string
  number: string
  description: string
  tel_uri: string
}

export interface GovernmentSchemeOfficialLink {
  title: string
  url: string
  purpose: string
}

export interface GovernmentSchemeDetail {
  scheme_id: string
  name: string
  short_name: string
  administering_body: string
  official_portal_url: string
  beneficiary_portal_url?: string | null
  hospital_search_portal_url?: string | null
  helplines: GovernmentSchemeHelpline[]
  coverage_ceiling_inr: number
  coverage_display: string
  coverage_description: string
  nature_of_scheme: string
  bpl_benefit: string
  apl_benefit: string
  referral_required_for_private: boolean
  emergency_referral_exempt: boolean
  mandatory_documents: string[]
  conditional_documents: string[]
  exclusions: string[]
  limitations_and_disclaimers: string[]
  official_links: GovernmentSchemeOfficialLink[]
  is_discretionary: boolean
  status: string
}

export interface GovernmentSchemesCatalog {
  status: string
  schemes: GovernmentSchemeDetail[]
  emergency_helplines: GovernmentSchemeHelpline[]
  disclaimer: string
  last_verified: string
}

export interface SchemeEligibilityEvaluationRequest {
  is_karnataka_resident: boolean
  ration_card_type: 'BPL_PHH_AAY' | 'APL_NPHH' | 'NONE'
  patient_age?: number | null
  care_type: 'EMERGENCY' | 'PLANNED'
  estimated_cost_inr?: number | null
}

export interface SchemeEligibilityEvaluationResponse {
  status: string
  pathway_headline: string
  primary_scheme_id?: string | null
  primary_scheme_name?: string | null
  eligible_schemes: string[]
  coverage_summary: string
  copay_status: string
  referral_required: boolean
  referral_guidance: string
  emergency_exemption: boolean
  senior_citizen_expansion: boolean
  cmrf_applicable: boolean
  cmrf_status_note?: string | null
  actionable_steps: string[]
  mandatory_documents: string[]
  conditional_documents: string[]
  official_verification_links: GovernmentSchemeOfficialLink[]
  helpline_numbers: GovernmentSchemeHelpline[]
  disclaimer: string
}

export const DEFAULT_EMERGENCY_HELPLINES: GovernmentSchemeHelpline[] = [
  {
    name: 'NHA PM-JAY Call Centre',
    number: '14555',
    description: '24x7 Multilingual National Toll-Free Helpline',
    tel_uri: 'tel:14555',
  },
  {
    name: 'Arogya Karnataka SAST',
    number: '1800-425-8330',
    description: 'Karnataka State Arogya Karnataka Toll-Free Helpdesk',
    tel_uri: 'tel:18004258330',
  },
  {
    name: 'Karnataka Health Helpline',
    number: '104',
    description: '24x7 Medical Advice and Scheme Information',
    tel_uri: 'tel:104',
  },
  {
    name: 'Seva Sindhu Citizen Services',
    number: '080-22230282',
    description: 'Karnataka Online Services & CMRF Application Support',
    tel_uri: 'tel:08022230282',
  },
  {
    name: 'National Emergency Unified Response',
    number: '112',
    description: 'Ambulance, Police & Fire Emergency Services',
    tel_uri: 'tel:112',
  },
]

export const DEFAULT_GOVERNMENT_SCHEMES: GovernmentSchemeDetail[] = [
  {
    scheme_id: 'pmjay',
    name: 'Ayushman Bharat — Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)',
    short_name: 'PM-JAY',
    administering_body: 'National Health Authority (NHA), Ministry of Health and Family Welfare, Government of India',
    official_portal_url: 'https://pmjay.gov.in/',
    beneficiary_portal_url: 'https://beneficiary.nha.gov.in/',
    hospital_search_portal_url: 'https://hospitals.pmjay.gov.in/',
    helplines: [
      {
        name: 'NHA PM-JAY Call Centre',
        number: '14555',
        description: '24x7 Multilingual National Toll-Free Helpline',
        tel_uri: 'tel:14555',
      },
      {
        name: 'NHA Alternate Toll-Free',
        number: '1800-111-565',
        description: 'National Citizen Assistance & Grievance Line',
        tel_uri: 'tel:1800111565',
      },
    ],
    coverage_ceiling_inr: 500000.0,
    coverage_display: '₹5,00,000 / family / year (Floater)',
    coverage_description: 'Cashless and paperless inpatient secondary and tertiary hospital care at public and empanelled private hospitals nationwide (National Portability).',
    nature_of_scheme: 'Statutory National Health Protection Entitlement',
    bpl_benefit: '100% cashless hospitalization up to ₹5,00,000 per year for households meeting SECC 2011 deprivation criteria or Priority Household (PHH/AAY) lists.',
    apl_benefit: 'Not directly covered under central PM-JAY independently unless covered under state integrated scheme (Arogya Karnataka) or qualifying under the Senior Citizen (70+) expansion.',
    referral_required_for_private: false,
    emergency_referral_exempt: true,
    mandatory_documents: [
      'Aadhaar Card (Patient and Household Head)',
      'Ration Card (PHH / AAY) or PM-JAY Family ID',
      'Active Mobile Number for OTP / Biometric e-KYC',
    ],
    conditional_documents: [
      'Ayushman Bharat Card printout (if already generated at beneficiary.nha.gov.in)',
      'Age verification document showing age 70+ for Ayushman Vay Vandana Card (Universal ₹5 Lakh Cover)',
    ],
    exclusions: [
      'Outpatient (OPD) doctor consultations and standalone retail pharmacy bills',
      'Elective cosmetic surgery and non-essential aesthetic procedures',
      'Organ harvesting from donors without prior NHA package pre-authorization',
      'Non-empanelled private hospital admissions',
    ],
    limitations_and_disclaimers: [
      'Tertiary surgical interventions require mandatory pre-authorization approved by State Health Agency.',
      'Senior Citizen (70+) coverage applies as a distinct ₹5 Lakh top-up pool under the Ayushman Vay Vandana Card regardless of income.',
    ],
    official_links: [
      {
        title: 'PM-JAY Official Portal',
        url: 'https://pmjay.gov.in/',
        purpose: 'National scheme guidelines and announcements',
      },
      {
        title: 'Beneficiary Portal (Check Eligibility & Ayushman Card)',
        url: 'https://beneficiary.nha.gov.in/',
        purpose: 'Verify eligibility and generate Ayushman Card via Aadhaar OTP',
      },
      {
        title: 'Empanelled Hospital Directory',
        url: 'https://hospitals.pmjay.gov.in/',
        purpose: 'Official list of verified network hospitals and active specialties',
      },
    ],
    is_discretionary: false,
    status: 'active',
  },
  {
    scheme_id: 'ab_ark',
    name: 'Ayushman Bharat — Arogya Karnataka (AB-ArK)',
    short_name: 'Arogya Karnataka',
    administering_body: 'Suvarna Arogya Suraksha Trust (SAST), Department of Health & Family Welfare, Government of Karnataka',
    official_portal_url: 'https://sast.karnataka.gov.in/',
    beneficiary_portal_url: 'https://arogya.karnataka.gov.in/',
    hospital_search_portal_url: 'https://sast.karnataka.gov.in/',
    helplines: [
      {
        name: 'Suvarna Arogya Suraksha Trust (SAST)',
        number: '1800-425-8330',
        description: 'Karnataka State Arogya Karnataka Toll-Free Helpdesk',
        tel_uri: 'tel:18004258330',
      },
      {
        name: 'Karnataka Health Helpline',
        number: '104',
        description: '24x7 Medical Advice and Scheme Information',
        tel_uri: 'tel:104',
      },
    ],
    coverage_ceiling_inr: 500000.0,
    coverage_display: '₹5,00,000 / year (BPL) | ₹1,50,000 / year (APL 30% Co-Pay)',
    coverage_description: 'Integrated state-central health scheme providing 100% cashless treatment for BPL and 30% financial assistance for APL, with defined public-to-private referral rules.',
    nature_of_scheme: 'Integrated State Health Protection & Co-Payment Scheme',
    bpl_benefit: 'Eligible Category (BPL / NFSA PHH & AAY cardholders): 100% cashless treatment up to ₹5,00,000 per family per year on a family floater basis.',
    apl_benefit: 'General Category (APL / Non-BPL Karnataka residents): 30% financial assistance from the state (capped at ₹1,50,000 per family per year); patient pays 70% co-payment.',
    referral_required_for_private: true,
    emergency_referral_exempt: true,
    mandatory_documents: [
      'Aadhaar Card (Patient and Household Head)',
      'Karnataka Ration Card (BPL/PHH/AAY or APL/NPHH)',
      'Government Hospital Online Referral Slip (ORS) (Mandatory for private planned care; exempt for emergencies)',
    ],
    conditional_documents: [
      'Arogya Karnataka / Ayushman Card (issued at public hospital or Karnataka One / Bangalore One)',
      'Treating Doctor Clinical Summary & Diagnostic Reports',
    ],
    exclusions: [
      'Direct walk-in to private empanelled hospitals for elective/planned procedures without a prior government referral',
      'Simple secondary procedures in private hospitals (reserved for Government Public Health Institutions)',
      'Cosmetic procedures, fertility treatments, and unverified alternative therapies',
    ],
    limitations_and_disclaimers: [
      'Emergency Exception: 171 defined acute emergency procedures (e.g. poly-trauma, heart attack, acute stroke) do NOT require an advance referral.',
      'Planned Private Care Rule: For planned complex secondary or tertiary care, you MUST first obtain a referral from a public hospital (PHC, CHC, Taluk, or District Hospital). Unreferred planned care is billed privately.',
    ],
    official_links: [
      {
        title: 'Suvarna Arogya Suraksha Trust (SAST)',
        url: 'https://sast.karnataka.gov.in/',
        purpose: 'Official Karnataka scheme portal, guidelines, and hospital search',
      },
      {
        title: 'Department of Health & Family Welfare Karnataka',
        url: 'https://arogya.karnataka.gov.in/',
        purpose: 'State health department announcements and beneficiary guidelines',
      },
    ],
    is_discretionary: false,
    status: 'active',
  },
  {
    scheme_id: 'cmrf',
    name: "Karnataka Chief Minister's Relief Fund (CMRF — Medical Relief)",
    short_name: 'Karnataka CMRF',
    administering_body: "Chief Minister's Secretariat / Relief Fund Section, Vidhana Soudha, Government of Karnataka",
    official_portal_url: 'https://cmrf.karnataka.gov.in/',
    beneficiary_portal_url: 'https://sevasindhuservices.karnataka.gov.in/',
    hospital_search_portal_url: 'https://cmrf.karnataka.gov.in/',
    helplines: [
      {
        name: 'Seva Sindhu Citizen Services',
        number: '080-22230282',
        description: 'Karnataka Online Services & CMRF Application Support',
        tel_uri: 'tel:08022230282',
      },
      {
        name: 'CMRF Section, Vidhana Soudha',
        number: '080-22033528',
        description: "Chief Minister's Medical Relief Processing Desk",
        tel_uri: 'tel:08022033528',
      },
    ],
    coverage_ceiling_inr: 150000.0,
    coverage_display: 'Discretionary Grant (Typically ₹25,000 to ₹1,50,000)',
    coverage_description: "Discretionary financial relief sanctioned directly by the Chief Minister's Office for catastrophic illnesses (cancer, heart surgery, neurosurgery, organ failure) paid directly to the treating hospital.",
    nature_of_scheme: 'Discretionary Ex-Gratia Financial Relief (Not Guaranteed)',
    bpl_benefit: 'Priority consideration for indigent and BPL families whose catastrophic medical expenses exceed family means or exhaust insurance limits.',
    apl_benefit: 'May be considered if the family suffers catastrophic financial hardship and presents a Tahsildar-certified low income certificate, subject to CMO scrutiny.',
    referral_required_for_private: false,
    emergency_referral_exempt: true,
    mandatory_documents: [
      "Formal Application Form addressed to the Hon'ble Chief Minister of Karnataka",
      'Recommendation Letter from Sitting Local MLA, MLC, or MP',
      'Original Medical Cost Estimate Certificate signed by Treating Specialist and Medical Superintendent with Hospital Seal',
      'BPL Ration Card or Tahsildar Income Certificate (proving annual income <₹1,00,000)',
      'Aadhaar Card and Voter ID of Patient and Applicant',
      'Treating Hospital Bank Mandate (Cancelled Cheque / Bank Letter with IFSC and Account Number for direct RTGS disbursement)',
    ],
    conditional_documents: [
      'Discharge Summary and Final Bills (if applying for post-treatment reimbursement consideration)',
      'Relevant Diagnostic Pathology / Radiology Reports (e.g. Biopsy, Angiogram, MRI)',
    ],
    exclusions: [
      'Beneficiaries enrolled in employer medical reimbursement schemes (CGHS, ESI, Armed Forces ECHS)',
      'Elective cosmetic surgeries, minor illnesses, or unapproved hospital facilities',
      'Direct cash payment to the patient (funds are legally disbursed ONLY to the treating hospital account)',
    ],
    limitations_and_disclaimers: [
      "DISCRETIONARY ASSISTANCE NOTICE: The Chief Minister's Relief Fund is an ex-gratia grant, NOT an entitlement or insurance scheme. Sanction is subject to the Chief Minister's discretion, fund availability, and administrative scrutiny. Financial assistance is never guaranteed.",
      'Processing Turnaround: Administrative review and file movement typically take 3 to 8 weeks; urgent cases can be expedited via the CMO or Seva Sindhu helpdesk.',
    ],
    official_links: [
      {
        title: 'Karnataka CMRF Official Portal',
        url: 'https://cmrf.karnataka.gov.in/',
        purpose: 'Guidelines, application status tracking, and orders',
      },
      {
        title: 'Seva Sindhu Online Medical Relief Service',
        url: 'https://sevasindhuservices.karnataka.gov.in/',
        purpose: 'Digital submission under Major Ailments Assistance Application Service',
      },
    ],
    is_discretionary: true,
    status: 'active',
  },
]

// ============================================================================
// Managed Karnataka Hospital Facilities & Live Availability Badge
// ============================================================================

export const MANAGED_HOSPITALS = [
  { id: 'hosp_davg_shree_institute', name: 'Shree Medical Institute (Davangere)', district: 'Davangere', phone: '+91 8192 284900' },
  { id: 'hosp_blr_manipal', name: 'Manipal Hospital Old Airport Road', district: 'Bengaluru', phone: '+91 80 2502 4444' },
  { id: 'hosp_blr_apollo', name: 'Apollo Hospital Bannerghatta Road', district: 'Bengaluru', phone: '+91 80 2630 4050' },
  { id: 'hosp_davg_chigateri', name: 'Chigateri District Hospital', district: 'Davangere', phone: '+91 8192 231433' },
  { id: 'hosp_blr_fortis', name: 'Fortis Hospital Cunningham Road', district: 'Bengaluru', phone: '+91 80 4199 4444' },
  { id: 'hosp_mys_columbia', name: 'Columbia Asia Hospital Mysuru', district: 'Mysuru', phone: '+91 821 398 9898' },
  { id: 'hosp_hub_tatwadarsha', name: 'Tatwadarsha Hospital Hubballi', district: 'Dharwad', phone: '+91 836 221 8888' },
]

export function HospitalAvailabilityBadge({
  availability,
}: {
  availability?: HospitalAvailabilityResponse | null
}) {
  if (!availability) {
    return (
      <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80 my-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">
              Availability not updated
            </span>
          </div>
          <span className="text-[10px] text-slate-400 italic">Awaiting hospital verification</span>
        </div>
      </div>
    )
  }

  const isAccepting = availability.duty_status === 'Accepting Patients'
  const isLimited = availability.duty_status === 'Limited'
  const erStatus = availability.emergency_dept_status || 'Operational'
  const isErOperational = erStatus === 'Operational'

  const formattedTime = availability.last_updated
    ? new Date(availability.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Recently'

  return (
    <div className="p-2.5 rounded-xl bg-slate-50/95 border border-slate-200 shadow-2xs my-2 space-y-2">
      {/* Header: Section Title, Duty Status, and Last Updated */}
      <div className="flex items-center justify-between text-xs border-b border-slate-200/70 pb-1.5 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isAccepting ? 'bg-emerald-500 animate-pulse' : isLimited ? 'bg-amber-500' : 'bg-rose-500'
            }`}
          />
          <span className="font-black text-[10px] uppercase tracking-wider text-slate-700">
            LIVE STAFF AVAILABILITY
          </span>
          <span
            className={`font-black text-[10px] uppercase px-1.5 py-0.2 rounded border ${
              isAccepting
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : isLimited
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'bg-rose-50 text-rose-700 border-rose-300'
            }`}
          >
            {availability.duty_status}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 font-medium">
          Last Updated: <span className="font-bold text-slate-700">{formattedTime}</span>
        </span>
      </div>

      {/* Staffing Counts Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-center">
        <div className="bg-white p-1.5 rounded-lg border border-slate-200">
          <div className="text-sm font-black text-slate-900 leading-tight">
            {availability.doctors_available}
          </div>
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
            Doctors Available
          </div>
        </div>

        <div className="bg-white p-1.5 rounded-lg border border-rose-200">
          <div className="text-sm font-black text-rose-600 leading-tight">
            {availability.emergency_doctors}
          </div>
          <div className="text-[9px] text-rose-700 font-bold uppercase tracking-wider">
            Emergency Doctors
          </div>
        </div>

        <div className="bg-white p-1.5 rounded-lg border border-slate-200">
          <div className="text-sm font-black text-slate-900 leading-tight">
            {availability.nurses_available}
          </div>
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
            Nurses Available
          </div>
        </div>

        <div className="bg-white p-1.5 rounded-lg border border-rose-200">
          <div className="text-sm font-black text-rose-600 leading-tight">
            {availability.emergency_nurses ?? '—'}
          </div>
          <div className="text-[9px] text-rose-700 font-bold uppercase tracking-wider">
            Emergency Nurses
          </div>
        </div>
      </div>

      {/* Emergency Department Operational Status */}
      <div className="flex items-center justify-between text-[11px] bg-white px-2 py-1 rounded-lg border border-slate-200">
        <span className="text-slate-600 font-bold">Emergency Department:</span>
        <span
          className={`font-black uppercase tracking-wider ${
            isErOperational ? 'text-emerald-700' : 'text-amber-700'
          }`}
        >
          {erStatus}
        </span>
      </div>

      {availability.notes && (
        <p className="text-[10px] text-slate-600 italic bg-white/80 px-2 py-1 rounded border border-slate-100">
          “{availability.notes}”
        </p>
      )}
    </div>
  )
}

export function HospitalFinder() {
  const { user } = useAuth()
  const isHospitalStaff = user?.portal === 'hospital_management'

  // Navigation Tab: 'facilities' (GPS Nearby & Registry), 'cost_comparison' (Stage 3), 'schemes' (Stage 4B), 'manage_availability', 'emergency_sos'
  const [activeTab, setActiveTab] = useState<'facilities' | 'cost_comparison' | 'schemes' | 'manage_availability' | 'emergency_sos'>(
    user?.portal === 'hospital_management' ? 'manage_availability' : 'facilities'
  )

  // Live Hospital Availability Map
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, HospitalAvailabilityResponse>>({})
  const [availabilityLoading, setAvailabilityLoading] = useState(false)

  // Manage Availability Desk States (Hospital Staff)
  const [selectedMgmtHospitalId, setSelectedMgmtHospitalId] = useState<string>(() => {
    if (user?.organization?.toLowerCase().includes('manipal')) return 'hosp_blr_manipal'
    if (user?.name?.toLowerCase().includes('manipal')) return 'hosp_blr_manipal'
    return 'hosp_davg_shree_institute'
  })
  const [mgmtDoctors, setMgmtDoctors] = useState<number>(14)
  const [mgmtEmergencyDoctors, setMgmtEmergencyDoctors] = useState<number>(3)
  const [mgmtNurses, setMgmtNurses] = useState<number>(28)
  const [mgmtDutyStatus, setMgmtDutyStatus] = useState<string>('Accepting Patients')
  const [mgmtNotes, setMgmtNotes] = useState<string>('Trauma Bay & ICU staffed; CT scanner operational')
  const [isSavingAvailability, setIsSavingAvailability] = useState(false)
  const [mgmtFeedback, setMgmtFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Emergency SOS Desk States (Hospital Staff)
  const [sosList, setSosList] = useState<EmergencySOSRecord[]>([])
  const [sosFilter, setSosFilter] = useState<'ALL' | 'PENDING' | 'RESPONDING' | 'RESOLVED'>('ALL')
  const [selectedProtocolRecord, setSelectedProtocolRecord] = useState<EmergencySOSRecord | null>(null)
  const lastKnownPendingCount = useRef<number>(0)

  // Patient Emergency SOS States
  const [isSosModalOpen, setIsSosModalOpen] = useState(false)
  const [sosEmergencyType, setSosEmergencyType] = useState<string>('Accident / Trauma')
  const [sosTargetHospitalId, setSosTargetHospitalId] = useState<string>('hosp_davg_shree_institute')
  const [sosPatientName, setSosPatientName] = useState<string>(user?.name || 'Mohan Rao')
  const [sosPatientPhone, setSosPatientPhone] = useState<string>('+91 98450 12345')
  const [sosDescription, setSosDescription] = useState<string>('')
  const [sosCoords, setSosCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [sosLocating, setSosLocating] = useState(false)
  const [isSubmittingSos, setIsSubmittingSos] = useState(false)
  const [activeSosTracking, setActiveSosTracking] = useState<EmergencySOSRecord | null>(null)
  const [sosError, setSosError] = useState<string | null>(null)

  // Search Mode: 'nearby_gps' (Stage 2) or 'manual_city' (Registry/OSM)
  const [searchMode, setSearchMode] = useState<'nearby_gps' | 'manual_city'>('manual_city')

  // Search Parameters
  const [cityOrArea, setCityOrArea] = useState('Bengaluru, Karnataka')
  const [symptom, setSymptom] = useState('')
  const [maxDistanceKm, setMaxDistanceKm] = useState(35)
  const [careType, setCareType] = useState('All')
  const [sortBy, setSortBy] = useState<'distance' | 'cost' | 'rating'>('distance')

  // GPS Geolocation States
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [geoLocating, setGeoLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)

  // Stage 2 Nearby Results
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyResponse, setNearbyResponse] = useState<KarnatakaNearbyResponse | null>(null)
  const [nearbyError, setNearbyError] = useState<string | null>(null)
  const [selectedNearbyHospital, setSelectedNearbyHospital] = useState<KarnatakaNearbyHospital | null>(null)

  // Legacy / Manual City Search States
  const [loading, setLoading] = useState(false)
  const [searchResponse, setSearchResponse] = useState<HospitalSearchResponse | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedHospital, setSelectedHospital] = useState<HospitalDetail | null>(null)

  // UI States
  const [showMap, setShowMap] = useState(false)
  const [expandedPrices, setExpandedPrices] = useState<Record<string, boolean>>({})

  // ---------------------------------------------------------------------------
  // Feature 1: Live Hospital Doctor Availability Handlers & Polling
  // ---------------------------------------------------------------------------
  const fetchAllAvailabilities = useCallback(async () => {
    try {
      setAvailabilityLoading(true)
      const list = await getAllHospitalAvailabilities()
      const map: Record<string, HospitalAvailabilityResponse> = {}
      for (const item of list) {
        map[item.hospital_id] = item
      }
      setAvailabilityMap(map)
      if (map[selectedMgmtHospitalId]) {
        const cur = map[selectedMgmtHospitalId]
        setMgmtDoctors(cur.doctors_available)
        setMgmtEmergencyDoctors(cur.emergency_doctors)
        setMgmtNurses(cur.nurses_available)
        setMgmtDutyStatus(cur.duty_status)
        setMgmtNotes(cur.notes || '')
      }
    } catch (e) {
      console.warn('Could not fetch hospital availabilities:', e)
    } finally {
      setAvailabilityLoading(false)
    }
  }, [selectedMgmtHospitalId])

  useEffect(() => {
    fetchAllAvailabilities()
    const interval = setInterval(fetchAllAvailabilities, 4000)
    return () => clearInterval(interval)
  }, [fetchAllAvailabilities])

  const handleSaveAvailability = async () => {
    setIsSavingAvailability(true)
    setMgmtFeedback(null)
    try {
      const targetHosp = MANAGED_HOSPITALS.find((h) => h.id === selectedMgmtHospitalId)
      const res = await updateHospitalAvailability(selectedMgmtHospitalId, {
        hospital_id: selectedMgmtHospitalId,
        hospital_name: targetHosp?.name || selectedMgmtHospitalId,
        doctors_available: mgmtDoctors,
        emergency_doctors: mgmtEmergencyDoctors,
        nurses_available: mgmtNurses,
        duty_status: mgmtDutyStatus,
        notes: mgmtNotes.trim() || undefined,
      })
      setAvailabilityMap((prev) => ({ ...prev, [selectedMgmtHospitalId]: res }))
      setMgmtFeedback({
        type: 'success',
        message: `Availability updated successfully for ${res.hospital_name}. Now live for citizens.`,
      })
    } catch (e: any) {
      setMgmtFeedback({
        type: 'error',
        message: e?.message || 'Failed to update hospital availability.',
      })
    } finally {
      setIsSavingAvailability(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Feature 2: Emergency SOS System Handlers & Polling
  // ---------------------------------------------------------------------------
  const fetchHospitalSos = useCallback(async () => {
    if (!isHospitalStaff) return
    try {
      const records = await listHospitalSOS(selectedMgmtHospitalId)
      setSosList(records)

      const pendingCount = records.filter((r) => r.status === 'PENDING').length
      if (pendingCount > lastKnownPendingCount.current) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          if (AudioContextClass) {
            const ctx = new AudioContextClass()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            gain.gain.setValueAtTime(0.2, ctx.currentTime)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start()
            osc.stop(ctx.currentTime + 0.3)
          }
        } catch {
          // Audio autoplay might be restricted
        }
      }
      lastKnownPendingCount.current = pendingCount
    } catch (e) {
      console.warn('Could not fetch hospital SOS alerts:', e)
    }
  }, [isHospitalStaff, selectedMgmtHospitalId])

  useEffect(() => {
    if (isHospitalStaff) {
      fetchHospitalSos()
      const interval = setInterval(fetchHospitalSos, 4000)
      return () => clearInterval(interval)
    }
  }, [isHospitalStaff, fetchHospitalSos])

  const handleUpdateSosStatus = async (
    sosId: string,
    newStatus: 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED',
    notes?: string
  ) => {
    try {
      const updated = await updateSOSStatus(sosId, newStatus, notes)
      setSosList((prev) => prev.map((s) => (s.sos_id === sosId ? updated : s)))
      if (activeSosTracking?.sos_id === sosId) {
        setActiveSosTracking(updated)
      }
    } catch (e: any) {
      alert(`Could not update SOS status: ${e?.message || 'Network error'}`)
    }
  }

  const handleRequestSosLocation = () => {
    if (!navigator.geolocation) {
      setSosError('Geolocation is not supported by your browser.')
      return
    }
    setSosLocating(true)
    setSosError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSosCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setSosLocating(false)
      },
      (err) => {
        setSosError(`GPS permission denied or unavailable: ${err.message}`)
        setSosLocating(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleSubmitSos = async () => {
    if (!sosPatientName.trim()) {
      setSosError('Please provide patient or caller name.')
      return
    }
    if (!sosPatientPhone.trim()) {
      setSosError('Please enter a callback phone number for the emergency desk.')
      return
    }

    setIsSubmittingSos(true)
    setSosError(null)
    try {
      const targetHosp = MANAGED_HOSPITALS.find((h) => h.id === sosTargetHospitalId)
      const record = await createEmergencySOS({
        emergency_type: sosEmergencyType,
        hospital_id: sosTargetHospitalId,
        hospital_name: targetHosp?.name || sosTargetHospitalId,
        patient_name: sosPatientName.trim(),
        patient_phone: sosPatientPhone.trim(),
        description: sosDescription.trim() || undefined,
        latitude: sosCoords?.lat,
        longitude: sosCoords?.lon,
        address: locationLabel || undefined,
      })
      setActiveSosTracking(record)
    } catch (e: any) {
      setSosError(e?.message || 'Failed to dispatch SOS alert. Please call 112 directly.')
    } finally {
      setIsSubmittingSos(false)
    }
  }

  useEffect(() => {
    if (!activeSosTracking || activeSosTracking.status === 'RESOLVED') return
    const interval = setInterval(async () => {
      try {
        const latest = await getEmergencySOS(activeSosTracking.sos_id)
        setActiveSosTracking(latest)
      } catch {
        // Silent poll error
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeSosTracking])

  // Stage 3: Treatment Package Cost & Price Comparison States
  const [selectedPackage, setSelectedPackage] = useState<string>('Normal Delivery')
  const [selectedRoomCategory, setSelectedRoomCategory] = useState<string>('Deluxe')
  const [costLoading, setCostLoading] = useState<boolean>(false)
  const [costPrediction, setCostPrediction] = useState<CostPredictionResult | null>(null)
  const [costError, setCostError] = useState<string | null>(null)
  const [costWarning, setCostWarning] = useState<string | null>(null)
  const [costCatalog, setCostCatalog] = useState<CostComparisonCatalog | null>(null)
  const [benchmarkFilterCategory, setBenchmarkFilterCategory] = useState<string>('All')

  // Stage 4B: Government Healthcare Schemes States
  const [schemesCatalog, setSchemesCatalog] = useState<GovernmentSchemesCatalog | null>(null)
  const [schemesLoading, setSchemesLoading] = useState<boolean>(false)
  const [schemesError, setSchemesError] = useState<string | null>(null)
  const [selectedSchemeFilter, setSelectedSchemeFilter] = useState<string>('all')

  // Anonymous Guidance Form States (Strictly non-PII)
  const [guidanceResident, setGuidanceResident] = useState<boolean>(true)
  const [guidanceRationCard, setGuidanceRationCard] = useState<'BPL_PHH_AAY' | 'APL_NPHH' | 'NONE'>('BPL_PHH_AAY')
  const [guidanceAge, setGuidanceAge] = useState<string>('45')
  const [guidanceCareType, setGuidanceCareType] = useState<'EMERGENCY' | 'PLANNED'>('EMERGENCY')
  const [guidanceCostEstimate, setGuidanceCostEstimate] = useState<string>('')

  const [guidanceLoading, setGuidanceLoading] = useState<boolean>(false)
  const [guidanceResponse, setGuidanceResponse] = useState<SchemeEligibilityEvaluationResponse | null>(null)
  const [guidanceError, setGuidanceError] = useState<string | null>(null)

  // Interactive Document Checklist State: docId -> checked
  const [checkedDocs, setCheckedDocs] = useState<Record<string, boolean>>({})

  // ---------------------------------------------------------------------------
  // Stage 4B: Fetch Schemes Catalog & Helplines
  // ---------------------------------------------------------------------------
  const fetchSchemesCatalog = useCallback(async () => {
    setSchemesLoading(true)
    setSchemesError(null)
    try {
      const res = await fetch(`${API_BASE}/hospital-ml/schemes`)
      if (res.ok) {
        const data: GovernmentSchemesCatalog = await res.json()
        setSchemesCatalog(data)
      } else {
        setSchemesCatalog({
          status: 'success',
          schemes: DEFAULT_GOVERNMENT_SCHEMES,
          emergency_helplines: DEFAULT_EMERGENCY_HELPLINES,
          disclaimer:
            'Official scheme policies, coverage schedules, and empanelment rosters are determined solely by government authorities. EvidenceBridge provides informational guidance and does not authorize or determine scheme approvals.',
          last_verified: '2026-11-04',
        })
      }
    } catch (err) {
      console.warn('Schemes catalog fetch notice, using verified built-in catalog:', err)
      setSchemesCatalog({
        status: 'success',
        schemes: DEFAULT_GOVERNMENT_SCHEMES,
        emergency_helplines: DEFAULT_EMERGENCY_HELPLINES,
        disclaimer:
          'Official scheme policies, coverage schedules, and empanelment rosters are determined solely by government authorities. EvidenceBridge provides informational guidance and does not authorize or determine scheme approvals.',
        last_verified: '2026-11-04',
      })
    } finally {
      setSchemesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSchemesCatalog()
  }, [fetchSchemesCatalog])

  // ---------------------------------------------------------------------------
  // Stage 4B: Pure Deterministic Local Guidance Fallback
  // ---------------------------------------------------------------------------
  const computeLocalGuidance = useCallback(
    (req: SchemeEligibilityEvaluationRequest) => {
      const isEmergency = req.care_type === 'EMERGENCY'
      const isKarnataka = req.is_karnataka_resident
      const isSenior = req.patient_age !== undefined && req.patient_age !== null && req.patient_age >= 70

      let primaryId: string | null = null
      let primaryName: string | null = null
      let eligible: string[] = []
      let copay = ''
      let cov = ''
      const steps: string[] = []
      const mandDocs: string[] = ['Aadhaar Card (Patient and Household Head)']
      const condDocs: string[] = [
        'Ayushman Bharat / Arogya Karnataka ID Card (if already generated)',
        'Treating Doctor Prescription & Diagnostic Reports',
      ]

      if (isEmergency) {
        steps.push(
          '1. Proceed immediately to the nearest hospital emergency room. Referral is waived for acute emergencies.'
        )
        steps.push(
          '2. Present patient Aadhaar and Ration Card at the hospital Ayushman/Arogya Mitra desk within 24 hours of admission.'
        )
      } else {
        steps.push(
          '1. For planned/elective care, visit a Government Public Health Institution (Taluk or District Hospital) first to obtain an Online Referral Slip (ORS).'
        )
        steps.push(
          '2. Confirm that the private hospital is actively empanelled for your specialty on hospitals.pmjay.gov.in or sast.karnataka.gov.in.'
        )
        steps.push(
          '3. Present Aadhaar, Ration Card, and Referral Slip at the empanelled hospital desk prior to admission.'
        )
      }

      if (!isKarnataka) {
        primaryId = 'pmjay'
        primaryName = 'Ayushman Bharat — PM-JAY (National Portability)'
        eligible = ['pmjay']
        copay = '100% Cashless Coverage (up to ₹5,00,000/yr for eligible SECC/NFSA beneficiaries)'
        cov =
          'PM-JAY National Portability pathway. Non-Karnataka residents enrolled under PM-JAY in their home state can access cashless care at PM-JAY empanelled hospitals across Karnataka.'
        mandDocs.push('Home State Ration Card or PM-JAY Beneficiary ID')
      } else {
        if (req.ration_card_type === 'BPL_PHH_AAY') {
          primaryId = 'ab_ark'
          primaryName = 'Ayushman Bharat — Arogya Karnataka (Eligible / BPL Category)'
          eligible = ['ab_ark', 'pmjay']
          copay = '100% Cashless Coverage (₹0 Patient Co-Payment for approved package rates up to ₹5,00,000/yr)'
          cov =
            'Eligible Category (BPL / NFSA PHH & AAY Cardholders): 100% cashless hospitalization up to ₹5,00,000 per family per year on a family floater basis across all empanelled network hospitals under integrated AB-ArK / PM-JAY.'
          mandDocs.push('Valid Karnataka BPL Ration Card (PHH / AAY)')
          if (!isEmergency) mandDocs.push('Government Public Health Institution Online Referral Slip (ORS)')
        } else if (req.ration_card_type === 'APL_NPHH') {
          primaryId = 'ab_ark'
          primaryName = 'Ayushman Bharat — Arogya Karnataka (General / APL Category)'
          eligible = ['ab_ark']
          copay = '30% State Financial Assistance (Capped at ₹1,50,000/yr); 70% Patient Co-Payment'
          cov =
            'General Category (APL / Non-BPL Karnataka Residents): Co-payment model. State covers 30% of notified package tariff up to ₹1,50,000/year; patient pays remaining 70% directly to the hospital.'
          mandDocs.push('Karnataka APL Ration Card (NPHH) or Voter ID proving Karnataka residence')
          if (!isEmergency) mandDocs.push('Government Public Health Institution Online Referral Slip (ORS)')
          steps.push('Be prepared to settle 70% of the package rate directly with the hospital.')
        } else {
          if (isSenior) {
            primaryId = 'pmjay'
            primaryName = 'Ayushman Bharat — PM-JAY (Ayushman Vay Vandana Card for 70+)'
            eligible = ['pmjay']
            copay = '100% Cashless Coverage for Senior Citizens 70+ (up to ₹5,00,000/yr)'
            cov =
              'Senior Citizen Universal Expansion (Ayushman Vay Vandana Card): All individuals aged 70 and above qualify for ₹5,00,000 annual top-up coverage under PM-JAY regardless of household income or ration card tier.'
            mandDocs.push('Aadhaar Card proving patient age 70+')
          } else {
            primaryId = null
            primaryName = 'Standard Public Hospital Subsidized Care / Discretionary Relief'
            eligible = []
            copay = 'General Private Tariff / Direct Public Hospital Rates'
            cov =
              'Standard PM-JAY and AB-ArK require a valid BPL/PHH/AAY or APL ration card. Uninsured citizens may seek subsidized care at Government Public Hospitals (e.g. Victoria Hospital ₹20 OPD) or apply for CMRF relief.'
            mandDocs.push('Government Hospital OPD Registration Slip')
            condDocs.push('Tahsildar Income Certificate (<₹1,00,000/yr) if applying for CMRF')
          }
        }
      }

      if (isSenior) {
        steps.push(
          'Senior Citizen Expansion: Since the patient is aged 70 or older, they qualify for the Ayushman Vay Vandana Card (₹5 Lakh cover irrespective of income). Enrol using Aadhaar e-KYC on beneficiary.nha.gov.in.'
        )
      }

      const defaultLinks: GovernmentSchemeOfficialLink[] = [
        {
          title: 'PM-JAY Beneficiary Portal (Verify Eligibility & Ayushman Card)',
          url: 'https://beneficiary.nha.gov.in/',
          purpose: 'Verify eligibility and generate Ayushman Card via Aadhaar OTP',
        },
        {
          title: 'PM-JAY Empanelled Hospital Directory',
          url: 'https://hospitals.pmjay.gov.in/',
          purpose: 'Search verified network hospitals by state and district',
        },
        {
          title: 'Suvarna Arogya Suraksha Trust (SAST Karnataka)',
          url: 'https://sast.karnataka.gov.in/',
          purpose: 'Karnataka state health schemes, guidelines, and network hospital directory',
        },
        {
          title: 'Karnataka Chief Minister’s Relief Fund Portal',
          url: 'https://cmrf.karnataka.gov.in/',
          purpose: 'Official CMRF guidelines and application status tracking',
        },
        {
          title: 'Seva Sindhu Online Medical Relief Application',
          url: 'https://sevasindhuservices.karnataka.gov.in/',
          purpose: 'Digital application under Major Ailments Assistance Application Service',
        },
      ]

      setGuidanceResponse({
        status: 'success',
        pathway_headline: 'Potential scheme pathway — confirm with the official authority.',
        primary_scheme_id: primaryId,
        primary_scheme_name: primaryName,
        eligible_schemes: eligible,
        coverage_summary: cov,
        copay_status: copay,
        referral_required: !isEmergency,
        referral_guidance: isEmergency
          ? 'Emergency Health Care Exemption: Direct admission to any empanelled public or private hospital is permitted WITHOUT an advance government referral.'
          : 'Online Referral System (ORS) Rule: For planned procedures at private empanelled hospitals, an advance referral slip from a Government Hospital is strictly mandatory.',
        emergency_exemption: isEmergency,
        senior_citizen_expansion: isSenior,
        cmrf_applicable: isKarnataka,
        cmrf_status_note: isKarnataka
          ? 'Karnataka Chief Minister’s Relief Fund (CMRF) is available as discretionary ex-gratia financial relief (typically ₹25,000 to ₹1,50,000) disbursed directly to the treating hospital for catastrophic illnesses. Financial assistance is discretionary and subject to CMO review, not guaranteed.'
          : null,
        actionable_steps: steps,
        mandatory_documents: mandDocs,
        conditional_documents: condDocs,
        official_verification_links: defaultLinks,
        helpline_numbers: DEFAULT_EMERGENCY_HELPLINES,
        disclaimer:
          'Potential scheme pathway — confirm with the official authority. EvidenceBridge does not determine eligibility or approve medical treatments. All official eligibility, pre-authorizations, and coverage decisions are made solely by the National Health Authority (NHA), Suvarna Arogya Suraksha Trust (SAST), or the Chief Minister\'s Relief Fund committee.',
      })
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Stage 4B: Execute Anonymous Guidance Evaluation
  // ---------------------------------------------------------------------------
  const executeGuidanceEvaluation = useCallback(async () => {
    setGuidanceLoading(true)
    setGuidanceError(null)

    const parsedAge = guidanceAge.trim() ? parseInt(guidanceAge, 10) : undefined
    const parsedCost = guidanceCostEstimate.trim() ? parseFloat(guidanceCostEstimate) : undefined

    const payload: SchemeEligibilityEvaluationRequest = {
      is_karnataka_resident: guidanceResident,
      ration_card_type: guidanceRationCard,
      patient_age: parsedAge !== undefined && !isNaN(parsedAge) ? parsedAge : undefined,
      care_type: guidanceCareType,
      estimated_cost_inr: parsedCost !== undefined && !isNaN(parsedCost) ? parsedCost : undefined,
    }

    try {
      const res = await fetch(`${API_BASE}/hospital-ml/schemes/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data: SchemeEligibilityEvaluationResponse = await res.json()
        setGuidanceResponse(data)
      } else {
        computeLocalGuidance(payload)
      }
    } catch (err) {
      console.warn('Guidance evaluation fallback to local rules:', err)
      computeLocalGuidance(payload)
    } finally {
      setGuidanceLoading(false)
    }
  }, [guidanceResident, guidanceRationCard, guidanceAge, guidanceCareType, guidanceCostEstimate, computeLocalGuidance])

  // Document Checklist toggling
  const toggleDocCheck = (doc: string) => {
    setCheckedDocs((prev) => ({
      ...prev,
      [doc]: !prev[doc],
    }))
  }

  const resetChecklist = () => {
    setCheckedDocs({})
  }

  // ---------------------------------------------------------------------------
  // Stage 3: Fetch Catalog of Supported Packages and Comparable Benchmarks
  // ---------------------------------------------------------------------------
  const fetchCostCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/hospital-ml/cost/catalog`)
      if (res.ok) {
        const data: CostComparisonCatalog = await res.json()
        setCostCatalog(data)
      }
    } catch (err) {
      console.warn('Cost catalog fetch failed, using built-in catalog data:', err)
    }
  }, [])

  useEffect(() => {
    fetchCostCatalog()
  }, [fetchCostCatalog])

  // ---------------------------------------------------------------------------
  // Stage 3: Execute Cost Prediction for Selected Package & Room Category
  // ---------------------------------------------------------------------------
  const executeCostPrediction = useCallback(
    async (pkg: string = selectedPackage, room: string = selectedRoomCategory) => {
      setCostLoading(true)
      setCostError(null)
      setCostWarning(null)

      try {
        const res = await fetch(`${API_BASE}/hospital-ml/cost/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            package_name: pkg,
            room_category: room,
          }),
        })

        const envelope = await res.json()

        if (envelope.status === 'success' && envelope.data) {
          setCostPrediction(envelope.data)
          setCostWarning(
            envelope.warning || 'Experimental package price model trained on Sakhii Hospital (Bengaluru) data only.'
          )
        } else if (envelope.status === 'validation_error') {
          setCostError(
            envelope.error || 'The selected procedure or room tier is not covered by the published tariff schedule.'
          )
        } else if (envelope.status === 'external_service_unavailable') {
          // Fallback to published reference tariff if known
          const packagesList = costCatalog?.supported_packages || DEFAULT_TREATMENT_PACKAGES
          const found = packagesList.find((p) => p.package_name.toLowerCase() === pkg.toLowerCase())
          const publishedPrice = found?.published_prices_inr?.[room]

          if (publishedPrice) {
            setCostPrediction({
              hospital: 'Sakhii Hospital',
              district: 'Bengaluru',
              package: pkg,
              room_category: room,
              published_reference_price_inr: publishedPrice,
              experimental_ml_estimate_inr: publishedPrice,
              difference_inr: 0.0,
              price_type: 'Published hospital package tariff (Local Baseline)',
              model_status: 'Published Baseline (External Service Cold-Starting)',
              karnataka_wide_prediction: false,
              package_scope_verified: false,
            })
            setCostWarning(
              'External Karnataka ML model is undergoing cold-start. Displaying verified published reference tariff from Sakhii Hospital dataset.'
            )
          } else {
            setCostError(
              envelope.error || 'External ML cost prediction service is temporarily unavailable. Please retry shortly.'
            )
          }
        } else {
          setCostError(envelope.error || 'Unable to retrieve treatment package estimation.')
        }
      } catch (err: unknown) {
        console.error('Treatment cost prediction error:', err)
        setCostError(err instanceof Error ? err.message : 'Network error connecting to cost prediction service.')
      } finally {
        setCostLoading(false)
      }
    },
    [costCatalog, selectedPackage, selectedRoomCategory]
  )


  // ---------------------------------------------------------------------------
  // Stage 2: Fetch Nearby Hospitals via Backend GPS Integration
  // ---------------------------------------------------------------------------
  const executeNearbySearch = useCallback(
    async (targetCoords: { lat: number; lon: number }, radius: number = maxDistanceKm, specFilter: string = symptom) => {
      setNearbyLoading(true)
      setNearbyError(null)

      try {
        const payload = {
          latitude: targetCoords.lat,
          longitude: targetCoords.lon,
          radius_km: radius,
          specialty: specFilter.trim() || undefined,
          limit: 20,
        }

        const res = await fetch(`${API_BASE}/hospital-ml/hospitals/nearby`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          throw new Error(`Nearby hospital service returned status ${res.status}`)
        }

        const data: KarnatakaNearbyResponse = await res.json()
        setNearbyResponse(data)
        if (data.hospitals && data.hospitals.length > 0) {
          setSelectedNearbyHospital(data.hospitals[0])
        } else {
          setSelectedNearbyHospital(null)
        }
        if (data.resolved_district) {
          setLocationLabel(`${data.resolved_district} District`)
        }
      } catch (err: unknown) {
        console.error('Nearby hospital fetch failed:', err)
        setNearbyError(
          err instanceof Error
            ? err.message
            : 'Unable to reach nearby hospital service. Please try again or search by district.'
        )
      } finally {
        setNearbyLoading(false)
      }
    },
    [maxDistanceKm, symptom]
  )

  // ---------------------------------------------------------------------------
  // Manual / City Registry Search
  // ---------------------------------------------------------------------------
  const executeCitySearch = useCallback(
    async (overrideCoords?: { lat: number; lon: number }, overrideCity?: string) => {
      setLoading(true)
      setSearchError(null)

      try {
        const queryCity = overrideCity !== undefined ? overrideCity : cityOrArea
        const params = new URLSearchParams()
        if (queryCity.trim()) {
          params.append('city_or_area', queryCity.trim())
        }

        const activeCoords = overrideCoords || (queryCity === 'Your Current Geolocation' ? coords : null)
        if (activeCoords) {
          params.append('lat', activeCoords.lat.toString())
          params.append('lon', activeCoords.lon.toString())
        }

        if (symptom.trim()) {
          params.append('symptom', symptom.trim())
        }

        params.append('max_distance_km', maxDistanceKm.toString())
        if (careType !== 'All') {
          params.append('care_type', careType)
        }
        params.append('sort_by', sortBy)

        const res = await fetch(`${API_BASE}/hospitals/search?${params.toString()}`)
        if (!res.ok) {
          throw new Error(`Search failed with status ${res.status}`)
        }

        const data: HospitalSearchResponse = await res.json()
        setSearchResponse(data)
        if (data.hospitals.length > 0) {
          setSelectedHospital(data.hospitals[0])
        }
      } catch (err: unknown) {
        console.error('Hospital search failed:', err)
        setSearchError(
          err instanceof Error
            ? err.message
            : 'Unable to reach hospital search service. Please check your connection.'
        )
      } finally {
        setLoading(false)
      }
    },
    [careType, cityOrArea, coords, maxDistanceKm, sortBy, symptom]
  )

  // Initial load: run default search
  useEffect(() => {
    executeCitySearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Stage 2: Browser Geolocation API Handler (One-shot with explicit user consent)
  // ---------------------------------------------------------------------------
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser. Please type your district or city name.')
      return
    }

    setGeoLocating(true)
    setGeoError(null)

    // One-shot getCurrentPosition with strict 8s timeout and high accuracy
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userCoords = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        }
        setCoords(userCoords)
        setGeoLocating(false)
        setSearchMode('nearby_gps')
        setLocationLabel(`(${userCoords.lat.toFixed(4)}° N, ${userCoords.lon.toFixed(4)}° E)`)
        executeNearbySearch(userCoords, maxDistanceKm)
      },
      (err) => {
        setGeoLocating(false)
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Location access was denied. You can search by entering any Karnataka district name above.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError('Current location is unavailable from your device. Please type your district name.')
        } else if (err.code === err.TIMEOUT) {
          setGeoError('Location request timed out. Please try again or type a district name.')
        } else {
          setGeoError('Could not determine current location. Please type your district name.')
        }
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 60000 }
    )
  }

  const handleResetLocation = () => {
    setCoords(null)
    setLocationLabel(null)
    setSearchMode('manual_city')
    setNearbyResponse(null)
    executeCitySearch(undefined, cityOrArea)
  }

  const togglePriceExpansion = (hospId: string) => {
    setExpandedPrices((prev) => ({
      ...prev,
      [hospId]: !prev[hospId],
    }))
  }

  // Active hospital for map view
  const activeMapHospital =
    searchMode === 'nearby_gps'
      ? selectedNearbyHospital
        ? {
            name: selectedNearbyHospital.name,
            lat: selectedNearbyHospital.lat,
            lon: selectedNearbyHospital.lon,
            distance_km: selectedNearbyHospital.distance_km,
            district: selectedNearbyHospital.district,
            category: selectedNearbyHospital.category,
            source: selectedNearbyHospital.data_source,
          }
        : null
      : selectedHospital
      ? {
          name: selectedHospital.name,
          lat: selectedHospital.lat,
          lon: selectedHospital.lon,
          distance_km: selectedHospital.distance_km,
          district: selectedHospital.city,
          category: selectedHospital.facility_type,
          source: selectedHospital.data_source,
        }
      : null

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              Karnataka Hospital ML &bull; Validated Dataset
            </span>
            <span className="text-xs text-slate-500 font-medium">GPS Haversine Distance &bull; Stage 2</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Hospital &amp; Care Finder
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Locate nearby hospitals using your live GPS location or district search.
            EvidenceBridge computes exact straight-line Haversine distances against the validated Karnataka hospital directory
            with directory evidence completeness transparency.
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMap(!showMap)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
              showMap
                ? 'bg-navy-900 text-white border-navy-900 shadow-sm'
                : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300'
            }`}
          >
            <span>🗺️</span>
            <span>{showMap ? 'Hide Map' : 'Show Interactive Map'}</span>
          </button>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isHospitalStaff && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('manage_availability' as any)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === ('manage_availability' as any)
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>🏥</span>
                <span>Manage Availability</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('emergency_sos' as any)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === ('emergency_sos' as any)
                    ? 'bg-rose-700 text-white shadow-sm'
                    : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
                }`}
              >
                <span>🚨</span>
                <span>Emergency SOS Desk</span>
                {sosList.filter((s) => s.status === 'PENDING').length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white animate-pulse">
                    {sosList.filter((s) => s.status === 'PENDING').length} NEW
                  </span>
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('facilities')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'facilities'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span>🏥</span>
            <span>Nearby Hospitals &amp; Directory</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('cost_comparison')
              if (!costPrediction) {
                executeCostPrediction()
              }
            }}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'cost_comparison'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span>💰</span>
            <span>Treatment Costs</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-200 text-amber-900 ml-1">
              ML
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('schemes')
              if (!schemesCatalog) {
                fetchSchemesCatalog()
              }
            }}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'schemes'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span>🏛️</span>
            <span>Govt Schemes</span>
          </button>
        </div>

        {/* SOS Emergency Button for Patients */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsSosModalOpen(true)
              setActiveSosTracking(null)
            }}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white text-xs sm:text-sm font-black shadow-md transition-all flex items-center gap-2 animate-pulse cursor-pointer"
            title="Dispatch immediate emergency SOS to nearby hospital"
          >
            <span className="text-base">🚨</span>
            <span>EMERGENCY SOS</span>
          </button>
        </div>
      </div>

      {activeTab === 'facilities' && (
        <>
          {/* Mode Selector & Prominent GPS Action Banner */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-sky-50 via-indigo-50/40 to-slate-50 border border-sky-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center text-xl shrink-0 shadow-xs">
            📍
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              {coords ? 'GPS Location Active' : 'Find Hospitals Near Your Current Location'}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5 max-w-xl">
              {coords
                ? `Using device coordinates ${locationLabel || ''}. Distances are computed via Haversine great-circle formula.`
                : 'Share your current location with one click to locate the closest hospitals in your Karnataka district.'}
            </p>
            {geoError && (
              <p className="text-xs font-semibold text-rose-600 mt-1.5 flex items-center gap-1">
                <span>⚠️</span>
                <span>{geoError}</span>
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          {coords ? (
            <button
              type="button"
              onClick={handleResetLocation}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-300 transition-colors shadow-xs"
            >
              Reset / Change Location
            </button>
          ) : (
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={geoLocating}
              className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center gap-2"
            >
              {geoLocating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Acquiring GPS Location...</span>
                </>
              ) : (
                <>
                  <span>📍</span>
                  <span>Use My Current Location</span>
                </>
              )}
            </button>
          )}

          {/* Mode Switcher Tabs */}
          <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1">
            <button
              type="button"
              onClick={() => {
                setSearchMode('nearby_gps')
                if (coords) {
                  executeNearbySearch(coords, maxDistanceKm)
                } else {
                  handleUseCurrentLocation()
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                searchMode === 'nearby_gps'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              GPS Nearby
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchMode('manual_city')
                executeCitySearch()
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                searchMode === 'manual_city'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              District Search
            </button>
          </div>
        </div>
      </div>

      {/* Emergency Red-Flag Banner */}
      {searchResponse?.emergency_alert && searchResponse.emergency_alert.is_emergency && (
        <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 border-2 border-rose-500 text-rose-950 shadow-md">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xl shrink-0">
              🚨
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-rose-900">
                {searchResponse.emergency_alert.warning_title || 'Immediate Emergency Care Advised'}
              </h3>
              <p className="text-xs sm:text-sm text-rose-900/90 leading-relaxed font-medium">
                {searchResponse.emergency_alert.warning_message}
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <span className="px-3 py-1 rounded-lg bg-rose-700 text-white text-xs font-extrabold tracking-wide">
                  {searchResponse.emergency_alert.emergency_phone || 'Call 112 / 108'}
                </span>
                <span className="text-xs font-semibold text-rose-800">
                  {searchResponse.emergency_alert.action_advice}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
         PATIENT EMERGENCY SOS MODAL & LIVE TRACKER
         ==================================================================== */}
      {isSosModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-transparent flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150">
            {/* Close */}
            <button
              type="button"
              onClick={() => {
                setIsSosModalOpen(false)
                setActiveSosTracking(null)
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-sm font-bold cursor-pointer"
            >
              ✕
            </button>

            {activeSosTracking ? (
              /* Live Status Tracker */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">SOS Distress Call Active</h3>
                    <p className="text-xs text-slate-500">Tracking dispatch status in real time</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Distress ID:</span>
                    <span className="font-mono font-bold text-slate-900">{activeSosTracking.sos_id}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Hospital Alerted:</span>
                    <span className="font-black text-slate-900">{activeSosTracking.hospital_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Emergency Type:</span>
                    <span className="font-bold text-rose-700">{activeSosTracking.emergency_type}</span>
                  </div>

                  {/* Stepper */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    {[
                      { step: 'PENDING', label: '1. Distress Transmitted to Triage', active: true },
                      {
                        step: 'ACKNOWLEDGED',
                        label: '2. Hospital Staff Acknowledged Call',
                        active: activeSosTracking.status === 'ACKNOWLEDGED' || activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESPONDING',
                        label: '3. Emergency Response Team En Route',
                        active: activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESOLVED',
                        label: '4. Emergency Case Resolved',
                        active: activeSosTracking.status === 'RESOLVED',
                      },
                    ].map((st, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                            st.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {st.active ? '✓' : idx + 1}
                        </span>
                        <span className={`font-bold ${st.active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {st.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <span>ℹ️</span>
                  <span>
                    Keep your phone line open. The emergency triage desk may call you at{' '}
                    <strong>{activeSosTracking.patient_phone}</strong>.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="tel:112"
                    className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black text-center shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>📞</span>
                    <span>Call India Emergency 112</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSosModalOpen(false)
                      setActiveSosTracking(null)
                    }}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Close Tracker
                  </button>
                </div>
              </div>
            ) : (
              /* SOS Distress Form */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Emergency SOS Distress Alert</h3>
                    <p className="text-xs text-slate-500">Transmits immediate alert to hospital triage desk</p>
                  </div>
                </div>

                {/* Emergency Type Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Emergency Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'Accident / Trauma', label: 'Accident / Trauma', icon: '💥' },
                      { id: 'Breathing Difficulty', label: 'Breathing Difficulty', icon: '🫁' },
                      { id: 'Chest Pain', label: 'Chest Pain / Cardiac', icon: '❤️' },
                      { id: 'Other Emergency', label: 'Other Critical Emergency', icon: '⚠️' },
                    ].map((em) => (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => setSosEmergencyType(em.id)}
                        className={`p-2.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition-all cursor-pointer ${
                          sosEmergencyType === em.id
                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span className="text-lg">{em.icon}</span>
                        <span className="leading-tight">{em.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Hospital Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Alert Target Hospital
                  </label>
                  <select
                    value={sosTargetHospitalId}
                    onChange={(e) => setSosTargetHospitalId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold bg-white text-slate-900"
                  >
                    {MANAGED_HOSPITALS.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.district})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Patient Name & Phone */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Patient / Bystander Name
                    </label>
                    <input
                      type="text"
                      value={sosPatientName}
                      onChange={(e) => setSosPatientName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="text"
                      value={sosPatientPhone}
                      onChange={(e) => setSosPatientPhone(e.target.value)}
                      placeholder="+91 98450 12345"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                </div>

                {/* GPS Location Permission */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Location Sharing (GPS)
                    </label>
                    {sosCoords ? (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <span>✓</span> Acquired ({sosCoords.lat.toFixed(3)}°, {sosCoords.lon.toFixed(3)}°)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Optional</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestSosLocation}
                    disabled={sosLocating}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📍</span>
                    <span>{sosLocating ? 'Acquiring GPS...' : sosCoords ? 'Update GPS Location' : 'Share Current GPS Location'}</span>
                  </button>
                </div>

                {/* Condition Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Condition / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={sosDescription}
                    onChange={(e) => setSosDescription(e.target.value)}
                    placeholder="Brief description of patient condition or immediate assistance needed..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium resize-none"
                  />
                </div>

                {/* Direct 112 Call Banner */}
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
                  <div className="text-xs text-rose-950 font-medium">
                    <strong className="block text-rose-900 font-bold">Life-Threatening Emergency?</strong>
                    Call India Emergency Services immediately.
                  </div>
                  <a
                    href="tel:112"
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-black whitespace-nowrap shrink-0 flex items-center gap-1"
                  >
                    <span>📞</span>
                    <span>Call 112</span>
                  </a>
                </div>

                {sosError && (
                  <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    {sosError}
                  </p>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSos}
                    onClick={handleSubmitSos}
                    className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmittingSos ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Transmitting Distress Call...</span>
                      </>
                    ) : (
                      <>
                        <span>🚨</span>
                        <span>DISPATCH EMERGENCY SOS</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search Input Filter Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (searchMode === 'nearby_gps' && coords) {
              executeNearbySearch(coords, maxDistanceKm)
            } else {
              executeCitySearch()
            }
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4"
        >
          {/* City / Area / District Input */}
          <div className="sm:col-span-1 lg:col-span-4">
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              {searchMode === 'nearby_gps' ? 'Current GPS Location' : 'District or City'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={coords ? `📍 GPS Location ${locationLabel || ''}` : cityOrArea}
                onChange={(e) => {
                  setCityOrArea(e.target.value)
                  setCoords(null)
                  setSearchMode('manual_city')
                }}
                disabled={!!coords}
                placeholder="e.g. Bengaluru Urban, Ballari, Mysuru..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 pr-10 disabled:bg-slate-50 disabled:text-slate-700"
              />
              {!coords && (
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={geoLocating}
                  title="Use current GPS location"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                >
                  {geoLocating ? (
                    <span className="w-4 h-4 block border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-sm">📍</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Specialty or Symptom Filter */}
          <div className="sm:col-span-1 lg:col-span-3">
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Specialty or Symptom (Optional)
            </label>
            <input
              type="text"
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
              placeholder="e.g. Cardiology, Surgery, Fever..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>

          {/* Care Type Filter */}
          <div className="sm:col-span-1 lg:col-span-2">
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
              Type of Care
            </label>
            <select
              value={careType}
              onChange={(e) => setCareType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
            >
              <option value="All">All Facilities</option>
              <option value="Hospital">General Hospital</option>
              <option value="Tertiary">Tertiary Center</option>
              <option value="Secondary">Secondary Care</option>
              <option value="Primary">Primary Care</option>
            </select>
          </div>

          {/* Search Action Button */}
          <div className="sm:col-span-1 lg:col-span-3 flex items-end gap-2">
            <button
              type="submit"
              disabled={loading || nearbyLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
            >
              {loading || nearbyLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>{searchMode === 'nearby_gps' ? 'Find Nearby Hospitals' : 'Search District'}</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Regional Hub Chips */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
            Karnataka Revenue Districts:
          </span>
          {[
            { label: 'Bengaluru Urban', district: 'Bengaluru Urban' },
            { label: 'Ballari', district: 'Ballari' },
            { label: 'Mysuru', district: 'Mysuru' },
            { label: 'Dharwad / Hubballi', district: 'Dharwad' },
            { label: 'Davangere', district: 'Davangere' },
            { label: 'Belagavi', district: 'Belagavi' },
            { label: 'Kalaburagi', district: 'Kalaburagi' },
            { label: 'Dakshina Kannada', district: 'Dakshina Kannada' },
          ].map((c) => {
            const isSelected = cityOrArea.toLowerCase().includes(c.district.toLowerCase())
            return (
              <button
                key={c.district}
                type="button"
                onClick={() => {
                  setCityOrArea(c.district)
                  setCoords(null)
                  setSearchMode('manual_city')
                  executeCitySearch(undefined, c.district)
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  isSelected
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-800 border border-slate-200'
                }`}
              >
                🏛️ {c.label}
              </button>
            )
          })}
        </div>

        {/* Radius Slider & Sort Controls */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
          {/* Distance Slider */}
          <div className="flex items-center gap-2.5">
            <span className="font-bold text-slate-600">Travel Radius:</span>
            <input
              type="range"
              min="5"
              max="75"
              step="5"
              value={maxDistanceKm}
              onChange={(e) => {
                const newRadius = Number(e.target.value)
                setMaxDistanceKm(newRadius)
                if (searchMode === 'nearby_gps' && coords) {
                  executeNearbySearch(coords, newRadius)
                }
              }}
              className="w-28 sm:w-36 accent-sky-600 cursor-pointer"
            />
            <span className="font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">
              {maxDistanceKm} km ({Math.round(maxDistanceKm * 0.621371)} miles)
            </span>
            <span className="text-[10px] text-slate-400 font-medium">(Straight-line Haversine)</span>
          </div>

          {/* Sort Criteria */}
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-600">Sort by:</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setSortBy('distance')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  sortBy === 'distance' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Nearest First
              </button>
              <button
                type="button"
                onClick={() => setSortBy('cost')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  sortBy === 'cost' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Published Fee
              </button>
              <button
                type="button"
                onClick={() => setSortBy('rating')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  sortBy === 'rating' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Evidence Trust
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Informational Scope Notice */}
      <div className="text-[11px] text-slate-600 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          ℹ️ <strong>Auditor Transparency:</strong> Straight-line distances are computed using the Haversine great-circle formula.
          Directory completeness indicates metadata availability in the Karnataka hospital registry; it is not a clinical quality rating.
        </div>
        <div className="shrink-0 text-[10px] text-slate-400 font-medium">
          Haversine &bull; Validated ML Dataset &bull; Overpass Fallback
        </div>
      </div>

      {/* Errors */}
      {searchError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <strong>Search Error:</strong> {searchError}
        </div>
      )}
      {nearbyError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <strong>Nearby Hospital Error:</strong> {nearbyError}
        </div>
      )}

      {/* Interactive Map Section (Integrated Stage 2) */}
      {showMap && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-in fade-in space-y-0">
          <div className="p-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span>🗺️</span>
              <span className="font-bold">
                OpenStreetMap &bull; {activeMapHospital?.name || 'Interactive Hospital Map'}
              </span>
              {activeMapHospital?.distance_km !== undefined && activeMapHospital.distance_km !== null && (
                <span className="px-2 py-0.5 rounded bg-sky-600 text-white font-black text-[10px]">
                  {activeMapHospital.distance_km} km away
                </span>
              )}
            </div>
            {coords && (
              <span className="text-[10px] text-emerald-300 font-bold">
                📍 User GPS: ({coords.lat.toFixed(4)}, {coords.lon.toFixed(4)})
              </span>
            )}
            <span className="text-[10px] text-slate-400">
              Tiles &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a>
            </span>
          </div>

          <div className="w-full h-80 sm:h-96 relative bg-slate-100">
            {activeMapHospital ? (
              <iframe
                title="Hospital Location Map"
                width="100%"
                height="100%"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${activeMapHospital.lon - 0.04}%2C${activeMapHospital.lat - 0.03}%2C${activeMapHospital.lon + 0.04}%2C${activeMapHospital.lat + 0.03}&layer=mapnik&marker=${activeMapHospital.lat}%2C${activeMapHospital.lon}`}
                className="w-full h-full border-0"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                Select a hospital below to center on map coordinates.
              </div>
            )}
          </div>

          {/* Quick Hospital Selector Carousel below map */}
          {searchMode === 'nearby_gps' && nearbyResponse?.hospitals && nearbyResponse.hospitals.length > 0 && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 overflow-x-auto flex items-center gap-2 text-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0 mr-1">
                Map Markers:
              </span>
              {nearbyResponse.hospitals.map((h) => {
                const isSelected = selectedNearbyHospital?.id === h.id
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedNearbyHospital(h)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span>🏥</span>
                    <span className="truncate max-w-[140px]">{h.name}</span>
                    <span className={`text-[10px] font-black ${isSelected ? 'text-sky-100' : 'text-sky-700'}`}>
                      {h.distance_km} km
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Results Section */}
      {searchMode === 'nearby_gps' ? (
        // ====================================================================
        // STAGE 2: NEARBY GPS HOSPITALS VIEW
        // ====================================================================
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <span>Nearby Hospitals</span>
                <span className="text-xs font-semibold text-slate-500">
                  ({nearbyResponse?.count || 0} within {maxDistanceKm} km
                  {nearbyResponse?.resolved_district ? ` in ${nearbyResponse.resolved_district}` : ''})
                </span>
              </h2>
              {nearbyResponse?.warning && (
                <p className="text-xs text-amber-700 mt-0.5">{nearbyResponse.warning}</p>
              )}
            </div>
            {nearbyResponse && (
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200">
                  ML Dataset: {nearbyResponse.karnataka_dataset_count}
                </span>
                {nearbyResponse.osm_fallback_count > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 font-semibold border border-sky-200">
                    OSM Fallback: {nearbyResponse.osm_fallback_count}
                  </span>
                )}
              </div>
            )}
          </div>

          {nearbyLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-5 rounded-2xl bg-white border border-slate-200 animate-pulse space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-16 bg-slate-50 rounded" />
                </div>
              ))}
            </div>
          ) : nearbyResponse?.hospitals && nearbyResponse.hospitals.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {nearbyResponse.hospitals.map((hosp) => {
                const isSelected = selectedNearbyHospital?.id === hosp.id
                const isMLSource = hosp.data_source.includes('Karnataka')

                return (
                  <div
                    key={hosp.id}
                    onClick={() => setSelectedNearbyHospital(hosp)}
                    className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-sky-500 shadow-md ring-2 ring-sky-200'
                        : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div>
                      {/* Top Row: Name, Distance & District */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            {/* Source Badge */}
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-bold ${
                                isMLSource
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                              }`}
                            >
                              {isMLSource ? 'Karnataka ML Dataset' : 'OpenStreetMap Fallback'}
                            </span>

                            {/* Category Badge */}
                            {hosp.category && (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700">
                                {hosp.category.toLowerCase().includes('govt') || hosp.category.toLowerCase().includes('government')
                                  ? '🏛️ Government'
                                  : hosp.category.toLowerCase().includes('trust')
                                  ? '🤝 Trust'
                                  : '🏢 Private'}
                              </span>
                            )}

                            {/* Care Type */}
                            {hosp.care_type && (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                                {hosp.care_type}
                              </span>
                            )}
                          </div>

                          <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                            {hosp.name}
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            📍 {hosp.district}
                            {hosp.pincode ? ` &bull; PIN: ${hosp.pincode}` : ''}
                            {hosp.established_year ? ` &bull; Est. ${hosp.established_year}` : ''}
                          </p>
                        </div>

                        {/* Calculated Haversine Distance Badge */}
                        <div className="text-right shrink-0 bg-sky-50 px-3 py-1.5 rounded-xl border border-sky-200">
                          <div className="text-sm font-black text-sky-950 leading-none">
                            {hosp.distance_km} km
                          </div>
                          <div className="text-[9px] text-sky-700 font-medium mt-0.5">
                            {hosp.distance_miles} mi (Haversine)
                          </div>
                        </div>
                      </div>

                      {/* Directory Evidence Completeness Badge (Requirement 5) */}
                      {hosp.evidence_completeness_percentage !== null &&
                        hosp.evidence_completeness_percentage !== undefined && (
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 my-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                Directory Evidence Completeness
                              </span>
                              <span className="text-xs font-black text-sky-700">
                                {hosp.evidence_completeness_percentage}% ({hosp.completeness_category || 'Scored'})
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1.5">
                              <div
                                className="bg-sky-600 h-full rounded-full transition-all"
                                style={{ width: `${Math.min(100, Math.max(0, hosp.evidence_completeness_percentage))}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-slate-400 block mt-1">
                              Directory metadata availability only; not clinical quality or patient safety.
                            </span>
                          </div>
                        )}

                      {/* Specialties */}
                      {hosp.specialties && hosp.specialties.length > 0 && (
                        <div className="my-2.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Specialties:
                          </span>
                          <div className="flex flex-wrap items-center gap-1">
                            {hosp.specialties.slice(0, 6).map((spec, sIdx) => (
                              <span
                                key={sIdx}
                                className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 text-sky-900 border border-sky-100"
                              >
                                {spec}
                              </span>
                            ))}
                            {hosp.specialties.length > 6 && (
                              <span className="text-[10px] text-slate-400 font-medium">
                                +{hosp.specialties.length - 6} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Emergency Services info */}
                      {hosp.emergency_services && (
                        <div className="text-[11px] text-slate-600 my-2">
                          <strong className="text-slate-800">Emergency:</strong> {hosp.emergency_services}
                        </div>
                      )}

                      {/* Live Doctor & Nurse Staffing Badge */}
                      <HospitalAvailabilityBadge availability={availabilityMap[hosp.id]} />
                    </div>

                    {/* Footer Actions: Contact, Directions, SOS */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSosTargetHospitalId(hosp.id)
                            setIsSosModalOpen(true)
                            setActiveSosTracking(null)
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                          title="Send Emergency SOS distress alert to this hospital"
                        >
                          <span>🚨</span>
                          <span>Emergency SOS</span>
                        </button>

                        {hosp.phone && (
                          <a
                            href={`tel:${hosp.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <span>📞</span>
                            <span>{hosp.phone}</span>
                          </a>
                        )}
                        {hosp.mobile && !hosp.phone && (
                          <a
                            href={`tel:${hosp.mobile}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <span>📱</span>
                            <span>{hosp.mobile}</span>
                          </a>
                        )}
                        {hosp.website && (
                          <a
                            href={hosp.website.startsWith('http') ? hosp.website : `https://${hosp.website}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <span>🌐</span>
                            <span>Website</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveTab('schemes')
                            if (!schemesCatalog) fetchSchemesCatalog()
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200 transition-colors flex items-center gap-1"
                        >
                          <span>🏛️</span>
                          <span>Govt Schemes</span>
                        </button>
                      </div>

                      {hosp.directions_url && (
                        <a
                          href={hosp.directions_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold transition-colors flex items-center gap-1 shrink-0 shadow-xs"
                        >
                          <span>🧭</span>
                          <span>Directions</span>
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-4">
              <span className="text-3xl block">🏥</span>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  No Hospitals Found Within {maxDistanceKm} km
                </h3>
                <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed mt-1">
                  No registered medical facilities with valid coordinates were found within {maxDistanceKm} km of your location.
                  EvidenceBridge strictly adheres to your travel radius and never substitutes hospitals from distant regions.
                </p>
              </div>

              {/* Actionable Suggestions */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {maxDistanceKm < 50 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMaxDistanceKm(50)
                      if (coords) executeNearbySearch(coords, 50)
                    }}
                    className="px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold transition-colors"
                  >
                    Expand Radius to 50 km &rarr;
                  </button>
                )}
                {maxDistanceKm < 75 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMaxDistanceKm(75)
                      if (coords) executeNearbySearch(coords, 75)
                    }}
                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs"
                  >
                    Expand Radius to 75 km &rarr;
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        // ====================================================================
        // LEGACY / MANUAL DISTRICT & REGISTRY SEARCH VIEW
        // ====================================================================
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              Available Hospitals{' '}
              <span className="text-xs font-semibold text-slate-500">
                ({searchResponse?.total_results || 0} found in {searchResponse?.query_city || 'target region'})
              </span>
            </h2>
            {searchResponse?.search_coordinates && (
              <span className="text-xs text-slate-400">
                Straight-line distances from coordinates ({searchResponse.search_coordinates.lat.toFixed(2)}, {searchResponse.search_coordinates.lon.toFixed(2)})
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-5 rounded-2xl bg-white border border-slate-200 animate-pulse space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-16 bg-slate-50 rounded" />
                </div>
              ))}
            </div>
          ) : searchResponse?.hospitals && searchResponse.hospitals.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {searchResponse.hospitals.map((hosp) => {
                const isSelected = selectedHospital?.id === hosp.id
                const isPricesExpanded = !!expandedPrices[hosp.id]

                return (
                  <div
                    key={hosp.id}
                    onClick={() => setSelectedHospital(hosp)}
                    className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-sky-500 shadow-md ring-2 ring-sky-200'
                        : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div>
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <span className="inline-block px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide bg-slate-100 text-slate-700">
                              {hosp.facility_type}
                            </span>
                            <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                              {hosp.country === 'IN' ? '🇮🇳 India' : hosp.country === 'US' ? '🇺🇸 USA' : hosp.country}
                            </span>
                            <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                              Source: {hosp.data_source}
                            </span>
                          </div>
                          <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                            {hosp.name}
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {hosp.neighborhood ? `${hosp.neighborhood} &bull; ` : ''}
                            {hosp.address}
                          </p>
                        </div>

                        {/* Straight-line Distance Pill */}
                        {hosp.distance_km !== undefined && hosp.distance_km !== null && (
                          <div className="text-right shrink-0 bg-sky-50 px-2.5 py-1.5 rounded-xl border border-sky-100">
                            <div className="text-xs font-black text-sky-900 leading-none">
                              {hosp.distance_km} km
                            </div>
                            <div className="text-[9px] text-sky-700 font-medium mt-0.5">
                              {hosp.distance_miles} mi (Straight-line)
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Why this hospital appears */}
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 my-3">
                        <strong className="text-slate-900 font-bold block text-[10px] uppercase tracking-wider mb-0.5">
                          Why this hospital appears in your results:
                        </strong>
                        <p className="text-[11px] leading-relaxed text-slate-600">{hosp.why_appears}</p>
                      </div>

                      {/* Pricing Section */}
                      <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 my-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 block">
                              Published Consultation Fee
                            </span>
                            {hosp.price_available && hosp.consultation_fee !== null && hosp.consultation_fee !== undefined ? (
                              <div className="flex items-baseline gap-1.5 mt-0.5">
                                <span className="text-lg font-black text-emerald-950">
                                  {formatCurrency(hosp.consultation_fee, hosp.consultation_fee_currency)}
                                </span>
                                <span className="text-[10px] text-emerald-800 font-medium">
                                  ({hosp.price_type})
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mt-1 italic">
                                <span>ℹ️</span>
                                <span>Price data not available</span>
                              </div>
                            )}
                          </div>

                          {hosp.procedure_prices && hosp.procedure_prices.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                togglePriceExpansion(hosp.id)
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-[11px] font-bold transition-colors"
                            >
                              {isPricesExpanded ? 'Hide Procedures' : `View Procedures (${hosp.procedure_prices.length})`}
                            </button>
                          )}
                        </div>

                        {hosp.consultation_fee_source && (
                          <p className="text-[10px] text-emerald-800/80 mt-1 leading-tight">
                            Source: {hosp.consultation_fee_source}
                          </p>
                        )}

                        {isPricesExpanded && hosp.procedure_prices.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-emerald-200 space-y-2 animate-in fade-in">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block">
                              Published Procedure &amp; Test Benchmarks:
                            </span>
                            {hosp.procedure_prices.map((p, idx) => (
                              <div key={idx} className="p-2 rounded-lg bg-white border border-emerald-200 text-xs">
                                <div className="flex items-center justify-between font-bold text-slate-800">
                                  <span>{p.service_name}</span>
                                  <span className="text-emerald-900 font-extrabold">
                                    {formatCurrency(p.min_price, p.currency)} &ndash; {formatCurrency(p.max_price, p.currency)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                                  <span>CPT: {p.cpt_code || 'Standard OPD'}</span>
                                  <span>Source: {p.source}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Local Trust & Accreditations */}
                      <div className="grid grid-cols-2 gap-2 my-3 text-xs">
                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                            Public Rating
                          </span>
                          {hosp.public_rating ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-sm font-extrabold text-amber-500">
                                ★ {hosp.public_rating.toFixed(1)}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                ({hosp.review_count?.toLocaleString()} reviews)
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">Rating unavailable</span>
                          )}
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                            EvidenceBridge Trust
                          </span>
                          {hosp.trust_score ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-sm font-extrabold text-sky-700">
                                {Math.round(hosp.trust_score * 100)}%
                              </span>
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                                Verified
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Score calculating</span>
                          )}
                        </div>
                      </div>

                      {hosp.accreditations && hosp.accreditations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 my-2">
                          {hosp.accreditations.map((acc, aIdx) => (
                            <span
                              key={aIdx}
                              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-900 border border-sky-200"
                            >
                              ✓ {acc}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Live Doctor & Nurse Staffing Badge */}
                      <HospitalAvailabilityBadge availability={availabilityMap[hosp.id]} />
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSosTargetHospitalId(hosp.id)
                            setIsSosModalOpen(true)
                            setActiveSosTracking(null)
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                          title="Send Emergency SOS distress alert to this hospital"
                        >
                          <span>🚨</span>
                          <span>Emergency SOS</span>
                        </button>

                        {hosp.phone && (
                          <a
                            href={`tel:${hosp.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <span>📞</span>
                            <span>Call</span>
                          </a>
                        )}
                        {hosp.website && (
                          <a
                            href={hosp.website}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors flex items-center gap-1"
                          >
                            <span>🌐</span>
                            <span>Website</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveTab('schemes')
                            if (!schemesCatalog) fetchSchemesCatalog()
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200 transition-colors flex items-center gap-1"
                        >
                          <span>🏛️</span>
                          <span>Govt Schemes</span>
                        </button>
                      </div>

                      {hosp.directions_url && (
                        <a
                          href={hosp.directions_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold transition-colors flex items-center gap-1"
                        >
                          <span>🧭</span>
                          <span>Directions</span>
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-4">
              <span className="text-3xl block">🏥</span>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  No Hospitals Found Within {maxDistanceKm} km
                </h3>
                <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed mt-1">
                  No registered medical facilities were found within {maxDistanceKm} km of{' '}
                  <strong>{searchResponse?.query_city || cityOrArea}</strong>.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* ====================================================================
         FEATURE 1: MANAGE AVAILABILITY VIEW (Hospital Staff Desk)
         ==================================================================== */}
      {activeTab === ('manage_availability' as any) && (
        <div className="space-y-6 animate-in fade-in">
          {/* Header & Desk Profile */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-orange-50 via-amber-50/60 to-white border border-orange-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-orange-100 text-orange-800 border border-orange-200">
                  Hospital Management Desk
                </span>
                <span className="text-xs text-slate-500 font-medium">FastAPI &bull; MongoDB Real-Time Sync</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Manage Hospital Live Availability
              </h2>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                Update real-time clinical staffing and hospital capacity status. Updates are saved to MongoDB and immediately visible to citizens and emergency dispatchers.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-slate-500">Authorized Desk:</span>
              <span className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-800 shadow-2xs">
                {user?.name || 'Shree Medical Institute'}
              </span>
            </div>
          </div>

          {/* Form Card */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Select Hospital */}
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Select Hospital Facility
                </label>
                <select
                  value={selectedMgmtHospitalId}
                  onChange={(e) => {
                    const newId = e.target.value
                    setSelectedMgmtHospitalId(newId)
                    const existing = availabilityMap[newId]
                    if (existing) {
                      setMgmtDoctors(existing.doctors_available)
                      setMgmtEmergencyDoctors(existing.emergency_doctors)
                      setMgmtNurses(existing.nurses_available)
                      setMgmtDutyStatus(existing.duty_status)
                      setMgmtNotes(existing.notes || '')
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold bg-white text-slate-900 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                >
                  {MANAGED_HOSPITALS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} — {h.district}
                    </option>
                  ))}
                </select>
              </div>

              {/* Staffing Counts Grid */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Total Doctors Currently Available
                </label>
                <input
                  type="number"
                  min="0"
                  value={mgmtDoctors}
                  onChange={(e) => setMgmtDoctors(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-base font-black text-slate-900 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">Across all general OPD and inpatient wards</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-rose-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <span>🚨</span> Emergency Doctors On Duty
                </label>
                <input
                  type="number"
                  min="0"
                  value={mgmtEmergencyDoctors}
                  onChange={(e) => setMgmtEmergencyDoctors(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-rose-300 bg-rose-50/30 text-base font-black text-rose-700 focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">Dedicated ER, Casualty, and Trauma specialists</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Nurses Currently Available
                </label>
                <input
                  type="number"
                  min="0"
                  value={mgmtNurses}
                  onChange={(e) => setMgmtNurses(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-base font-black text-slate-900 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">Staff nurses on active duty in ER, ICU, and wards</p>
              </div>

              {/* Duty Status Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Hospital Duty Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { status: 'Accepting Patients', color: 'emerald', icon: '🟢', label: 'Accepting' },
                    { status: 'Limited', color: 'amber', icon: '🟡', label: 'Limited' },
                    { status: 'Unavailable', color: 'rose', icon: '🔴', label: 'Unavailable' },
                  ].map((s) => (
                    <button
                      key={s.status}
                      type="button"
                      onClick={() => setMgmtDutyStatus(s.status)}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center flex flex-col items-center gap-1 cursor-pointer ${
                        mgmtDutyStatus === s.status
                          ? s.color === 'emerald'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : s.color === 'amber'
                            ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                            : 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                      }`}
                    >
                      <span className="text-sm">{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Broadcasted in real time to emergency triage desk</p>
              </div>

              {/* Operational / Triage Notes */}
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Triage / Operational Notes (Optional)
                </label>
                <input
                  type="text"
                  value={mgmtNotes}
                  onChange={(e) => setMgmtNotes(e.target.value)}
                  placeholder="e.g. Trauma Bay 2 operational; 4 ICU beds vacant; CT scanner functional"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Feedback Message */}
            {mgmtFeedback && (
              <div
                className={`p-3 rounded-xl text-xs font-bold border flex items-center justify-between animate-in fade-in ${
                  mgmtFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                <span>{mgmtFeedback.message}</span>
                <button
                  type="button"
                  onClick={() => setMgmtFeedback(null)}
                  className="text-xs hover:opacity-75 cursor-pointer font-black"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Current record: {availabilityMap[selectedMgmtHospitalId] ? `Updated ${new Date(availabilityMap[selectedMgmtHospitalId].last_updated).toLocaleTimeString()}` : 'No previous update logged'}
              </span>
              <button
                type="button"
                disabled={isSavingAvailability}
                onClick={handleSaveAvailability}
                className="px-6 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-extrabold shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                {isSavingAvailability ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving to MongoDB...</span>
                  </>
                ) : (
                  <>
                    <span>💾</span>
                    <span>Save Availability Status</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
         PATIENT EMERGENCY SOS MODAL & LIVE TRACKER
         ==================================================================== */}
      {isSosModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-transparent flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150">
            {/* Close */}
            <button
              type="button"
              onClick={() => {
                setIsSosModalOpen(false)
                setActiveSosTracking(null)
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-sm font-bold cursor-pointer"
            >
              ✕
            </button>

            {activeSosTracking ? (
              /* Live Status Tracker */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">SOS Distress Call Active</h3>
                    <p className="text-xs text-slate-500">Tracking dispatch status in real time</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Distress ID:</span>
                    <span className="font-mono font-bold text-slate-900">{activeSosTracking.sos_id}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Hospital Alerted:</span>
                    <span className="font-black text-slate-900">{activeSosTracking.hospital_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Emergency Type:</span>
                    <span className="font-bold text-rose-700">{activeSosTracking.emergency_type}</span>
                  </div>

                  {/* Stepper */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    {[
                      { step: 'PENDING', label: '1. Distress Transmitted to Triage', active: true },
                      {
                        step: 'ACKNOWLEDGED',
                        label: '2. Hospital Staff Acknowledged Call',
                        active: activeSosTracking.status === 'ACKNOWLEDGED' || activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESPONDING',
                        label: '3. Emergency Response Team En Route',
                        active: activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESOLVED',
                        label: '4. Emergency Case Resolved',
                        active: activeSosTracking.status === 'RESOLVED',
                      },
                    ].map((st, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                            st.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {st.active ? '✓' : idx + 1}
                        </span>
                        <span className={`font-bold ${st.active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {st.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <span>ℹ️</span>
                  <span>
                    Keep your phone line open. The emergency triage desk may call you at{' '}
                    <strong>{activeSosTracking.patient_phone}</strong>.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="tel:112"
                    className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black text-center shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>📞</span>
                    <span>Call India Emergency 112</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSosModalOpen(false)
                      setActiveSosTracking(null)
                    }}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Close Tracker
                  </button>
                </div>
              </div>
            ) : (
              /* SOS Distress Form */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Emergency SOS Distress Alert</h3>
                    <p className="text-xs text-slate-500">Transmits immediate alert to hospital triage desk</p>
                  </div>
                </div>

                {/* Emergency Type Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Emergency Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'Accident / Trauma', label: 'Accident / Trauma', icon: '💥' },
                      { id: 'Breathing Difficulty', label: 'Breathing Difficulty', icon: '🫁' },
                      { id: 'Chest Pain', label: 'Chest Pain / Cardiac', icon: '❤️' },
                      { id: 'Other Emergency', label: 'Other Critical Emergency', icon: '⚠️' },
                    ].map((em) => (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => setSosEmergencyType(em.id)}
                        className={`p-2.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition-all cursor-pointer ${
                          sosEmergencyType === em.id
                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span className="text-lg">{em.icon}</span>
                        <span className="leading-tight">{em.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Hospital Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Alert Target Hospital
                  </label>
                  <select
                    value={sosTargetHospitalId}
                    onChange={(e) => setSosTargetHospitalId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold bg-white text-slate-900"
                  >
                    {MANAGED_HOSPITALS.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.district})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Patient Name & Phone */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Patient / Bystander Name
                    </label>
                    <input
                      type="text"
                      value={sosPatientName}
                      onChange={(e) => setSosPatientName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="text"
                      value={sosPatientPhone}
                      onChange={(e) => setSosPatientPhone(e.target.value)}
                      placeholder="+91 98450 12345"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                </div>

                {/* GPS Location Permission */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Location Sharing (GPS)
                    </label>
                    {sosCoords ? (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <span>✓</span> Acquired ({sosCoords.lat.toFixed(3)}°, {sosCoords.lon.toFixed(3)}°)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Optional</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestSosLocation}
                    disabled={sosLocating}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📍</span>
                    <span>{sosLocating ? 'Acquiring GPS...' : sosCoords ? 'Update GPS Location' : 'Share Current GPS Location'}</span>
                  </button>
                </div>

                {/* Condition Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Condition / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={sosDescription}
                    onChange={(e) => setSosDescription(e.target.value)}
                    placeholder="Brief description of patient condition or immediate assistance needed..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium resize-none"
                  />
                </div>

                {/* Direct 112 Call Banner */}
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
                  <div className="text-xs text-rose-950 font-medium">
                    <strong className="block text-rose-900 font-bold">Life-Threatening Emergency?</strong>
                    Call India Emergency Services immediately.
                  </div>
                  <a
                    href="tel:112"
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-black whitespace-nowrap shrink-0 flex items-center gap-1"
                  >
                    <span>📞</span>
                    <span>Call 112</span>
                  </a>
                </div>

                {sosError && (
                  <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    {sosError}
                  </p>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSos}
                    onClick={handleSubmitSos}
                    className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmittingSos ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Transmitting Distress Call...</span>
                      </>
                    ) : (
                      <>
                        <span>🚨</span>
                        <span>DISPATCH EMERGENCY SOS</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
         FEATURE 2: EMERGENCY SOS DESK VIEW (Hospital Staff Desk)
         ==================================================================== */}
      {activeTab === ('emergency_sos' as any) && (
        <div className="space-y-6 animate-in fade-in">
          {/* Header */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-red-50 via-rose-50 to-white border border-red-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl animate-pulse">🚨</span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Emergency SOS Dispatch Desk
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white animate-pulse">
                  LIVE DISPATCH
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                Real-time incoming distress requests from patients and bystanders. Click "View Clinical Protocol" for authoritative ATLS/ACLS/BLS procedures.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-bold text-slate-700">Polling every 4s</span>
              <button
                type="button"
                onClick={fetchHospitalSos}
                className="ml-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                ↻ Refresh Now
              </button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { id: 'ALL', label: `All Alerts (${sosList.length})` },
              { id: 'PENDING', label: `Pending Triage (${sosList.filter((s) => s.status === 'PENDING').length})` },
              { id: 'RESPONDING', label: `En Route / Responding (${sosList.filter((s) => s.status === 'RESPONDING').length})` },
              { id: 'RESOLVED', label: `Resolved (${sosList.filter((s) => s.status === 'RESOLVED').length})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSosFilter(f.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  sosFilter === f.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* SOS List */}
          {sosList.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <span className="text-4xl block">🛡️</span>
              <h3 className="text-base font-bold text-slate-800">No active SOS emergency requests</h3>
              <p className="text-xs text-slate-500">
                Incoming distress calls routed to {MANAGED_HOSPITALS.find((h) => h.id === selectedMgmtHospitalId)?.name || 'this hospital'} will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sosList
                .filter((s) => (sosFilter === 'ALL' ? true : s.status === sosFilter))
                .map((sos) => {
                  const isPending = sos.status === 'PENDING'
                  const isAck = sos.status === 'ACKNOWLEDGED'
                  const isResp = sos.status === 'RESPONDING'
                  const isRes = sos.status === 'RESOLVED'

                  return (
                    <div
                      key={sos.sos_id}
                      className={`p-5 rounded-2xl border transition-all ${
                        isPending
                          ? 'bg-rose-50/70 border-rose-300 shadow-sm ring-1 ring-rose-200'
                          : isResp
                          ? 'bg-sky-50/60 border-sky-300 shadow-sm'
                          : isAck
                          ? 'bg-amber-50/60 border-amber-300 shadow-sm'
                          : 'bg-white border-slate-200 opacity-80'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
                              isPending
                                ? 'bg-rose-600 text-white animate-pulse'
                                : isResp
                                ? 'bg-sky-600 text-white'
                                : isAck
                                ? 'bg-amber-500 text-white'
                                : 'bg-emerald-600 text-white'
                            }`}
                          >
                            {sos.status}
                          </span>

                          <span className="text-sm font-black text-slate-900">
                            {sos.emergency_type}
                          </span>

                          <span className="text-xs text-slate-500 font-mono">
                            ID: {sos.sos_id}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500 font-medium">
                          Received: {new Date(sos.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ({new Date(sos.created_at).toLocaleDateString()})
                        </div>
                      </div>

                      {/* Details Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-3 text-xs">
                        <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Patient / Caller
                          </span>
                          <div className="font-extrabold text-slate-900 text-sm">
                            {sos.patient_name}
                          </div>
                          <a
                            href={`tel:${sos.patient_phone}`}
                            className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800 font-bold mt-1"
                          >
                            <span>📞</span>
                            <span>{sos.patient_phone}</span>
                          </a>
                        </div>

                        <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Location &amp; Coordinates
                          </span>
                          {sos.latitude && sos.longitude ? (
                            <div>
                              <div className="font-mono text-slate-800 font-bold text-xs">
                                {sos.latitude.toFixed(4)}°, {sos.longitude.toFixed(4)}°
                              </div>
                              <a
                                href={`https://www.google.com/maps?q=${sos.latitude},${sos.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 mt-1 underline"
                              >
                                <span>📍 Open in Google Maps</span>
                              </a>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No GPS coordinates shared</span>
                          )}
                          {sos.address && (
                            <div className="text-[11px] text-slate-600 mt-1">{sos.address}</div>
                          )}
                        </div>

                        <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Description / Symptoms
                          </span>
                          <p className="text-slate-800 font-medium line-clamp-3">
                            {sos.description || 'No additional condition details provided.'}
                          </p>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                        {/* Clinical Protocol Button */}
                        <button
                          type="button"
                          onClick={() => setSelectedProtocolRecord(sos)}
                          className="px-3.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <span>📋</span>
                          <span>View Clinical Protocol ({sos.clinical_protocol?.protocol_name?.slice(0, 24) || 'ATLS/ACLS'}...)</span>
                        </button>

                        {/* Status Transition Buttons */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isPending && (
                            <button
                              type="button"
                              onClick={() => handleUpdateSosStatus(sos.sos_id, 'ACKNOWLEDGED')}
                              className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black shadow-xs transition-all cursor-pointer"
                            >
                              ✓ Acknowledge Alert
                            </button>
                          )}

                          {(isPending || isAck) && (
                            <button
                              type="button"
                              onClick={() => handleUpdateSosStatus(sos.sos_id, 'RESPONDING')}
                              className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-black shadow-xs transition-all cursor-pointer flex items-center gap-1"
                            >
                              <span>🚑</span>
                              <span>Dispatch Team / Mark Responding</span>
                            </button>
                          )}

                          {!isRes && (
                            <button
                              type="button"
                              onClick={() => handleUpdateSosStatus(sos.sos_id, 'RESOLVED')}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                            >
                              Mark Resolved
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'cost_comparison' && (
        /* ====================================================================
           STAGE 3: TREATMENT COST INFORMATION & PRICE COMPARISON VIEW
           ==================================================================== */
        <div className="space-y-6 animate-in fade-in">
          {/* Header & Attribution Card */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-amber-50/70 via-sky-50/50 to-white border border-amber-200 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-200">
                    Stage 3 &bull; Treatment Package Cost Estimation
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                    RandomForestRegressor
                  </span>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  Treatment Package Cost &amp; Price Benchmark Comparison
                </h2>
                <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  Predict procedure package costs using the external Karnataka ML regression model and compare against
                  official hospital published tariffs, subsidized government health schedules, and national statutory price ceilings.
                </p>
              </div>

              {/* Attribution Callout Box */}
              <div className="p-3.5 rounded-xl bg-amber-100/60 border border-amber-300 text-right shrink-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-900 block">
                  Attributed Facility
                </span>
                <span className="text-sm font-extrabold text-slate-900 block">
                  Sakhii Hospital
                </span>
                <span className="text-[10px] text-slate-600 font-medium block">
                  Bengaluru &bull; Experimental Model
                </span>
              </div>
            </div>

            {/* Strict Attribution & Auditor Transparency Alert */}
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <span className="text-base shrink-0 mt-0.5">⚠️</span>
              <div className="leading-relaxed">
                <strong>Auditor Transparency &amp; Model Scope Constraint:</strong> This machine learning cost estimation model was
                trained exclusively on published package tariffs from <strong>Sakhii Hospital (Bengaluru)</strong>. It is
                an <strong>experimental prototype</strong> and must <strong>never</strong> be attributed to or extrapolated
                to other hospitals or unverified procedures. Published benchmarks from other institutions below are presented
                strictly for independent comparative context without price fabrication.
              </div>
            </div>
          </div>

          {/* Interactive Cost Estimation Form Card */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-5">
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <span>🩺</span>
              <span>Select Procedure Package &amp; Room Tier</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {/* Package Selector */}
              <div className="md:col-span-6">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Treatment / Procedure Package (Sakhii Hospital Tariff)
                </label>
                <select
                  value={selectedPackage}
                  onChange={(e) => {
                    const newPkg = e.target.value
                    setSelectedPackage(newPkg)
                    executeCostPrediction(newPkg, selectedRoomCategory)
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                >
                  {/* Obstetrics & Maternity */}
                  <optgroup label="Obstetrics &amp; Maternity Packages">
                    {(costCatalog?.supported_packages || DEFAULT_TREATMENT_PACKAGES)
                      .filter((p) => p.category.includes('Obstetrics') || p.category.includes('Maternity'))
                      .map((p) => (
                        <option key={p.package_name} value={p.package_name}>
                          {p.package_name} (Sakhii Published Ref: ₹{p.published_prices_inr?.[selectedRoomCategory]?.toLocaleString('en-IN') || 'Quoted'})
                        </option>
                      ))}
                  </optgroup>

                  {/* Gynecological Surgery */}
                  <optgroup label="Gynecological Surgery Packages">
                    {(costCatalog?.supported_packages || DEFAULT_TREATMENT_PACKAGES)
                      .filter((p) => !p.category.includes('Obstetrics') && !p.category.includes('Maternity'))
                      .map((p) => (
                        <option key={p.package_name} value={p.package_name}>
                          {p.package_name} (Sakhii Published Ref: ₹{p.published_prices_inr?.[selectedRoomCategory]?.toLocaleString('en-IN') || 'Quoted'})
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>

              {/* Room Category Buttons */}
              <div className="md:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Room Accommodation Tier
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['Private', 'Deluxe', 'Suite'].map((room) => {
                    const isSelected = selectedRoomCategory === room
                    return (
                      <button
                        key={room}
                        type="button"
                        onClick={() => {
                          setSelectedRoomCategory(room)
                          executeCostPrediction(selectedPackage, room)
                        }}
                        className={`py-2 px-2 rounded-xl text-xs font-bold transition-all text-center border ${
                          isSelected
                            ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        {room}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Action Button */}
              <div className="md:col-span-2 flex items-end">
                <button
                  type="button"
                  onClick={() => executeCostPrediction()}
                  disabled={costLoading}
                  className="w-full py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  {costLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Estimating...</span>
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>Calculate</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {costError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <span>⚠️</span>
                <div>
                  <strong>Cost Prediction Notice:</strong> {costError}
                </div>
              </div>
            )}

            {/* Warning Message */}
            {costWarning && (
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <span>ℹ️</span>
                <div>{costWarning}</div>
              </div>
            )}

            {/* Prediction Output KPI Section */}
            {costPrediction && (
              <div className="pt-4 border-t border-slate-100 space-y-4 animate-in fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                      Model Prediction Output:
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                      Sakhii Hospital &bull; {costPrediction.package} &bull; {costPrediction.room_category} Tier
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Status: <strong className="text-emerald-700 font-extrabold">{costPrediction.model_status || 'Experimental'}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Box 1: Published Reference Tariff */}
                  <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 block">
                      Published Reference Tariff
                    </span>
                    <div className="text-2xl font-black text-emerald-950 mt-1">
                      ₹{costPrediction.published_reference_price_inr?.toLocaleString('en-IN') || '0'}
                    </div>
                    <span className="text-[10px] text-emerald-700 font-medium block mt-1">
                      Official published tariff (Sakhii Hospital)
                    </span>
                  </div>

                  {/* Box 2: ML Model Estimate */}
                  <div className="p-4 rounded-2xl bg-sky-50/80 border border-sky-200">
                    <span className="text-[10px] font-black uppercase tracking-wider text-sky-800 block">
                      Experimental ML Estimate
                    </span>
                    <div className="text-2xl font-black text-sky-950 mt-1">
                      ₹{costPrediction.experimental_ml_estimate_inr?.toLocaleString('en-IN') || '0'}
                    </div>
                    <span className="text-[10px] text-sky-700 font-medium block mt-1">
                      RandomForestRegressor predicted value
                    </span>
                  </div>

                  {/* Box 3: Variance / Difference */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 block">
                      Model Prediction Variance
                    </span>
                    <div className="text-2xl font-black text-slate-900 mt-1 flex items-baseline gap-1">
                      <span>
                        {costPrediction.difference_inr >= 0 ? '+' : ''}
                        ₹{costPrediction.difference_inr?.toLocaleString('en-IN') || '0'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-medium block mt-1">
                      Variance (ML Estimate &minus; Published Tariff)
                    </span>
                  </div>
                </div>

                {/* Structured Metadata Breakdown Table */}
                <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 bg-slate-50 p-2.5 font-bold text-slate-700 border-b border-slate-200">
                    <div>Attributed Facility</div>
                    <div>Price Classification</div>
                    <div>Karnataka-Wide Scope</div>
                    <div>Package Scope Verified</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 p-2.5 font-medium text-slate-900 bg-white">
                    <div className="font-bold text-amber-900">
                      🏥 {costPrediction.hospital} ({costPrediction.district || 'Bengaluru'})
                    </div>
                    <div>{costPrediction.price_type || 'Published hospital package tariff'}</div>
                    <div>
                      {costPrediction.karnataka_wide_prediction ? (
                        <span className="text-emerald-700 font-bold">Yes (Statewide)</span>
                      ) : (
                        <span className="text-rose-700 font-bold">No (Sakhii Hospital Only)</span>
                      )}
                    </div>
                    <div>
                      {costPrediction.package_scope_verified ? (
                        <span className="text-emerald-700 font-bold">Verified</span>
                      ) : (
                        <span className="text-amber-800 font-bold">Pending Audit Validation</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ====================================================================
              COMPARABLE PRICE BENCHMARKS SECTION
              ==================================================================== */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>📊</span>
                  <span>EvidenceBridge Price Benchmarks &amp; Comparative Tariffs</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Compare published hospital tariffs against government subsidized rates and national statutory price ceilings.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  'All',
                  'Maternity & Obstetrics',
                  'Outpatient Consultation Tariff',
                  'Diagnostic Imaging',
                  'Pathology & Blood Tests',
                  'Essential Inpatient Consumables',
                  'Emergency Visit',
                ].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setBenchmarkFilterCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      benchmarkFilterCategory === cat
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {cat === 'All' ? 'All Benchmarks' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Benchmark Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-2">
              {(costCatalog?.comparable_benchmarks || DEFAULT_COMPARABLE_BENCHMARKS)
                .filter(
                  (b) =>
                    benchmarkFilterCategory === 'All' ||
                    b.category.toLowerCase().includes(benchmarkFilterCategory.toLowerCase())
                )
                .map((bench) => {
                  const isPublished = bench.price_type.includes('Published')
                  const isSubsidized = bench.price_type.includes('Subsidized')
                  const isStatutory = bench.price_type.includes('Ceiling') || bench.price_type.includes('NPPA')

                  return (
                    <div
                      key={bench.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all flex flex-col justify-between space-y-3"
                    >
                      <div>
                        {/* Type & Category Pill */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide ${
                              isStatutory
                                ? 'bg-purple-100 text-purple-900 border border-purple-200'
                                : isSubsidized
                                ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                : isPublished
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                : 'bg-amber-100 text-amber-900 border border-amber-200'
                            }`}
                          >
                            {bench.price_type}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {bench.category}
                          </span>
                        </div>

                        {/* Title */}
                        <h4 className="text-sm font-extrabold text-slate-900 leading-snug">
                          {bench.service_or_procedure}
                        </h4>

                        {/* Hospital / Source */}
                        <p className="text-xs text-slate-600 mt-1 font-semibold flex items-center gap-1">
                          <span>🏛️</span>
                          <span>{bench.hospital_or_source}</span>
                        </p>
                      </div>

                      {/* Pricing Footer */}
                      <div className="pt-2.5 border-t border-slate-200/80">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Benchmark Rate:
                          </span>
                          <span className="text-sm font-black text-slate-950">
                            {bench.price_display}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                          <span className="truncate max-w-[200px]" title={bench.data_source}>
                            Source: {bench.data_source}
                          </span>
                          {bench.last_updated && (
                            <span className="shrink-0">Updated: {bench.last_updated}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Auditor Transparency & Evidence Safety Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-600 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <span>🛡️</span>
                <span>Price Transparency &amp; Medical Disclaimer</span>
              </span>
              <span className="text-[10px] text-slate-500">EvidenceBridge Healthcare Audit Standards</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              {costCatalog?.disclaimer ||
                'Cost predictions are generated by an experimental RandomForestRegressor trained solely on Sakhii Hospital (Bengaluru) tariff data. They must NOT be attributed to or extrapolated to other medical facilities. Published benchmarks reflect official public filings, government subsidized schedules, and statutory price ceilings.'}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-500 pt-1">
              <span>• National Pharmaceutical Pricing Authority (NPPA DPCO Schedules)</span>
              <span>• CGHS &amp; NABL Accredited Diagnostic Tariffs</span>
              <span>• Department of Health &amp; Family Welfare, Government of Karnataka</span>
              <span>• Sakhii Hospital Published Maternity &amp; Surgical Tariff Schedule</span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
         PATIENT EMERGENCY SOS MODAL & LIVE TRACKER
         ==================================================================== */}
      {isSosModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-transparent flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150">
            {/* Close */}
            <button
              type="button"
              onClick={() => {
                setIsSosModalOpen(false)
                setActiveSosTracking(null)
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-sm font-bold cursor-pointer"
            >
              ✕
            </button>

            {activeSosTracking ? (
              /* Live Status Tracker */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">SOS Distress Call Active</h3>
                    <p className="text-xs text-slate-500">Tracking dispatch status in real time</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Distress ID:</span>
                    <span className="font-mono font-bold text-slate-900">{activeSosTracking.sos_id}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Hospital Alerted:</span>
                    <span className="font-black text-slate-900">{activeSosTracking.hospital_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Emergency Type:</span>
                    <span className="font-bold text-rose-700">{activeSosTracking.emergency_type}</span>
                  </div>

                  {/* Stepper */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    {[
                      { step: 'PENDING', label: '1. Distress Transmitted to Triage', active: true },
                      {
                        step: 'ACKNOWLEDGED',
                        label: '2. Hospital Staff Acknowledged Call',
                        active: activeSosTracking.status === 'ACKNOWLEDGED' || activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESPONDING',
                        label: '3. Emergency Response Team En Route',
                        active: activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESOLVED',
                        label: '4. Emergency Case Resolved',
                        active: activeSosTracking.status === 'RESOLVED',
                      },
                    ].map((st, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                            st.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {st.active ? '✓' : idx + 1}
                        </span>
                        <span className={`font-bold ${st.active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {st.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <span>ℹ️</span>
                  <span>
                    Keep your phone line open. The emergency triage desk may call you at{' '}
                    <strong>{activeSosTracking.patient_phone}</strong>.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="tel:112"
                    className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black text-center shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>📞</span>
                    <span>Call India Emergency 112</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSosModalOpen(false)
                      setActiveSosTracking(null)
                    }}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Close Tracker
                  </button>
                </div>
              </div>
            ) : (
              /* SOS Distress Form */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Emergency SOS Distress Alert</h3>
                    <p className="text-xs text-slate-500">Transmits immediate alert to hospital triage desk</p>
                  </div>
                </div>

                {/* Emergency Type Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Emergency Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'Accident / Trauma', label: 'Accident / Trauma', icon: '💥' },
                      { id: 'Breathing Difficulty', label: 'Breathing Difficulty', icon: '🫁' },
                      { id: 'Chest Pain', label: 'Chest Pain / Cardiac', icon: '❤️' },
                      { id: 'Other Emergency', label: 'Other Critical Emergency', icon: '⚠️' },
                    ].map((em) => (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => setSosEmergencyType(em.id)}
                        className={`p-2.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition-all cursor-pointer ${
                          sosEmergencyType === em.id
                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span className="text-lg">{em.icon}</span>
                        <span className="leading-tight">{em.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Hospital Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Alert Target Hospital
                  </label>
                  <select
                    value={sosTargetHospitalId}
                    onChange={(e) => setSosTargetHospitalId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold bg-white text-slate-900"
                  >
                    {MANAGED_HOSPITALS.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.district})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Patient Name & Phone */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Patient / Bystander Name
                    </label>
                    <input
                      type="text"
                      value={sosPatientName}
                      onChange={(e) => setSosPatientName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="text"
                      value={sosPatientPhone}
                      onChange={(e) => setSosPatientPhone(e.target.value)}
                      placeholder="+91 98450 12345"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                </div>

                {/* GPS Location Permission */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Location Sharing (GPS)
                    </label>
                    {sosCoords ? (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <span>✓</span> Acquired ({sosCoords.lat.toFixed(3)}°, {sosCoords.lon.toFixed(3)}°)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Optional</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestSosLocation}
                    disabled={sosLocating}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📍</span>
                    <span>{sosLocating ? 'Acquiring GPS...' : sosCoords ? 'Update GPS Location' : 'Share Current GPS Location'}</span>
                  </button>
                </div>

                {/* Condition Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Condition / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={sosDescription}
                    onChange={(e) => setSosDescription(e.target.value)}
                    placeholder="Brief description of patient condition or immediate assistance needed..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium resize-none"
                  />
                </div>

                {/* Direct 112 Call Banner */}
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
                  <div className="text-xs text-rose-950 font-medium">
                    <strong className="block text-rose-900 font-bold">Life-Threatening Emergency?</strong>
                    Call India Emergency Services immediately.
                  </div>
                  <a
                    href="tel:112"
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-black whitespace-nowrap shrink-0 flex items-center gap-1"
                  >
                    <span>📞</span>
                    <span>Call 112</span>
                  </a>
                </div>

                {sosError && (
                  <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    {sosError}
                  </p>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSos}
                    onClick={handleSubmitSos}
                    className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmittingSos ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Transmitting Distress Call...</span>
                      </>
                    ) : (
                      <>
                        <span>🚨</span>
                        <span>DISPATCH EMERGENCY SOS</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'schemes' && (
        /* ====================================================================
           STAGE 4B: GOVERNMENT HEALTHCARE SCHEMES & FINANCIAL AID VIEW
           ==================================================================== */
        <div className="space-y-6 animate-in fade-in">
          {/* 1. Header & Scheme Selector Banner */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-emerald-50/70 via-teal-50/50 to-white border border-emerald-200 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-950 border border-emerald-200">
                    Stage 4B &bull; Government Healthcare Assistance
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                    Official .gov.in Verified Schedules
                  </span>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  Government Healthcare Schemes &amp; Financial Assistance
                </h2>
                <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  Verified eligibility pathways, co-payment rules, and referral prerequisites for Ayushman Bharat
                  (PM-JAY), Arogya Karnataka (AB-ArK), and the Karnataka Chief Minister&apos;s Relief Fund (CMRF).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200 self-start sm:self-auto shrink-0">
                {(['all', 'pmjay', 'ab_ark', 'cmrf'] as const).map((filter) => {
                  const labels: Record<string, string> = {
                    all: 'All Schemes',
                    pmjay: 'PM-JAY (Central)',
                    ab_ark: 'Arogya Karnataka',
                    cmrf: 'CMRF (State Grant)',
                  }
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setSelectedSchemeFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        selectedSchemeFilter === filter
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                    >
                      {labels[filter]}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Scheme Summary Quick Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-white border border-emerald-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-500">AB-PMJAY (Central)</div>
                  <div className="text-sm font-black text-slate-900">₹5,00,000 / family / yr</div>
                  <div className="text-[10px] text-emerald-800 font-semibold">100% Cashless for SECC/NFSA &amp; 70+</div>
                </div>
                <span className="text-2xl">🇮🇳</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-emerald-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-500">Arogya Karnataka (State)</div>
                  <div className="text-sm font-black text-slate-900">₹5L (BPL) &bull; ₹1.5L (APL)</div>
                  <div className="text-[10px] text-sky-800 font-semibold">Public Referral Rule for Private Care</div>
                </div>
                <span className="text-2xl">🏥</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-emerald-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-500">Karnataka CMRF (Ex-Gratia)</div>
                  <div className="text-sm font-black text-slate-900">Discretionary Grant</div>
                  <div className="text-[10px] text-amber-800 font-semibold">Catastrophic Care &bull; Direct to Hospital</div>
                </div>
                <span className="text-2xl">🏛️</span>
              </div>
            </div>
          </div>

          {/* 2. Official Emergency Helpline & Quick Dial Bar */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <span>📞</span>
                <span>Verified Official Healthcare Helplines &amp; Emergency Quick-Dial</span>
              </h3>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Click number to dial directly
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {(schemesCatalog?.emergency_helplines || DEFAULT_EMERGENCY_HELPLINES).map((h, idx) => (
                <a
                  key={idx}
                  href={h.tel_uri}
                  className="p-3 rounded-xl bg-slate-50 hover:bg-emerald-50/70 border border-slate-200 hover:border-emerald-300 transition-all flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="text-xs font-bold text-slate-900 truncate group-hover:text-emerald-900">
                      {h.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{h.description}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-black text-emerald-700 shadow-2xs group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <span>📞</span>
                    <span>{h.number}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* 3. Anonymous Eligibility & Care Pathway Guidance (Strictly Non-PII) */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>🧭</span>
                  <span>Anonymous Healthcare Scheme &amp; Referral Pathway Guidance</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Answer 4 anonymous questions to determine applicable government scheme benefits, public referral
                  requirements, and document checklists.
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold shrink-0 self-start sm:self-auto">
                <span>🔒</span>
                <span>Zero Personal Data Stored &bull; Strictly Non-PII</span>
              </div>
            </div>

            {/* Non-PII Guidance Form */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Question 1: Karnataka Resident */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  1. Permanent Karnataka Resident?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGuidanceResident(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                      guidanceResident
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Yes (Karnataka)
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidanceResident(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                      !guidanceResident
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    No (Other State)
                  </button>
                </div>
                <div className="text-[10px] text-slate-500">
                  {guidanceResident ? 'Qualifies for state AB-ArK & CMRF' : 'Guided to PM-JAY National Portability'}
                </div>
              </div>

              {/* Question 2: Ration Card Classification */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  2. Household Ration Card
                </label>
                <select
                  value={guidanceRationCard}
                  onChange={(e) => setGuidanceRationCard(e.target.value as 'BPL_PHH_AAY' | 'APL_NPHH' | 'NONE')}
                  className="w-full py-2 px-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="BPL_PHH_AAY">BPL / Priority Household (PHH / AAY)</option>
                  <option value="APL_NPHH">APL / Non-Priority (NPHH)</option>
                  <option value="NONE">No Ration Card / General Category</option>
                </select>
                <div className="text-[10px] text-slate-500">
                  {guidanceRationCard === 'BPL_PHH_AAY'
                    ? '100% Cashless up to ₹5 Lakh'
                    : guidanceRationCard === 'APL_NPHH'
                    ? '30% State Aid / 70% Co-Payment'
                    : 'Universal 70+ cover or public rates'}
                </div>
              </div>

              {/* Question 3: Patient Age */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  3. Patient Age (Years)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    max="120"
                    placeholder="e.g. 45"
                    value={guidanceAge}
                    onChange={(e) => setGuidanceAge(e.target.value)}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setGuidanceAge('72')}
                    className="px-2 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black shrink-0"
                    title="Senior Citizen 70+ Universal Cover"
                  >
                    70+ Age
                  </button>
                </div>
                <div className="text-[10px] text-slate-500">
                  {parseInt(guidanceAge, 10) >= 70
                    ? '🌟 Qualifies for Ayushman Vay Vandana Card'
                    : 'Standard age category'}
                </div>
              </div>

              {/* Question 4: Care Urgency */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  4. Urgency of Treatment
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGuidanceCareType('EMERGENCY')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all border text-center ${
                      guidanceCareType === 'EMERGENCY'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    🚨 Emergency
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidanceCareType('PLANNED')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all border text-center ${
                      guidanceCareType === 'PLANNED'
                        ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    🗓️ Planned Care
                  </button>
                </div>
                <div className="text-[10px] text-slate-500">
                  {guidanceCareType === 'EMERGENCY'
                    ? 'Referral is officially waived'
                    : 'Public referral strictly required'}
                </div>
              </div>
            </div>

            {/* Optional Treatment Cost & Submit */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2 max-w-sm">
                <label htmlFor="guidance-cost-estimate-input" className="text-xs font-bold text-slate-600 shrink-0">
                  Projected Cost (Optional):
                </label>
                <input
                  id="guidance-cost-estimate-input"
                  type="number"
                  placeholder="₹ e.g. 250000"
                  value={guidanceCostEstimate}
                  onChange={(e) => setGuidanceCostEstimate(e.target.value)}
                  className="py-1.5 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 w-36 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={executeGuidanceEvaluation}
                  disabled={guidanceLoading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {guidanceLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Evaluating Rules...</span>
                    </>
                  ) : (
                    <>
                      <span>🔍</span>
                      <span>Evaluate Scheme Pathway</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Guidance Evaluation Result Card */}
            {guidanceResponse && (
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-emerald-200 shadow-xs space-y-4 animate-in fade-in">
                {/* Result Headline & Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <span className="text-[11px] font-black text-emerald-800 uppercase tracking-wider block">
                      {guidanceResponse.pathway_headline}
                    </span>
                    <h4 className="text-base font-extrabold text-slate-900 mt-0.5">
                      {guidanceResponse.primary_scheme_name || 'Standard Healthcare Assistance Pathway'}
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-950 border border-emerald-200">
                      {guidanceResponse.copay_status}
                    </span>
                  </div>
                </div>

                {/* Coverage Summary */}
                <p className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
                  {guidanceResponse.coverage_summary}
                </p>

                {/* Critical Callouts: Referral Gatekeeping, Senior Citizen, CMRF */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Referral Callout */}
                  <div
                    className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                      guidanceResponse.referral_required
                        ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                        : 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                    }`}
                  >
                    <div className="font-extrabold flex items-center gap-1.5">
                      <span>{guidanceResponse.referral_required ? '⚠️' : '✅'}</span>
                      <span>
                        {guidanceResponse.referral_required
                          ? 'Government Public Hospital Referral Required'
                          : 'Emergency Care: Referral Waived'}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-700">
                      {guidanceResponse.referral_guidance}
                    </p>
                  </div>

                  {/* Senior Citizen or CMRF Callout */}
                  {guidanceResponse.senior_citizen_expansion ? (
                    <div className="p-3.5 rounded-xl bg-sky-50/80 border border-sky-300 text-sky-950 text-xs space-y-1">
                      <div className="font-extrabold flex items-center gap-1.5">
                        <span>🌟</span>
                        <span>Ayushman Vay Vandana Card (Age 70+ Universal Cover)</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-700">
                        Senior citizens aged 70 and above receive a distinct ₹5,00,000 annual top-up health cover under
                        PM-JAY regardless of household income or ration card tier. Enrol via Aadhaar e-KYC on the NHA
                        beneficiary portal.
                      </p>
                    </div>
                  ) : guidanceResponse.cmrf_status_note ? (
                    <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-xs space-y-1">
                      <div className="font-extrabold flex items-center gap-1.5">
                        <span>🏛️</span>
                        <span>Karnataka Chief Minister&apos;s Relief Fund (CMRF Notice)</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        {guidanceResponse.cmrf_status_note}
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Actionable Steps Roadmap */}
                {guidanceResponse.actionable_steps.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                      <span>📋</span>
                      <span>Recommended Patient &amp; Family Action Steps:</span>
                    </div>
                    <div className="space-y-1.5">
                      {guidanceResponse.actionable_steps.map((step, sIdx) => (
                        <div
                          key={sIdx}
                          className="p-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 flex items-start gap-2 shadow-2xs"
                        >
                          <span className="font-bold text-emerald-700 shrink-0">&bull;</span>
                          <span className="leading-relaxed">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Official Verification Portals Bar */}
                <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>🌐</span>
                    <span>Verify Status on Official Portals:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href="https://beneficiary.nha.gov.in/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                    >
                      <span>Check Ayushman Eligibility</span>
                      <span>↗</span>
                    </a>
                    <a
                      href="https://hospitals.pmjay.gov.in/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                    >
                      <span>Find PM-JAY Hospitals</span>
                      <span>↗</span>
                    </a>
                    <a
                      href="https://sast.karnataka.gov.in/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                    >
                      <span>SAST Karnataka</span>
                      <span>↗</span>
                    </a>
                  </div>
                </div>

                {/* Auditor Disclaimer Box */}
                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                  <strong>Notice:</strong> {guidanceResponse.disclaimer}
                </div>
              </div>
            )}
          </div>

          {/* 4. Official Scheme Comparison Profiles */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <span>📑</span>
                <span>Verified Government Healthcare Schemes in Karnataka</span>
              </h3>
              <span className="text-xs text-slate-500">
                Verified against official Gazette notifications and health ministry portals
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {(schemesCatalog?.schemes || DEFAULT_GOVERNMENT_SCHEMES)
                .filter((s) => selectedSchemeFilter === 'all' || s.scheme_id === selectedSchemeFilter)
                .map((scheme) => (
                  <div
                    key={scheme.scheme_id}
                    className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      {/* Scheme Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              scheme.scheme_id === 'pmjay'
                                ? 'bg-emerald-100 text-emerald-950'
                                : scheme.scheme_id === 'ab_ark'
                                ? 'bg-sky-100 text-sky-950'
                                : 'bg-amber-100 text-amber-950'
                            }`}
                          >
                            {scheme.short_name}
                          </span>
                          <h4 className="text-base font-extrabold text-slate-900 mt-1 leading-snug">
                            {scheme.name}
                          </h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">{scheme.administering_body}</p>
                        </div>
                      </div>

                      {/* Coverage Metric */}
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Coverage Ceiling &amp; Mode
                        </div>
                        <div className="text-sm font-black text-slate-900 mt-0.5">
                          {scheme.coverage_display}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                          {scheme.coverage_description}
                        </div>
                      </div>

                      {/* BPL vs APL Entitlements */}
                      <div className="space-y-1.5 text-xs">
                        <div className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200">
                          <span className="font-extrabold text-emerald-900 block text-[11px]">
                            BPL / Priority Household:
                          </span>
                          <span className="text-[11px] text-slate-700 leading-relaxed block mt-0.5">
                            {scheme.bpl_benefit}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-sky-50/70 border border-sky-200">
                          <span className="font-extrabold text-sky-900 block text-[11px]">
                            APL / General Category:
                          </span>
                          <span className="text-[11px] text-slate-700 leading-relaxed block mt-0.5">
                            {scheme.apl_benefit}
                          </span>
                        </div>
                      </div>

                      {/* Public Referral Constraint */}
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                        <span className="font-bold text-slate-800 block text-[11px]">
                          {scheme.referral_required_for_private
                            ? '⚠️ Public Referral Required for Private Care'
                            : 'ℹ️ Central Portability / Direct Referral Schedule'}
                        </span>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                          {scheme.emergency_referral_exempt
                            ? 'Emergency procedures exempt from referral. Planned private care requires advance ORS referral.'
                            : 'Please confirm specific pre-authorization requirements with the hospital desk.'}
                        </p>
                      </div>

                      {/* Exclusions */}
                      <div className="text-[11px] text-slate-500 space-y-1">
                        <span className="font-bold text-slate-700 block">Exclusions:</span>
                        <ul className="list-disc list-inside space-y-0.5 pl-1">
                          {scheme.exclusions.slice(0, 3).map((ex, exIdx) => (
                            <li key={exIdx} className="truncate">
                              {ex}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Official Action Links */}
                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      <a
                        href={scheme.official_portal_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                      >
                        <span>Official Portal</span>
                        <span>↗</span>
                      </a>
                      {scheme.beneficiary_portal_url && (
                        <a
                          href={scheme.beneficiary_portal_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                        >
                          <span>Citizen Verification</span>
                          <span>↗</span>
                        </a>
                      )}
                      {scheme.hospital_search_portal_url && (
                        <a
                          href={scheme.hospital_search_portal_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
                        >
                          <span>Network Directory</span>
                          <span>↗</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* 5. Interactive Document Readiness Checklist */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>📝</span>
                  <span>Interactive Patient Document Readiness Checklist</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Check off the physical documents you have gathered before traveling to the hospital or Seva Sindhu
                  center.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-xs font-bold text-slate-700">
                  Ready:{' '}
                  <span className="text-emerald-700 font-extrabold">
                    {Object.values(checkedDocs).filter(Boolean).length}
                  </span>{' '}
                  checked
                </div>
                <button
                  type="button"
                  onClick={resetChecklist}
                  className="px-3 py-1 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Checklist items */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  id: 'doc_aadhaar',
                  title: 'Aadhaar Card (Patient and Household Head)',
                  type: 'Mandatory',
                  desc: 'Used for biometric or OTP e-KYC at the hospital Ayushman/Arogya Mitra desk.',
                },
                {
                  id: 'doc_ration',
                  title: 'Valid Karnataka Ration Card (BPL/PHH/AAY or APL/NPHH)',
                  type: 'Mandatory',
                  desc: 'Determines whether you receive 100% cashless coverage or 30% co-payment assistance.',
                },
                {
                  id: 'doc_referral',
                  title: 'Government Public Hospital Online Referral Slip (ORS)',
                  type: 'Mandatory for Private Planned Care',
                  desc: 'Issued by PHC/Taluk/District hospital doctor. Strictly mandatory for private admissions (exempt for emergencies).',
                },
                {
                  id: 'doc_card',
                  title: 'Ayushman Bharat / Arogya Karnataka Card Printout',
                  type: 'Conditional',
                  desc: 'Can be downloaded online from beneficiary.nha.gov.in or generated at Bangalore One / Karnataka One.',
                },
                {
                  id: 'doc_cmrf_estimate',
                  title: 'Doctor Medical Cost Estimate with Superintendent Seal',
                  type: 'Mandatory for CMRF Grants',
                  desc: 'Original hospital estimate required when seeking discretionary relief from Chief Minister’s Relief Fund.',
                },
                {
                  id: 'doc_cmrf_mla',
                  title: 'Sitting MLA / MLC / MP Recommendation Letter',
                  type: 'Mandatory for CMRF Grants',
                  desc: 'Formal recommendation addressed to the Chief Minister of Karnataka.',
                },
                {
                  id: 'doc_tahsildar_income',
                  title: 'Tahsildar Certified Family Income Certificate (<₹1,00,000/yr)',
                  type: 'Mandatory for CMRF if no BPL card',
                  desc: 'Issued via Nadakacheri revenue services certifying annual household income.',
                },
                {
                  id: 'doc_bank_mandate',
                  title: 'Treating Hospital Bank Mandate (Cancelled Cheque / IFSC)',
                  type: 'Mandatory for CMRF Disbursement',
                  desc: 'CMRF grants are paid directly to the treating hospital account via RTGS, never as cash to patients.',
                },
              ].map((doc) => {
                const isChecked = !!checkedDocs[doc.id]
                return (
                  <div
                    key={doc.id}
                    onClick={() => toggleDocCheck(doc.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                      isChecked
                        ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleDocCheck(doc.id)}
                      className="mt-1 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-bold leading-snug ${
                            isChecked ? 'text-emerald-950 line-through opacity-80' : 'text-slate-900'
                          }`}
                        >
                          {doc.title}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                            doc.type.includes('Mandatory')
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {doc.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{doc.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 6. Official Hospital Empanelment Verification & Portals */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-sky-50 via-indigo-50/40 to-slate-50 border border-sky-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>🏥</span>
                  <span>Hospital Empanelment Verification Protocol</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 max-w-2xl leading-relaxed">
                  EvidenceBridge records hospital locations and published prices, but official government scheme
                  empanelment rosters update continuously. Always verify active hospital empanelment on official
                  government portals prior to admission.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="https://hospitals.pmjay.gov.in/"
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold transition-colors shadow-xs flex items-center gap-1.5"
                >
                  <span>Search Empanelled Hospitals</span>
                  <span>↗</span>
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <a
                href="https://beneficiary.nha.gov.in/"
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl bg-white border border-sky-200 hover:border-sky-400 transition-all flex flex-col justify-between group shadow-2xs"
              >
                <div>
                  <div className="text-xs font-extrabold text-slate-900 group-hover:text-sky-700">
                    NHA Beneficiary Portal
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Check PM-JAY card &amp; e-KYC status</div>
                </div>
                <div className="text-[11px] font-bold text-sky-600 mt-2 flex items-center gap-1">
                  <span>beneficiary.nha.gov.in</span>
                  <span>↗</span>
                </div>
              </a>

              <a
                href="https://sast.karnataka.gov.in/"
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl bg-white border border-sky-200 hover:border-sky-400 transition-all flex flex-col justify-between group shadow-2xs"
              >
                <div>
                  <div className="text-xs font-extrabold text-slate-900 group-hover:text-sky-700">
                    SAST Karnataka Portal
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Arogya Karnataka network facilities</div>
                </div>
                <div className="text-[11px] font-bold text-sky-600 mt-2 flex items-center gap-1">
                  <span>sast.karnataka.gov.in</span>
                  <span>↗</span>
                </div>
              </a>

              <a
                href="https://sevasindhuservices.karnataka.gov.in/"
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl bg-white border border-sky-200 hover:border-sky-400 transition-all flex flex-col justify-between group shadow-2xs"
              >
                <div>
                  <div className="text-xs font-extrabold text-slate-900 group-hover:text-sky-700">
                    Seva Sindhu Online
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">CMRF Major Ailments Application</div>
                </div>
                <div className="text-[11px] font-bold text-sky-600 mt-2 flex items-center gap-1">
                  <span>sevasindhuservices.karnataka.gov.in</span>
                  <span>↗</span>
                </div>
              </a>

              <a
                href="https://cmrf.karnataka.gov.in/"
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl bg-white border border-sky-200 hover:border-sky-400 transition-all flex flex-col justify-between group shadow-2xs"
              >
                <div>
                  <div className="text-xs font-extrabold text-slate-900 group-hover:text-sky-700">
                    CMRF Secretariat Cell
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Track Chief Minister relief orders</div>
                </div>
                <div className="text-[11px] font-bold text-sky-600 mt-2 flex items-center gap-1">
                  <span>cmrf.karnataka.gov.in</span>
                  <span>↗</span>
                </div>
              </a>
            </div>
          </div>

          {/* 7. Auditor Transparency & Legal Integrity Notice */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-600 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <span>🛡️</span>
                <span>Government Scheme Informational Notice &amp; Legal Disclaimer</span>
              </span>
              <span className="text-[10px] text-slate-500">EvidenceBridge Public Interest Standards</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Potential scheme pathway — confirm with the official authority. EvidenceBridge provides informational
              guidance and does not authorize or determine scheme approvals. All official eligibility, pre-authorizations,
              and coverage decisions are made solely by the National Health Authority (NHA), Suvarna Arogya Suraksha
              Trust (SAST), or the Chief Minister&apos;s Relief Fund committee.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-500 pt-1">
              <span>• National Health Authority (MoHFW, Government of India)</span>
              <span>• Suvarna Arogya Suraksha Trust (SAST, Government of Karnataka)</span>
              <span>• Department of Health &amp; Family Welfare, Karnataka</span>
              <span>• Chief Minister&apos;s Relief Fund Section, Vidhana Soudha, Bengaluru</span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
         CLINICAL EMERGENCY PROTOCOL MODAL (ATLS / ACLS / BLS Standard)
         ==================================================================== */}
      {selectedProtocolRecord && selectedProtocolRecord.clinical_protocol && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-transparent flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedProtocolRecord(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-sm font-bold cursor-pointer"
            >
              ✕
            </button>

            {/* Protocol Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-black bg-rose-600 text-white">
                {selectedProtocolRecord.clinical_protocol.emergency_code}
              </span>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Emergency Protocol &bull; Peer-Reviewed Standard
              </span>
            </div>

            <h3 className="text-xl font-black text-slate-900">
              {selectedProtocolRecord.clinical_protocol.protocol_name}
            </h3>

            {/* Primary Action Callout */}
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 my-3 text-xs text-rose-950 font-bold leading-relaxed flex items-start gap-2">
              <span className="text-base shrink-0">⚠️</span>
              <div>
                <span className="uppercase tracking-wider text-[10px] text-rose-700 block font-black">
                  Primary Immediate Action
                </span>
                {selectedProtocolRecord.clinical_protocol.primary_action}
              </div>
            </div>

            {/* ABCDE Steps */}
            {selectedProtocolRecord.clinical_protocol.abcde_protocol && (
              <div className="my-4">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                  ABCDE Primary Resuscitation Steps:
                </h4>
                <div className="space-y-2">
                  {selectedProtocolRecord.clinical_protocol.abcde_protocol.map((step, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                      <div className="font-extrabold text-slate-900">{step.step}</div>
                      <div className="text-slate-700 mt-0.5">{step.action}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stat Diagnostics */}
            {selectedProtocolRecord.clinical_protocol.immediate_diagnostics && (
              <div className="my-3">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Stat Diagnostics &amp; Lab Orders:
                </h4>
                <ul className="list-disc list-inside text-xs text-slate-800 space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {selectedProtocolRecord.clinical_protocol.immediate_diagnostics.map((diag, idx) => (
                    <li key={idx} className="font-medium">{diag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stat Medications */}
            {selectedProtocolRecord.clinical_protocol.stat_medications && (
              <div className="my-3">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Immediate STAT Medications:
                </h4>
                <div className="space-y-1.5">
                  {selectedProtocolRecord.clinical_protocol.stat_medications.map((med, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs flex items-center justify-between">
                      <div>
                        <span className="font-black text-emerald-950">{med.name}</span>
                        <span className="text-emerald-700 font-bold ml-1.5">({med.dose})</span>
                      </div>
                      <span className="text-[10px] text-emerald-800 font-medium">{med.indication}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Critical Precautions */}
            {selectedProtocolRecord.clinical_protocol.critical_precautions && (
              <div className="my-3">
                <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider mb-1.5">
                  Critical Precautions &amp; Red Flags:
                </h4>
                <ul className="list-disc list-inside text-xs text-slate-800 space-y-1 bg-rose-50/50 p-3 rounded-xl border border-rose-200">
                  {selectedProtocolRecord.clinical_protocol.critical_precautions.map((prec, idx) => (
                    <li key={idx} className="font-medium">{prec}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Specialist Consult */}
            {selectedProtocolRecord.clinical_protocol.specialist_consult_needed && (
              <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-950 font-medium">
                <strong className="text-indigo-900 font-bold">Specialist Consult:</strong>{' '}
                {selectedProtocolRecord.clinical_protocol.specialist_consult_needed}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedProtocolRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-black transition-colors cursor-pointer"
              >
                Close Protocol
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
         PATIENT EMERGENCY SOS MODAL & LIVE TRACKER
         ==================================================================== */}
      {isSosModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-transparent flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150">
            {/* Close */}
            <button
              type="button"
              onClick={() => {
                setIsSosModalOpen(false)
                setActiveSosTracking(null)
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-sm font-bold cursor-pointer"
            >
              ✕
            </button>

            {activeSosTracking ? (
              /* Live Status Tracker */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">SOS Distress Call Active</h3>
                    <p className="text-xs text-slate-500">Tracking dispatch status in real time</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Distress ID:</span>
                    <span className="font-mono font-bold text-slate-900">{activeSosTracking.sos_id}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Hospital Alerted:</span>
                    <span className="font-black text-slate-900">{activeSosTracking.hospital_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">Emergency Type:</span>
                    <span className="font-bold text-rose-700">{activeSosTracking.emergency_type}</span>
                  </div>

                  {/* Stepper */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    {[
                      { step: 'PENDING', label: '1. Distress Transmitted to Triage', active: true },
                      {
                        step: 'ACKNOWLEDGED',
                        label: '2. Hospital Staff Acknowledged Call',
                        active: activeSosTracking.status === 'ACKNOWLEDGED' || activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESPONDING',
                        label: '3. Emergency Response Team En Route',
                        active: activeSosTracking.status === 'RESPONDING' || activeSosTracking.status === 'RESOLVED',
                      },
                      {
                        step: 'RESOLVED',
                        label: '4. Emergency Case Resolved',
                        active: activeSosTracking.status === 'RESOLVED',
                      },
                    ].map((st, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                            st.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {st.active ? '✓' : idx + 1}
                        </span>
                        <span className={`font-bold ${st.active ? 'text-slate-900' : 'text-slate-400'}`}>
                          {st.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <span>ℹ️</span>
                  <span>
                    Keep your phone line open. The emergency triage desk may call you at{' '}
                    <strong>{activeSosTracking.patient_phone}</strong>.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="tel:112"
                    className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black text-center shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>📞</span>
                    <span>Call India Emergency 112</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSosModalOpen(false)
                      setActiveSosTracking(null)
                    }}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Close Tracker
                  </button>
                </div>
              </div>
            ) : (
              /* SOS Distress Form */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">🚨</span>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Emergency SOS Distress Alert</h3>
                    <p className="text-xs text-slate-500">Transmits immediate alert to hospital triage desk</p>
                  </div>
                </div>

                {/* Emergency Type Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Emergency Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'Accident / Trauma', label: 'Accident / Trauma', icon: '💥' },
                      { id: 'Breathing Difficulty', label: 'Breathing Difficulty', icon: '🫁' },
                      { id: 'Chest Pain', label: 'Chest Pain / Cardiac', icon: '❤️' },
                      { id: 'Other Emergency', label: 'Other Critical Emergency', icon: '⚠️' },
                    ].map((em) => (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => setSosEmergencyType(em.id)}
                        className={`p-2.5 rounded-xl border text-xs font-bold text-left flex items-center gap-2 transition-all cursor-pointer ${
                          sosEmergencyType === em.id
                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span className="text-lg">{em.icon}</span>
                        <span className="leading-tight">{em.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Hospital Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Alert Target Hospital
                  </label>
                  <select
                    value={sosTargetHospitalId}
                    onChange={(e) => setSosTargetHospitalId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold bg-white text-slate-900"
                  >
                    {MANAGED_HOSPITALS.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.district})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Patient Name & Phone */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Patient / Bystander Name
                    </label>
                    <input
                      type="text"
                      value={sosPatientName}
                      onChange={(e) => setSosPatientName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="text"
                      value={sosPatientPhone}
                      onChange={(e) => setSosPatientPhone(e.target.value)}
                      placeholder="+91 98450 12345"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium"
                    />
                  </div>
                </div>

                {/* GPS Location Permission */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Location Sharing (GPS)
                    </label>
                    {sosCoords ? (
                      <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <span>✓</span> Acquired ({sosCoords.lat.toFixed(3)}°, {sosCoords.lon.toFixed(3)}°)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Optional</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestSosLocation}
                    disabled={sosLocating}
                    className="w-full py-2 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>📍</span>
                    <span>{sosLocating ? 'Acquiring GPS...' : sosCoords ? 'Update GPS Location' : 'Share Current GPS Location'}</span>
                  </button>
                </div>

                {/* Condition Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Condition / Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={sosDescription}
                    onChange={(e) => setSosDescription(e.target.value)}
                    placeholder="Brief description of patient condition or immediate assistance needed..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-medium resize-none"
                  />
                </div>

                {/* Direct 112 Call Banner */}
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
                  <div className="text-xs text-rose-950 font-medium">
                    <strong className="block text-rose-900 font-bold">Life-Threatening Emergency?</strong>
                    Call India Emergency Services immediately.
                  </div>
                  <a
                    href="tel:112"
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-black whitespace-nowrap shrink-0 flex items-center gap-1"
                  >
                    <span>📞</span>
                    <span>Call 112</span>
                  </a>
                </div>

                {sosError && (
                  <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    {sosError}
                  </p>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSos}
                    onClick={handleSubmitSos}
                    className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmittingSos ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Transmitting Distress Call...</span>
                      </>
                    ) : (
                      <>
                        <span>🚨</span>
                        <span>DISPATCH EMERGENCY SOS</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Source & Attribution Footer */}
      <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-600 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-slate-700">
          <span>Data Sources &amp; Transparency Notice:</span>
          <span>Updated: {new Date().getFullYear()}</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          {searchResponse?.disclaimer ||
            'EvidenceBridge Hospital Finder provides facility location, published price benchmarks, and regulatory accreditation metrics for informational comparison only. This is not a medical diagnosis or treatment recommendation.'}
        </p>
        <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-400 pt-1">
          <span>• Karnataka State Health Registry (Validated ML Dataset - 2,226 facilities)</span>
          <span>• OpenStreetMap Cartography &bull; Overpass API (ODbL)</span>
          <span>• NABH (National Accreditation Board for Hospitals) Registry</span>
          <span>• CMS Hospital Price Transparency Files (US &amp; International)</span>
        </div>
      </div>
    </div>
  )
}

export default HospitalFinder
