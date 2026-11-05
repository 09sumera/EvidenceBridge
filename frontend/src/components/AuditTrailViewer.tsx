import React, { useState } from 'react'
import type { AuditTrail, DecisionStep, EvidencePassage, VerificationResult } from '../types'
import { VerificationBadge, VerdictBadge } from './VerificationBadge'
import { formatCurrency } from '../utils/currency'

interface AuditTrailViewerProps {
  auditTrail: AuditTrail
  verification?: VerificationResult | null
}

const STAGE_TITLES: Record<string, { title: string; subtitle: string; icon: string }> = {
  EXTRACTION: {
    title: 'Model 1: BioBERT Reading Document',
    subtitle: 'Extracts Indian healthcare entities, procedure codes, and billed amounts',
    icon: '📄',
  },
  PROVENANCE: {
    title: 'Verifying Authenticity',
    subtitle: 'Calculates tamper-proof SHA-256 fingerprint of the source document',
    icon: '🔐',
  },
  HYBRID_RETRIEVAL: {
    title: 'Model 2: BGE Evidence Retrieval',
    subtitle: 'Searches authoritative clinical guidelines via 384-d semantic BGE embeddings',
    icon: '🔎',
  },
  COST_AUDIT: {
    title: 'Checking Regional Prices',
    subtitle: 'Compares billed amounts against CMS and Fair Health public benchmarks',
    icon: '💰',
  },
  CLINICAL_VERIFICATION: {
    title: 'Model 3: DeBERTa NLI Cross-Examination',
    subtitle: 'Evaluates claim statement against evidence for entailment, contradiction, or neutral',
    icon: '🩺',
  },
  PROVIDER_SCREENING: {
    title: 'Model 4: Provider Anomaly Screening',
    subtitle: 'Isolation Forest V3 evaluation of provider billing metrics',
    icon: '🏥',
  },
  CLAIM_SCREENING: {
    title: 'Model 5: Claim Anomaly Screening',
    subtitle: 'Isolation Forest V3 Strict Temporal screening of individual claim ratios',
    icon: '📑',
  },
  ABSTENTION_GATE: {
    title: 'Safety Gate & Human Review',
    subtitle: 'Deterministic safeguards ensure the system holds claims when evidence is missing',
    icon: '🛡️',
  },
  FINAL_ACTION: {
    title: 'Final Decision & Audit Synthesis',
    subtitle: 'Synthesizes clinical verification, cost anomaly checks, and safety policies',
    icon: '⚖️',
  },
}

