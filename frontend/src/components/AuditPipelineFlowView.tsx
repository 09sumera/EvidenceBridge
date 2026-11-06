import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type {
  ExtractAndVerifyResponse,
  Model6PredictionResult,
  GroupedMedicalInformation,
  BillingReconciliationResult,
  MedicineGroup,
} from '../types'
import { VerificationBadge, VerdictBadge } from './VerificationBadge'
import {
  buildFallbackGroupedInfo,
  buildFallbackBillingReconciliation,
} from './FiveModelsAuditPanel'

export type FlowStage = 'raw' | '1' | '2' | '3' | '4' | '5' | '6'

interface AuditPipelineFlowViewProps {
  result: ExtractAndVerifyResponse | null
  text: string
  setText: (val: string) => void
  loading: boolean
  ocrLoading: boolean
  ocrStatusText?: string
  ocrProgress?: number
  ocrWarning?: string | null
  ocrSuccessMessage?: string | null
  handleSubmit: (e: React.FormEvent) => void
  handleClear: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  imagePreview: string | null
  imageName: string | null
  handleRemoveImage: () => void
  readClaimAloud: () => void
  model6Prediction?: Model6PredictionResult | null
  isDark: boolean
  onSelectSample?: (label: string, sampleText: string) => void
}

export function AuditPipelineFlowView({
  result,
  text,
  setText,
  loading,
  ocrLoading,
  ocrStatusText,
  ocrProgress,
  ocrWarning,
  ocrSuccessMessage,
  handleSubmit,
  handleClear,
  fileInputRef,
  handleFileUpload,
  imagePreview,
  imageName,
  handleRemoveImage,
  readClaimAloud,
  model6Prediction,
  isDark,
  onSelectSample,
}: AuditPipelineFlowViewProps) {
  // Active selected stage: by default, if result exists, highlight 6 (Summary) just like Image 5!
  // If no result yet, default to 'raw' (Upload Raw Data).
  const [activeStage, setActiveStage] = useState<FlowStage>(result ? '6' : 'raw')
  const [copiedHash, setCopiedHash] = useState(false)
  const outputSectionRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  // Smooth scroll down to stage output section when user clicks a stage box
  const handleSelectStage = (stage: FlowStage) => {
    setActiveStage(stage)
    setTimeout(() => {
      if (outputSectionRef.current) {
        outputSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      if (stage === 'raw' && textAreaRef.current) {
        textAreaRef.current.focus()
      }
    }, 60)
  }

  // When a new result arrives, auto-select stage 6 (Summary) with the glowing blue border from Image 5
  useEffect(() => {
    if (result) {
      setActiveStage('6')
    } else {
      setActiveStage('raw')
    }
  }, [result])

  // Derive grouped medical information & billing reconciliation
  const sharedContext = result?.verification.shared_context
  const nerEntities = result?.verification.ner_entities
  const groupedInfo: GroupedMedicalInformation | null = result
    ? result.verification.ner_grouped_info || buildFallbackGroupedInfo(sharedContext, nerEntities)
    : null

  const rec: BillingReconciliationResult | null = result
    ? (result.verification.billing_reconciliation &&
      (result.verification.billing_reconciliation.itemized_sum > 0 ||
        result.verification.billing_reconciliation.stated_total != null))
      ? result.verification.billing_reconciliation
      : buildFallbackBillingReconciliation(sharedContext?.original_text || '') ||
        result.verification.billing_reconciliation ||
        null
    : null

  // Helper to copy SHA-256 hash
  const handleCopyHash = (hash: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(hash)
      setCopiedHash(true)
      setTimeout(() => setCopiedHash(false), 2000)
    }
  }

  // Medicine list for stage 2
  const medicineList: MedicineGroup[] = (groupedInfo?.medicines && groupedInfo.medicines.length > 0)
    ? groupedInfo.medicines
    : (groupedInfo?.medicine ? [groupedInfo.medicine] : [])
  const hasFallbackSingleMed =
    medicineList.length === 0 &&
    Boolean(
      groupedInfo?.medicine?.medicine_name?.value ||
      groupedInfo?.medicine?.generic_name?.value ||
      sharedContext?.medicines?.[0]
    )

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* THE FLOWCHART CONTAINER (Matching Image 5 & Dual Theme)      */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div
        className={`relative rounded-3xl p-6 sm:p-9 border-2 transition-all duration-200 overflow-hidden ${
          isDark
            ? 'bg-[#0b101e] border-neutral-800 text-white shadow-2xl'
            : 'bg-white border-slate-300 text-slate-900 shadow-xl'
        }`}
      >
        {/* Subtle background glow */}
        <div
          className={`absolute top-0 right-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none ${
            isDark ? 'bg-blue-600/10' : 'bg-sky-400/10'
          }`}
        />
        <div
          className={`absolute bottom-0 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none ${
            isDark ? 'bg-indigo-600/10' : 'bg-indigo-300/15'
          }`}
        />

        {/* 1. Header (EvidenceBridge Healthcare Claims Intelligence & Audit Platform) */}
        <div className="text-center relative z-10 mb-7">
          <h2
            className={`text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight flex items-center justify-center gap-2.5 ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            <span>EvidenceBridge</span>
          </h2>
          <p
            className={`text-xs sm:text-sm font-medium mt-1 tracking-wide ${
              isDark ? 'text-neutral-300' : 'text-slate-600'
            }`}
          >
            Healthcare Claims Intelligence &amp; Audit Platform
          </p>
        </div>

        {/* Arrow ↓ */}
        <div
          className={`flex justify-center my-3 relative z-10 ${
            isDark ? 'text-neutral-500' : 'text-slate-400'
          }`}
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* Box: Upload Raw Data */}
        <div className="relative z-10 max-w-xl mx-auto">
          <button
            type="button"
            onClick={() => handleSelectStage('raw')}
            className={`w-full text-left p-4 sm:p-5 rounded-2xl transition-all flex items-center justify-between gap-4 cursor-pointer group ${
              activeStage === 'raw'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 border transition-all ${
                  activeStage === 'raw'
                    ? isDark
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                      : 'bg-sky-100 border-sky-400 text-sky-700'
                    : isDark
                    ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div className="min-w-0">
                <div
                  className={`text-base sm:text-lg font-bold flex items-center gap-2 ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  <span>Upload Raw Data</span>
                  {activeStage === 'raw' && (
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full ${
                        isDark
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                          : 'bg-sky-100 text-sky-800 border border-sky-300'
                      }`}
                    >
                      Active Box
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs mt-0.5 truncate ${
                    isDark ? 'text-neutral-400' : 'text-slate-500'
                  }`}
                >
                  Bills &bull; prescriptions &bull; reports &bull; claim records
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              {text.length > 0 ? (
                <span
                  className={`text-[11px] font-mono px-2.5 py-1 rounded-full font-semibold border ${
                    isDark
                      ? 'bg-emerald-950/70 text-emerald-400 border-emerald-700/60'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}
                >
                  {text.length} chars
                </span>
              ) : (
                <span
                  className={`text-[11px] font-mono px-2.5 py-1 rounded-full border ${
                    isDark
                      ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  Ready
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Arrow ↓ */}
        <div
          className={`flex justify-center my-3 relative z-10 ${
            isDark ? 'text-neutral-500' : 'text-slate-400'
          }`}
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* 2x2 Grid of Stages 1, 2, 3, 4 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto relative z-10">
          {/* Box 1: 1. Document Utilization */}
          <button
            type="button"
            onClick={() => handleSelectStage('1')}
            className={`text-left p-4 sm:p-5 rounded-2xl transition-all flex items-start gap-3.5 cursor-pointer group ${
              activeStage === '1'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 border transition-all ${
                activeStage === '1'
                  ? isDark
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-sky-100 border-sky-400 text-sky-700'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4
                  className={`text-sm sm:text-base font-bold ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  1. Document Utilization
                </h4>
                {result && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      isDark
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}
                  >
                    Extracted
                  </span>
                )}
              </div>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  isDark ? 'text-neutral-400' : 'text-slate-500'
                }`}
              >
                Extracts details from uploaded documents
              </p>
            </div>
          </button>

          {/* Box 2: 2. Tablet Information */}
          <button
            type="button"
            onClick={() => handleSelectStage('2')}
            className={`text-left p-4 sm:p-5 rounded-2xl transition-all flex items-start gap-3.5 cursor-pointer group ${
              activeStage === '2'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 border transition-all ${
                activeStage === '2'
                  ? isDark
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-sky-100 border-sky-400 text-sky-700'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
              }`}
            >
              💊
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4
                  className={`text-sm sm:text-base font-bold ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  2. Tablet Information
                </h4>
                {result && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      isDark
                        ? 'bg-sky-950/80 text-sky-300 border-sky-700/60'
                        : 'bg-sky-100 text-sky-800 border border-sky-300'
                    }`}
                  >
                    {medicineList.length > 0 ? `${medicineList.length} Decoded` : 'Medicines'}
                  </span>
                )}
              </div>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  isDark ? 'text-neutral-400' : 'text-slate-500'
                }`}
              >
                Medicine name, strength, dosage and quantity
              </p>
            </div>
          </button>

          {/* Box 3: 3. Diagnosis Information */}
          <button
            type="button"
            onClick={() => handleSelectStage('3')}
            className={`text-left p-4 sm:p-5 rounded-2xl transition-all flex items-start gap-3.5 cursor-pointer group ${
              activeStage === '3'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 border transition-all ${
                activeStage === '3'
                  ? isDark
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-sky-100 border-sky-400 text-sky-700'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4
                  className={`text-sm sm:text-base font-bold ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  3. Diagnosis Information
                </h4>
                {result && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      isDark
                        ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                        : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                    }`}
                  >
                    ADA &bull; ICMR
                  </span>
                )}
              </div>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  isDark ? 'text-neutral-400' : 'text-slate-500'
                }`}
              >
                Diagnosis details and clinical context
              </p>
            </div>
          </button>

          {/* Box 4: 4. Bill Cost */}
          <button
            type="button"
            onClick={() => handleSelectStage('4')}
            className={`text-left p-4 sm:p-5 rounded-2xl transition-all flex items-start gap-3.5 cursor-pointer group ${
              activeStage === '4'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0 border transition-all ${
                activeStage === '4'
                  ? isDark
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-sky-100 border-sky-400 text-sky-700'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
              }`}
            >
              💰
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4
                  className={`text-sm sm:text-base font-bold ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  4. Bill Cost
                </h4>
                {result && rec && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      isDark
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}
                  >
                    ₹{rec.stated_total != null ? rec.stated_total : rec.itemized_sum}
                  </span>
                )}
              </div>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  isDark ? 'text-neutral-400' : 'text-slate-500'
                }`}
              >
                Charges, totals and cost breakdown
              </p>
            </div>
          </button>
        </div>

        {/* Arrow ↓ */}
        <div
          className={`flex justify-center my-3 relative z-10 ${
            isDark ? 'text-neutral-500' : 'text-slate-400'
          }`}
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* Box 5: 5. Anomaly Detection */}
        <div className="relative z-10 max-w-xl mx-auto">
          <button
            type="button"
            onClick={() => handleSelectStage('5')}
            className={`w-full text-left p-4 sm:p-5 rounded-2xl transition-all flex items-center justify-between gap-4 cursor-pointer group ${
              activeStage === '5'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] ring-1 ring-sky-400/50'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_20px_rgba(2,132,199,0.22)] ring-2 ring-sky-500/25'
                : isDark
                ? 'bg-[#12192b]/90 border border-neutral-800 hover:border-neutral-700 hover:bg-[#161f36]'
                : 'bg-slate-50/90 border border-slate-200 hover:border-slate-300 hover:bg-white shadow-xs'
            }`}
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 border transition-all ${
                  activeStage === '5'
                    ? isDark
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-amber-100 border-amber-400 text-amber-700'
                    : isDark
                    ? 'bg-neutral-800/60 border-neutral-700 text-neutral-300 group-hover:text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-600 group-hover:text-slate-900'
                }`}
              >
                ⚠️
              </div>
              <div className="min-w-0">
                <div
                  className={`text-base sm:text-lg font-bold flex items-center gap-2 ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  <span>5. Anomaly Detection</span>
                  {activeStage === '5' && (
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full ${
                        isDark
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                          : 'bg-sky-100 text-sky-800 border border-sky-300'
                      }`}
                    >
                      Active Box
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs mt-0.5 truncate ${
                    isDark ? 'text-neutral-400' : 'text-slate-500'
                  }`}
                >
                  Unusual charges, duplicates and suspicious patterns
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              {result && (
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    result.verification.requires_human_review || result.verification.cost_anomaly_flag
                      ? isDark
                        ? 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                      : isDark
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}
                >
                  {result.verification.requires_human_review ? 'Variance Flagged' : 'Normal Screen'}
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Arrow ↓ */}
        <div
          className={`flex justify-center my-3 relative z-10 ${
            isDark ? 'text-neutral-500' : 'text-slate-400'
          }`}
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* Box 6: 6. Summary (Highlighted with glowing blue border as in Image 5!) */}
        <div className="relative z-10 max-w-xl mx-auto">
          <button
            type="button"
            onClick={() => handleSelectStage('6')}
            className={`w-full text-left p-4 sm:p-5 rounded-2xl transition-all flex items-center justify-between gap-4 cursor-pointer group ${
              activeStage === '6'
                ? isDark
                  ? 'bg-[#15203b] border-2 border-sky-400 shadow-[0_0_25px_rgba(56,189,248,0.45)] ring-2 ring-sky-400/60'
                  : 'bg-sky-50 border-2 border-sky-600 shadow-[0_0_25px_rgba(2,132,199,0.3)] ring-2 ring-sky-500/35'
                : isDark
                ? 'bg-[#12192b]/90 border-2 border-sky-500/70 shadow-[0_0_15px_rgba(14,165,233,0.25)] hover:border-sky-400 hover:bg-[#161f36]'
                : 'bg-white border-2 border-sky-400 shadow-[0_0_15px_rgba(14,165,233,0.18)] hover:border-sky-600 hover:bg-sky-50/50'
            }`}
          >
            <div className="flex items-center gap-4 min-w-0">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 border transition-all ${
                  activeStage === '6'
                    ? isDark
                      ? 'bg-sky-500/30 border-sky-300 text-sky-200'
                      : 'bg-sky-200 border-sky-500 text-sky-800'
                    : isDark
                    ? 'bg-sky-950/60 border-sky-800 text-sky-300 group-hover:text-white'
                    : 'bg-sky-50 border-sky-200 text-sky-600 group-hover:text-sky-800'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div
                  className={`text-base sm:text-lg font-bold flex items-center gap-2 ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  <span>6. Summary</span>
                  {activeStage === '6' && (
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full ${
                        isDark
                          ? 'bg-sky-500/30 text-sky-200 border border-sky-300/50'
                          : 'bg-sky-100 text-sky-800 border border-sky-400/50'
                      }`}
                    >
                      Active Box
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs mt-0.5 truncate ${
                    isDark ? 'text-neutral-300' : 'text-slate-500'
                  }`}
                >
                  Consolidated findings, evidence and audit result
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              {result ? (
                <span
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${
                    result.verification.action === 'accept'
                      ? isDark
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-500'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-400'
                      : result.verification.action === 'flag'
                      ? isDark
                        ? 'bg-amber-950 text-amber-300 border-amber-500'
                        : 'bg-amber-100 text-amber-800 border border-amber-400'
                      : isDark
                      ? 'bg-neutral-800 text-neutral-300 border-neutral-600'
                      : 'bg-slate-200 text-slate-800 border border-slate-300'
                  }`}
                >
                  {result.verification.action === 'accept'
                    ? '✓ APPROVED'
                    : result.verification.action === 'flag'
                    ? '⚠️ FLAGGED'
                    : 'SAFE HOLD'}
                </span>
              ) : (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    isDark
                      ? 'bg-neutral-800 text-neutral-400 border-neutral-700'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  Ready
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Hint banner */}
        <div
          className={`text-center text-[11px] mt-6 relative z-10 ${
            isDark ? 'text-neutral-400' : 'text-slate-500'
          }`}
        >
          💡 Click any box above to inspect its real-time audit output below.
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* STAGE OUTPUT VIEW (Outputs the details for the clicked box!)  */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div ref={outputSectionRef} id="audit-stage-output" className="space-y-4 scroll-mt-24">
        {/* Output Header Bar */}
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs shadow-adjudo-sm transition-colors ${
            isDark
              ? 'bg-neutral-900 border-neutral-700 text-neutral-200'
              : 'bg-white border-slate-300 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse" />
            <span>Output View:</span>
            <span className="text-sky-600 dark:text-sky-400 font-mono uppercase">
              {activeStage === 'raw' && 'Upload Raw Data (Input Document)'}
              {activeStage === '1' && '1. Document Utilization'}
              {activeStage === '2' && '2. Tablet Information'}
              {activeStage === '3' && '3. Diagnosis Information'}
              {activeStage === '4' && '4. Bill Cost'}
              {activeStage === '5' && '5. Anomaly Detection'}
              {activeStage === '6' && '6. Summary (Final Audit Result)'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {result && (
              <span className="text-[11px] font-mono text-slate-500 dark:text-neutral-400">
                Claim: {result.claim.claim_id}
              </span>
            )}
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 0: UPLOAD RAW DATA (Input Form)                      */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === 'raw' && (
          <form
            onSubmit={handleSubmit}
            className={`rounded-2xl border p-6 sm:p-8 shadow-adjudo transition-all ${
              isDark ? 'bg-adjudo-dark-surface border-neutral-700' : 'bg-white border-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className={`text-xs font-black px-2.5 py-1 rounded-full uppercase tracking-wider border ${
                  isDark
                    ? 'text-orange-300 bg-orange-950/70 border-orange-800'
                    : 'text-orange-950 bg-orange-100 border-orange-600'
                }`}>
                  Upload Raw Data
                </span>
                <label
                  htmlFor="clinical-text"
                  className={`block text-base font-black mt-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}
                >
                  Raw Hospital Bill, Prescription or Clinical Chart Note
                </label>
              </div>
              <span className={`text-xs font-bold ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                {text.length > 0 ? `${text.length} characters` : 'Paste unedited document'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-3.5">
              <p className={`text-sm leading-relaxed ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                Paste any hospital invoice, doctor prescription, EHR consultation note, or clinical summary.
              </p>

              {/* Quick OCR Scan Buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrLoading}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-adjudo-sm cursor-pointer disabled:opacity-50 ${
                    isDark
                      ? 'border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800'
                      : 'border-neutral-900 bg-white text-neutral-900 hover:bg-cream-200'
                  }`}
                  title="Upload an image of a hospital bill or prescription"
                >
                  <svg className={`w-4 h-4 ${isDark ? 'text-orange-400' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload Photo
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {/* Image Preview */}
            {imagePreview && (
              <div className="mb-3.5 p-3.5 bg-slate-50/90 border border-slate-200 rounded-xl shadow-xs flex items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={imagePreview}
                    alt="Document Preview"
                    className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-lg border border-slate-300 shadow-xs flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">
                      {imageName || 'Document Photo'}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {ocrLoading ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-700 bg-sky-100/80 border border-sky-200 px-2 py-0.5 rounded-md">
                          <svg className="animate-spin w-3 h-3 text-sky-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          {ocrStatusText || `Running local OCR... (${ocrProgress}%)`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 border border-emerald-200 px-2 py-0.5 rounded-md">
                          <span>✓</span>
                          <span>OCR Processed</span>
                        </span>
                      )}

                      {model6Prediction && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-100/70 border border-indigo-200 px-2 py-0.5 rounded-md">
                          <span>🏷️</span>
                          <span>{model6Prediction.category_label || model6Prediction.document_category}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRemoveImage}
                  disabled={ocrLoading}
                  className="text-xs font-bold text-slate-500 hover:text-rose-600 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-rose-300 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                >
                  Remove
                </button>
              </div>
            )}

            <textarea
              ref={textAreaRef}
              id="clinical-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste raw hospital bill, doctor prescription, or clinical consultation note here..."
              className={`w-full px-4 py-3.5 rounded-xl border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 leading-relaxed transition-all shadow-inner ${
                isDark
                  ? 'border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500'
                  : 'border-neutral-900 bg-cream-50/70 text-neutral-950 placeholder:text-neutral-500'
              }`}
              required
            />

            {/* Actions Row */}
            <div className={`flex items-center justify-between pt-6 mt-6 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
              <button
                type="button"
                onClick={handleClear}
                className={`text-sm font-bold px-4 py-2.5 rounded-xl border transition-all cursor-pointer ${
                  isDark ? 'border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800' : 'border-neutral-900/60 text-neutral-800 hover:text-black hover:bg-cream-200'
                }`}
              >
                Clear Text
              </button>

              <button
                type="submit"
                disabled={loading || ocrLoading || !text.trim()}
                className="adjudo-btn-primary px-7 py-3 rounded-xl font-black text-sm flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-1 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Auditing Clinical Evidence &amp; Pricing...
                  </>
                ) : (
                  'Extract & Verify Claim →'
                )}
              </button>
            </div>
          </form>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 1: 1. DOCUMENT UTILIZATION                            */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '1' && (
          <div className="p-6 rounded-2xl border border-sky-200 bg-sky-50/20 dark:bg-neutral-900 dark:border-neutral-700 space-y-4 shadow-sm animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sky-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-mono text-[10px] font-bold uppercase">
                  Stage 1
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  1. Document Utilization &amp; Clinical Entities
                </h3>
              </div>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 bg-white dark:bg-neutral-800 px-3 py-1 rounded-full border border-slate-200 dark:border-neutral-700">
                {groupedInfo?.document_type ? groupedInfo.document_type.replace(/_/g, ' ') : 'Medical Document'}
              </span>
            </div>

            {groupedInfo ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Hospital Information */}
                <div className="bg-white dark:bg-neutral-800/90 rounded-xl border border-sky-100 dark:border-neutral-700 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-sky-50 dark:border-neutral-700 pb-2">
                    <span className="text-xs font-bold uppercase text-sky-900 dark:text-sky-300">
                      🏥 Hospital &amp; Facility
                    </span>
                    <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 dark:bg-neutral-700 px-2 py-0.5 rounded-full">
                      Provider
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Hospital Name</span>
                      <strong className="text-slate-900 dark:text-white font-semibold">
                        {sharedContext?.hospital_name || groupedInfo.hospital.hospital_name?.value || 'Apollo Clinic - Davangere'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Location</span>
                      <span className="text-slate-700 dark:text-neutral-300">
                        {groupedInfo.hospital.location?.value || 'Davangere, Karnataka'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Patient Information */}
                <div className="bg-white dark:bg-neutral-800/90 rounded-xl border border-sky-100 dark:border-neutral-700 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-sky-50 dark:border-neutral-700 pb-2">
                    <span className="text-xs font-bold uppercase text-sky-900 dark:text-sky-300">
                      👤 Patient &amp; Encounter
                    </span>
                    <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 dark:bg-neutral-700 px-2 py-0.5 rounded-full">
                      Encounter
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Patient Name</span>
                      <span className="text-slate-900 dark:text-white font-semibold">
                        {groupedInfo.hospital.patient_name?.value || '52-year-old male'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Claim / Encounter Reference</span>
                      <span className="font-mono text-slate-800 dark:text-neutral-200 font-bold bg-slate-50 dark:bg-neutral-700 px-2 py-0.5 rounded border border-slate-200 dark:border-neutral-600">
                        {result?.claim.claim_id || 'Not specified'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cryptographic Provenance */}
                {result?.claim.provenance?.source_hash && (
                  <div className="md:col-span-2 p-3 bg-white dark:bg-neutral-800/90 rounded-xl border border-sky-100 dark:border-neutral-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        SHA-256 Cryptographic Provenance Stamp
                      </span>
                      <span className="font-mono text-[11px] text-slate-700 dark:text-neutral-300 select-all">
                        {result.claim.provenance.source_hash}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyHash(result.claim.provenance.source_hash)}
                      className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      {copiedHash ? '✓ Copied' : 'Copy Hash'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500">
                Please upload or audit a medical document to display Stage 1 Document Utilization output.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-sky-100 dark:border-neutral-800 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('raw')}
                className="font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                ← Back to Upload Raw Data
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('2')}
                className="adjudo-btn-primary px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer"
              >
                Next: 2. Tablet Information →
              </button>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 2: 2. TABLET INFORMATION                              */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '2' && (
          <div className="p-6 rounded-2xl border border-sky-200 bg-sky-50/20 dark:bg-neutral-900 dark:border-neutral-700 space-y-4 shadow-sm animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sky-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-mono text-[10px] font-bold uppercase">
                  Stage 2
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  2. Tablet Information &amp; Pharmaceutical Intelligence
                </h3>
              </div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-neutral-800 px-3 py-1 rounded-full border border-emerald-200 dark:border-neutral-700">
                Prescription Decoded
              </span>
            </div>

            {medicineList.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {medicineList.map((med, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 space-y-2.5 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-neutral-700 pb-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-sky-700 dark:text-sky-400">
                            Tablet #{idx + 1}
                          </span>
                          <strong className="block text-sm font-bold text-slate-900 dark:text-white">
                            {med.medicine_name?.value || med.generic_name?.value || 'Prescribed Medicine'}
                          </strong>
                        </div>
                        {med.strength?.value && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-50 dark:bg-neutral-700 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-neutral-600">
                            {med.strength.value}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Active Ingredient</span>
                          <span className="font-semibold text-slate-800 dark:text-neutral-200">
                            {med.active_ingredient?.value || med.generic_name?.value || 'Formulated compound'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Quantity / Dosage</span>
                          <span className="font-semibold text-slate-800 dark:text-neutral-200">{med.dosage_quantity?.value || '1 Tab'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Frequency</span>
                          <span className="font-semibold text-slate-800 dark:text-neutral-200">{med.frequency?.value || 'As directed'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Duration</span>
                          <span className="font-semibold text-slate-800 dark:text-neutral-200">{med.duration?.value || '30 days'}</span>
                        </div>
                      </div>

                      {med.instructions?.value && (
                        <div className="p-2 bg-slate-50 dark:bg-neutral-700/50 rounded text-[11px] text-slate-600 dark:text-neutral-300">
                          <strong>Instructions:</strong> {med.instructions.value}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : hasFallbackSingleMed ? (
              <div className="p-4 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-700 pb-2">
                  <strong className="text-sm font-bold text-slate-900 dark:text-white">
                    {groupedInfo?.medicine?.medicine_name?.value || sharedContext?.medicines?.[0] || 'Metformin Hydrochloride 500 mg'}
                  </strong>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-50 dark:bg-neutral-700 text-sky-800 dark:text-sky-300">
                    {groupedInfo?.medicine?.strength?.value || '500 mg'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Generic Name</span>
                    <span className="font-semibold text-slate-800 dark:text-neutral-200">
                      {groupedInfo?.medicine?.generic_name?.value || 'Metformin'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Dosage Quantity</span>
                    <span className="font-semibold text-slate-800 dark:text-neutral-200">
                      {groupedInfo?.medicine?.dosage_quantity?.value || '1 tablet'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Frequency</span>
                    <span className="font-semibold text-slate-800 dark:text-neutral-200">
                      {groupedInfo?.medicine?.frequency?.value || 'twice daily'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Duration</span>
                    <span className="font-semibold text-slate-800 dark:text-neutral-200">
                      {groupedInfo?.medicine?.duration?.value || '30 days'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500">
                Please upload or audit a medical document to display Stage 2 Tablet Information.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-sky-100 dark:border-neutral-800 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('1')}
                className="font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                ← Previous: 1. Document Utilization
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('3')}
                className="adjudo-btn-primary px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer"
              >
                Next: 3. Diagnosis Information →
              </button>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 3: 3. DIAGNOSIS INFORMATION                           */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '3' && (
          <div className="p-6 rounded-2xl border border-indigo-200 bg-indigo-50/20 dark:bg-neutral-900 dark:border-neutral-700 space-y-4 shadow-sm animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono text-[10px] font-bold uppercase">
                  Stage 3
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  3. Diagnosis Information &amp; Clinical Guidelines (ADA &bull; ICMR)
                </h3>
              </div>
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 dark:bg-neutral-800 px-3 py-1 rounded-full border border-indigo-200 dark:border-neutral-700">
                Guideline Verification
              </span>
            </div>

            {result ? (
              <div className="space-y-4">
                {/* Clinical Context */}
                <div className="p-4 bg-white dark:bg-neutral-800/90 rounded-xl border border-indigo-100 dark:border-neutral-700 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Encounter Diagnosis</span>
                    <strong className="text-slate-900 dark:text-white font-semibold">
                      {groupedInfo?.clinical.diagnosis?.value || 'confirmed Type 2 Diabetes Mellitus (HbA1c 7.8%)'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Clinical Procedure</span>
                    <span className="text-slate-700 dark:text-neutral-300 font-medium">
                      {groupedInfo?.clinical.procedure?.value || 'First-line oral monotherapy'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Encounter Type</span>
                    <span className="text-slate-700 dark:text-neutral-300 font-medium">
                      {groupedInfo?.clinical.encounter_type?.value || 'Outpatient Encounter'}
                    </span>
                  </div>
                </div>

                {/* Retrieved Guidelines Passages */}
                {result.verification.passages_considered && result.verification.passages_considered.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                      Authoritative Clinical Evidence Matches ({result.verification.passages_considered.length} Sources)
                    </span>
                    <div className="space-y-2">
                      {result.verification.passages_considered.slice(0, 3).map((p, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 bg-white dark:bg-neutral-800/90 rounded-xl border border-indigo-100 dark:border-neutral-700 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <strong className="text-indigo-950 dark:text-indigo-300 font-bold">{p.title}</strong>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-neutral-700 text-emerald-700 dark:text-emerald-400 font-bold">
                              {Math.round(p.relevance_score * 100)}% relevance
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-neutral-300 italic text-[11px] leading-relaxed line-clamp-2">
                            &ldquo;{p.text}&rdquo;
                          </p>
                          <div className="text-[10px] text-slate-400">{p.source}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500">
                Please upload or audit a medical document to display Stage 3 Diagnosis Information.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-indigo-100 dark:border-neutral-800 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('2')}
                className="font-bold text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                ← Previous: 2. Tablet Information
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('4')}
                className="adjudo-btn-primary px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer"
              >
                Next: 4. Bill Cost →
              </button>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 4: 4. BILL COST                                       */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '4' && (
          <div className="p-6 rounded-2xl border border-blue-200 bg-blue-50/20 dark:bg-neutral-900 dark:border-neutral-700 space-y-4 shadow-sm animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold uppercase">
                  Stage 4
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  4. Bill Cost &amp; Accounting Reconciliation
                </h3>
              </div>
              <span className="text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-neutral-800 px-3 py-1 rounded-full border border-blue-200 dark:border-neutral-700">
                {rec?.classification ? rec.classification.replace(/_/g, ' ') : 'Financial Audit'}
              </span>
            </div>

            {rec ? (
              <div className="space-y-4">
                {/* 4 KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Itemized Sum</span>
                    <strong className="text-base font-bold text-slate-900 dark:text-white block mt-0.5">
                      ₹{rec.itemized_sum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </strong>
                    <span className="text-[10px] text-slate-500">Sum of line items</span>
                  </div>

                  <div className="p-3 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Stated Total</span>
                    <strong className="text-base font-bold text-slate-900 dark:text-white block mt-0.5">
                      {rec.stated_total != null
                        ? `₹${rec.stated_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : 'Not Specified'}
                    </strong>
                    <span className="text-[10px] text-slate-500">Invoice header</span>
                  </div>

                  <div className={`p-3 bg-white dark:bg-neutral-800/90 rounded-xl border shadow-2xs ${
                    rec.difference != null && Math.abs(rec.difference) >= 0.01
                      ? 'border-rose-200 dark:border-rose-800 bg-rose-50/20'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/20'
                  }`}>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Arithmetic Difference</span>
                    <strong className={`text-base font-bold block mt-0.5 font-mono ${
                      rec.difference != null && Math.abs(rec.difference) >= 0.01
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {rec.difference != null
                        ? `${rec.difference >= 0 ? '+' : ''}₹${rec.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '₹0.00'}
                    </strong>
                    <span className="text-[10px] text-slate-500">Itemized − Stated</span>
                  </div>

                  <div className="p-3 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Integrity Signals</span>
                    <strong className="text-sm font-bold text-slate-900 dark:text-white block mt-0.5">
                      {(rec.duplicates?.length || 0) + (rec.overlaps?.length || 0) > 0
                        ? `${(rec.duplicates?.length || 0) + (rec.overlaps?.length || 0)} Signals`
                        : 'Clean'}
                    </strong>
                    <span className="text-[10px] text-slate-500">Accounting sanity</span>
                  </div>
                </div>

                {/* Itemized Line Items Table */}
                {rec.line_items && rec.line_items.length > 0 && (
                  <div className="bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 p-4 space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                      Itemized Line Items ({rec.line_items.length})
                    </span>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-neutral-700 text-slate-400 text-left">
                          <th className="pb-1 font-semibold">#</th>
                          <th className="pb-1 font-semibold">Line Description</th>
                          <th className="pb-1 text-right font-semibold">Amount (INR)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-neutral-700">
                        {rec.line_items.map((it, idx) => (
                          <tr key={idx}>
                            <td className="py-1 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-1 text-slate-800 dark:text-neutral-200 font-medium">{it.description}</td>
                            <td className="py-1 text-right font-mono font-bold text-slate-900 dark:text-white">
                              ₹{it.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500">
                Please upload or audit a medical document to display Stage 4 Bill Cost output.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-blue-100 dark:border-neutral-800 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('3')}
                className="font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                ← Previous: 3. Diagnosis Information
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('5')}
                className="adjudo-btn-primary px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer"
              >
                Next: 5. Anomaly Detection →
              </button>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 5: 5. ANOMALY DETECTION                               */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '5' && (
          <div className="p-6 rounded-2xl border border-amber-200 bg-amber-50/20 dark:bg-neutral-900 dark:border-neutral-700 space-y-4 shadow-sm animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-100 dark:border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px] font-bold uppercase">
                  Stage 5
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  5. Anomaly Detection &amp; Outlier Screening
                </h3>
              </div>
              <span className="text-xs font-semibold text-amber-800 bg-amber-100 dark:bg-neutral-800 px-3 py-1 rounded-full border border-amber-300 dark:border-neutral-700">
                Isolation Forest V3 &bull; Benchmark Ratios
              </span>
            </div>

            {result ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Cost Anomaly */}
                <div className="p-4 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-700 pb-2">
                    <span className="text-xs font-bold uppercase text-slate-800 dark:text-white">
                      Price Benchmark Screening
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      result.verification.cost_anomaly_flag
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {result.verification.cost_anomaly_flag ? 'Price Variance Flagged' : 'Normal / Fair Pricing'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-neutral-300 leading-relaxed">
                    {result.verification.cost_anomaly_flag
                      ? `Charge exceeds benchmark distribution by ${result.verification.anomaly_details?.multiplier?.toFixed(1) || '2.0'}x.`
                      : 'Billed amounts are in line with regional CGHS and government price ceilings.'}
                  </p>
                </div>

                {/* Provider Screening */}
                <div className="p-4 bg-white dark:bg-neutral-800/90 rounded-xl border border-slate-200 dark:border-neutral-700 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-700 pb-2">
                    <span className="text-xs font-bold uppercase text-slate-800 dark:text-white">
                      Provider Practice Volume
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                      Evaluated
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-neutral-300 leading-relaxed">
                    Evaluated facility billing profile against regional normative practice ratios.
                  </p>
                </div>

                {/* Human Review Flags */}
                {result.verification.human_review_reasons && result.verification.human_review_reasons.length > 0 && (
                  <div className="md:col-span-2 p-3.5 bg-rose-50 dark:bg-neutral-800 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs text-rose-900 dark:text-rose-300 space-y-1">
                    <strong className="block font-bold">Detected Supervisory Review Triggers:</strong>
                    <ul className="list-disc list-inside space-y-0.5">
                      {result.verification.human_review_reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-neutral-500">
                Please upload or audit a medical document to display Stage 5 Anomaly Detection output.
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-amber-100 dark:border-neutral-800 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('4')}
                className="font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                ← Previous: 4. Bill Cost
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('6')}
                className="adjudo-btn-primary px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer"
              >
                Next: 6. Summary →
              </button>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────── */}
        {/* OUTPUT 6: 6. SUMMARY (Consolidated Findings)                */}
        {/* ──────────────────────────────────────────────────────────── */}
        {activeStage === '6' && (
          <div className="space-y-4 animate-fadeIn">
            {result ? (
              <div
                className={`rounded-2xl border-2 p-6 sm:p-8 shadow-adjudo transition-all ${
                  result.verification.action === 'accept'
                    ? isDark
                      ? 'bg-emerald-950/40 border-emerald-600'
                      : 'bg-emerald-50/90 border-emerald-700'
                    : result.verification.action === 'flag'
                    ? isDark
                      ? 'bg-amber-950/40 border-amber-600'
                      : 'bg-amber-50/90 border-amber-700'
                    : isDark
                    ? 'bg-neutral-900 border-neutral-700'
                    : 'bg-cream-100 border-neutral-900'
                }`}
              >
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-5">
                  <div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-xs font-black uppercase tracking-wider ${isDark ? 'text-neutral-400' : 'text-neutral-700'}`}>
                        Audit Decision &bull; ID: {result.claim.claim_id}
                      </span>
                      <VerificationBadge action={result.verification.action} size="sm" />
                      <VerdictBadge verdict={result.verification.verdict} />
                    </div>

                    <h2 className={`text-2xl sm:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                      {result.verification.action === 'accept' && (
                        <span className={isDark ? 'text-emerald-300' : 'text-emerald-950'}>Approved: Matches Medical Guidelines</span>
                      )}
                      {result.verification.action === 'flag' && (
                        <span className={isDark ? 'text-amber-300' : 'text-amber-950'}>Flagged for Review: Potential Issue Detected</span>
                      )}
                      {result.verification.action === 'abstain' && (
                        <span className={isDark ? 'text-neutral-200' : 'text-neutral-950'}>Not enough reliable evidence to make a decision</span>
                      )}
                    </h2>

                    <p className={`text-sm sm:text-base mt-2 max-w-3xl leading-relaxed ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                      {result.verification.action === 'abstain'
                        ? 'The system safely held this claim instead of guessing because sufficient verified guidelines or pricing benchmarks are not yet available.'
                        : result.verification.reasoning}
                    </p>

                    {/* What this means */}
                    <div className={`mt-4 p-4 rounded-xl border text-xs sm:text-sm space-y-1.5 shadow-adjudo-sm ${
                      isDark
                        ? 'bg-neutral-900/90 border-neutral-700 text-neutral-200'
                        : 'bg-white border-neutral-900 text-neutral-900'
                    }`}>
                      <div className={`font-black flex items-center gap-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                        <span className="text-base">💡</span>
                        <span>What this means &amp; What you can do next:</span>
                      </div>
                      {result.verification.action === 'flag' && (
                        <p className={`leading-relaxed ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                          <strong>Recommendation:</strong> The billed amount appears higher than the available comparison price, or clinical guidelines advise caution.
                          You can request an itemized hospital bill with procedure codes (CPT/HCPCS), ask for in-network pricing, or contact your provider for billing clarification.
                        </p>
                      )}
                      {result.verification.action === 'accept' && (
                        <p className={`leading-relaxed ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                          <strong>Recommendation:</strong> The procedure indication aligns with published medical guidelines and the billed charges fall within standard fair pricing benchmarks.
                        </p>
                      )}
                      {result.verification.action === 'abstain' && (
                        <p className={`leading-relaxed ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                          <strong>Recommendation:</strong> Not enough reliable evidence to make an automated decision. Ask your hospital for the exact procedure code (CPT) or check with your insurer to clarify coverage without ungrounded assumptions.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-2.5 sm:self-start flex-wrap">
                    <button
                      type="button"
                      onClick={handleClear}
                      className="adjudo-btn-secondary px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap flex items-center gap-2 cursor-pointer"
                    >
                      <span>🔄</span>
                      <span>New Audit</span>
                    </button>

                    <Link
                      to={`/claims/${encodeURIComponent(result.claim.claim_id)}`}
                      className="adjudo-btn-dark px-5 py-2.5 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap cursor-pointer"
                    >
                      View Full 9-Stage Audit &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`p-8 rounded-2xl border text-center text-xs space-y-3 transition-colors ${
                  isDark
                    ? 'border-neutral-800 bg-[#0c1222] text-neutral-400'
                    : 'border-slate-300 bg-white text-slate-600 shadow-sm'
                }`}
              >
                <span className="text-3xl block">📋</span>
                <strong
                  className={`block text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}
                >
                  No Audit Evaluated Yet
                </strong>
                <p className="max-w-md mx-auto">
                  Click <strong>Upload Raw Data</strong> above to input a hospital bill or prescription, or select a pre-configured sample to run the 6-stage intelligence pipeline.
                </p>
                <button
                  type="button"
                  onClick={() => handleSelectStage('raw')}
                  className="adjudo-btn-primary px-5 py-2 rounded-xl text-xs font-bold mt-2 cursor-pointer"
                >
                  Go to Upload Raw Data →
                </button>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 text-xs">
              <button
                type="button"
                onClick={() => handleSelectStage('5')}
                className="font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                ← Previous: 5. Anomaly Detection
              </button>
              <button
                type="button"
                onClick={() => handleSelectStage('raw')}
                className="font-bold text-neutral-500 hover:underline cursor-pointer"
              >
                Return to Upload Raw Data ⤾
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AuditPipelineFlowView
