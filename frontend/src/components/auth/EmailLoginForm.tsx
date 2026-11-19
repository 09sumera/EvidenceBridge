import React, { useState } from 'react'
import type { PortalType } from '../../context/AuthContext'
import { AccountTypeSelector } from './AccountTypeSelector'

interface EmailLoginFormProps {
  portal: PortalType
  onPortalChange: (portal: PortalType) => void
  onSubmitEmail: (email: string, portal: PortalType, orgName?: string) => Promise<void>
  onSwitchToPassword?: () => void
  onSwitchToSignup?: () => void
  onDemoLogin?: (portal: PortalType) => Promise<void>
  loading: boolean
  error: string | null
  onClearError?: () => void
  hidePortalSelector?: boolean
}

export const EmailLoginForm: React.FC<EmailLoginFormProps> = ({
  portal,
  onPortalChange,
  onSubmitEmail,
  onSwitchToPassword,
  onSwitchToSignup,
  loading,
  error,
  onClearError,
  hidePortalSelector = false,
}) => {
  const [name, setName] = useState(() =>
    portal === 'hospital_management' ? 'Dr. Ananya Rao' : 'Ramesh Kumar',
  )
  const [email, setEmail] = useState(() =>
    portal === 'hospital_management' ? 'admin@shreemedical.local' : 'ramesh.kumar@patient.local',
  )
  const [hospitalName, setHospitalName] = useState('Shree Medical Institute')
  const [emailTouched, setEmailTouched] = useState(false)
  const [localValidationErr, setLocalValidationErr] = useState<string | null>(null)

  const handlePortalSwitch = (newPortal: PortalType) => {
    onPortalChange(newPortal)
    if (onClearError) onClearError()
    setLocalValidationErr(null)
    if (newPortal === 'hospital_management') {
      setName('Dr. Ananya Rao')
      if (!email || email === 'ramesh.kumar@patient.local') {
        setEmail('admin@shreemedical.local')
      }
    } else {
      setName('Ramesh Kumar')
      if (!email || email === 'admin@shreemedical.local') {
        setEmail('ramesh.kumar@patient.local')
      }
    }
  }

  const validateEmail = (val: string): boolean => {
    const clean = val.trim()
    if (!clean) {
      setLocalValidationErr('Please enter your email address.')
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(clean)) {
      setLocalValidationErr('Please enter a valid email address.')
      return false
    }
    setLocalValidationErr(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailTouched(true)
    if (onClearError) onClearError()

    if (!validateEmail(email)) {
      return
    }

    await onSubmitEmail(
      email.trim(),
      portal,
      portal === 'hospital_management' ? hospitalName.trim() : undefined,
    )
  }

  const currentError = localValidationErr || error

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5" noValidate>
      {/* Account Type Selector */}
      {!hidePortalSelector && (
        <AccountTypeSelector
          selected={portal}
          onChange={handlePortalSwitch}
          disabled={loading}
        />
      )}

      {/* Name Input */}
      <div>
        <label htmlFor="otp-name-input" className="block text-xs font-bold text-neutral-900 mb-1">
          {portal === 'hospital_management' ? '👤 Administrator Full Name' : '👤 Patient Full Name'}
        </label>
        <input
          id="otp-name-input"
          type="text"
          disabled={loading}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={portal === 'hospital_management' ? 'Dr. Ananya Rao' : 'Ramesh Kumar'}
          className="w-full px-3 py-2 rounded-xl border-2 border-neutral-900 bg-white text-xs sm:text-sm font-bold text-neutral-950 placeholder-neutral-400 shadow-[1px_1px_0px_0px_#111111] focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
        />
      </div>

      {/* Hospital Organization input if Hospital is selected */}
      {portal === 'hospital_management' && (
        <div>
          <label htmlFor="hospital-name-input" className="block text-xs font-bold text-neutral-900 mb-1">
            🏥 Hospital / Institution Name
          </label>
          <input
            id="hospital-name-input"
            type="text"
            disabled={loading}
            value={hospitalName}
            onChange={(e) => setHospitalName(e.target.value)}
            placeholder="Shree Medical Institute"
            className="w-full px-3 py-2 rounded-xl border-2 border-neutral-900 bg-white text-xs sm:text-sm font-bold text-neutral-950 placeholder-neutral-400 shadow-[1px_1px_0px_0px_#111111] focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
          />
        </div>
      )}

      {/* Email Address */}
      <div>
        <label htmlFor="otp-email-input" className="block text-xs font-bold text-neutral-900 mb-1">
          📧 Email Address (You will receive your OTP here) *
        </label>
        <input
          id="otp-email-input"
          type="email"
          autoComplete="email"
          disabled={loading}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (onClearError) onClearError()
            setLocalValidationErr(null)
          }}
          placeholder={
            portal === 'hospital_management' ? 'admin@shreemedical.local' : 'ramesh.kumar@patient.local'
          }
          className={`w-full px-3 py-2 rounded-xl border-2 text-xs sm:text-sm font-bold text-neutral-950 placeholder-neutral-400 bg-white transition-all shadow-[1px_1px_0px_0px_#111111] focus:outline-none ${
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
          className="p-2.5 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-900 text-xs font-bold flex items-start gap-2 shadow-[1px_1px_0px_0px_#111111]"
        >
          <span className="text-sm flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <span>{currentError}</span>
          </div>
        </div>
      )}

      {/* Primary Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className={`w-full py-2.5 px-4 rounded-xl font-black text-xs sm:text-sm text-white bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all flex items-center justify-center gap-2 cursor-pointer ${
          loading ? 'opacity-75 cursor-wait' : 'active:translate-x-[2px] active:translate-y-[2px]'
        }`}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>Sending Passcode...</span>
          </span>
        ) : (
          <span>Send Verification Passcode to Email &rarr;</span>
        )}
      </button>

      {/* Switch to Password Login */}
      {onSwitchToPassword && (
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={onSwitchToPassword}
            disabled={loading}
            className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>🔑</span>
            <span>Login with Password instead</span>
          </button>
        </div>
      )}

      {/* Switch to Sign Up */}
      {onSwitchToSignup && (
        <div className="text-center pt-1 text-xs font-bold text-neutral-600">
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignup}
            disabled={loading}
            className="font-black text-orange-600 hover:text-orange-700 hover:underline cursor-pointer ml-1"
          >
            Create an Account
          </button>
        </div>
      )}
    </form>
  )
}
