// ============================================================
// EvidenceBridge API client — typed fetch wrappers
// All calls go to /api/v1 (proxied by Vite to :8000)
// ============================================================

import {
  ApiError,
  AuditResponse,
  AuthResponse,
  Claim,
  ClaimListResponse,
  CommunityStory,
  CommunityStoryCreate,
  CommunityStoryListResponse,
  DocumentImageProcessResponse,
  ExtractedEntity,
  ExtractionRequest,
  ExtractionResponse,
  ExtractAndVerifyResponse,
  HealthResponse,
  InsightsSummaryResponse,
  MedicineSubstitutionResult,
  Model6PredictionResult,
  ModelStatusResponse,
  NERExtractionResult,
  NLIResult,
  ProviderAnomalyResult,
  ClaimAnomalyResult,
  RetrievalResultPassage,
  TrustDensityListResponse,
  TrustDensityResponse,
  UnifiedAuditReport,
  UnifiedAuditRequest,
  UserCreateRequest,
  UserLoginRequest,
  UserResponse,
  VerificationResponse,
  VerificationResult,
} from '../types'


export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '')

export const TOKEN_STORAGE_KEY = 'evidencebridge_token'
export const USER_STORAGE_KEY = 'evidencebridge_user'

// In-memory token cache for synchronous, zero-race-condition access
let memoryAuthToken: string | null = null
let autoDemoPromise: Promise<string | null> | null = null

// Initialize memory token synchronously on script load
try {
  if (typeof window !== 'undefined') {
    memoryAuthToken =
      localStorage.getItem(TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      null
  }
} catch {
  // Storage access might be restricted in some iframe / sandboxed environments
}

export function isInvalidToken(token: string | null): boolean {
  if (!token || !token.trim()) return true
  const t = token.trim()
  if (
    t === 'demo_patient_token' ||
    t === 'demo_hospital_token' ||
    t.startsWith('otp_token_') ||
    t.startsWith('usr_token_') ||
    t.startsWith('local_token_') ||
    t.startsWith('token_')
  ) {
    return true
  }

  // Check if JWT token has expired or is nearing expiration
  if (t.includes('.')) {
    try {
      const parts = t.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        if (payload.exp && typeof payload.exp === 'number') {
          // If expired (or expiring in under 60 seconds), treat as invalid to trigger refresh
          if (Date.now() >= payload.exp * 1000 - 60000) {
            return true
          }
        }
      }
    } catch {
      // Ignore parse failure; allow backend to validate
    }
  }

  return false
}

export function getAuthToken(): string | null {
  if (memoryAuthToken && memoryAuthToken.trim()) {
    return memoryAuthToken.trim()
  }
  if (typeof window !== 'undefined') {
    try {
      const local = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (local && local.trim()) {
        memoryAuthToken = local.trim()
        return memoryAuthToken
      }
      const session = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (session && session.trim()) {
        memoryAuthToken = session.trim()
        return memoryAuthToken
      }
    } catch {
      // Storage access might be restricted
    }
  }
  return null
}

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token && token.trim() ? token.trim() : null
  if (typeof window !== 'undefined') {
    try {
      if (memoryAuthToken) {
        localStorage.setItem(TOKEN_STORAGE_KEY, memoryAuthToken)
        sessionStorage.setItem(TOKEN_STORAGE_KEY, memoryAuthToken)
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      }
    } catch {
      // Storage access might be restricted
    }
  }
}

/**
 * Ensures a valid session token exists before issuing protected requests.
 * Checks for invalid or stale tokens and acquires a valid JWT or canonical
 * pre-authorized demo token ('demo_bearer_token') to prevent 401 Unauthorized errors.
 */
export async function ensureAuthToken(forceRefresh = false): Promise<string> {
  const existing = getAuthToken()
  if (existing && !forceRefresh && !isInvalidToken(existing)) {
    return existing
  }

  if (autoDemoPromise) {
    const res = await autoDemoPromise
    return res || 'demo_bearer_token'
  }

  autoDemoPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.access_token) {
          setAuthToken(data.access_token)
          return data.access_token
        }
      }
    } catch (err) {
      console.warn('Auto demo authentication failed:', err)
    } finally {
      autoDemoPromise = null
    }

    // Ultimate fallback token pre-authorized by backend decode_access_token()
    setAuthToken('demo_bearer_token')
    return 'demo_bearer_token'
  })()

  const result = await autoDemoPromise
  return result || 'demo_bearer_token'
}

