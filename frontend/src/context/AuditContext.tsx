import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { ExtractAndVerifyResponse, SourceType } from '../types'
import { useAuth } from './AuthContext'

interface AuditContextType {
  result: ExtractAndVerifyResponse | null
  text: string
  sourceType: SourceType
  sourceUrl: string
  activePreset: string | null
  imagePreview: string | null
  imageName: string | null
  setResult: (res: ExtractAndVerifyResponse | null) => void
  setText: (t: string) => void
  setSourceType: (s: SourceType) => void
  setSourceUrl: (u: string) => void
  setActivePreset: (p: string | null) => void
  setImagePreview: (url: string | null) => void
  setImageName: (name: string | null) => void
  clearAudit: () => void
}

const AuditContext = createContext<AuditContextType | undefined>(undefined)

interface PersistedAuditState {
  result: ExtractAndVerifyResponse | null
  text: string
  sourceType: SourceType
  sourceUrl: string
  activePreset: string | null
  imageName: string | null
}

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const currentEmailKey = user?.email ? user.email.trim().toLowerCase() : 'guest'
  const prevEmailKeyRef = useRef<string>(currentEmailKey)

  const getStorageKey = (emailKey: string) => `eb_active_audit_${emailKey}`

  const loadState = (emailKey: string): PersistedAuditState => {
    try {
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem(getStorageKey(emailKey))
        if (stored) {
          return JSON.parse(stored) as PersistedAuditState
        }
      }
    } catch {
      // ignore
    }
    return {
      result: null,
      text: '',
      sourceType: 'hospital_bill',
      sourceUrl: '',
      activePreset: null,
      imageName: null,
    }
  }

  const initial = loadState(currentEmailKey)

  const [result, setResultState] = useState<ExtractAndVerifyResponse | null>(initial.result)
  const [text, setTextState] = useState<string>(initial.text)
  const [sourceType, setSourceTypeState] = useState<SourceType>(initial.sourceType)
  const [sourceUrl, setSourceUrlState] = useState<string>(initial.sourceUrl)
  const [activePreset, setActivePresetState] = useState<string | null>(initial.activePreset)
  const [imagePreview, setImagePreviewState] = useState<string | null>(null)
  const [imageName, setImageNameState] = useState<string | null>(initial.imageName)

  // When active user switches (e.g. Patient logs out and Hospital logs in), switch audit buffer
  useEffect(() => {
    if (prevEmailKeyRef.current !== currentEmailKey) {
      prevEmailKeyRef.current = currentEmailKey
      const userState = loadState(currentEmailKey)
      setResultState(userState.result)
      setTextState(userState.text)
      setSourceTypeState(userState.sourceType)
      setSourceUrlState(userState.sourceUrl)
      setActivePresetState(userState.activePreset)
      setImagePreviewState(null)
      setImageNameState(userState.imageName)
    }
  }, [currentEmailKey])

  // Persist whenever state changes for current email
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const key = getStorageKey(currentEmailKey)
        if (result || text || activePreset || imageName) {
          const stateToSave: PersistedAuditState = {
            result,
            text,
            sourceType,
            sourceUrl,
            activePreset,
            imageName,
          }
          sessionStorage.setItem(key, JSON.stringify(stateToSave))
        } else {
          sessionStorage.removeItem(key)
        }
      }
    } catch {
      // Storage quota or restriction
    }
  }, [result, text, sourceType, sourceUrl, activePreset, imageName, currentEmailKey])

  const setResult = (res: ExtractAndVerifyResponse | null) => {
    setResultState(res)
  }

  const setText = (t: string) => {
    setTextState(t)
  }

  const setSourceType = (s: SourceType) => {
    setSourceTypeState(s)
  }

  const setSourceUrl = (u: string) => {
    setSourceUrlState(u)
  }

  const setActivePreset = (p: string | null) => {
    setActivePresetState(p)
  }

  const setImagePreview = (url: string | null) => {
    setImagePreviewState(url)
  }

  const setImageName = (name: string | null) => {
    setImageNameState(name)
  }

  const clearAudit = () => {
    setResultState(null)
    setTextState('')
    setSourceTypeState('hospital_bill')
    setSourceUrlState('')
    setActivePresetState(null)
    setImagePreviewState(null)
    setImageNameState(null)
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(getStorageKey(currentEmailKey))
      }
    } catch {
      // ignore
    }
  }

  return (
    <AuditContext.Provider
      value={{
        result,
        text,
        sourceType,
        sourceUrl,
        activePreset,
        imagePreview,
        imageName,
        setResult,
        setText,
        setSourceType,
        setSourceUrl,
        setActivePreset,
        setImagePreview,
        setImageName,
        clearAudit,
      }}
    >
      {children}
    </AuditContext.Provider>
  )
}

export function useAudit(): AuditContextType {
  const context = useContext(AuditContext)
  if (!context) {
    throw new Error('useAudit must be used within an AuditProvider')
  }
  return context
}
