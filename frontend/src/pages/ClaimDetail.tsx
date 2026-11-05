import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getClaim, getVerification, getAudit, verifyClaim } from '../api/client'
import type { Claim, VerificationResult, AuditTrail } from '../types'
import { VerificationBadge, VerdictBadge } from '../components/VerificationBadge'
import { AuditTrailViewer } from '../components/AuditTrailViewer'
import { FiveModelsAuditPanel } from '../components/FiveModelsAuditPanel'
import { ModelStatusCard } from '../components/ModelStatusCard'
import { useVoice } from '../context/VoiceContext'
import { useAuth } from '../context/AuthContext'
import { getUserClaimById } from '../services/userDataStore'
import { formatCurrency } from '../utils/currency'

export default function ClaimDetail() {
  const { claimId } = useParams<{ claimId: string }>()
  const { user } = useAuth()
  const { setActiveClaim, readClaimAloud } = useVoice()

  const [claim, setClaim] = useState<Claim | null>(null)
  const [verification, setVerification] = useState<VerificationResult | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditTrail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reverifying, setReverifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedHash, setCopiedHash] = useState(false)

  const loadData = async () => {
    if (!claimId) return
    setLoading(true)
    setError(null)

    // 1. Check current user's isolated data store first
    const userEmail = user?.email || 'ramesh.kumar@patient.local'
    const local = getUserClaimById(userEmail, claimId)
    if (local && local.claim) {
      setClaim(local.claim)
      setVerification(local.verification)
      setAuditTrail(local.auditTrail)
      setLoading(false)
      return
    }

    try {
      const [cRes, vRes, aRes] = await Promise.allSettled([
        getClaim(claimId),
        getVerification(claimId),
        getAudit(claimId),
      ])

      if (cRes.status === 'fulfilled') {
        setClaim(cRes.value)
      } else {
        setError('Claim record not found in audit database.')
        setLoading(false)
        return
      }

      if (vRes.status === 'fulfilled') {
        setVerification(vRes.value)
      } else {
        setVerification(null)
      }

      if (aRes.status === 'fulfilled') {
        setAuditTrail(aRes.value.audit_trail)
      } else {
        setAuditTrail(null)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading claim data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [claimId])

  useEffect(() => {
    if (claim) {
      setActiveClaim({
        claimId: claim.claim_id,
        entity: claim.extracted_fields?.entity,
        action: verification?.action || 'unverified',
        verdict: verification?.verdict,
        costAnomalyFlag: verification?.cost_anomaly_flag,
        costRange: claim.extracted_fields?.cost_range,
        confidence: claim.confidence,
        supportScore: verification?.support_score,
        reasoning: verification?.reasoning,
        abstainReason: verification?.abstain_reason,
        anomalyDetails: verification?.anomaly_details,
        city: claim.location?.city,
        sourceType: claim.source_type,
      })
    }
  }, [claim, verification, setActiveClaim])

  const handleReverify = async () => {
    if (!claimId) return
    setReverifying(true)
    try {
      const resp = await verifyClaim(claimId)
      setVerification(resp.verification)
      // Reload audit trail
      try {
        const aResp = await getAudit(claimId)
        setAuditTrail(aResp.audit_trail)
      } catch {
        // ok
      }
    } catch (err: unknown) {
      alert(`Re-verification failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReverifying(false)
    }
  }

  const handleCopyHash = () => {
    if (claim?.provenance?.source_hash) {
      navigator.clipboard.writeText(claim.provenance.source_hash)
      setCopiedHash(true)
      setTimeout(() => setCopiedHash(false), 2000)
    }
  }

  const formatDocCurrency = (amount: number, currency = 'USD') => {
    return formatCurrency(amount, currency)
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-10 space-y-4 animate-pulse">
        <div className="h-6 bg-slate-200 rounded w-1/4" />
        <div className="h-10 bg-slate-200 rounded w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
          <div className="lg:col-span-2 h-96 bg-slate-200 rounded-2xl" />
          <div className="h-96 bg-slate-200 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !claim) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="text-4xl mb-3">🔍</div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">Claim Not Found</h2>
        <p className="text-xs text-slate-500 mb-6">{error || `No claim with ID ${claimId}`}</p>
        <Link
          to="/claims"
          className="inline-flex items-center px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
        >
          &larr; Back to Claims Explorer
        </Link>
      </div>
    )
  }

  const fields = claim.extracted_fields
  const location = claim.location
  const anomaly = verification?.anomaly_details

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* 5 AI Models Live Status Architecture Banner */}
      <ModelStatusCard />

      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link to="/claims" className="hover:text-slate-800 font-semibold hover:underline">
            Claims Explorer
          </Link>
          <span>/</span>
          <span className="font-mono text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded">
            {claim.claim_id}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          <button
            type="button"
            onClick={() => readClaimAloud()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-subtle transition-colors"
            title="Read audit decision aloud using browser AI voice"
          >
            <span>🔊</span>
            <span>Read Result Aloud</span>
          </button>

          <button
            type="button"
            onClick={handleReverify}
            disabled={reverifying}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${reverifying ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {reverifying ? 'Auditing Against Guidelines...' : 'Re-Run Verification Audit'}
          </button>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Core Document & Audit Graph */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7 shadow-card">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold">
                {claim.claim_id}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 font-semibold capitalize border border-sky-100">
                {claim.source_type.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-slate-400">
                Ingested: {new Date(claim.timestamp).toLocaleString()}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">
              {fields?.entity || 'Unspecified Medical Procedure'}
            </h1>

            {fields?.effect_or_outcome && (
              <p className="text-xs sm:text-sm text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed">
                {fields.effect_or_outcome}
              </p>
            )}
          </div>

          {/* Visual Indicators & Summary Bars */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-base">📊</span>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Visual Claim Summary &amp; Indicators
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">
                Extraction &bull; Clinical Fit &bull; Price Markup
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Indicator 1: Extraction Confidence */}
              <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-semibold">1. Extraction Confidence</span>
                  <span className="font-mono font-black text-slate-900">
                    {Math.round((claim.confidence || 0) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(5, (claim.confidence || 0) * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {claim.confidence >= 0.8
                    ? 'High NLP entity extraction clarity'
                    : 'Moderate ambiguity in source text'}
                </span>
              </div>

              {/* Indicator 2: Guideline Match / Support Score */}
              <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-semibold">2. Guideline Match</span>
                  <span className="font-mono font-black text-slate-900">
                    {verification ? `${Math.round(verification.support_score * 100)}%` : 'Pending'}
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (verification?.support_score || 0) >= 0.7
                        ? 'bg-emerald-500'
                        : (verification?.support_score || 0) >= 0.4
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(5, (verification?.support_score || 0) * 100))}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 block capitalize">
                  {verification ? `${verification.verdict.replace(/_/g, ' ')} evidence` : 'Audit in progress'}
                </span>
              </div>

              {/* Indicator 3: Cost Markup Multiplier */}
              <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-semibold">3. Cost Markup Level</span>
                  <span className="font-mono font-black text-slate-900">
                    {anomaly?.multiplier ? `${anomaly.multiplier.toFixed(1)}×` : '1.0×'}
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (anomaly?.multiplier || 1) >= 10
                        ? 'bg-rose-500'
                        : (anomaly?.multiplier || 1) >= 5
                        ? 'bg-orange-500'
                        : (anomaly?.multiplier || 1) >= 3
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(10, ((anomaly?.multiplier || 1) / 16) * 100))}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {verification?.cost_anomaly_flag
                    ? `${(anomaly?.severity || 'Price Alert').toUpperCase()} hospital markup`
                    : 'Within standard CMS benchmark range'}
                </span>
              </div>
            </div>
          </div>

          {/* Verbatim Source Document */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Original Verbatim Medical Document
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                {claim.provenance?.text_length} characters
              </span>
            </div>
            <pre className="text-xs font-mono bg-slate-50 text-slate-800 p-4 rounded-xl border border-slate-200 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-56">
              {claim.original_text}
            </pre>
          </div>

          {/* Structured Extraction Fields */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
              Structured Clinical Extraction
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Procedure / Entity</span>
                <span className="font-bold text-slate-800">{fields?.entity}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Billed Charge</span>
                <span className="font-mono font-bold text-slate-900">
                  {fields?.cost_range
                    ? `${fields.cost_range}${fields.cost_currency ? ` (${fields.cost_currency})` : ''}`
                    : 'Price data not available'}
                </span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Extraction Confidence</span>
                <span className="font-mono font-bold text-slate-900">{Math.round(claim.confidence * 100)}%</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Extracted City</span>
                <span className="font-semibold text-slate-800">{fields?.location_city || 'Not mentioned'}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Clinical Sentiment</span>
                <span className="font-semibold text-slate-800 capitalize">{fields?.sentiment || 'Neutral'}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5 text-[11px]">Semantic Embedding</span>
                <span className="font-semibold text-slate-800">{claim.indexed_vector ? 'Indexed (ChromaDB)' : 'Not indexed'}</span>
              </div>
            </div>
          </div>

          {/* Cryptographic Authenticity & Provenance */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Document Authenticity Fingerprint
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Immutable SHA-256 cryptographic hash calculated immediately upon ingestion to guarantee tamper-resistance.
            </p>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs">
              <span className="truncate mr-3 text-slate-700">{claim.provenance?.source_hash}</span>
              <button
                type="button"
                onClick={handleCopyHash}
                className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-[11px] flex-shrink-0 transition-colors shadow-2xs"
              >
                {copiedHash ? '✓ Copied' : 'Copy Hash'}
              </button>
            </div>
          </div>

          {/* Geographic Location Info */}
          {location && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Resolved Geographic Locality
                </h3>
                <Link
                  to={`/trust-density?key=${encodeURIComponent(location.normalized_key)}`}
                  className="text-xs font-bold text-sky-600 hover:text-sky-800 hover:underline"
                >
                  View Metro Reliability Score &rarr;
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <span className="text-slate-400 block mb-0.5 text-[11px]">City</span>
                  <span className="font-bold text-indigo-950">{location.city}</span>
                </div>
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <span className="text-slate-400 block mb-0.5 text-[11px]">State / Region</span>
                  <span className="font-bold text-indigo-950">{location.state_or_region || 'N/A'}</span>
                </div>
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <span className="text-slate-400 block mb-0.5 text-[11px]">Canonical Key</span>
                  <span className="font-mono font-bold text-indigo-950">{location.normalized_key}</span>
                </div>
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <span className="text-slate-400 block mb-0.5 text-[11px]">Country</span>
                  <span className="font-bold text-indigo-950">{location.country}</span>
                </div>
              </div>
            </div>
          )}

          {/* Five Integrated AI Models Panel */}
          <FiveModelsAuditPanel
            claimId={claim.claim_id}
            sharedContext={verification?.shared_context}
            synthesis={verification?.synthesis}
            nerEntities={verification?.ner_entities}
            retrievalPassages={verification?.passages_considered?.map((p) => ({
              passage_id: p.passage_id,
              guideline_id: p.guideline_id,
              title: p.title,
              source: p.source,
              text: p.text,
              similarity_score: p.relevance_score,
              model_name: 'BGE Small en-v1.5',
            }))}
            nliResult={verification?.nli_result}
            providerAnomaly={verification?.provider_anomaly}
            claimAnomaly={verification?.claim_anomaly}
            medicineSubstitution={verification?.medicine_substitution}
            billingReconciliation={verification?.billing_reconciliation}
            requiresHumanReview={verification?.requires_human_review}
            humanReviewReasons={verification?.human_review_reasons}
          />

          {/* 7-Stage Audit Trail Viewer */}
          {auditTrail && <AuditTrailViewer auditTrail={auditTrail} verification={verification} />}
        </div>

        {/* Right Column (1/3): Sticky Audit Verdict Summary */}
        <div className="lg:col-span-1 space-y-6">
          <div className="sticky top-20 bg-white rounded-2xl border border-slate-200 p-6 shadow-card space-y-5">
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Audit Decision Summary
              </div>
              {verification ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <VerificationBadge action={verification.action} size="lg" />
                    <VerdictBadge verdict={verification.verdict} />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
                  Unverified. Click &ldquo;Re-Run Verification Audit&rdquo; to evaluate against guidelines.
                </div>
              )}
            </div>

            {/* Guideline Confidence Bar */}
            {verification && (
              <div>
                <div className="flex justify-between text-xs text-slate-600 mb-1.5 font-medium">
                  <span>Guideline Match Confidence</span>
                  <span className="font-mono font-bold text-slate-900">
                    {Math.round(verification.support_score * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      verification.support_score >= 0.70
                        ? 'bg-emerald-500'
                        : verification.support_score >= 0.40
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, verification.support_score * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {/* Price Anomaly Box */}
            {verification?.cost_anomaly_flag && anomaly && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs space-y-2">
                <div className="font-bold flex items-center justify-between text-rose-800">
                  <span>⚠️ Price Alert Detected</span>
                  <span className="font-mono font-black uppercase bg-rose-200/80 px-2 py-0.5 rounded text-[11px]">
                    {(anomaly.multiplier ?? 1).toFixed(1)}× Benchmark
                  </span>
                </div>
                <p className="leading-relaxed text-rose-900 text-xs">
                  {anomaly.explanation}
                </p>
                <div className="font-mono text-[11px] text-rose-800 pt-2 border-t border-rose-200/80 flex justify-between items-center flex-wrap gap-1">
                  <span>
                    Benchmark: {formatCurrency(anomaly.benchmark_min, anomaly.benchmark_currency || anomaly.currency || 'INR')} – {formatCurrency(anomaly.benchmark_max, anomaly.benchmark_currency || anomaly.currency || 'INR')}
                  </span>
                  <span className="font-bold">
                    Billed: {formatCurrency(anomaly.extracted_amount, anomaly.currency || 'INR', { showCode: true })}
                  </span>
                </div>
                {anomaly.benchmark_currency && anomaly.currency && anomaly.benchmark_currency !== anomaly.currency && (
                  <div className="text-[11px] text-amber-800 bg-amber-100/70 p-1.5 rounded border border-amber-200">
                    Billed in {anomaly.currency}, benchmark published in {anomaly.benchmark_currency}.
                  </div>
                )}
              </div>
            )}

            {/* Abstain Reason */}
            {verification?.action === 'abstain' && (
              <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 text-xs text-slate-800">
                <strong className="block font-bold text-slate-900 mb-1">
                  Safety Gate Triggered:
                </strong>
                {verification.abstain_reason || 'Inconclusive clinical evidence in local knowledge base.'}
              </div>
            )}

            {/* Clinical Reasoning Summary */}
            {verification && (
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Clinical Rationale
                </span>
                <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  {verification.reasoning}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