async function apiFetch<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  // Public endpoints do not require an Authorization header
  const isPublic =
    path.startsWith('/health') ||
    path.startsWith('/auth/login') ||
    path.startsWith('/auth/signup') ||
    path.startsWith('/auth/demo')

  let token = getAuthToken()
  if ((!token || isInvalidToken(token)) && !isPublic) {
    token = await ensureAuthToken()
  }

  const authHeaders: Record<string, string> = {}
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  // Self-healing: if session expired or rejected with 401, auto-refresh token and retry once
  if (res.status === 401 && !isRetry && !isPublic) {
    console.warn(`[EvidenceBridge API] 401 Unauthorized for ${path}. Refreshing session token and retrying...`)
    setAuthToken(null)
    const freshToken = await ensureAuthToken(true)
    if (freshToken) {
      const retryHeaders = { ...(init?.headers ?? {}) } as Record<string, string>
      delete retryHeaders['Authorization']
      delete retryHeaders['authorization']
      return apiFetch<T>(path, { ...init, headers: retryHeaders }, true)
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = body?.detail ?? body?.message ?? msg
      if (typeof msg === 'object') msg = JSON.stringify(msg)
    } catch {
      // leave msg as-is
    }
    throw new ApiError(String(msg), res.status)
  }
  return res.json() as Promise<T>
}

// ---- Health ----

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}

// ---- Extraction ----

export function extractOnly(req: ExtractionRequest): Promise<ExtractionResponse> {
  return apiFetch<ExtractionResponse>('/extract', {
    method: 'POST',
    body: JSON.stringify({ store_claim: true, ...req }),
  })
}

export function extractAndVerify(
  req: ExtractionRequest,
): Promise<ExtractAndVerifyResponse> {
  return apiFetch<ExtractAndVerifyResponse>('/extract-and-verify', {
    method: 'POST',
    body: JSON.stringify({ store_claim: true, ...req }),
  })
}

// ---- Claims ----

export function listClaims(params?: {
  limit?: number
  skip?: number
  location?: string
  user_id?: string
}): Promise<ClaimListResponse> {
  const qs = new URLSearchParams()
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.skip !== undefined) qs.set('skip', String(params.skip))
  if (params?.location) qs.set('location', params.location)
  if (params?.user_id) qs.set('user_id', params.user_id)
  const q = qs.toString()
  return apiFetch<ClaimListResponse>(`/claims${q ? `?${q}` : ''}`)
}

export function getClaim(claimId: string): Promise<Claim> {
  return apiFetch<Claim>(`/claims/${encodeURIComponent(claimId)}`)
}

// ---- Verification ----

export function verifyClaim(claimId: string): Promise<VerificationResponse> {
  return apiFetch<VerificationResponse>(
    `/verify/${encodeURIComponent(claimId)}`,
    { method: 'POST' },
  )
}

export function getVerification(claimId: string): Promise<VerificationResult> {
  return apiFetch<VerificationResult>(
    `/verification/${encodeURIComponent(claimId)}`,
  )
}

// ---- Audit ----

export function getAudit(claimId: string): Promise<AuditResponse> {
  return apiFetch<AuditResponse>(`/audit/${encodeURIComponent(claimId)}`)
}

// ---- Trust Density ----

export function listTrustDensity(params?: {
  limit?: number
  skip?: number
  sort_by?: string
}): Promise<TrustDensityListResponse> {
  const qs = new URLSearchParams()
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.skip !== undefined) qs.set('skip', String(params.skip))
  if (params?.sort_by) qs.set('sort_by', params.sort_by)
  const q = qs.toString()
  return apiFetch<TrustDensityListResponse>(`/trust-density${q ? `?${q}` : ''}`)
}

export function getTrustDensity(locationKey: string): Promise<TrustDensityResponse> {
  return apiFetch<TrustDensityResponse>(
    `/trust-density/${encodeURIComponent(locationKey)}`,
  )
}

export function recomputeTrustDensity(
  locationKey: string,
): Promise<TrustDensityResponse> {
  return apiFetch<TrustDensityResponse>(
    `/trust-density/${encodeURIComponent(locationKey)}/recompute`,
    { method: 'POST' },
  )
}

// ---- Layer 6: Evaluation Harness ----

import type {
  EvaluationReport,
  EvaluationRunResponse,
  EvaluationListResponse,
} from '../types'

export function runEvaluation(options?: {
  dataset_path?: string
  force_reverify?: boolean
  offline_mode?: boolean
}): Promise<EvaluationRunResponse> {
  return apiFetch<EvaluationRunResponse>('/evaluate', {
    method: 'POST',
    body: JSON.stringify(options ?? { offline_mode: true }),
  })
}

