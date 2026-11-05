import React, { useState, useEffect } from 'react'
import { getModelsStatus } from '../api/client'
import type { ModelStatusResponse } from '../types'

export function ModelStatusCard() {
  const [status, setStatus] = useState<ModelStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const fetchStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getModelsStatus()
      setStatus(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not fetch models status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  if (loading && !status) {
    return (
      <div className="p-4 rounded-2xl bg-white border border-slate-200 animate-pulse text-xs text-slate-500">
        Checking 5 AI Models status...
      </div>
    )
  }

  if (error || !status) {
    return null
  }

  const m = status.models

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-subtle text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-4 bg-gradient-to-r from-slate-50 via-white to-slate-50 flex items-center justify-between gap-4 text-left hover:bg-slate-100/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-sm">
            🤖
          </div>
          <div>
            <div className="flex items-center gap-2">
              <strong className="font-bold text-slate-900 text-xs">
                Five AI Models Integrated Engine
              </strong>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                Online &bull; {status.device.device_name}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              BioBERT NER, BGE 384-d, DeBERTa NLI, Provider V3 &amp; Claim V3 Isolation Forests
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] font-semibold text-sky-700 hidden sm:inline">
            {isExpanded ? 'Hide Architecture' : 'Inspect AI Engine'}
          </span>
          <span className="text-slate-400 font-mono text-xs">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="p-5 border-t border-slate-200 space-y-4 bg-slate-50/40">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Model 1 */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Model 1: BioBERT NER</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                Indian Healthcare Token Classifier (69 BIO labels)
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                {m.model_1_ner.path}
              </div>
            </div>

            {/* Model 2 */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Model 2: BGE Retrieval</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                BGE Small en-v1.5 (384-d, ChromaDB online)
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                {m.model_2_retrieval.default}
              </div>
            </div>

            {/* Model 3 */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Model 3: DeBERTa NLI</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                DeBERTa-v3-small (contradiction, entailment, neutral)
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                Threshold: {(m.model_3_nli.provisional_threshold * 100).toFixed(0)}%
              </div>
            </div>

            {/* Model 4 */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Model 4: Provider Screening</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                Isolation Forest V3 (9 billing features &amp; ratio caps)
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                {m.model_4_provider_anomaly.label}
              </div>
            </div>

            {/* Model 5 */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Model 5: Claim Screening</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                Isolation Forest V3 Strict Temporal + V4-A Experimental (13 features)
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                {m.model_5_claim_anomaly.label}
              </div>
            </div>

            {/* Preserved Medicine Matcher & OCR */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">Medicine &amp; OCR Engine</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                Preserved TF-IDF Matcher &bull; RapidOCR ONNX Runtime
              </p>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                Brand/generic substitution &amp; document OCR
              </div>
            </div>

            {/* Model 6 Document AI */}
            {m.model_6_document_ai && (
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs">Model 6: Document AI</span>
                  <span className={`w-2 h-2 rounded-full ${m.model_6_document_ai.available ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                </div>
                <p className="text-[11px] text-slate-500">
                  ResNet18 Image Document Classifier (Prescription, Lab Report, Invoice)
                </p>
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  {m.model_6_document_ai.path}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
export default ModelStatusCard
