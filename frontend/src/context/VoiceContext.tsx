import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { elevenLabsVoice, ElevenLabsVoiceEngine } from '../services/elevenlabsVoice'
import { getAllHospitalAvailabilities, type HospitalAvailabilityResponse } from '../api/client'

export interface ActiveClaimContext {
  claimId: string
  entity?: string | null
  action: 'accept' | 'flag' | 'abstain' | string
  verdict?: 'supported' | 'partially_supported' | 'contradicted' | 'insufficient_evidence' | string
  costAnomalyFlag?: boolean
  costRange?: string | null
  confidence?: number
  supportScore?: number
  reasoning?: string | null
  abstainReason?: string | null
  anomalyDetails?: {
    is_anomaly: boolean
    extracted_amount?: number | null
    benchmark_min?: number | null
    benchmark_max?: number | null
    multiplier?: number | null
    severity?: string | null
    explanation?: string
    benchmark_name?: string | null
  } | null
  city?: string | null
  sourceType?: string | null
}

export interface VoiceMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: Date
}

interface VoiceContextType {
  // Panel state
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isEnabled: boolean
  setIsEnabled: (enabled: boolean) => void

  // Language state
  language: 'en' | 'kn'
  setLanguage: (lang: 'en' | 'kn') => void

  // Speech engine state
  status: 'idle' | 'listening' | 'thinking' | 'speaking'
  isContinuous: boolean
  setIsContinuous: (continuous: boolean) => void
  kannadaVoiceAvailable: boolean
  transcript: string
  finalUserSaid: string
  setFinalUserSaid: (text: string) => void
  lastSpoken: string
  history: VoiceMessage[]
  error: string | null

  // Active document context
  activeClaim: ActiveClaimContext | null
  setActiveClaim: (claim: ActiveClaimContext | null) => void

  // Speech actions
  startListening: (continuousMode?: boolean) => void
  stopListening: () => void
  speak: (text: string, langOverride?: 'en' | 'kn') => void
  stopSpeaking: () => void

  // Pre-configured voice tasks
  readClaimAloud: (claimOverride?: ActiveClaimContext) => void
  explainClaim: (type?: 'explain' | 'why_flagged' | 'price_problem' | 'clinical_guideline') => Promise<void>
  readHospitalDetails: () => Promise<void>
  clearHistory: () => void
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined)