export function AuditTrailViewer({ auditTrail, verification }: AuditTrailViewerProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({
    0: false,
    3: true,
    4: true,
    5: true,
    6: true,
  })
  const [showAllPassages, setShowAllPassages] = useState(false)
  const [copiedHash, setCopiedHash] = useState(false)

  const steps: DecisionStep[] = auditTrail.steps || []
  const passages: EvidencePassage[] = auditTrail.passages_considered || []

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const allExpanded = steps.length > 0 && steps.every((_, idx) => !!expandedSteps[idx])

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedSteps({})
    } else {
      const all: Record<number, boolean> = {}
      steps.forEach((_, idx) => {
        all[idx] = true
      })
      setExpandedSteps(all)
    }
  }

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 2000)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card">
      {/* Header */}
      <div className="px-6 py-5 bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-bold text-slate-900">
              7-Stage Decision Audit Trail
            </h3>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200">
              {auditTrail.audit_id}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete, deterministic decision graph &bull; Verification:{' '}
            <span className="font-mono text-slate-700">{auditTrail.verification_id}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <VerificationBadge action={auditTrail.final_action} size="md" />
          <VerdictBadge verdict={auditTrail.final_verdict} />
        </div>
      </div>

      {/* Final Decision Rationale & Safety Overrides */}
      <div className="px-6 py-5 bg-sky-50/40 border-b border-sky-100">
        <div className="text-[11px] font-bold text-sky-900 uppercase tracking-wider mb-1.5 flex items-center gap-2">
          <span>⚖️</span>
          <span>Final Audit Outcome &amp; Summary</span>
        </div>
        <p className="text-sm text-slate-800 leading-relaxed font-medium">
          {auditTrail.final_reasoning}
        </p>

        {/* Human Review Required Banner */}
        {verification?.requires_human_review && (
          <div className="mt-3.5 p-4 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-950 flex items-start gap-3 shadow-subtle">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <div className="flex-1 space-y-1">
              <strong className="font-bold block text-rose-950 text-xs uppercase tracking-wide">
                Human Auditor Review Required
              </strong>
              <p className="text-rose-900 leading-relaxed">
                Safety gates or AI models have flagged this claim for mandatory human audit:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-rose-900 font-medium pl-1">
                {verification.human_review_reasons && verification.human_review_reasons.length > 0 ? (
                  verification.human_review_reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))
                ) : (
                  <li>Model prediction flagged for supervisory review.</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Policy Override Banner */}
        {auditTrail.policy_override_applied && (
          <div className="mt-3.5 p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-3 shadow-subtle">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <div className="flex-1">
              <strong className="font-bold block text-amber-950 text-xs">
                Deterministic Safety Override Enforced:
              </strong>
              <div className="mt-0.5 text-amber-900 leading-relaxed">
                {auditTrail.policy_override_reason}
              </div>
              {auditTrail.raw_model_verdict && (
                <div className="mt-2 font-mono text-[11px] text-amber-900 bg-amber-100/70 px-2.5 py-1 rounded-md inline-block border border-amber-200">
                  Initial Assessment: <span className="font-bold">{auditTrail.raw_model_verdict}</span>
                  {auditTrail.raw_model_support_score !== null &&
                    auditTrail.raw_model_support_score !== undefined && (
                      <span> (Confidence: {auditTrail.raw_model_support_score.toFixed(2)})</span>
                    )}
                  {' '}&rarr; Policy Enforced Action:{' '}
                  <span className="font-bold uppercase text-amber-950">{auditTrail.final_action}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {auditTrail.abstain_triggered && !auditTrail.policy_override_applied && (
          <div className="mt-3 p-3.5 rounded-xl text-xs text-amber-900 bg-amber-50 border border-amber-200 flex items-start gap-2">
            <span className="text-amber-600 font-bold">ℹ️</span>
            <div>
              <strong className="font-bold">Safety Abstention Enforced:</strong>{' '}
              {auditTrail.abstain_reason || 'Inconclusive clinical evidence or missing benchmarks.'}
            </div>
          </div>
        )}
      </div>

      {/* 7-Stage Decision Steps Timeline */}
      <div className="px-6 py-6 border-b border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Step-by-Step Execution Checklist ({steps.length} Stages)
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Every stage logs inputs, outputs, timestamps, and deterministic rule triggers
            </p>
          </div>
          <button
            type="button"
            onClick={toggleExpandAll}
            className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            {allExpanded ? 'Collapse All Stages' : 'Expand All (7 Stages)'}
          </button>
        </div>

        <div className="relative border-l-2 border-slate-200 ml-4 space-y-6">
          {steps.map((step, idx) => {
            const isExpanded = !!expandedSteps[idx]
            const stageNum = idx + 1
            const stageInfo = STAGE_TITLES[step.step_name] || {
              title: step.step_name,
              subtitle: 'Pipeline execution stage',
              icon: '🔹',
            }

            // Node colors
            const nodeColor =
              step.step_name === 'ABSTENTION_GATE'
                ? 'border-amber-500 bg-amber-50 text-amber-600'
                : step.step_name === 'FINAL_ACTION'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
                : step.step_name === 'COST_AUDIT'
                ? 'border-rose-500 bg-rose-50 text-rose-600'
                : step.step_name === 'CLINICAL_VERIFICATION'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                : 'border-sky-500 bg-sky-50 text-sky-600'

            return (
              <div key={idx} className="relative pl-7">
                {/* Timeline Node Icon */}
                <div
                  className={`absolute -left-[13px] top-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs shadow-xs ${nodeColor}`}
                >
                  <span className="text-[10px]">{stageInfo.icon}</span>
                </div>

                <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors shadow-subtle">
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => toggleStep(idx)}
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">
                          Stage {stageNum}: {stageInfo.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
                          {step.step_name}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(step.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {stageInfo.subtitle}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-xs text-sky-600 hover:text-sky-800 font-bold px-2 py-1 rounded hover:bg-sky-50 transition-colors flex-shrink-0"
                    >
                      {isExpanded ? 'Hide Details ▲' : 'Inspect Details ▼'}
                    </button>
                  </div>

                  {/* Summary row */}
                  <div className="mt-3 space-y-1.5 text-xs bg-white p-3 rounded-lg border border-slate-200/70">
                    <div className="text-slate-600 text-xs">
                      <span className="font-bold text-slate-700">What went in:</span>{' '}
                      {step.input_summary}
                    </div>
                    <div className="text-slate-900 text-xs font-medium">
                      <span className="font-bold text-slate-700">What was produced:</span>{' '}
                      {step.output_summary}
                    </div>
                  </div>

                  {/* Detailed inspector */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-200 text-xs space-y-3 bg-white p-3.5 rounded-lg border border-slate-200">
                      {/* Special Stage Callouts */}
                      {step.step_name === 'PROVENANCE' &&
                        typeof step.details?.source_hash === 'string' && (
                          <div className="p-3 rounded-lg bg-sky-50/60 border border-sky-200 text-xs">
                            <div className="text-[11px] font-bold text-sky-900 mb-1">
                              Document Authenticity Fingerprint (SHA-256)
                            </div>
                            <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-700 bg-white p-2 rounded border border-slate-200">
                              <span className="truncate">{step.details.source_hash}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyHash(step.details?.source_hash as string)}
                                className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-[11px] flex-shrink-0 transition-colors"
                              >
                                {copiedHash ? '✓ Copied' : 'Copy Hash'}
                              </button>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1.5">
                              This cryptographic hash guarantees the document text was not modified or tampered with prior to auditing.
                            </div>
                          </div>
                        )}

                      {step.step_name === 'COST_AUDIT' && step.details && (
                        <div className="p-3 rounded-lg bg-rose-50/60 border border-rose-200 text-xs">
                          <div className="text-[11px] font-bold text-rose-900 mb-2">
                            Pricing Benchmark Comparison
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                            <div className="bg-white p-2 rounded border border-rose-100">
                              <span className="text-slate-400 block text-[10px]">Benchmark Reference:</span>
                              <span className="font-semibold text-slate-800">
                                {String(step.details.benchmark_name || 'None')}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-rose-100">
                              <span className="text-slate-400 block text-[10px]">Billed Charge:</span>
                              <span className="font-semibold text-slate-900">
                                {step.details.extracted_amount != null
                                  ? formatCurrency(Number(step.details.extracted_amount), String(step.details.currency || 'INR'))
                                  : 'Price data not available'}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-rose-100">
                              <span className="text-slate-400 block text-[10px]">Benchmark Range:</span>
                              <span className="font-semibold text-slate-800">
                                {step.details.benchmark_max != null
                                  ? `${formatCurrency(Number(step.details.benchmark_min || 0), String(step.details.benchmark_currency || step.details.currency || 'INR'))} – ${formatCurrency(Number(step.details.benchmark_max), String(step.details.benchmark_currency || step.details.currency || 'INR'))}`
                                  : 'Benchmark not available'}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-rose-100">
                              <span className="text-slate-400 block text-[10px]">Markup Status:</span>
                              <span
                                className={`font-bold ${
                                  step.details.is_anomaly ? 'text-rose-600' : 'text-slate-800'
                                }`}
                              >
                                {step.details.is_anomaly
                                  ? `${Number(step.details.multiplier || 1).toFixed(1)}× (ANOMALY)`
                                  : (step.details.multiplier
                                      ? `${Number(step.details.multiplier).toFixed(1)}× (NORMAL)`
                                      : 'NORMAL PRICING')}
                              </span>
                            </div>
                          </div>
                          {Boolean(step.details.benchmark_currency && step.details.currency && step.details.benchmark_currency !== step.details.currency) && (
                            <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                              ⚠️ Note: Billed charge is in {String(step.details.currency)} while comparison benchmark is published in {String(step.details.benchmark_currency)}. Cross-currency comparison is noted.
                            </div>
                          )}
                        </div>
                      )}

                      {step.step_name === 'CLINICAL_VERIFICATION' && step.details && (
                        <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200 text-xs">
                          <div className="text-[11px] font-bold text-indigo-900 mb-2">
                            Local Clinical Evaluation Details
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                            <div className="bg-white p-2 rounded border border-indigo-100">
                              <span className="text-indigo-600 block text-[10px]">Model Verdict:</span>
                              <span className="font-bold text-indigo-900">
                                {String(step.details.raw_model_verdict || 'bypassed')}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-indigo-100">
                              <span className="text-indigo-600 block text-[10px]">Guideline Match Score:</span>
                              <span className="font-bold text-indigo-900">
                                {step.details.raw_model_support_score !== undefined
                                  ? `${Math.round(Number(step.details.raw_model_support_score) * 100)}%`
                                  : 'N/A'}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-indigo-100">
                              <span className="text-indigo-600 block text-[10px]">Authoritative Guidelines:</span>
                              <span className="font-bold text-indigo-900">
                                {String(step.details.usable_passages_count || 0)} applied
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {step.step_name === 'ABSTENTION_GATE' && step.details && (
                        <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200 text-xs">
                          <div className="text-[11px] font-bold text-amber-900 mb-2">
                            Abstention Safeguards &amp; Deterministic Rules
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                            <div className="bg-white p-2 rounded border border-amber-100">
                              <span className="text-amber-700 block text-[10px]">Safety Gate Result:</span>
                              <span
                                className={`font-bold ${
                                  step.details.should_abstain ? 'text-amber-900' : 'text-emerald-700'
                                }`}
                              >
                                {step.details.should_abstain ? 'ABSTENTION TRIGGERED' : 'PASSED (PROCEED)'}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-amber-100">
                              <span className="text-amber-700 block text-[10px]">Specific Rule:</span>
                              <span className="font-bold text-amber-900 truncate block">
                                {String(step.details.rule_triggered || 'NONE')}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded border border-amber-100">
                              <span className="text-amber-700 block text-[10px]">Policy Override:</span>
                              <span className="font-bold text-amber-900">
                                {step.details.policy_override_applied ? 'YES' : 'NO'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Raw Payload Accordion */}
                      {step.details && Object.keys(step.details).length > 0 && (
                        <details className="text-[11px] text-slate-500 pt-1">
                          <summary className="cursor-pointer text-slate-400 hover:text-slate-600 font-mono text-[10px] uppercase tracking-wider">
                            View Raw Stage Payload (JSON)
                          </summary>
                          <pre className="text-[10px] text-slate-700 overflow-x-auto p-2.5 mt-1 bg-slate-50 rounded-lg border border-slate-200 font-mono">
                            {JSON.stringify(step.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Considered Clinical Evidence Passages */}
      {passages.length > 0 && (
        <div className="px-6 py-6 bg-slate-50/50">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Authoritative Medical Guidelines Evaluated ({passages.length})
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Excerpts retrieved from published clinical guidelines (ADA, ACR, CDC, CMS, Fair Health)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllPassages(!showAllPassages)}
              className="text-xs text-sky-600 hover:text-sky-800 font-bold px-2 py-1 rounded hover:bg-sky-50 transition-colors"
            >
              {showAllPassages ? 'Collapse Guidelines ▲' : `Show All Guidelines (${passages.length}) ▼`}
            </button>
          </div>

          <div className="space-y-3">
            {(showAllPassages ? passages : passages.slice(0, 3)).map((p, idx) => {
              const scorePct = Math.round(p.relevance_score * 100)
              const scoreColor =
                p.relevance_score >= 0.6
                  ? 'bg-emerald-500'
                  : p.relevance_score >= 0.35
                  ? 'bg-amber-500'
                  : 'bg-rose-400'

              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border text-xs shadow-subtle ${
                    p.used_in_decision
                      ? 'bg-white border-slate-200'
                      : 'bg-slate-100/70 border-slate-200 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="font-bold text-slate-900 text-xs">
                      {p.title}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        {p.source}
                      </span>
                      {p.used_in_decision ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          ✓ APPLIED IN AUDIT
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-medium">
                          DISCARDED (OFF-TOPIC)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Relevance Score Bar */}
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[11px] text-slate-500 font-medium w-36">
                      Guideline Relevance: {scorePct}%
                    </span>
                    <div className="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${scoreColor}`}
                        style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
                      />
                    </div>
                  </div>

                  {/* Passage Text */}
                  <blockquote className="text-slate-700 leading-relaxed text-xs bg-slate-50 p-3 rounded-lg border border-slate-100 font-serif italic">
                    &ldquo;{p.text}&rdquo;
                  </blockquote>

                  {p.discard_reason && (
                    <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded border border-rose-100">
                      <strong>Discard Reason:</strong> {p.discard_reason}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
export default AuditTrailViewer
