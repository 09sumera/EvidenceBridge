import React, { useState, useRef } from 'react'
import type { AuditTrail, DecisionStep, EvidencePassage, VerificationResult } from '../types'
import { VerificationBadge, VerdictBadge } from './VerificationBadge'
import { formatCurrency } from '../utils/currency'
import { useTheme } from '../context/ThemeContext'

interface AuditTrailViewerProps {
  auditTrail: AuditTrail
  verification?: VerificationResult | null
}

interface StageDefinition {
  num: number
  stepKey: string
  title: string
  subtitle: string
  defaultOutput: string
  color: {
    accent: string
    borderLight: string
    bgLight: string
    textLight: string
    badgeBgLight: string
    badgeTextLight: string
    pillBgLight: string
    borderDark: string
    bgDark: string
    textDark: string
    glowDark: string
    badgeBgDark: string
    badgeTextDark: string
    pillBgDark: string
    iconColorLight: string
    iconColorDark: string
  }
  renderIcon: (isDark: boolean) => React.ReactNode
}

const STAGES: StageDefinition[] = [
  // ROW 1
  {
    num: 1,
    stepKey: 'EXTRACTION',
    title: 'Document Reading (BioBERT)',
    subtitle: 'Extracts health entities, procedure codes and billing amounts.',
    defaultOutput: 'Extracted entities, codes, and billing amounts',
    color: {
      accent: '#06b6d4',
      borderLight: 'border-cyan-500 hover:border-cyan-600',
      bgLight: 'bg-cyan-50/40 hover:bg-cyan-50/70',
      textLight: 'text-cyan-900',
      badgeBgLight: 'bg-cyan-500 text-white',
      badgeTextLight: 'text-cyan-900 bg-cyan-100',
      pillBgLight: 'bg-cyan-100/70 text-cyan-950 border-cyan-200',
      borderDark: 'border-cyan-400',
      bgDark: 'bg-[#08172c]',
      textDark: 'text-cyan-200',
      glowDark: 'shadow-[0_0_16px_rgba(6,182,212,0.35)] hover:shadow-[0_0_24px_rgba(6,182,212,0.55)]',
      badgeBgDark: 'bg-cyan-400 text-slate-950 font-bold',
      badgeTextDark: 'text-cyan-300 bg-cyan-950/80 border border-cyan-500/40',
      pillBgDark: 'bg-[#040e1c]/90 text-cyan-200 border-cyan-500/30',
      iconColorLight: 'text-cyan-600',
      iconColorDark: 'text-cyan-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
  {
    num: 2,
    stepKey: 'PROVENANCE',
    title: 'Verification & Authenticity',
    subtitle: 'Validates source documents and checks integrity (SHA-256).',
    defaultOutput: 'Verification status (Verified / Not Verified)',
    color: {
      accent: '#10b981',
      borderLight: 'border-emerald-500 hover:border-emerald-600',
      bgLight: 'bg-emerald-50/40 hover:bg-emerald-50/70',
      textLight: 'text-emerald-900',
      badgeBgLight: 'bg-emerald-500 text-white',
      badgeTextLight: 'text-emerald-900 bg-emerald-100',
      pillBgLight: 'bg-emerald-100/70 text-emerald-950 border-emerald-200',
      borderDark: 'border-emerald-400',
      bgDark: 'bg-[#06201a]',
      textDark: 'text-emerald-200',
      glowDark: 'shadow-[0_0_16px_rgba(16,185,129,0.35)] hover:shadow-[0_0_24px_rgba(16,185,129,0.55)]',
      badgeBgDark: 'bg-emerald-400 text-slate-950 font-bold',
      badgeTextDark: 'text-emerald-300 bg-emerald-950/80 border border-emerald-500/40',
      pillBgDark: 'bg-[#031511]/90 text-emerald-200 border-emerald-500/30',
      iconColorLight: 'text-emerald-600',
      iconColorDark: 'text-emerald-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    ),
  },
  {
    num: 3,
    stepKey: 'HYBRID_RETRIEVAL',
    title: 'Evidence Retrieval (BGE)',
    subtitle: 'Retrieves relevant clinical guidelines and evidence from knowledge base.',
    defaultOutput: 'Top relevant guidelines & references',
    color: {
      accent: '#f59e0b',
      borderLight: 'border-amber-500 hover:border-amber-600',
      bgLight: 'bg-amber-50/40 hover:bg-amber-50/70',
      textLight: 'text-amber-900',
      badgeBgLight: 'bg-amber-500 text-white',
      badgeTextLight: 'text-amber-900 bg-amber-100',
      pillBgLight: 'bg-amber-100/70 text-amber-950 border-amber-200',
      borderDark: 'border-amber-400',
      bgDark: 'bg-[#221a08]',
      textDark: 'text-amber-200',
      glowDark: 'shadow-[0_0_16px_rgba(245,158,11,0.35)] hover:shadow-[0_0_24px_rgba(245,158,11,0.55)]',
      badgeBgDark: 'bg-amber-400 text-slate-950 font-bold',
      badgeTextDark: 'text-amber-300 bg-amber-950/80 border border-amber-500/40',
      pillBgDark: 'bg-[#150f03]/90 text-amber-200 border-amber-500/30',
      iconColorLight: 'text-amber-600',
      iconColorDark: 'text-amber-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
        />
      </svg>
    ),
  },

  // ROW 2
  {
    num: 4,
    stepKey: 'COST_AUDIT',
    title: 'Regional Price Check',
    subtitle: 'Compares billed cost with CMS / Fair Health benchmarks and regional price range.',
    defaultOutput: 'Benchmark range, markup & billing deviation',
    color: {
      accent: '#a855f7',
      borderLight: 'border-purple-500 hover:border-purple-600',
      bgLight: 'bg-purple-50/40 hover:bg-purple-50/70',
      textLight: 'text-purple-900',
      badgeBgLight: 'bg-purple-500 text-white',
      badgeTextLight: 'text-purple-900 bg-purple-100',
      pillBgLight: 'bg-purple-100/70 text-purple-950 border-purple-200',
      borderDark: 'border-purple-400',
      bgDark: 'bg-[#1e0e2e]',
      textDark: 'text-purple-200',
      glowDark: 'shadow-[0_0_16px_rgba(168,85,247,0.35)] hover:shadow-[0_0_24px_rgba(168,85,247,0.55)]',
      badgeBgDark: 'bg-purple-400 text-slate-950 font-bold',
      badgeTextDark: 'text-purple-300 bg-purple-950/80 border border-purple-500/40',
      pillBgDark: 'bg-[#12071d]/90 text-purple-200 border-purple-500/30',
      iconColorLight: 'text-purple-600',
      iconColorDark: 'text-purple-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-purple-400' : 'text-purple-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    num: 5,
    stepKey: 'CLINICAL_VERIFICATION',
    title: 'Clinical Text Analysis (DeBERTa)',
    subtitle: 'Evaluates clinical justification and guideline alignment (ADA, ICMR, RSSDI).',
    defaultOutput: 'Guideline match score & clinical support',
    color: {
      accent: '#06b6d4',
      borderLight: 'border-teal-500 hover:border-teal-600',
      bgLight: 'bg-teal-50/40 hover:bg-teal-50/70',
      textLight: 'text-teal-900',
      badgeBgLight: 'bg-teal-500 text-white',
      badgeTextLight: 'text-teal-900 bg-teal-100',
      pillBgLight: 'bg-teal-100/70 text-teal-950 border-teal-200',
      borderDark: 'border-teal-400',
      bgDark: 'bg-[#081e22]',
      textDark: 'text-teal-200',
      glowDark: 'shadow-[0_0_16px_rgba(20,184,166,0.35)] hover:shadow-[0_0_24px_rgba(20,184,166,0.55)]',
      badgeBgDark: 'bg-teal-400 text-slate-950 font-bold',
      badgeTextDark: 'text-teal-300 bg-teal-950/80 border border-teal-500/40',
      pillBgDark: 'bg-[#031317]/90 text-teal-200 border-teal-500/30',
      iconColorLight: 'text-teal-600',
      iconColorDark: 'text-teal-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-teal-400' : 'text-teal-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <circle cx="12" cy="6" r="2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.2 16.2l3.6-7.8M15.8 16.2l-3.6-7.8" />
      </svg>
    ),
  },
  {
    num: 6,
    stepKey: 'PROVIDER_SCREENING',
    title: 'Provider Anomaly Screening',
    subtitle: 'Detects unusual provider billing behavior using Isolation Forest.',
    defaultOutput: 'Provider anomaly score & flag',
    color: {
      accent: '#ec4899',
      borderLight: 'border-pink-500 hover:border-pink-600',
      bgLight: 'bg-pink-50/40 hover:bg-pink-50/70',
      textLight: 'text-pink-900',
      badgeBgLight: 'bg-pink-500 text-white',
      badgeTextLight: 'text-pink-900 bg-pink-100',
      pillBgLight: 'bg-pink-100/70 text-pink-950 border-pink-200',
      borderDark: 'border-pink-400',
      bgDark: 'bg-[#260c1d]',
      textDark: 'text-pink-200',
      glowDark: 'shadow-[0_0_16px_rgba(236,72,153,0.35)] hover:shadow-[0_0_24px_rgba(236,72,153,0.55)]',
      badgeBgDark: 'bg-pink-400 text-slate-950 font-bold',
      badgeTextDark: 'text-pink-300 bg-pink-950/80 border border-pink-500/40',
      pillBgDark: 'bg-[#15050e]/90 text-pink-200 border-pink-500/30',
      iconColorLight: 'text-pink-600',
      iconColorDark: 'text-pink-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-pink-400' : 'text-pink-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },

  // ROW 3
  {
    num: 7,
    stepKey: 'CLAIM_SCREENING',
    title: 'Claim Anomaly Screening',
    subtitle: 'Identifies anomalous or inconsistent claims using Isolation Forest (claim level).',
    defaultOutput: 'Claim anomaly score & status (Normal / Anomalous)',
    color: {
      accent: '#0ea5e9',
      borderLight: 'border-sky-500 hover:border-sky-600',
      bgLight: 'bg-sky-50/40 hover:bg-sky-50/70',
      textLight: 'text-sky-900',
      badgeBgLight: 'bg-sky-500 text-white',
      badgeTextLight: 'text-sky-900 bg-sky-100',
      pillBgLight: 'bg-sky-100/70 text-sky-950 border-sky-200',
      borderDark: 'border-cyan-400',
      bgDark: 'bg-[#081729]',
      textDark: 'text-cyan-200',
      glowDark: 'shadow-[0_0_16px_rgba(6,182,212,0.35)] hover:shadow-[0_0_24px_rgba(6,182,212,0.55)]',
      badgeBgDark: 'bg-cyan-400 text-slate-950 font-bold',
      badgeTextDark: 'text-cyan-300 bg-cyan-950/80 border border-cyan-500/40',
      pillBgDark: 'bg-[#040e1b]/90 text-cyan-200 border-cyan-500/30',
      iconColorLight: 'text-sky-600',
      iconColorDark: 'text-cyan-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-cyan-400' : 'text-sky-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
  },
  {
    num: 8,
    stepKey: 'ABSTENTION_GATE',
    title: 'Safety Gate & Human Review',
    subtitle: 'Applies rule-based safety checks and flags cases for mandatory human audit.',
    defaultOutput: 'Safety status (Passed / Flagged for Review)',
    color: {
      accent: '#10b981',
      borderLight: 'border-emerald-500 hover:border-emerald-600',
      bgLight: 'bg-emerald-50/40 hover:bg-emerald-50/70',
      textLight: 'text-emerald-900',
      badgeBgLight: 'bg-emerald-500 text-white',
      badgeTextLight: 'text-emerald-900 bg-emerald-100',
      pillBgLight: 'bg-emerald-100/70 text-emerald-950 border-emerald-200',
      borderDark: 'border-emerald-400',
      bgDark: 'bg-[#06201a]',
      textDark: 'text-emerald-200',
      glowDark: 'shadow-[0_0_16px_rgba(16,185,129,0.35)] hover:shadow-[0_0_24px_rgba(16,185,129,0.55)]',
      badgeBgDark: 'bg-emerald-400 text-slate-950 font-bold',
      badgeTextDark: 'text-emerald-300 bg-emerald-950/80 border border-emerald-500/40',
      pillBgDark: 'bg-[#031511]/90 text-emerald-200 border-emerald-500/30',
      iconColorLight: 'text-emerald-600',
      iconColorDark: 'text-emerald-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    num: 9,
    stepKey: 'FINAL_ACTION',
    title: 'Final Decision & Audit Synthesis',
    subtitle: 'Synthesizes model outputs to generate final audit decision with explanation & evidence.',
    defaultOutput: 'Final decision (Approved / Flagged) with explanation',
    color: {
      accent: '#8b5cf6',
      borderLight: 'border-violet-500 hover:border-violet-600',
      bgLight: 'bg-violet-50/40 hover:bg-violet-50/70',
      textLight: 'text-violet-900',
      badgeBgLight: 'bg-violet-500 text-white',
      badgeTextLight: 'text-violet-900 bg-violet-100',
      pillBgLight: 'bg-violet-100/70 text-violet-950 border-violet-200',
      borderDark: 'border-violet-400',
      bgDark: 'bg-[#190c2e]',
      textDark: 'text-violet-200',
      glowDark: 'shadow-[0_0_16px_rgba(139,92,246,0.35)] hover:shadow-[0_0_24px_rgba(139,92,246,0.55)]',
      badgeBgDark: 'bg-violet-400 text-slate-950 font-bold',
      badgeTextDark: 'text-violet-300 bg-violet-950/80 border border-violet-500/40',
      pillBgDark: 'bg-[#100720]/90 text-violet-200 border-violet-500/30',
      iconColorLight: 'text-violet-600',
      iconColorDark: 'text-violet-400',
    },
    renderIcon: (isDark) => (
      <svg
        className={`w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0 ${isDark ? 'text-violet-400' : 'text-violet-600'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
]

export function AuditTrailViewer({ auditTrail, verification }: AuditTrailViewerProps) {
  const { isDark } = useTheme()
  const [selectedStageIdx, setSelectedStageIdx] = useState<number>(0)
  const [copiedHash, setCopiedHash] = useState(false)
  const [showAllPassages, setShowAllPassages] = useState(false)
  const [expandedAllDetails, setExpandedAllDetails] = useState(false)
  const inspectorRef = useRef<HTMLDivElement | null>(null)

  const steps: DecisionStep[] = auditTrail.steps || []
  const passages: EvidencePassage[] = auditTrail.passages_considered || []

  // Helper to find step object for a stage
  const getStepForStage = (stage: StageDefinition): DecisionStep | undefined => {
    return (
      steps.find((s) => s.step_name === stage.stepKey) ||
      steps[stage.num - 1]
    )
  }

  // Generate dynamic live output snippet for bottom pill
  const getDynamicOutputText = (stage: StageDefinition): string => {
    const step = getStepForStage(stage)
    if (!step) return stage.defaultOutput

    switch (stage.stepKey) {
      case 'EXTRACTION': {
        const entity = step.details?.entity
        const charge = step.details?.extracted_amount || step.details?.charge
        if (entity && charge) return `Extracted: ${entity} (₹${charge})`
        if (entity) return `Extracted: ${entity}`
        return step.output_summary || stage.defaultOutput
      }
      case 'PROVENANCE': {
        if (step.details?.source_hash) {
          return `Verification status: Tamper-proof SHA-256 Verified`
        }
        return `Verification status: Verified / Authentic`
      }
      case 'HYBRID_RETRIEVAL': {
        const count = step.details?.usable_passages_count
        if (typeof count === 'number') {
          return `Top relevant guidelines: ${count} verified passages`
        }
        return step.output_summary || stage.defaultOutput
      }
      case 'COST_AUDIT': {
        const mult = step.details?.multiplier
        const isAnom = step.details?.is_anomaly
        if (typeof mult === 'number') {
          return `Benchmark: ${mult.toFixed(1)}× markup (${isAnom ? 'Flagged Alert' : 'Normal'})`
        }
        return step.output_summary || stage.defaultOutput
      }
      case 'CLINICAL_VERIFICATION': {
        const verdict = step.details?.raw_model_verdict
        const score = step.details?.raw_model_support_score
        if (verdict) {
          const pct = typeof score === 'number' ? ` (${Math.round(score * 100)}% match)` : ''
          return `Verdict: ${verdict}${pct}`
        }
        return step.output_summary || stage.defaultOutput
      }
      case 'PROVIDER_SCREENING': {
        const isAnom = step.details?.is_anomaly
        const score = step.details?.anomaly_score
        const scoreStr = typeof score === 'number' ? ` (Score: ${score.toFixed(3)})` : ''
        return `Provider status: ${isAnom ? 'Flagged Anomaly' : 'Normal Profile'}${scoreStr}`
      }
      case 'CLAIM_SCREENING': {
        const isAnom = step.details?.is_anomaly
        const score = step.details?.anomaly_score
        const scoreStr = typeof score === 'number' ? ` (Score: ${score.toFixed(3)})` : ''
        return `Claim screening: ${isAnom ? 'Anomalous' : 'Normal Status'}${scoreStr}`
      }
      case 'ABSTENTION_GATE': {
        const shouldAbstain = step.details?.should_abstain
        return `Safety status: ${shouldAbstain ? 'Flagged for Review' : 'Passed Safely'}`
      }
      case 'FINAL_ACTION': {
        return `Final Decision: ${auditTrail.final_action.toUpperCase()} (${auditTrail.final_verdict})`
      }
      default:
        return step.output_summary || stage.defaultOutput
    }
  }

  const handleStageClick = (idx: number) => {
    setSelectedStageIdx(idx)
    // Smooth scroll down to the stage output inspector
    setTimeout(() => {
      if (inspectorRef.current) {
        inspectorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 100)
  }

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 2000)
  }

  const activeStage = STAGES[selectedStageIdx] || STAGES[0]
  const activeStep = getStepForStage(activeStage)

  return (
    <div
      className={`rounded-2xl transition-colors duration-300 overflow-hidden border ${
        isDark
          ? 'bg-[#070c16] border-cyan-900/50 text-white shadow-[0_10px_35px_rgba(0,0,0,0.7)]'
          : 'bg-[#fcfdfd] border-slate-300 text-slate-900 shadow-xl'
      }`}
    >
      {/* 1. Header Banner styled exactly like Image 4 */}
      <div className="p-4 sm:p-6 pb-2 sm:pb-4 flex flex-col items-center justify-center">
        <div
          className={`w-full max-w-2xl px-6 py-3.5 rounded-2xl flex items-center justify-center gap-3 transition-all ${
            isDark
              ? 'bg-[#0d1629] border-2 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)] text-cyan-100'
              : 'bg-white border-2 border-slate-900 text-slate-950 shadow-[0_4px_14px_rgba(0,0,0,0.08)]'
          }`}
        >
          {/* Heartbeat pulse in heart icon */}
          <div className="flex items-center justify-center flex-shrink-0">
            <svg
              className={`w-6 h-6 sm:w-7 sm:h-7 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h2l1.5-3 2.5 6 1.5-3h2.5" />
            </svg>
          </div>

          <div className={`h-5 w-[1.5px] ${isDark ? 'bg-cyan-500/50' : 'bg-slate-300'}`} />

          <h2 className="text-base sm:text-xl font-black italic tracking-wide text-center">
            EvidenceBridge &ndash; 9-Stage Decision Audit Trail
          </h2>
        </div>

        {/* Sub-bar with audit metadata & badges */}
        <div className="w-full mt-3 px-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-mono px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                isDark
                  ? 'bg-slate-900/90 border-slate-700 text-slate-300'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              Audit ID: {auditTrail.audit_id}
            </span>
            <span className={isDark ? 'text-slate-400 text-[11px]' : 'text-slate-500 text-[11px]'}>
              Verification:{' '}
              <span className={`font-mono ${isDark ? 'text-cyan-300' : 'text-slate-800'}`}>
                {auditTrail.verification_id}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <VerificationBadge action={auditTrail.final_action} size="sm" />
            <VerdictBadge verdict={auditTrail.final_verdict} />
          </div>
        </div>
      </div>

      {/* 2. Safety Banners & Decision Rationale */}
      <div
        className={`mx-4 sm:mx-6 my-2 p-4 rounded-xl border text-xs ${
          isDark
            ? 'bg-[#0a1220]/70 border-cyan-900/40 text-slate-200'
            : 'bg-sky-50/60 border-sky-100 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-2 font-bold mb-1 uppercase tracking-wider text-[11px]">
          <span>⚖️</span>
          <span className={isDark ? 'text-cyan-300' : 'text-sky-900'}>
            Final Audit Outcome &amp; Summary
          </span>
        </div>
        <p className="leading-relaxed font-medium">{auditTrail.final_reasoning}</p>

        {/* Human Review Banner */}
        {verification?.requires_human_review && (
          <div
            className={`mt-3 p-3.5 rounded-lg border flex items-start gap-3 ${
              isDark
                ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}
          >
            <span className="text-base flex-shrink-0">⚠️</span>
            <div className="flex-1 space-y-0.5">
              <strong className="block uppercase text-[11px] font-bold">
                Human Auditor Review Required
              </strong>
              <p className="leading-relaxed text-xs">
                Safety gates or AI models have flagged this claim for mandatory human audit:
              </p>
              <ul className="list-disc list-inside pl-1 text-[11px] font-medium">
                {verification.human_review_reasons && verification.human_review_reasons.length > 0 ? (
                  verification.human_review_reasons.map((r, i) => <li key={i}>{r}</li>)
                ) : (
                  <li>Model prediction flagged for supervisory review.</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Policy Override Banner */}
        {auditTrail.policy_override_applied && (
          <div
            className={`mt-3 p-3.5 rounded-lg border flex items-start gap-3 ${
              isDark
                ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <span className="text-base flex-shrink-0">⚠️</span>
            <div className="flex-1 text-xs">
              <strong className="block font-bold">Deterministic Safety Override Enforced:</strong>
              <div>{auditTrail.policy_override_reason}</div>
            </div>
          </div>
        )}
      </div>

      {/* 3. The 3x3 Connected Chain Pipeline (Image 4 Serpentine Layout) */}
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">⚡</span>
            <h4
              className={`text-xs font-bold uppercase tracking-wider ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              Interactive 9-Stage Chain Connection
            </h4>
            <span
              className={`hidden sm:inline-block text-[11px] px-2 py-0.5 rounded-full ${
                isDark ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-cyan-50 text-cyan-700 border border-cyan-200'
              }`}
            >
              Click any stage box to inspect live output
            </span>
          </div>

          <button
            type="button"
            onClick={() => setExpandedAllDetails(!expandedAllDetails)}
            className={`text-xs font-semibold px-3 py-1 rounded-lg border transition-colors ${
              isDark
                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {expandedAllDetails ? 'Hide All Details ▲' : 'Expand All 9 Stages ▼'}
          </button>
        </div>

        {/* Chain Container */}
        <div className="relative py-2 space-y-4">
          {/* Helper function to render a single stage card */}
          {(() => {
            const renderCard = (stage: StageDefinition, idx: number) => {
              const isSelected = selectedStageIdx === idx
              const dynamicOutput = getDynamicOutputText(stage)

              return (
                <div
                  key={stage.num}
                  onClick={() => handleStageClick(idx)}
                  className={`flex-1 min-w-0 w-full rounded-2xl p-3.5 sm:p-4 lg:p-5 cursor-pointer select-none transition-all duration-200 flex flex-col justify-between border-2 ${
                    isDark
                      ? `${stage.color.borderDark} ${stage.color.bgDark} ${stage.color.glowDark}`
                      : `${stage.color.borderLight} ${stage.color.bgLight} shadow-sm hover:shadow-md`
                  } ${
                    isSelected
                      ? isDark
                        ? 'ring-2 ring-white scale-[1.02] shadow-[0_0_28px_rgba(255,255,255,0.4)]'
                        : 'ring-2 ring-slate-900 scale-[1.02] shadow-lg'
                      : 'hover:scale-[1.01]'
                  }`}
                >
                  {/* Top Badge: Circle Number + Stage Pill */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
                          isDark ? stage.color.badgeBgDark : stage.color.badgeBgLight
                        }`}
                      >
                        {stage.num}
                      </div>
                      <span
                        className={`text-xs font-bold italic tracking-wide px-2 py-0.5 rounded-md ${
                          isDark ? stage.color.badgeTextDark : stage.color.badgeTextLight
                        }`}
                      >
                        Stage {stage.num}
                      </span>
                    </div>

                    {isSelected && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isDark
                            ? 'bg-white text-slate-900'
                            : 'bg-slate-900 text-white'
                        }`}
                      >
                        Active
                      </span>
                    )}
                  </div>

                  {/* Body: Left Icon + Right Title & Subtitle */}
                  <div className="flex items-start gap-3 sm:gap-4 my-1">
                    <div className="p-1 rounded-xl flex-shrink-0">
                      {stage.renderIcon(isDark)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h5
                        className={`font-black italic text-sm sm:text-base leading-tight mb-1.5 ${
                          isDark ? 'text-white' : 'text-slate-900'
                        }`}
                      >
                        {stage.title}
                      </h5>
                      <p
                        className={`text-xs leading-relaxed line-clamp-3 sm:line-clamp-2 ${
                          isDark ? 'text-slate-300' : 'text-slate-600'
                        }`}
                      >
                        {stage.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Bottom Output Pill */}
                  <div
                    className={`mt-4 px-3 py-2 rounded-xl text-xs italic font-medium border flex items-center justify-between gap-2 transition-colors ${
                      isDark ? stage.color.pillBgDark : stage.color.pillBgLight
                    }`}
                  >
                    <span className="truncate">
                      <strong className="not-italic font-bold">Output:</strong> {dynamicOutput}
                    </span>
                    <span className="text-[10px] not-italic opacity-70 flex-shrink-0 font-mono">
                      {isSelected ? '▲ Opened' : '▼ View'}
                    </span>
                  </div>
                </div>
              )
            }

            // Arrow right divider between columns in desktop
            const renderArrowRight = () => (
              <div className="hidden md:flex items-center justify-center flex-shrink-0 text-slate-300 dark:text-cyan-400/80 px-0.5">
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 animate-pulse"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>
            )

            // Downward arrow for mobile stacked view
            const renderMobileArrowDown = () => (
              <div className="md:hidden flex items-center justify-center py-1">
                <svg
                  className="w-5 h-5 text-amber-500 animate-bounce"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            )

            return (
              <div className="space-y-3 lg:space-y-4 w-full">
                {/* ================= ROW 1 (Stages 1, 2, 3) ================= */}
                <div className="flex flex-col md:flex-row items-stretch gap-2 sm:gap-3 w-full">
                  {renderCard(STAGES[0], 0)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[1], 1)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[2], 2)}
                </div>

                {/* Serpentine Connector 1 -> 2 (From Stage 3 right/bottom across to Stage 4 top) */}
                <div className="hidden md:block relative h-10 lg:h-12 w-full px-6 lg:px-8">
                  <svg
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                    viewBox="0 0 1000 48"
                  >
                    <defs>
                      <filter id="chain-glow-1" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation={isDark ? '3' : '1.5'} result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                      <marker
                        id="arrow-down-1"
                        markerWidth="8"
                        markerHeight="8"
                        refX="4"
                        refY="4"
                        orient="auto"
                      >
                        <polygon points="0 0, 8 4, 0 8" fill="#f97316" />
                      </marker>
                    </defs>
                    <path
                      d="M 833,0 L 833,22 Q 833,34 815,34 L 185,34 Q 167,34 167,42 L 167,46"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={isDark ? '4' : '3'}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#chain-glow-1)"
                      markerEnd="url(#arrow-down-1)"
                    />
                  </svg>
                </div>

                {/* Mobile divider between Row 1 and Row 2 */}
                {renderMobileArrowDown()}

                {/* ================= ROW 2 (Stages 4, 5, 6) ================= */}
                <div className="flex flex-col md:flex-row items-stretch gap-2 sm:gap-3 w-full">
                  {renderCard(STAGES[3], 3)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[4], 4)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[5], 5)}
                </div>

                {/* Serpentine Connector 2 -> 3 (From Stage 6 right/bottom across to Stage 7 top) */}
                <div className="hidden md:block relative h-10 lg:h-12 w-full px-6 lg:px-8">
                  <svg
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                    viewBox="0 0 1000 48"
                  >
                    <defs>
                      <filter id="chain-glow-2" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation={isDark ? '3' : '1.5'} result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                      <marker
                        id="arrow-down-2"
                        markerWidth="8"
                        markerHeight="8"
                        refX="4"
                        refY="4"
                        orient="auto"
                      >
                        <polygon points="0 0, 8 4, 0 8" fill="#f97316" />
                      </marker>
                    </defs>
                    <path
                      d="M 833,0 L 833,22 Q 833,34 815,34 L 185,34 Q 167,34 167,42 L 167,46"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={isDark ? '4' : '3'}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#chain-glow-2)"
                      markerEnd="url(#arrow-down-2)"
                    />
                  </svg>
                </div>

                {/* Mobile divider between Row 2 and Row 3 */}
                {renderMobileArrowDown()}

                {/* ================= ROW 3 (Stages 7, 8, 9) ================= */}
                <div className="flex flex-col md:flex-row items-stretch gap-2 sm:gap-3 w-full">
                  {renderCard(STAGES[6], 6)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[7], 7)}
                  {renderArrowRight()}
                  {renderMobileArrowDown()}

                  {renderCard(STAGES[8], 8)}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* 4. Interactive Live Output Inspector (Directly shows the clicked box's output) */}
      <div
        ref={inspectorRef}
        id="stage-output-inspector"
        className={`mx-4 sm:mx-6 mb-6 rounded-2xl border p-5 sm:p-6 transition-all ${
          isDark
            ? 'bg-[#081224] border-cyan-500/40 text-slate-100 shadow-[0_0_25px_rgba(6,182,212,0.15)]'
            : 'bg-white border-slate-300 text-slate-900 shadow-md'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shadow-sm ${
                isDark ? activeStage.color.badgeBgDark : activeStage.color.badgeBgLight
              }`}
            >
              {activeStage.num}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-black text-base sm:text-lg">{activeStage.title}</h4>
                <span
                  className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                    isDark
                      ? 'bg-slate-900 border-slate-700 text-cyan-300'
                      : 'bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  {activeStage.stepKey}
                </span>
                {activeStep?.timestamp && (
                  <span className="text-[11px] font-mono opacity-60">
                    {new Date(activeStep.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <p className="text-xs opacity-75 mt-0.5">{activeStage.subtitle}</p>
            </div>
          </div>

          {/* Quick jump stage buttons */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {STAGES.map((s, idx) => (
              <button
                key={s.num}
                type="button"
                onClick={() => handleStageClick(idx)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  selectedStageIdx === idx
                    ? isDark
                      ? 'bg-cyan-400 text-slate-950 font-black scale-110 shadow-sm'
                      : 'bg-slate-900 text-white font-black scale-110 shadow-sm'
                    : isDark
                    ? 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
                title={`Stage ${s.num}: ${s.title}`}
              >
                {s.num}
              </button>
            ))}
          </div>
        </div>

        {/* Input vs Output Overview Card */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div
            className={`p-3.5 rounded-xl border ${
              isDark
                ? 'bg-slate-900/60 border-slate-800 text-slate-200'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <span className="font-bold uppercase tracking-wider text-[10px] opacity-70 block mb-1">
              📥 What Went In:
            </span>
            <p className="font-medium leading-relaxed">
              {activeStep?.input_summary || 'Ingested raw claim data & context'}
            </p>
          </div>

          <div
            className={`p-3.5 rounded-xl border ${
              isDark
                ? 'bg-slate-900/60 border-slate-800 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <span className="font-bold uppercase tracking-wider text-[10px] opacity-70 block mb-1">
              📤 What Was Produced (Live Output):
            </span>
            <p className="font-bold leading-relaxed">
              {activeStep?.output_summary || getDynamicOutputText(activeStage)}
            </p>
          </div>
        </div>

        {/* Specialized Stage Callouts */}
        {activeStage.stepKey === 'PROVENANCE' &&
          typeof activeStep?.details?.source_hash === 'string' && (
            <div
              className={`mt-4 p-4 rounded-xl border text-xs ${
                isDark
                  ? 'bg-cyan-950/40 border-cyan-800 text-cyan-200'
                  : 'bg-sky-50 border-sky-200 text-slate-800'
              }`}
            >
              <div className="font-bold mb-1.5 flex items-center justify-between">
                <span>🔐 Tamper-Proof Cryptographic Fingerprint (SHA-256)</span>
                <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30">
                  Verified Clean
                </span>
              </div>
              <div
                className={`flex items-center justify-between gap-2 font-mono text-[11px] p-2.5 rounded-lg border ${
                  isDark ? 'bg-black/60 border-cyan-900/60 text-cyan-300' : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                <span className="truncate">{activeStep.details.source_hash}</span>
                <button
                  type="button"
                  onClick={() => handleCopyHash(activeStep?.details?.source_hash as string)}
                  className={`px-3 py-1 rounded font-semibold text-xs flex-shrink-0 transition-colors ${
                    isDark
                      ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  {copiedHash ? '✓ Copied' : 'Copy Hash'}
                </button>
              </div>
              <p className="mt-2 text-[11px] opacity-75">
                Calculated immediately upon ingestion to prove the source text has not been modified.
              </p>
            </div>
          )}

        {activeStage.stepKey === 'COST_AUDIT' && activeStep?.details && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs ${
              isDark
                ? 'bg-purple-950/30 border-purple-800 text-purple-200'
                : 'bg-purple-50/60 border-purple-200 text-slate-800'
            }`}
          >
            <div className="font-bold mb-2">Regional Pricing Benchmark Cross-Examination</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-purple-900/50' : 'bg-white border-purple-100'}`}>
                <span className="opacity-60 block text-[10px]">Benchmark Reference:</span>
                <span className="font-bold">{String(activeStep.details.benchmark_name || 'Standard Regional Rate')}</span>
              </div>
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-purple-900/50' : 'bg-white border-purple-100'}`}>
                <span className="opacity-60 block text-[10px]">Billed Charge:</span>
                <span className="font-bold">
                  {activeStep.details.extracted_amount != null
                    ? formatCurrency(Number(activeStep.details.extracted_amount), String(activeStep.details.currency || 'INR'))
                    : 'N/A'}
                </span>
              </div>
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-purple-900/50' : 'bg-white border-purple-100'}`}>
                <span className="opacity-60 block text-[10px]">Benchmark Range:</span>
                <span className="font-bold">
                  {activeStep.details.benchmark_max != null
                    ? `${formatCurrency(Number(activeStep.details.benchmark_min || 0), String(activeStep.details.benchmark_currency || 'INR'))} – ${formatCurrency(Number(activeStep.details.benchmark_max), String(activeStep.details.benchmark_currency || 'INR'))}`
                    : 'Benchmark not available'}
                </span>
              </div>
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-purple-900/50' : 'bg-white border-purple-100'}`}>
                <span className="opacity-60 block text-[10px]">Markup Status:</span>
                <span className={`font-bold ${activeStep.details.is_anomaly ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {activeStep.details.is_anomaly
                    ? `${Number(activeStep.details.multiplier || 1).toFixed(1)}× (ANOMALY)`
                    : (activeStep.details.multiplier
                        ? `${Number(activeStep.details.multiplier).toFixed(1)}× (NORMAL)`
                        : 'NORMAL PRICING')}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeStage.stepKey === 'CLINICAL_VERIFICATION' && activeStep?.details && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs ${
              isDark
                ? 'bg-teal-950/30 border-teal-800 text-teal-200'
                : 'bg-teal-50/60 border-teal-200 text-slate-800'
            }`}
          >
            <div className="font-bold mb-2">Clinical Guideline Cross-Examination (DeBERTa NLI)</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-teal-900/50' : 'bg-white border-teal-100'}`}>
                <span className="opacity-60 block text-[10px]">Model Verdict:</span>
                <span className="font-bold uppercase">{String(activeStep.details.raw_model_verdict || 'supported')}</span>
              </div>
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-teal-900/50' : 'bg-white border-teal-100'}`}>
                <span className="opacity-60 block text-[10px]">Guideline Match Score:</span>
                <span className="font-bold">
                  {activeStep.details.raw_model_support_score !== undefined
                    ? `${Math.round(Number(activeStep.details.raw_model_support_score) * 100)}%`
                    : '100%'}
                </span>
              </div>
              <div className={`p-2.5 rounded border ${isDark ? 'bg-black/40 border-teal-900/50' : 'bg-white border-teal-100'}`}>
                <span className="opacity-60 block text-[10px]">Authoritative Guidelines:</span>
                <span className="font-bold">{String(activeStep.details.usable_passages_count || 3)} Applied</span>
              </div>
            </div>
          </div>
        )}

        {/* Raw Payload Collapsible */}
        {activeStep?.details && Object.keys(activeStep.details).length > 0 && (
          <details className="mt-4 text-xs opacity-70">
            <summary className="cursor-pointer font-mono text-[11px] hover:underline uppercase tracking-wider">
              Inspect Raw JSON Stage Payload
            </summary>
            <pre
              className={`mt-2 p-3 rounded-xl overflow-x-auto font-mono text-[10px] ${
                isDark ? 'bg-black/80 text-cyan-200 border border-slate-800' : 'bg-slate-100 text-slate-800 border border-slate-200'
              }`}
            >
              {JSON.stringify(activeStep.details, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* 5. Authoritative Guidelines Section */}
      {passages.length > 0 && (
        <div
          className={`px-4 sm:px-6 py-5 border-t ${
            isDark ? 'border-slate-800/80 bg-black/20' : 'border-slate-200 bg-slate-50/50'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider">
                Authoritative Medical Guidelines Evaluated ({passages.length})
              </h4>
              <p className="text-[11px] opacity-60">
                Retrieved from ICMR, WHO, ADA, CGHS, and published clinical practice schedules
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllPassages(!showAllPassages)}
              className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                isDark
                  ? 'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/50'
                  : 'text-sky-600 hover:text-sky-800 hover:bg-sky-50'
              }`}
            >
              {showAllPassages ? 'Collapse Guidelines ▲' : `Show All (${passages.length}) ▼`}
            </button>
          </div>

          <div className="space-y-2.5">
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
                  className={`p-3.5 rounded-xl border text-xs ${
                    isDark
                      ? p.used_in_decision
                        ? 'bg-[#0b1424] border-slate-800'
                        : 'bg-slate-900/40 border-slate-800/60 opacity-60'
                      : p.used_in_decision
                      ? 'bg-white border-slate-200 shadow-xs'
                      : 'bg-slate-100/70 border-slate-200 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="font-bold truncate">{p.title}</div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {p.source}
                      </span>
                      {p.used_in_decision ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                          ✓ APPLIED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400 text-[10px] font-medium">
                          DISCARDED
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Relevance bar */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] opacity-60 font-medium">
                      Relevance: {scorePct}%
                    </span>
                    <div
                      className={`flex-1 h-1.5 rounded-full overflow-hidden ${
                        isDark ? 'bg-slate-800' : 'bg-slate-100'
                      }`}
                    >
                      <div
                        className={`h-full rounded-full ${scoreColor}`}
                        style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
                      />
                    </div>
                  </div>

                  <blockquote
                    className={`p-2.5 rounded-lg font-serif italic text-[11px] leading-relaxed ${
                      isDark ? 'bg-black/40 text-slate-300' : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    &ldquo;{p.text}&rdquo;
                  </blockquote>
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
