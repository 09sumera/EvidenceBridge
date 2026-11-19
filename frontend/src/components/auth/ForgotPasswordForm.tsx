import React, { useState } from 'react'
import type { PortalType } from '../../context/AuthContext'
import { AccountTypeSelector } from './AccountTypeSelector'

interface ForgotPasswordFormProps {
  portal: PortalType
  onPortalChange: (portal: PortalType) => void
  onSubmitForgot: (email: string, portal: PortalType) => Promise<void>
  onBackToLogin: () => void
  loading: boolean
  error: string | null
  onClearError?: () => void
  hidePortalSelector?: boolean
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  portal,
  onPortalChange,
  onSubmitForgot,
  onBackToLogin,
  loading,
  error,
  onClearError,
  hidePortalSelector = false,
}) => {
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const validate = (): boolean => {
    const clean = email.trim()
    if (!clean) {
      setLocalErr('Please enter your registered email address.')
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(clean)) {
      setLocalErr('Please enter a valid email address.')
      return false
    }
    setLocalErr(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailTouched(true)
    if (onClearError) onClearError()

    if (!validate()) return

    await onSubmitForgot(email.trim(), portal)
  }

  const currentError = localErr || error

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Account Type Selector */}
      {!hidePortalSelector && (
        <AccountTypeSelector
          selected={portal}
          onChange={(p) => {
            onPortalChange(p)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          disabled={loading}
        />
      )}

      {/* Email Input */}
      <div>
        <label htmlFor="forgot-email-input" className="block text-xs font-bold text-neutral-900 mb-1.5">
          📧 Registered Account Email Address *
        </label>
        <input
          id="forgot-email-input"
          type="email"
          autoComplete="email"
          disabled={loading}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          placeholder={
            portal === 'hospital_management' ? 'admin@shreemedical.local' : 'ramesh.kumar@patient.local'
          }
          className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm font-bold text-neutral-950 placeholder-neutral-400 bg-white transition-all shadow-[1px_1px_0px_0px_#111111] focus:outline-none ${
            currentError && emailTouched && !email
              ? 'border-rose-500 bg-rose-50/30'
              : 'border-neutral-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'
          } ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
      </div>

      {/* Error Banner */}
      {currentError && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-900 text-xs font-bold flex items-start gap-2 shadow-[1px_1px_0px_0px_#111111]"
        >
          <span className="text-sm flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <span>{currentError}</span>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className={`w-full py-3 px-4 rounded-xl font-black text-sm text-white bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all flex items-center justify-center gap-2 cursor-pointer ${
          loading ? 'opacity-75 cursor-wait' : 'active:translate-x-[2px] active:translate-y-[2px]'
        }`}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>Sending Recovery Code...</span>
          </span>
        ) : (
          <span>Send Recovery Code to Email &rarr;</span>
        )}
      </button>

      {/* Back to Login */}
      <div className="text-center pt-2 text-xs font-bold text-neutral-600">
        Remembered your password?{' '}
        <button
          type="button"
          onClick={onBackToLogin}
          disabled={loading}
          className="font-black text-orange-600 hover:text-orange-700 hover:underline cursor-pointer ml-1"
        >
          Login
        </button>
      </div>
    </form>
  )
}