export function getEvaluationReport(runId: string): Promise<EvaluationReport> {
  return apiFetch<EvaluationReport>(`/evaluate/${encodeURIComponent(runId)}`)
}

export function listEvaluationRuns(
  limit = 20,
  skip = 0,
): Promise<EvaluationListResponse> {
  return apiFetch<EvaluationListResponse>(`/evaluate?limit=${limit}&skip=${skip}`)
}

export function listStories(
  limit = 50,
  skip = 0,
  userId?: string,
): Promise<CommunityStoryListResponse> {
  const qs = new URLSearchParams({ limit: String(limit), skip: String(skip) })
  if (userId) qs.set('user_id', userId)
  return apiFetch<CommunityStoryListResponse>(`/stories?${qs.toString()}`)
}

export function createStory(
  story: CommunityStoryCreate,
): Promise<CommunityStory> {
  return apiFetch<CommunityStory>('/stories', {
    method: 'POST',
    body: JSON.stringify(story),
  })
}

export function getInsightsSummary(
  paramsOrUserId?: string | { userId?: string; benchmark?: boolean; allowFallback?: boolean },
): Promise<InsightsSummaryResponse> {
  let userId: string | undefined
  let benchmark: boolean | undefined
  let allowFallback: boolean | undefined

  if (typeof paramsOrUserId === 'string') {
    userId = paramsOrUserId
  } else if (paramsOrUserId) {
    userId = paramsOrUserId.userId
    benchmark = paramsOrUserId.benchmark
    allowFallback = paramsOrUserId.allowFallback
  }

  const qs = new URLSearchParams()
  if (userId) qs.set('user_id', userId)
  if (benchmark !== undefined) qs.set('benchmark', String(benchmark))
  if (allowFallback !== undefined) qs.set('allow_fallback', String(allowFallback))
  const q = qs.toString()
  return apiFetch<InsightsSummaryResponse>(`/insights/summary${q ? `?${q}` : ''}`)
}

// ---- Authentication & User Accounts (Part 2) ----

export function loginApi(req: UserLoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function signupApi(req: UserCreateRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function demoAuthApi(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/demo', {
    method: 'POST',
  })
}

export function getMeApi(): Promise<UserResponse> {
  return apiFetch<UserResponse>('/auth/me')
}

// ---------------------------------------------------------------------------
// Five AI Models & Unified Audit Client Methods
// ---------------------------------------------------------------------------

export function getModelsStatus(): Promise<ModelStatusResponse> {
  return apiFetch<ModelStatusResponse>('/models/status')
}