const STORAGE_LANG_KEY = 'evidencebridge_voice_lang'
const STORAGE_ENABLED_KEY = 'evidencebridge_voice_enabled'
const STORAGE_CONTINUOUS_KEY = 'evidencebridge_voice_continuous'

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isHospitalManagement } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Panel state
  const [isOpen, setIsOpen] = useState(false)
  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem(STORAGE_ENABLED_KEY)
      return val === null ? true : val === 'true'
    } catch {
      return true
    }
  })

  // Continuous Listening
  const [isContinuous, setIsContinuousState] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem(STORAGE_CONTINUOUS_KEY)
      return val === null ? false : val === 'true'
    } catch {
      return false
    }
  })

  // ElevenLabs multilingual models inherently support Kannada and English
  const [kannadaVoiceAvailable] = useState<boolean>(true)

  // Language state: 'en' (English) or 'kn' (Kannada)
  const [language, setLanguageState] = useState<'en' | 'kn'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_LANG_KEY)
      return saved === 'kn' ? 'kn' : 'en'
    } catch {
      return 'en'
    }
  })

  // Engine state
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [transcript, setTranscript] = useState('')
  const [finalUserSaid, setFinalUserSaid] = useState('')
  const [lastSpoken, setLastSpoken] = useState('')
  const [history, setHistory] = useState<VoiceMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeClaim, setActiveClaim] = useState<ActiveClaimContext | null>(null)
  const lastExecutedCommandRef = useRef<{ text: string; time: number }>({ text: '', time: 0 })
  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)

  const isPatient = isAuthenticated && !isHospitalManagement && user?.portal !== 'hospital_management'

  // Ref trackers
  const isContinuousRef = useRef(isContinuous)
  isContinuousRef.current = isContinuous
  const statusRef = useRef(status)
  statusRef.current = status
  const languageRef = useRef(language)
  languageRef.current = language
  const activeClaimRef = useRef(activeClaim)
  activeClaimRef.current = activeClaim

  const setIsContinuous = (continuous: boolean) => {
    setIsContinuousState(continuous)
    try {
      localStorage.setItem(STORAGE_CONTINUOUS_KEY, String(continuous))
    } catch {}
  }

  const setLanguage = (lang: 'en' | 'kn') => {
    setLanguageState(lang)
    languageRef.current = lang
    try {
      localStorage.setItem(STORAGE_LANG_KEY, lang)
    } catch {}
    setError(null)

    // Dynamically update speech recognition if currently running
    if (isListeningRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {}
      setTimeout(() => {
        if (isListeningRef.current) {
          startListening()
        }
      }, 150)
    }
  }

  // Cleanup on unmount or patient logout
  useEffect(() => {
    return () => {
      isListeningRef.current = false
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {}
      }
      elevenLabsVoice.stopSession()
    }
  }, [])

  // If user signs out or switches to hospital management, immediately stop voice
  useEffect(() => {
    if (!isPatient) {
      isListeningRef.current = false
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {}
      }
      elevenLabsVoice.stopSession()
      setStatus('idle')
      setIsOpen(false)
    }
  }, [isPatient])

  /**
   * Stop active speech output
   */
  const stopSpeaking = useCallback(() => {
    elevenLabsVoice.stopAudioPlayback()
    setStatus((prev) => (prev === 'speaking' ? 'idle' : prev))
  }, [])

  /**
   * Speak response aloud using ElevenLabs / Voice Engine
   */
  const speak = useCallback(
    (text: string, langOverride?: 'en' | 'kn') => {
      const targetLang = langOverride || languageRef.current
      const cleanText = (text || '').trim()
      if (!cleanText) return

      stopSpeaking()
      setLastSpoken(cleanText)
      setStatus('speaking')
      setError(null)

      // Add to conversation history
      setHistory((prev) => [
        ...prev.slice(-15),
        {
          id: `msg_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sender: 'assistant',
          text: cleanText,
          timestamp: new Date(),
        },
      ])

      // If ElevenLabs WebSocket session is active, send response through ElevenLabs session
      if (elevenLabsVoice.isActive()) {
        elevenLabsVoice.sendUserMessage(cleanText)
      } else {
        // Speak using ElevenLabs REST TTS API (supports API Key sk_...) with browser SpeechSynthesis fallback
        elevenLabsVoice.speakText(cleanText, targetLang).then(() => {
          setStatus((prev) => {
            if (prev === 'speaking') {
              return isContinuousRef.current ? 'listening' : 'idle'
            }
            return prev
          })
        })
      }
    },
    [stopSpeaking]
  )

  /**
   * Section 5: Read Claim Result Aloud
   * Strictly reads actual loaded claim data without fabricating evidence.
   */
  const readClaimAloud = useCallback(
    (claimOverride?: ActiveClaimContext) => {
      const claim = claimOverride || activeClaimRef.current
      const currentLang = languageRef.current

      if (!claim) {
        const noDocMsg =
          currentLang === 'kn'
            ? 'ಯಾವುದೇ ಕ್ಲೈಮ್ ಪ್ರಸ್ತುತ ತೆರೆದಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೊದಲು ಕ್ಲೈಮ್ ತೆರೆಯಿರಿ.'
            : 'No claim is currently open. Please open a claim first.'
        speak(noDocMsg)
        return
      }

      if (currentLang === 'kn') {
        const actionKn =
          claim.action === 'accept'
            ? 'ಅನುಮೋದಿಸಲಾಗಿದೆ'
            : claim.action === 'flag'
            ? 'ಪರಿಶೀಲನೆಗೆ ಫ್ಲ್ಯಾಗ್ ಮಾಡಲಾಗಿದೆ'
            : 'ಸಾಕ್ಷ್ಯಾಧಾರ ಸಾಲದು'
        const entityKn = claim.entity || 'ವೈದ್ಯಕೀಯ ಚಿಕಿತ್ಸೆ'
        const costKn = claim.costRange ? `ಮೊತ್ತ ${claim.costRange}` : 'ಬೆಲೆ ನಿಗದಿಯಾಗಿಲ್ಲ'
        const scoreKn = Math.round((claim.supportScore || 0) * 100)

        let msgKn = `ಕ್ಲೈಮ್ ಸಾರಾಂಶ: ${entityKn}. ಸ್ಥಿತಿ: ${actionKn}. ${costKn}. ಮಾರ್ಗಸೂಚಿ ಬೆಂಬಲ ಸ್ಕೋರ್: ${scoreKn} ಪ್ರತಿಶತ.`
        if (claim.costAnomalyFlag && claim.anomalyDetails?.multiplier) {
          msgKn += ` ಬೆಲೆಯ ಎಚ್ಚರಿಕೆ: ಪ್ರಾದೇಶಿಕ ದರಕ್ಕಿಂತ ${claim.anomalyDetails.multiplier.toFixed(1)} ಪಟ್ಟು ಅಧಿಕವಾಗಿದೆ.`
        }
        if (claim.reasoning) {
          msgKn += ` ಕಾರಣ: ${claim.reasoning}`
        }
        speak(msgKn)
      } else {
        const actionEn =
          claim.action === 'accept'
            ? 'ACCEPTED'
            : claim.action === 'flag'
            ? 'FLAGGED FOR AUDIT REVIEW'
            : 'INSUFFICIENT EVIDENCE'
        const entityEn = claim.entity || 'Medical claim'
        const costEn = claim.costRange ? `billed at ${claim.costRange}` : 'with unspecified amount'
        const scoreEn = Math.round((claim.supportScore || 0) * 100)

        let msgEn = `Claim audit summary for ${entityEn}: Status is ${actionEn}, ${costEn}. Clinical guideline alignment is ${scoreEn} percent.`
        if (claim.costAnomalyFlag && claim.anomalyDetails?.multiplier) {
          msgEn += ` Price anomaly alert: Billed charges are ${claim.anomalyDetails.multiplier.toFixed(1)} times higher than standard tariff benchmarks.`
        }
        if (claim.reasoning) {
          msgEn += ` Finding: ${claim.reasoning}`
        }
        if (claim.abstainReason) {
          msgEn += ` Evidence note: ${claim.abstainReason}`
        }
        speak(msgEn)
      }
    },
    [speak]
  )

  /**
   * Section 5: Explain Claim Findings
   */
  const explainClaim = useCallback(
    async (type: 'explain' | 'why_flagged' | 'price_problem' | 'clinical_guideline' = 'explain') => {
      const claim = activeClaimRef.current
      const currentLang = languageRef.current

      if (!claim) {
        const msg =
          currentLang === 'kn'
            ? 'ಯಾವುದೇ ಕ್ಲೈಮ್ ಪ್ರಸ್ತುತ ತೆರೆದಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೊದಲು ಕ್ಲೈಮ್ ತೆರೆಯಿರಿ.'
            : 'No claim is currently open. Please open a claim first.'
        speak(msg)
        return
      }

      setStatus('thinking')

      if (type === 'why_flagged') {
        if (currentLang === 'kn') {
          if (claim.costAnomalyFlag && claim.anomalyDetails?.multiplier) {
            speak(`ಈ ಕ್ಲೈಮ್ ಅನ್ನು ಫ್ಲ್ಯಾಗ್ ಮಾಡಲು ಕಾರಣ: ಇದರ ದರವು ಅನುಮೋದಿತ ದರಕ್ಕಿಂತ ${claim.anomalyDetails.multiplier.toFixed(1)} ಪಟ್ಟು ಹೆಚ್ಚಾಗಿದೆ.`)
          } else if (claim.verdict === 'contradicted' || claim.action === 'flag') {
            speak(`ಈ ಕ್ಲೈಮ್ ಅನ್ನು ಫ್ಲ್ಯಾಗ್ ಮಾಡಲು ಕಾರಣ: ಕ್ಲಿನಿಕಲ್ ಮಾರ್ಗಸೂಚಿಗಳ ನಿಯಮಗಳಿಗೆ ಇದು ವ್ಯತ್ಯಾಸವಾಗಿದೆ. ${claim.reasoning || ''}`)
          } else {
            speak(`ಈ ಕ್ಲೈಮ್ ಅನ್ನು ದಾಖಲೆಗಳ ಪೂರ್ಣ ಪರಿಶೀಲನೆಗಾಗಿ ಫ್ಲ್ಯಾಗ್ ಮಾಡಲಾಗಿದೆ.`)
          }
        } else {
          if (claim.costAnomalyFlag && claim.anomalyDetails?.multiplier) {
            speak(`This claim was flagged because the billed amount is ${claim.anomalyDetails.multiplier.toFixed(1)} times higher than the regional benchmark for this procedure.`)
          } else if (claim.verdict === 'contradicted' || claim.action === 'flag') {
            speak(`This claim was flagged due to a clinical protocol discrepancy: ${claim.reasoning || 'Treatment does not align with standard indications.'}`)
          } else {
            speak(`This claim was flagged for auditor chart review to verify itemized billing details.`)
          }
        }
        return
      }

      if (type === 'price_problem') {
        if (currentLang === 'kn') {
          if (claim.anomalyDetails) {
            const mult = claim.anomalyDetails.multiplier?.toFixed(1) || '3.0'
            const max = claim.anomalyDetails.benchmark_max?.toLocaleString('en-IN') || '0'
            speak(`ಬೆಲೆಯ ಸಮಸ್ಯೆ: ಕ್ಲೈಮ್ ಮಾಡಿದ ಮೊತ್ತವು ಸಾಮಾನ್ಯ ಮಾನದಂಡವಾದ ರೂಪಾಯಿ ${max} ಗಿಂತ ${mult} ಪಟ್ಟು ಅಧಿಕವಾಗಿದೆ.`)
          } else {
            speak(`ಈ ಕ್ಲೈಮ್‌ನಲ್ಲಿ ಯಾವುದೇ ನಿರ್ದಿಷ್ಟ ಬೆಲೆಯ ವೈಪರೀತ್ಯ ಪತ್ತೆಯಾಗಿಲ್ಲ.`)
          }
        } else {
          if (claim.anomalyDetails) {
            const mult = claim.anomalyDetails.multiplier?.toFixed(1) || '3.0'
            const max = claim.anomalyDetails.benchmark_max?.toLocaleString('en-IN') || '0'
            speak(`Pricing issue: The billed procedure charge exceeds the expected benchmark of ₹${max} by ${mult} times.`)
          } else {
            speak(`No price variance detected for this claim.`)
          }
        }
        return
      }

      if (type === 'clinical_guideline') {
        if (currentLang === 'kn') {
          const score = Math.round((claim.supportScore || 0) * 100)
          speak(`ಕ್ಲಿನಿಕಲ್ ಮಾರ್ಗಸೂಚಿ ಫಲಿತಾಂಶ: ಬೆಂಬಲ ಸ್ಕೋರ್ ${score} ಪ್ರತಿಶತ. ತೀರ್ಪು: ${claim.verdict || 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ'}.`)
        } else {
          const score = Math.round((claim.supportScore || 0) * 100)
          speak(`Clinical guideline result: Guideline support score is ${score} percent. Verdict: ${claim.verdict || 'Evaluated'}. Reasoning: ${claim.reasoning || 'Standard protocol evaluated.'}`)
        }
        return
      }

      // Default explanation
      readClaimAloud(claim)
    },
    [readClaimAloud, speak]
  )

  /**
   * Section 5: Read Hospital Details & Live Staff Availability
   */
  const readHospitalDetails = useCallback(async () => {
    const currentLang = languageRef.current
    setStatus('thinking')

    try {
      const availabilities = await getAllHospitalAvailabilities()
      if (!availabilities || availabilities.length === 0) {
        const msg =
          currentLang === 'kn'
            ? 'ಯಾವುದೇ ಆಸ್ಪತ್ರೆಯ ಮಾಹಿತಿ ಪ್ರಸ್ತುತ ಲಭ್ಯವಿಲ್ಲ.'
            : 'No hospital availability data is currently loaded.'
        speak(msg)
        return
      }

      // Pick the primary loaded hospital or the first in list
      const h = availabilities[0]
      const docs = h.doctors_available !== null && h.doctors_available !== undefined ? h.doctors_available : 'Not updated'
      const erDocs = h.emergency_doctors !== null && h.emergency_doctors !== undefined ? h.emergency_doctors : 'Not updated'
      const nurses = h.nurses_available !== null && h.nurses_available !== undefined ? h.nurses_available : 'Not updated'
      const statusText = h.duty_status || 'Accepting Patients'

      if (currentLang === 'kn') {
        speak(`${h.hospital_name} ವಿವರಗಳು: ಪ್ರಸ್ತುತ ಲಭ್ಯವಿರುವ ವೈದ್ಯರು: ${docs}, ತುರ್ತು ವೈದ್ಯರು: ${erDocs}, ಶುಶ್ರೂಷಕರು: ${nurses}. ಆಸ್ಪತ್ರೆಯ ಸ್ಥಿತಿ: ${statusText}.`)
      } else {
        speak(`Hospital status for ${h.hospital_name}: Duty status is ${statusText}. Currently available: ${docs} total doctors, ${erDocs} emergency doctors, and ${nurses} nurses.`)
      }
    } catch {
      const msg =
        currentLang === 'kn'
          ? 'ಆಸ್ಪತ್ರೆಯ ವಿವರಗಳನ್ನು ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.'
          : 'Unable to retrieve hospital staff details at this moment.'
      speak(msg)
    }
  }, [speak])

  /**
   * Compare which hospital has more doctors available
   */
  const compareHospitalDoctors = useCallback(async () => {
    const currentLang = languageRef.current
    setStatus('thinking')

    try {
      const list = await getAllHospitalAvailabilities()
      const valid = list.filter((h) => typeof h.doctors_available === 'number')
      if (valid.length === 0) {
        speak(currentLang === 'kn' ? 'ವೈದ್ಯರ ಲಭ್ಯತೆ ವಿವರಗಳು ಲಭ್ಯವಿಲ್ಲ.' : 'Doctor availability has not been updated yet for the hospitals.')
        return
      }

      // Sort descending by doctors_available
      valid.sort((a, b) => (b.doctors_available || 0) - (a.doctors_available || 0))
      const top = valid[0]

      if (currentLang === 'kn') {
        speak(`${top.hospital_name} ಆಸ್ಪತ್ರೆಯಲ್ಲಿ ಅತಿ ಹೆಚ್ಚು ವೈದ್ಯರು ಲಭ್ಯವಿದ್ದಾರೆ: ಒಟ್ಟು ${top.doctors_available} ವೈದ್ಯರು.`)
      } else {
        speak(`${top.hospital_name} currently has the most doctors available, with ${top.doctors_available} active doctors on duty.`)
      }
    } catch {
      speak(currentLang === 'kn' ? 'ವೈದ್ಯರ ಲಭ್ಯತೆ ಹೋಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.' : 'Could not compare hospital doctor availability.')
    }
  }, [speak])

  /**
   * Section 4: Voice Commands and Page Navigation
   */
  const handleVoiceCommand = useCallback(
    async (recognizedText: string) => {
      const rawText = (recognizedText || '').trim()
      if (!rawText) return

      const rawLower = rawText.toLowerCase()
      const text = rawLower.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ')

      // Prevent duplicate command execution within 2.5s window
      const now = Date.now()
      if (lastExecutedCommandRef.current.text === text && now - lastExecutedCommandRef.current.time < 2500) {
        return
      }
      lastExecutedCommandRef.current = { text, time: now }

      setFinalUserSaid(rawText)

      // Add user transcript to conversation history
      setHistory((prev) => [
        ...prev.slice(-15),
        {
          id: `msg_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sender: 'user',
          text: rawText,
          timestamp: new Date(),
        },
      ])

      const currentLang = languageRef.current

      const matchesAny = (...patterns: string[]) => {
        return patterns.some((p) => {
          const cleanP = p.toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
          return text.includes(cleanP) || rawLower.includes(p.toLowerCase()) || text === cleanP
        })
      }

      // Stop speech playback
      if (matchesAny('stop', 'cancel', 'silence', 'pause', 'quiet', 'ನಿಲ್ಲು', 'ನಿಲ್ಲಿಸಿ', 'ಸಾಕು')) {
        stopSpeaking()
        return
      }

      // COMMAND: "Hospitals" (direct to hospitals, find hospitals, etc.)
      if (
        matchesAny(
          'direct to hospital',
          'direct to hospitals',
          'redirect to hospital',
          'redirect to hospitals',
          'navigate to hospital',
          'navigate to hospitals',
          'go to hospital',
          'go to hospitals',
          'take me to hospital',
          'take me to hospitals',
          'open hospital',
          'open hospitals',
          'show hospital',
          'show hospitals',
          'find hospital',
          'find hospitals',
          'find nearby hospitals',
          'nearby hospitals',
          'hospital finder',
          'hospitals',
          'hospital',
          'facilities',
          'doctors',
          'doctor availability',
          'aspatre',
          'aspathre',
          'hospitalge',
          'hospital ge',
          'ಆಸ್ಪತ್ರೆಗೆ ಹೋಗಿ',
          'ಆಸ್ಪತ್ರೆಗೆ',
          'ಆಸ್ಪತ್ರೆ ತೋರಿಸಿ',
          'ಆಸ್ಪತ್ರೆ ತೆರೆಯಿರಿ',
          'ಆಸ್ಪತ್ರೆಗಳು',
          'ಆಸ್ಪತ್ರೆ ಹುಡುಕಿ',
          'ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗಳು',
          'ಆಸ್ಪತ್ರೆ',
          'ವೈದ್ಯರು',
          'ವೈದ್ಯರನ್ನು ಹುಡುಕಿ',
          'ಡಾಕ್ಟರ್',
          'ಡಾಕ್ಟರ್ಸ್',
          'ಹಾಸ್ಪಿಟಲ್',
          'ಹಾಸ್ಪಿಟಲ್ಸ್',
          'ಹಾಸ್ಪಿಟಲ್‌ಗೆ ಹೋಗಿ'
        )
      ) {
        navigate('/hospitals')
        const navMsg = currentLang === 'kn' ? 'ಆಸ್ಪತ್ರೆಗಳ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.' : 'Directing to Hospitals.'
        speak(navMsg)
        return
      }

      // COMMAND: "Audit Claim" (direct to audit, new audit, etc.)
      if (
        matchesAny(
          'direct to audit',
          'redirect to audit',
          'navigate to audit',
          'go to audit',
          'take me to audit',
          'open audit',
          'audit claim',
          'audit document',
          'new audit',
          'check claim',
          'verify claim',
          'audit bill',
          'audit page',
          'audit',
          'ಆಡಿಟ್ ಪುಟ',
          'ಆಡಿಟ್‌ಗೆ ಹೋಗಿ',
          'ಆಡಿಟ್ ತೆರೆಯಿರಿ',
          'ಆಡಿಟ್',
          'ದಾಖಲೆ ಪರಿಶೀಲಿಸಿ',
          'ಪರಿಶೀಲನೆ',
          'ತಪಾಸಣೆ',
          'ಕ್ಲೈಮ್ ಪರಿಶೀಲಿಸಿ'
        )
      ) {
        navigate('/audit')
        const navMsg = currentLang === 'kn' ? 'ಕ್ಲೈಮ್ ಆಡಿಟ್ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.' : 'Directing to Claims Audit.'
        speak(navMsg)
        return
      }

      // COMMAND: "Claims Explorer" (direct to claims, my claims, etc.)
      if (
        matchesAny(
          'direct to claim',
          'direct to claims',
          'redirect to claim',
          'redirect to claims',
          'navigate to claim',
          'navigate to claims',
          'go to claim',
          'go to claims',
          'take me to claim',
          'take me to claims',
          'open claims explorer',
          'open claims',
          'open claim',
          'claims explorer',
          'claims history',
          'show claims',
          'browse claims',
          'all claims',
          'my claims',
          'claims',
          'claim',
          'ಕ್ಲೈಮ್‌ಗೆ ಹೋಗಿ',
          'ಕ್ಲೈಮ್ ತೋರಿಸಿ',
          'ಕ್ಲೈಮ್ ತೆರೆಯಿರಿ',
          'ಕ್ಲೈಮ್‌ಗಳು',
          'ಕ್ಲೈಮ್ಸ್',
          'ಕ್ಲೈಮ್',
          'ದಾಖಲೆಗಳು',
          'ನನ್ನ ಕ್ಲೈಮ್‌ಗಳು'
        )
      ) {
        navigate('/claims')
        const navMsg = currentLang === 'kn' ? 'ಕ್ಲೈಮ್ಸ್ ಎಕ್ಸ್‌ಪ್ಲೋರರ್ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.' : 'Directing to Claims Explorer.'
        speak(navMsg)
        return
      }

      // COMMAND: "Insights" (direct to insights, analytics, etc.)
      if (
        matchesAny(
          'direct to insights',
          'redirect to insights',
          'navigate to insights',
          'go to insights',
          'take me to insights',
          'open insights',
          'show insights',
          'insights',
          'insight',
          'analytics',
          'statistics',
          'charts',
          'graphs',
          'ಒಳನೋಟ ಪುಟ',
          'ಒಳನೋಟಕ್ಕೆ ಹೋಗಿ',
          'ಒಳನೋಟ ತೆರೆಯಿರಿ',
          'ಒಳನೋಟಗಳು',
          'ಒಳನೋಟ',
          'ಇನ್‌ಸೈಟ್ಸ್',
          'ಇನ್ಸೈಟ್ಸ್',
          'ಗಣಾಂಕಗಳು',
          'ಗಣಾಂಕ',
          'ಚಾರ್ಟ್ಸ್',
          'ಚಾರ್ಟ್',
          'ಗ್ರಾಫ್',
          'ವಿಶ್ಲೇಷಣೆ'
        )
      ) {
        navigate('/insights')
        const navMsg =
          currentLang === 'kn'
            ? 'ಒಳನೋಟಗಳು ಮತ್ತು ಗಣಾಂಕಗಳ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.'
            : 'Directing to Insights.'
        speak(navMsg)
        return
      }

      // COMMAND: "Staff & SOS Management" (direct to staff management)
      if (
        matchesAny(
          'direct to staff management',
          'direct to staff',
          'redirect to staff',
          'redirect to staff management',
          'navigate to staff management',
          'go to staff management',
          'staff and sos management',
          'staff management',
          'hospital management',
          'sos management',
          'emergency desk',
          'emergency sos',
          'sos desk',
          'open staff management',
          'ಸಿಬ್ಬಂದಿ ನಿರ್ವಹಣೆ',
          'ಸಿಬ್ಬಂದಿ ಪುಟ',
          'ಸಿಬ್ಬಂದಿಗೆ ಹೋಗಿ',
          'ಸಿಬ್ಬಂದಿ',
          'ಆಸ್ಪತ್ರೆ ಸಿಬ್ಬಂದಿ',
          'ತುರ್ತು ವಿಭಾಗ',
          'ತುರ್ತು ಸೇವೆ',
          'ತುರ್ತು',
          'ಎಮರ್ಜೆನ್ಸಿ',
          'ಎಸ್ಒಎಸ್',
          'ಎಸ್ ಒ ಎಸ್'
        )
      ) {
        navigate('/hospital/management?mode=read_only')
        const navMsg =
          currentLang === 'kn'
            ? 'ಆಸ್ಪತ್ರೆ ಸಿಬ್ಬಂದಿ ನಿರ್ವಹಣಾ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.'
            : 'Directing to Staff and SOS Management.'
        speak(navMsg)
        return
      }

      // COMMAND: "Dashboard / Home"
      if (
        matchesAny(
          'direct to home',
          'direct to dashboard',
          'redirect to home',
          'redirect to dashboard',
          'navigate to home',
          'navigate to dashboard',
          'open dashboard',
          'patient dashboard',
          'go home',
          'go to home',
          'go to dashboard',
          'take me home',
          'dashboard',
          'home',
          'welcome',
          'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
          'ಡ್ಯಾಶ್ ಬೋರ್ಡ್',
          'ಮುಖಪುಟಕ್ಕೆ ಹೋಗಿ',
          'ಮುಖಪುಟ',
          'ಹೋಮ್',
          'ಸ್ವಾಗತ'
        )
      ) {
        navigate('/')
        const navMsg = currentLang === 'kn' ? 'ಮುಖಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.' : 'Directing to Home.'
        speak(navMsg)
        return
      }

      // COMMAND: "Go back"
      if (matchesAny('go back', 'back', 'previous page', 'previous', 'take me back', 'ಹಿಂದಕ್ಕೆ ಹೋಗಿ', 'ಹಿಂದಕ್ಕೆ', 'ಹಿಂದೆ', 'ಹಿಂದಿನ ಪುಟ')) {
        navigate(-1)
        const navMsg = currentLang === 'kn' ? 'ಹಿಂದಿನ ಪುಟಕ್ಕೆ ಹೋಗುತ್ತಿದ್ದೇವೆ.' : 'Navigating back.'
        speak(navMsg)
        return
      }

      // COMMAND: "Read result" / "Read summary"
      if (
        matchesAny(
          'read result',
          'read summary',
          'read claim summary',
          'read my audit result',
          'read audit result',
          'read claim',
          'claim summary',
          'audit summary',
          'ಫಲಿತಾಂಶ ಓದಿ',
          'ಫಲಿತಾಂಶವನ್ನು ಓದಿ',
          'ಸಾರಾಂಶ ಓದಿ',
          'ಕ್ಲೈಮ್ ಸಾರಾಂಶ',
          'ಕ್ಲೈಮ್ ಓದಿ',
          'ವಿವರಣೆ ಓದಿ',
          'ಓದಿ'
        )
      ) {
        readClaimAloud()
        return
      }

      // COMMAND: "Why flagged?"
      if (
        matchesAny(
          'why flagged',
          'why was this flagged',
          'why was my claim flagged',
          'why is this flagged',
          'why is it flagged',
          'ಏಕೆ ಫ್ಲ್ಯಾಗ್',
          'ಯಾಕೆ ಫ್ಲ್ಯಾಗ್',
          'ಫ್ಲ್ಯಾಗ್ ಏಕೆ',
          'ಏಕೆ ಫ್ಲ್ಯಾಗ್ ಮಾಡಲಾಗಿದೆ',
          'ಯಾಕೆ ಫ್ಲಾಗ್',
          'ಸಮಸ್ಯೆ ಏನು'
        )
      ) {
        await explainClaim('why_flagged')
        return
      }

      // COMMAND: "Price problem?"
      if (
        matchesAny(
          'price problem',
          'pricing problem',
          'what is the pricing problem',
          'cost problem',
          'price alert',
          'ಬೆಲೆಯ ಸಮಸ್ಯೆ',
          'ಬೆಲೆ ಸಮಸ್ಯೆ',
          'ದರ ಸಮಸ್ಯೆ',
          'ಹೆಚ್ಚು ಬೆಲೆ',
          'ವೆಚ್ಚದ ಸಮಸ್ಯೆ',
          'ಬೆಲೆ'
        )
      ) {
        await explainClaim('price_problem')
        return
      }

      // COMMAND: "What is the clinical guideline result?"
      if (
        matchesAny(
          'what is the clinical guideline result',
          'clinical guideline result',
          'guideline result',
          'guideline',
          'ಮಾರ್ಗಸೂಚಿ ಫಲಿತಾಂಶ',
          'ಕ್ಲಿನಿಕಲ್ ಮಾರ್ಗಸೂಚಿ',
          'ಮಾರ್ಗಸೂಚಿ',
          'ನಿಯಮಗಳು'
        )
      ) {
        await explainClaim('clinical_guideline')
        return
      }

      // COMMAND: "Explain my claim"
      if (matchesAny('explain my claim', 'explain claim', 'explain this', 'ಕ್ಲೈಮ್ ವಿವರಿಸಿ', 'ವಿವರಿಸಿ', 'ತಿಳಿಸಿ')) {
        await explainClaim('explain')
        return
      }

      // Hospital Queries: Which hospital has more doctors available?
      if (
        matchesAny(
          'which hospital has more doctors available',
          'more doctors',
          'highest doctors',
          'most doctors',
          'ಯಾವ ಆಸ್ಪತ್ರೆಯಲ್ಲಿ ಹೆಚ್ಚು ವೈದ್ಯರಿದ್ದಾರೆ',
          'ಹೆಚ್ಚು ವೈದ್ಯರು'
        )
      ) {
        await compareHospitalDoctors()
        return
      }

      // Hospital Queries: Read hospital details / What doctors are available
      if (
        matchesAny(
          'read hospital details',
          'tell me about this hospital',
          'what doctors are available',
          'doctor availability',
          'hospital details',
          'ಆಸ್ಪತ್ರೆ ವಿವರ ಓದಿ',
          'ಆಸ್ಪತ್ರೆ ವಿವರಗಳು',
          'ವೈದ್ಯರು ಲಭ್ಯವಿದ್ದಾರಾ',
          'ವೈದ್ಯರ ಮಾಹಿತಿ'
        )
      ) {
        await readHospitalDetails()
        return
      }

      // Fallback response for unhandled queries - polite prompt to repeat
      const fallbackText =
        currentLang === 'kn'
          ? `ಕ್ಷಮಿಸಿ, "${rawText}" ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ. ನೀವು "ಕ್ಲೈಮ್ ತೆರೆಯಿರಿ", "ಆಸ್ಪತ್ರೆ ಹುಡುಕಿ", "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ", ಅಥವಾ "ಫಲಿತಾಂಶ ಓದಿ" ಎಂದು ಹೇಳಬಹುದು.`
          : `I heard "${rawText}". Could you please repeat that? You can say "Open claims", "Open hospitals", "Open dashboard", or "Read summary".`
      speak(fallbackText)
    },
    [compareHospitalDoctors, explainClaim, navigate, readClaimAloud, readHospitalDetails, speak, stopSpeaking]
  )

  /**
   * Start listening using Browser Speech Recognition & ElevenLabs Voice Engine
   */
  const startListening = useCallback(
    (continuousMode?: boolean) => {
      if (!isPatient) {
        setError('Voice assistant is only available for patient accounts.')
        return
      }

      if (continuousMode !== undefined) {
        setIsContinuous(continuousMode)
      }

      stopSpeaking()
      setError(null)
      setTranscript('')
      setFinalUserSaid('')
      isListeningRef.current = true
      setStatus('listening')

      // 1. Primary Speech Recognition: Browser Web Speech API (Chrome, Edge, Safari)
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRec) {
        try {
          if (recognitionRef.current) {
            try {
              recognitionRef.current.abort()
            } catch {}
          }

          const rec = new SpeechRec()
          recognitionRef.current = rec
          rec.continuous = true
          rec.interimResults = true
          rec.lang = languageRef.current === 'kn' ? 'kn-IN' : 'en-IN'

          rec.onstart = () => {
            setStatus('listening')
            setError(null)
          }

          rec.onresult = (event: any) => {
            let interimText = ''
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i]
              const textPiece = res[0]?.transcript || ''
              if (res.isFinal) {
                const finalPiece = textPiece.trim()
                if (finalPiece) {
                  setTranscript(finalPiece)
                  setFinalUserSaid(finalPiece)
                  handleVoiceCommand(finalPiece)
                }
              } else {
                interimText += textPiece
              }
            }
            if (interimText) {
              setTranscript(interimText)
            }
          }

          rec.onerror = (event: any) => {
            if (event.error === 'no-speech') {
              // Harmless pause in speech; do not abort
              return
            }
            if (event.error === 'language-not-supported') {
              console.warn('SpeechRecognition kn-IN not supported by browser engine; attempting en-IN fallback')
              try {
                rec.lang = 'en-IN'
                rec.start()
              } catch {}
              return
            }
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
              setError('Microphone permission denied. Please allow microphone access in your browser.')
              setStatus('idle')
              isListeningRef.current = false
            } else {
              console.warn('Speech recognition notice:', event.error)
            }
          }

          rec.onend = () => {
            if (isListeningRef.current && isContinuousRef.current) {
              try {
                rec.start()
              } catch {}
            } else if (!isListeningRef.current) {
              setStatus((prev) => (prev === 'listening' ? 'idle' : prev))
            }
          }

          rec.start()
        } catch (recErr) {
          console.warn('Browser SpeechRecognition init notice:', recErr)
        }
      }

      // 2. Also start ElevenLabs ConvAI WebSocket session if an actual public Agent ID is provided (not an sk_ API key)
      const agentId = ElevenLabsVoiceEngine.getAgentId()
      if (agentId && !agentId.startsWith('sk_')) {
        elevenLabsVoice.startSession({
          agentId,
          language: languageRef.current,
          onStatusChange: (newStatus) => {
            setStatus(newStatus)
          },
          onTranscript: (userText, isFinal) => {
            setTranscript(userText)
            if (isFinal) {
              setFinalUserSaid(userText)
              handleVoiceCommand(userText)
            }
          },
          onAgentResponse: (agentText) => {
            speak(agentText)
          },
          onError: (errMessage) => {
            console.warn('ElevenLabs ConvAI session notice:', errMessage)
          },
          dynamicVariables: {
            current_page: location.pathname,
            active_claim_id: activeClaimRef.current?.claimId || 'none',
            active_claim_status: activeClaimRef.current?.action || 'none',
          },
        })
      }
    },
    [handleVoiceCommand, isPatient, location.pathname, speak, stopSpeaking]
  )

  /**
   * Stop listening session
   */
  const stopListening = useCallback(() => {
    isListeningRef.current = false
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {}
      recognitionRef.current = null
    }
    elevenLabsVoice.stopSession()
    setStatus('idle')
  }, [])

  /**
   * Clear history
   */
  const clearHistory = () => {
    setHistory([])
    setLastSpoken('')
    setTranscript('')
    setFinalUserSaid('')
  }

  const value: VoiceContextType = {
    isOpen,
    setIsOpen,
    isEnabled,
    setIsEnabled,
    language,
    setLanguage,
    status,
    isContinuous,
    setIsContinuous,
    kannadaVoiceAvailable,
    transcript,
    finalUserSaid,
    setFinalUserSaid,
    lastSpoken,
    history,
    error,
    activeClaim,
    setActiveClaim,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    readClaimAloud,
    explainClaim,
    readHospitalDetails,
    clearHistory,
  }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}

export default VoiceContext
