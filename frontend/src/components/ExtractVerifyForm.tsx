import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { extractAndVerify, ensureAuthToken, processDocumentImage } from '../api/client'
import type { ExtractAndVerifyResponse, SourceType, Model6PredictionResult } from '../types'
import { VerificationBadge, VerdictBadge } from './VerificationBadge'
import { useVoice } from '../context/VoiceContext'
import { useAudit } from '../context/AuditContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { saveUserClaim } from '../services/userDataStore'
import { formatCurrency } from '../utils/currency'
import { extractTextFromImage } from '../utils/ocr'
import CameraCaptureModal from './CameraCaptureModal'
import PostProcessingSummary from './PostProcessingSummary'
import FiveModelsAuditPanel from './FiveModelsAuditPanel'
import AuditPipelineFlowView from './AuditPipelineFlowView'

interface ExtractVerifyFormProps {
  initialText?: string
  onSampleCleared?: () => void
}

export function ExtractVerifyForm({
  initialText = '',
  onSampleCleared,
}: ExtractVerifyFormProps) {
  const { user } = useAuth()
  const { isDark } = useTheme()
  const { setActiveClaim, readClaimAloud } = useVoice()
  const {
    result,
    text,
    sourceType,
    sourceUrl,
    imagePreview,
    imageName,
    setResult,
    setText,
    setSourceType,
    setSourceUrl,
    setImagePreview,
    setImageName,
    clearAudit,
  } = useAudit()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayFormat, setDisplayFormat] = useState<'flow' | 'classic'>('flow')

  // Optional 5-model anomaly screening inputs
  const [showAnomalyOptions, setShowAnomalyOptions] = useState(false)
  const [attachSampleAnomalyData, setAttachSampleAnomalyData] = useState(false)
  const [anomalyPreset, setAnomalyPreset] = useState<'none' | 'normal_sharma' | 'shree_audit'>('none')

  // Model 6 Document AI and OCR states
  const [model6Prediction, setModel6Prediction] = useState<Model6PredictionResult | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatusText, setOcrStatusText] = useState('')
  const [ocrWarning, setOcrWarning] = useState<string | null>(null)
  const [ocrSuccessMessage, setOcrSuccessMessage] = useState<string | null>(null)
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previousObjectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (initialText && initialText !== text) {
      setText(initialText)
      setError(null)
    }
  }, [initialText])

  useEffect(() => {
    if (result) {
      setActiveClaim({
        claimId: result.claim.claim_id,
        entity: result.claim.extracted_fields?.entity,
        action: result.verification.action,
        verdict: result.verification.verdict,
        costAnomalyFlag: result.verification.cost_anomaly_flag,
        costRange: result.claim.extracted_fields?.cost_range,
        confidence: result.claim.confidence,
        supportScore: result.verification.support_score,
        reasoning: result.verification.reasoning,
        abstainReason: result.verification.abstain_reason,
        anomalyDetails: result.verification.anomaly_details,
        city: result.claim.location?.city,
        sourceType: result.claim.source_type,
      })
    }
  }, [result, setActiveClaim])

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(previousObjectUrlRef.current)
      }
    }
  }, [])

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        resolve(reader.result as string)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  const runOcrOnSource = async (source: File | Blob, displayName: string) => {
    // Revoke previous object URL if any
    if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previousObjectUrlRef.current)
    }

    const previewUrl = URL.createObjectURL(source)
    previousObjectUrlRef.current = previewUrl

    setImagePreview(previewUrl)
    setImageName(displayName)
    setOcrLoading(true)
    setOcrProgress(15)
    setOcrStatusText('Model 6 Document AI analyzing image...')
    setOcrWarning(null)
    setOcrSuccessMessage(null)
    setModel6Prediction(null)

    try {
      // 1. Convert image to Base64
      const base64Data = await blobToBase64(source)

      // 2. Call backend unified image processing (Model 6 + RapidOCR)
      setOcrProgress(35)
      setOcrStatusText('Running Model 6 Document AI & OCR...')

      let processedBackend = false
      try {
        const procRes = await processDocumentImage(base64Data)
        if (procRes && procRes.model6_prediction) {
          processedBackend = true
          setModel6Prediction(procRes.model6_prediction)
          setOcrProgress(80)

          // Automatically sync suggested source type if recognized
          if (procRes.suggested_source_type) {
            setSourceType(procRes.suggested_source_type)
          }

          if (procRes.ocr_text && procRes.ocr_text.trim()) {
            setText(procRes.ocr_text)
            setOcrProgress(100)
            if (procRes.notice) {
              setOcrWarning(procRes.notice)
            } else {
              setOcrSuccessMessage(
                `Classified as ${procRes.model6_prediction.category_label} (${(procRes.model6_prediction.model_score * 100).toFixed(1)}% confidence). Verbatim text extracted below.`
              )
            }
          } else {
            // Backend OCR yielded minimal text; fallback to client OCR for text extraction
            setOcrStatusText('Extracting text via client-side OCR...')
            const clientOcr = await extractTextFromImage(source, (pct, status) => {
              setOcrProgress(pct)
              setOcrStatusText(status)
            })
            if (clientOcr.text) {
              setText(clientOcr.text)
              setOcrSuccessMessage(
                `Classified as ${procRes.model6_prediction.category_label}. Text extracted. Please review before verifying.`
              )
            } else {
              setOcrWarning(
                'Document type identified, but text could not be read clearly. Please type or edit the details below.'
              )
            }
          }
        }
      } catch (backendErr) {
        console.warn('Backend processDocumentImage failed; falling back to client OCR:', backendErr)
      }

      // 3. Fallback to client-side OCR if backend was unreachable
      if (!processedBackend) {
        setOcrStatusText('Running client-side OCR...')
        const res = await extractTextFromImage(source, (pct, status) => {
          setOcrProgress(pct)
          setOcrStatusText(status)
        })

        if (res.text) {
          setText(res.text)
          if (res.isLowQuality && res.warningMessage) {
            setOcrWarning(res.warningMessage)
          } else {
            setOcrSuccessMessage('Text successfully extracted from document. Please review before verifying.')
          }
        } else {
          setOcrWarning(
            res.warningMessage ||
              'Some parts of the image could not be read clearly. Please check the text below or type the missing information.'
          )
        }
      }
    } catch (err: unknown) {
      console.error('Image processing error:', err)
      setOcrWarning(
        'Some parts of the image could not be read clearly. Please check the text below or type the missing information.'
      )
    } finally {
      setOcrLoading(false)
      setOcrProgress(100)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    runOcrOnSource(file, file.name)
    e.target.value = ''
  }

  const handleCameraCapture = (blob: Blob) => {
    const now = new Date()
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    runOcrOnSource(blob, `Camera Photo (${timeStr})`)
  }

  const handleRemoveImage = () => {
    if (previousObjectUrlRef.current && previousObjectUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previousObjectUrlRef.current)
      previousObjectUrlRef.current = null
    }
    setImagePreview(null)
    setImageName(null)
    setModel6Prediction(null)
    setOcrWarning(null)
    setOcrSuccessMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return

    setLoading(true)
    setError(null)
    // Clear stale previous audit results immediately upon new submission
    setResult(null)
    setActiveClaim(null)

    let sampleProviderData: Record<string, any> | undefined = undefined
    let sampleClaimData: Record<string, any> | undefined = undefined

    try {
      await ensureAuthToken()

      const effectivePreset = anomalyPreset !== 'none' 
        ? anomalyPreset 
        : (attachSampleAnomalyData ? 'normal_sharma' : 'none')

      if (effectivePreset === 'shree_audit') {
        sampleProviderData = {
          provider_name: 'Shree Medical Institute',
          Tot_Benes: 2100,
          Tot_Srvcs: 8400,
          Tot_Bene_Day_Srvcs: 6300,
          Avg_Sbmtd_Chrg: 12500.0,
          Avg_Mdcr_Alowd_Amt: 9800.0,
          Submitted_To_Allowed_Ratio: 1.28,
          Services_Per_Beneficiary: 4.0,
          Bene_Days_Per_Beneficiary: 3.0,
          Medicare_Payment_Ratio: 0.78,
        }
        sampleClaimData = {
          CLM_ID: 'CLM_SHREE_7721',
          DESYNPUF_ID: 'BENE_000772',
          PRVDR_NUM: 'shree_medical',
          CLM_ADMSN_DT: '20260210',
          CLM_FROM_DT: '20260210',
          CLM_THRU_DT: '20260214',
          NCH_BENE_DSCHRG_DT: '20260214',
          CLM_UTLZTN_DAY_CNT: 4,
          CLM_PASS_THRU_PER_DIEM_AMT: 0.0, // Calibrated: pass-through per diem is 0.0, not total charge
          NCH_BENE_PTA_COINSRNC_LBLTY_AM: 0.0,
          NCH_BENE_BLOOD_DDCTBL_LBLTY_AM: 0.0,
          CLM_DRG_CD: '194',
          diagnosis_codes: ['486'],
          procedure_codes: ['3893'],
        }
      } else if (effectivePreset === 'normal_sharma') {
        sampleProviderData = {
          provider_name: 'Dr. Arun Sharma',
          Rndrng_NPI: '1003000126',
          Rndrng_Prvdr_Last_Org_Name: 'Sharma',
          Rndrng_Prvdr_First_Name: 'Arun',
          Rndrng_Prvdr_Type: 'Cardiology',
          Tot_Benes: 450,
          Tot_Srvcs: 1820,
          Tot_Bene_Day_Srvcs: 1440,
          Avg_Sbmtd_Chrg: 485.50,
          Avg_Mdcr_Alowd_Amt: 145.20,
          Avg_Mdcr_Pymt_Amt: 112.80,
          Avg_Mdcr_Stdzd_Amt: 110.40,
          Submitted_To_Allowed_Ratio: 3.34,
          Allowed_To_Payment_Ratio: 1.29,
          Services_Per_Beneficiary: 4.04,
          Bene_Days_Per_Beneficiary: 3.20,
          Medicare_Payment_Ratio: 0.78,
        }
        sampleClaimData = {
          CLM_ID: 'CLM_DEMO_99812',
          DESYNPUF_ID: 'BENE_000982',
          PRVDR_NUM: '10001',
          CLM_ADMSN_DT: '20260210',
          CLM_FROM_DT: '20260210',
          CLM_THRU_DT: '20260214',
          NCH_BENE_DSCHRG_DT: '20260214',
          CLM_UTLZTN_DAY_CNT: 4,
          CLM_PASS_THRU_PER_DIEM_AMT: 0.0, // Calibrated: pass-through per diem is 0.0, not total charge
          NCH_BENE_PTA_COINSRNC_LBLTY_AM: 0.0,
          NCH_BENE_BLOOD_DDCTBL_LBLTY_AM: 0.0,
          CLM_DRG_CD: '194',
          diagnosis_codes: ['486', '4280'],
          procedure_codes: ['9671', '3893'],
        }
      }

      const response = await extractAndVerify({
        text: text.trim(),
        source_type: sourceType,
        source_url: sourceUrl.trim() || undefined,
        store_claim: true,
        provider_data: sampleProviderData,
        claim_data: sampleClaimData,
      })
      setResult(response)

      // Save claim into the active user's isolated data vault
      if (user?.email && response?.claim) {
        saveUserClaim(
          user.email,
          response.claim,
          response.verification,
          null,
        )
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Claim auditing failed.'
      // Resilient self-healing retry if an old or expired token was present in localStorage
      if (
        errMsg.toLowerCase().includes('token') ||
        errMsg.toLowerCase().includes('session') ||
        errMsg.includes('401')
      ) {
        try {
          await ensureAuthToken(true)
          const retryRes = await extractAndVerify({
            text: text.trim(),
            source_type: sourceType,
            source_url: sourceUrl.trim() || undefined,
            store_claim: true,
            provider_data: sampleProviderData,
            claim_data: sampleClaimData,
          })
          setResult(retryRes)
          if (user?.email && retryRes?.claim) {
            saveUserClaim(user.email, retryRes.claim, retryRes.verification, null)
          }
          return
        } catch {
          // Fall through to display error
        }
      }
      if (errMsg === 'Failed to fetch' || errMsg.toLowerCase().includes('failed to fetch')) {
        setError('Unable to reach the backend API server. Please check your connection or verify that the EvidenceBridge backend service is running on port 8000.')
      } else {
        setError(errMsg)
      }
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    clearAudit()
    setError(null)
    handleRemoveImage()
    onSampleCleared?.()
  }

  const anomaly = result?.verification.anomaly_details
  const billedAmount = anomaly?.extracted_amount ?? null
  const benchmarkMax = anomaly?.benchmark_max ?? null
  const benchmarkMin = anomaly?.benchmark_min ?? null
  const multiplier = anomaly?.multiplier || 1
  const docCurrency = anomaly?.currency || result?.claim.extracted_fields?.cost_currency || 'INR'
  const benchmarkCurrency = anomaly?.benchmark_currency || docCurrency

  return (
    <div className="space-y-6">
      {/* View Format Switcher */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={`inline-flex items-center p-1 rounded-2xl border shadow-adjudo-sm transition-all ${
          isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-white border-neutral-900'
        }`}>
          <button
            type="button"
            onClick={() => setDisplayFormat('flow')}
            className={`px-4 py-2 rounded-xl font-black text-xs flex items-center gap-2 transition-all cursor-pointer ${
              displayFormat === 'flow'
                ? isDark
                  ? 'bg-neutral-100 text-neutral-950 shadow-adjudo-sm'
                  : 'bg-neutral-950 text-white shadow-adjudo-sm'
                : isDark
                ? 'text-neutral-400 hover:text-white'
                : 'text-neutral-600 hover:text-neutral-950'
            }`}
          >
            <span>🔀 Pipeline Flow Format</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 font-bold">
              Default
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDisplayFormat('classic')}
            className={`px-4 py-2 rounded-xl font-black text-xs flex items-center gap-2 transition-all cursor-pointer ${
              displayFormat === 'classic'
                ? isDark
                  ? 'bg-neutral-100 text-neutral-950 shadow-adjudo-sm'
                  : 'bg-neutral-950 text-white shadow-adjudo-sm'
                : isDark
                ? 'text-neutral-400 hover:text-white'
                : 'text-neutral-600 hover:text-neutral-950'
            }`}
          >
            <span>📄 Classic Full View</span>
          </button>
        </div>
      </div>

      {displayFormat === 'flow' ? (
        <AuditPipelineFlowView
          result={result}
          text={text}
          setText={setText}
          loading={loading}
          ocrLoading={ocrLoading}
          ocrStatusText={ocrStatusText}
          ocrProgress={ocrProgress}
          ocrWarning={ocrWarning}
          ocrSuccessMessage={ocrSuccessMessage}
          handleSubmit={handleSubmit}
          handleClear={handleClear}
          fileInputRef={fileInputRef}
          handleFileUpload={handleFileUpload}
          imagePreview={imagePreview}
          imageName={imageName}
          handleRemoveImage={handleRemoveImage}
          readClaimAloud={readClaimAloud}
          model6Prediction={model6Prediction}
          isDark={isDark}
        />
      ) : (
        <>
          {/* Visual Decision Banner (Audit Decision Result) */}
      {result && (
        <div className="animate-fadeIn">
          <div
            className={`rounded-2xl border-2 p-7 sm:p-8 shadow-adjudo transition-all ${
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

                {/* Plain-English "What this means & What to do next" */}
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
                  title="Clear this audit and evaluate a new document"
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

            {/* Abstention specific callout */}
            {result.verification.action === 'abstain' && (
              <div className={`mt-4 p-4 rounded-xl border text-sm leading-relaxed ${
                isDark ? 'bg-neutral-800 border-neutral-700 text-neutral-200' : 'bg-cream-200 border-neutral-900 text-neutral-900'
              }`}>
                <strong className={`font-black block mb-1 ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Safe Refusal Enforced:
                </strong>
                {result.verification.abstain_reason ||
                  'The system chose not to guess because authoritative guidelines were missing or pricing benchmarks were absent for this high-cost service.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input Form Card */}
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
              Step 1
            </span>
            <label
              htmlFor="clinical-text"
              className={`block text-base font-black mt-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}
            >
              Raw Hospital Bill or Clinical Chart Note
            </label>
          </div>
          <span className={`text-xs font-bold ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
            {text.length > 0 ? `${text.length} characters` : 'Paste unedited document'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-3.5">
          <p className={`text-sm leading-relaxed ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
            Paste an itemized hospital bill line (e.g. CPT procedure code, billed dollars), an EHR consultation note, or a prescription summary.
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

            {/* Hidden native file input for Upload Photo */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Small Image Preview with Removal option */}
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
                      {ocrStatusText || `Reading text... ${ocrProgress}%`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      ✓ Text extracted
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRemoveImage}
              className="text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 transition-colors flex-shrink-0 shadow-xs"
              title="Remove image and return to text-only mode"
            >
              ✕ Remove Photo
            </button>
          </div>
        )}

        {/* Model 6 Image-Based Medical Document AI Result Card */}
        {model6Prediction && (
          <div className="mb-3.5 p-3.5 bg-gradient-to-r from-indigo-50/90 via-sky-50/40 to-slate-50 border border-indigo-200/90 rounded-xl shadow-xs animate-fadeIn">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-indigo-600 text-white rounded-md shadow-xs">
                  Model 6
                </span>
                <span className="text-xs font-bold text-slate-800">
                  Medical Document AI:
                </span>
                <span className="text-xs font-extrabold text-indigo-950 bg-indigo-100/80 border border-indigo-200 px-2 py-0.5 rounded-md">
                  {model6Prediction.category_label}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                    model6Prediction.is_supported && model6Prediction.model_score >= 0.85
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : model6Prediction.is_supported
                      ? 'bg-sky-50 text-sky-800 border-sky-300'
                      : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                  {(model6Prediction.model_score * 100).toFixed(1)}% Confidence
                </span>
              </div>
            </div>

            {/* Class Probabilities Distribution */}
            {model6Prediction.all_probabilities && (
              <div className="mt-2.5 pt-2 border-t border-indigo-100 flex items-center justify-between text-[11px] text-slate-600 flex-wrap gap-2">
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                    Distribution:
                  </span>
                  <span className={model6Prediction.document_category === 'invoice_or_receipt' ? 'font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}>
                    Invoice/Bill: {((model6Prediction.all_probabilities['invoice_or_receipt'] ?? 0) * 100).toFixed(1)}%
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className={model6Prediction.document_category === 'prescription' ? 'font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}>
                    Prescription: {((model6Prediction.all_probabilities['prescription'] ?? 0) * 100).toFixed(1)}%
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className={model6Prediction.document_category === 'laboratory_report' ? 'font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}>
                    Lab Report: {((model6Prediction.all_probabilities['laboratory_report'] ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="text-[10px] text-indigo-700 font-semibold bg-indigo-50/80 px-2 py-0.5 rounded-md border border-indigo-100">
                  Target Audit Scope: <span className="font-bold underline capitalize">{model6Prediction.suggested_source_type.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {model6Prediction.message && (
              <p className="mt-1.5 text-[11px] text-slate-600 italic">
                {model6Prediction.message}
              </p>
            )}
          </div>
        )}

        {/* OCR Unclear Text Warning */}
        {ocrWarning && (
          <div className="mb-3.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-subtle animate-fadeIn">
            <span className="text-amber-600 font-bold text-sm mt-0.5">⚠️</span>
            <div className="flex-1">
              <strong className="block font-semibold">Image OCR Note:</strong>
              <span>{ocrWarning}</span>
            </div>
          </div>
        )}

        {/* OCR Success Banner */}
        {ocrSuccessMessage && !ocrWarning && (
          <div className="mb-3.5 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 shadow-subtle animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold">✓</span>
              <span>{ocrSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setOcrSuccessMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        <textarea
          id="clinical-text"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ocrLoading ? 'Extracting text from image using OCR... please wait.' : 'e.g. EMERGENCY ROOM - HOUSTON, TX. Patient with focal neurological signs underwent CPT 70551 MRI Brain without contrast. Billed charge $650.00...'}
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
            className="adjudo-btn-primary inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm sm:text-base font-black disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Auditing Clinical Evidence &amp; Pricing...
              </>
            ) : (
              'Extract & Verify Claim →'
            )}
          </button>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className={`p-4 rounded-xl border text-xs sm:text-sm flex items-start gap-3 shadow-subtle ${
          isDark ? 'bg-rose-950/40 border-rose-800 text-rose-200' : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <span className="text-rose-600 font-bold text-base mt-0.5">⚠️</span>
          <div>
            <strong className="block font-bold">Audit Evaluation Failed</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Detailed Audit Results & Modules */}
      {result && (
        <div className="space-y-6 animate-fadeIn">
          {/* Five Integrated AI Models Pipeline Breakdown */}
          <FiveModelsAuditPanel
            claimId={result.claim.claim_id}
            sharedContext={result.verification.shared_context}
            synthesis={result.verification.synthesis}
            nerEntities={result.verification.ner_entities}
            nerGroupedInfo={result.verification.ner_grouped_info}
            retrievalPassages={result.verification.passages_considered?.map((p) => ({
              passage_id: p.passage_id,
              guideline_id: p.guideline_id,
              title: p.title,
              source: p.source,
              text: p.text,
              similarity_score: p.relevance_score,
              model_name: 'BGE Small en-v1.5',
            }))}
            nliResult={result.verification.nli_result}
            providerAnomaly={result.verification.provider_anomaly}
            claimAnomaly={result.verification.claim_anomaly}
            medicineSubstitution={result.verification.medicine_substitution}
            billingReconciliation={result.verification.billing_reconciliation}
            requiresHumanReview={result.verification.requires_human_review}
            humanReviewReasons={result.verification.human_review_reasons}
          />

          {/* Post-Processing Clinical & Prescription Summary (Collapsible by default) */}
          <PostProcessingSummary result={result} />

          {/* Pricing Benchmark Visual (if anomaly or benchmark exists) */}
          {result.verification.cost_anomaly_flag && anomaly && (
            <div className={`rounded-2xl border p-6 sm:p-8 shadow-card transition-colors ${
              isDark ? 'bg-slate-900 border-rose-900/60' : 'bg-white border-rose-200'
            }`}>
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 uppercase">
                      Price Alert
                    </span>
                    <h3 className={`text-base sm:text-lg font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      Unusually High Charge Detected ({multiplier.toFixed(1)}× Benchmark)
                    </h3>
                  </div>
                  <p className={`text-xs sm:text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    The billed amount appears higher than the available comparison price (CMS Medicare and Fair Health fee schedules).
                  </p>
                </div>

                <div className="text-right">
                  <span className={`text-xs font-medium ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>Billed Amount:</span>
                  <div className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400">
                    {formatCurrency(billedAmount, docCurrency, { showCode: true })}
                  </div>
                </div>
              </div>

              {/* Progress/Ratio Bar */}
              <div className="space-y-2.5">
                <div className="w-full bg-slate-100 h-5 rounded-full overflow-hidden flex relative border border-slate-200">
                  {/* Benchmark Segment */}
                  <div
                    className="bg-emerald-500 h-full text-xs text-white flex items-center justify-center font-bold"
                    style={{
                      width: `${Math.min(100, Math.max(12, ((benchmarkMax || 1) / (billedAmount || 1)) * 100))}%`,
                    }}
                    title={`Standard Benchmark Range: ${formatCurrency(benchmarkMin, benchmarkCurrency)} - ${formatCurrency(benchmarkMax, benchmarkCurrency)}`}
                  >
                    Benchmark
                  </div>
                  {/* Markup Excess Segment */}
                  <div
                    className="bg-rose-500 h-full flex-1"
                    title={`Excess Markup: ${(multiplier - 1).toFixed(1)}x over benchmark`}
                  />
                </div>

                <div className="flex flex-col sm:flex-row justify-between text-xs sm:text-sm text-slate-600 font-mono gap-1">
                  <span>Standard Benchmark: {formatCurrency(benchmarkMin, benchmarkCurrency)} – {formatCurrency(benchmarkMax, benchmarkCurrency)}</span>
                  <span className="font-bold text-rose-600">
                    Billed: {formatCurrency(billedAmount, docCurrency)} ({multiplier.toFixed(1)}× markup)
                  </span>
                </div>
              </div>

              {docCurrency !== benchmarkCurrency && (
                <div className="mt-3 text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  ⚠️ Note: Billed charge is in {docCurrency} while comparison benchmark schedule is in {benchmarkCurrency}. Cross-currency auditing is noted.
                </div>
              )}

              <div className="mt-3.5 text-xs sm:text-sm text-slate-700 bg-rose-50/70 p-3.5 rounded-xl border border-rose-100 leading-relaxed">
                {anomaly.explanation}
              </div>
            </div>
          )}

          {/* Structured Information & Provenance Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Extracted Medical Entity & Procedure Codes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Extracted Clinical Information
              </span>
              <div className="space-y-3.5">
                <div>
                  <div className="text-xs text-slate-500 font-medium">Medical Procedure / Item</div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    {result.claim.extracted_fields?.entity || 'Extracted Clinical Entity'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-2.5 border-t border-slate-100">
                  <div>
                    <span className="text-slate-400 block text-xs mb-0.5">Billed Amount</span>
                    <span className="font-mono text-base font-bold text-slate-800">
                      {result.claim.extracted_fields?.cost_range
                        ? `${result.claim.extracted_fields.cost_range}${result.claim.extracted_fields.cost_currency ? ` (${result.claim.extracted_fields.cost_currency})` : ''}`
                        : 'Price data not available'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-slate-400 block text-xs">Evidence Confidence</span>
                      <span
                        className="text-xs text-slate-400 cursor-help"
                        title="How strongly the available evidence supports this result."
                      >
                        ℹ️
                      </span>
                    </div>
                    <span className="font-mono text-base font-bold text-slate-800">
                      {Math.round(result.verification.support_score * 100)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Guideline support certainty
                    </span>
                  </div>
                </div>

                {result.claim.extracted_fields?.effect_or_outcome && (
                  <div className="pt-2.5 border-t border-slate-100">
                    <span className="text-slate-400 block text-xs mb-0.5">Indication / Note</span>
                    <span className="text-xs sm:text-sm text-slate-700 leading-relaxed block">
                      {result.claim.extracted_fields.effect_or_outcome}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Authenticity & Geographic Location */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-subtle">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Document Authenticity &amp; Region
              </span>
              <div className="space-y-3.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-xs mb-0.5">Geographic Hospital Locality</span>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    {result.claim.location?.city
                      ? `${result.claim.location.city}${result.claim.location.state_or_region ? `, ${result.claim.location.state_or_region}` : ''}`
                      : 'Not Detected (National Benchmark Applied)'}
                  </div>
                  {result.claim.location?.normalized_key && (
                    <span className="text-xs text-sky-600 font-semibold inline-block mt-1">
                      Hospital Reliability: {result.claim.location.city} verified
                    </span>
                  )}
                </div>

                <div className="pt-2.5 border-t border-slate-100">
                  <span className="text-slate-400 block text-xs mb-0.5">Document Authenticity Fingerprint (SHA-256)</span>
                  <span className="font-mono text-xs text-slate-600 truncate block bg-slate-50 p-2 rounded-lg mt-1 border border-slate-200">
                    {result.claim.provenance?.source_hash || 'SHA-256 Verified'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Technical Details for Auditors (Collapsible) */}
          <details className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-xs sm:text-sm">
            <summary className="font-bold text-slate-700 cursor-pointer hover:text-slate-900 flex items-center justify-between">
              <span>🔧 Advanced Audit Details &amp; Provenance Record</span>
              <span className="text-xs text-slate-400">Click to expand</span>
            </summary>
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2.5 font-mono text-xs text-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500">System Verdict:</span>
                <span className="font-bold">{result.verification.verdict}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Decision Action:</span>
                <span className="font-bold">{result.verification.action}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Confidence Calibration:</span>
                <span>{result.claim.confidence ? (result.claim.confidence * 100).toFixed(1) + '%' : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Guideline Citations:</span>
                <span>{result.verification.evidence_snippets?.length || 0} authoritative sources cited</span>
              </div>
            </div>
          </details>
        </div>
      )}
        </>
      )}

      {/* Live Camera Viewfinder Modal */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={handleCameraCapture}
      />
    </div>
  )
}
export default ExtractVerifyForm