export function runUnifiedAudit(req: UnifiedAuditRequest): Promise<UnifiedAuditReport> {
  return apiFetch<UnifiedAuditReport>('/audit/unified', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export function extractNER(text: string): Promise<NERExtractionResult> {
  return apiFetch<NERExtractionResult>('/models/ner/extract', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function queryRetrieval(query: string, k = 5): Promise<RetrievalResultPassage[]> {
  return apiFetch<RetrievalResultPassage[]>('/models/retrieval/query', {
    method: 'POST',
    body: JSON.stringify({ query, k }),
  })
}

export function predictNLI(premise: string, hypothesis: string): Promise<NLIResult> {
  return apiFetch<NLIResult>('/models/nli/predict', {
    method: 'POST',
    body: JSON.stringify({ premise, hypothesis }),
  })
}

export function screenProviderAnomaly(
  providerData: Record<string, unknown>,
): Promise<ProviderAnomalyResult> {
  return apiFetch<ProviderAnomalyResult>('/models/anomaly/provider', {
    method: 'POST',
    body: JSON.stringify(providerData),
  })
}

export function screenClaimAnomaly(
  claimData: Record<string, unknown>,
): Promise<ClaimAnomalyResult> {
  return apiFetch<ClaimAnomalyResult>('/models/anomaly/claim', {
    method: 'POST',
    body: JSON.stringify(claimData),
  })
}

export function matchMedicine(
  queryMedicine: string,
  targetMedicine: string,
): Promise<MedicineSubstitutionResult> {
  return apiFetch<MedicineSubstitutionResult>('/models/medicine/match', {
    method: 'POST',
    body: JSON.stringify({
      query_medicine: queryMedicine,
      target_medicine: targetMedicine,
    }),
  })
}

export interface OCRResult {
  text: string
  confidence: number
  lines: Array<{
    text: string
    confidence: number
    box: number[][]
  }>
}

export function extractOCR(imageBase64: string): Promise<OCRResult> {
  return apiFetch<OCRResult>('/ocr/extract', {
    method: 'POST',
    body: JSON.stringify({ image_base64: imageBase64 }),
  })
}

// ---------------------------------------------------------------------------
// Model 6: Image-Based Medical Document AI Client Methods
// ---------------------------------------------------------------------------

export function classifyDocumentImage(imageBase64: string): Promise<Model6PredictionResult> {
  return apiFetch<Model6PredictionResult>('/model6/classify', {
    method: 'POST',
    body: JSON.stringify({ image_base64: imageBase64 }),
  })
}

export function processDocumentImage(imageBase64: string): Promise<DocumentImageProcessResponse> {
  return apiFetch<DocumentImageProcessResponse>('/document/process-image', {
    method: 'POST',
    body: JSON.stringify({ image_base64: imageBase64 }),
  })
}

// ---------------------------------------------------------------------------
// Feature 1: Live Hospital Doctor Availability
// ---------------------------------------------------------------------------

export interface HospitalAvailabilityUpdatePayload {
  hospital_id: string
  hospital_name?: string
  doctors_available: number
  emergency_doctors: number
  nurses_available: number
  emergency_nurses?: number
  department_specialists?: Record<string, number>
  available_beds?: number | null
  icu_beds_available?: number | null
  emergency_dept_status?: string // 'Operational' | 'Limited' | 'Critical' | 'Closed'
  duty_status: string // 'Accepting Patients' | 'Limited' | 'Unavailable'
  notes?: string
}

export interface HospitalAvailabilityResponse {
  hospital_id: string
  hospital_name: string
  doctors_available: number
  emergency_doctors: number
  nurses_available: number
  emergency_nurses?: number
  department_specialists?: Record<string, number>
  available_beds?: number | null
  icu_beds_available?: number | null
  emergency_dept_status?: string
  duty_status: string
  last_updated: string
  updated_by?: string
  notes?: string
}

export function updateHospitalAvailability(
  hospitalId: string,
  payload: HospitalAvailabilityUpdatePayload
): Promise<HospitalAvailabilityResponse> {
  return apiFetch<HospitalAvailabilityResponse>(`/hospitals/${encodeURIComponent(hospitalId)}/availability`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getHospitalAvailability(
  hospitalId: string
): Promise<HospitalAvailabilityResponse> {
  return apiFetch<HospitalAvailabilityResponse>(`/hospitals/${encodeURIComponent(hospitalId)}/availability`)
}

export function getAllHospitalAvailabilities(): Promise<HospitalAvailabilityResponse[]> {
  return apiFetch<HospitalAvailabilityResponse[]>('/hospitals-availability/all')
}

// ---------------------------------------------------------------------------
// Feature 2: SOS Emergency System
// ---------------------------------------------------------------------------

export interface EmergencySOSCreatePayload {
  emergency_type: string
  hospital_id: string
  hospital_name?: string
  patient_name: string
  patient_phone: string
  description?: string
  latitude?: number
  longitude?: number
  address?: string
}

export interface EmergencySOSRecord {
  sos_id: string
  emergency_type: string
  hospital_id: string
  hospital_name: string
  patient_name: string
  patient_phone: string
  description?: string
  latitude?: number
  longitude?: number
  address?: string
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED'
  created_at: string
  updated_at: string
  acknowledged_at?: string
  resolved_at?: string
  response_notes?: string
  clinical_protocol?: {
    emergency_code: string
    protocol_name: string
    primary_action: string
    abcde_protocol?: Array<{ step: string; action: string }>
    immediate_diagnostics?: string[]
    stat_medications?: Array<{ name: string; dose: string; indication: string }>
    critical_precautions?: string[]
    specialist_consult_needed?: string
  }
}

export function createEmergencySOS(
  payload: EmergencySOSCreatePayload
): Promise<EmergencySOSRecord> {
  return apiFetch<EmergencySOSRecord>('/sos', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getEmergencySOS(
  sosId: string
): Promise<EmergencySOSRecord> {
  return apiFetch<EmergencySOSRecord>(`/sos/${encodeURIComponent(sosId)}`)
}

export function listHospitalSOS(
  hospitalId: string
): Promise<EmergencySOSRecord[]> {
  return apiFetch<EmergencySOSRecord[]>(`/hospitals/${encodeURIComponent(hospitalId)}/sos`)
}

export function updateSOSStatus(
  sosId: string,
  status: 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED',
  responseNotes?: string
): Promise<EmergencySOSRecord> {
  return apiFetch<EmergencySOSRecord>(`/sos/${encodeURIComponent(sosId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      response_notes: responseNotes,
    }),
  })
}




