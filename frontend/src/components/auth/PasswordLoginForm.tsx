import React, { useState } from 'react'
import type { PortalType } from '../../context/AuthContext'
import { AccountTypeSelector } from './AccountTypeSelector'
import { PasswordInput } from './PasswordInput'

interface PasswordLoginFormProps {
  portal: PortalType
  onPortalChange: (portal: PortalType) => void
  onSubmitLogin: (email: string, password: string, portal: PortalType) => Promise<void>
  onSwitchToOtp: () => void
  onSwitchToSignup: () => void
  onForgotPassword: () => void
  onDemoLogin?: (portal: PortalType) => Promise<void>
  loading: boolean
  error: string | null
  onClearError?: () => void
  hidePortalSelector?: boolean
  hideDemo?: boolean
}

export const PasswordLoginForm: React.FC<PasswordLoginFormProps> = ({
  portal,
  onPortalChange,
  onSubmitLogin,
  onSwitchToOtp,
  onSwitchToSignup,
  onForgotPassword,
  onDemoLogin,
  loading,
  error,
  onClearError,
  hidePortalSelector = false,
  hideDemo = true,
}) => {
  const [email, setEmail] = useState(() =>
    portal === 'hospital_management' ? 'admin@shreemedical.local' : 'ramesh.kumar@patient.local',
  )
  const [password, setPassword] = useState('password123')
  const [emailTouched, setEmailTouched] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [localValidationErr, setLocalValidationErr] = useState<string | null>(null)

  const handlePortalSwitch = (newPortal: PortalType) => {
    onPortalChange(newPortal)
    if (onClearError) onClearError()
    setLocalValidationErr(null)
    if (newPortal === 'hospital_management') {
      if (!email || email === 'ramesh.kumar@patient.local') {
        setEmail('admin@shreemedical.local')
      }
    } else {
      if (!email || email === 'admin@shreemedical.local') {
        setEmail('ramesh.kumar@patient.local')
      }
    }
  }

  const validate = (): boolean => {
    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setLocalValidationErr('Please enter your registered email address.')
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail)) {
      setLocalValidationErr('Please enter a valid email address.')
      return false
    }
    if (!password) {
      setLocalValidationErr('Please enter your password.')
      return false
    }
    setLocalValidationErr(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailTouched(true)
    setPasswordTouched(true)
    if (onClearError) onClearError()

    if (!validate()) return

    await onSubmitLogin(email.trim(), password, portal)
  }

  const currentError = localValidationErr || error

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5" noValidate>
      {/* Account Type Selector (if not handled externally) */}
      {!hidePortalSelector && (
        <AccountTypeSelector
          selected={portal}
          onChange={handlePortalSwitch}
          disabled={loading}
        />
      )}

      {/* Email Input */}
      <div>
        <label htmlFor="login-email-input" className="block text-xs font-bold text-neutral-900 mb-1">
          {portal === 'hospital_management' ? '🏥 Hospital Management Email *' : '👤 Patient Account Email *'}
        </label>
        <input
          id="login-email-input"
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

      {/* Password Input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="login-password-input" className="block text-xs font-bold text-neutral-900">
            🔑 Account Password *
          </label>
          <button
            type="button"
            onClick={onForgotPassword}
            disabled={loading}
            className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline cursor-pointer"
          >
            Forgot Password?
          </button>
        </div>
        <PasswordInput
          id="login-password-input"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (onClearError) onClearError()
            setLocalValidationErr(null)
          }}
          disabled={loading}
          placeholder="Enter your password"
          hasError={!!(currentError && passwordTouched && !password)}
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

      {/* Primary Submit Button (Orange Neo-Brutalist) */}
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
            <span>Authenticating...</span>
          </span>
        ) : (
          <span>
            {portal === 'hospital_management' ? 'Login to Hospital Desk →' : 'Login to Patient Vault →'}
          </span>
        )}
      </button>

      {/* Switch to OTP Login */}
      <div className="text-center pt-1">
        <button
          type="button"
          onClick={onSwitchToOtp}
          disabled={loading}
          className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline inline-flex items-center gap-1.5 cursor-pointer"
        >
          <span>📲</span>
          <span>Login with Email OTP passcode instead</span>
        </button>
      </div>

      {/* Optional In-Form Demo Button */}
      {!hideDemo && onDemoLogin && (
        <div className="pt-2 border-t-2 border-neutral-900">
          <button
            type="button"
            disabled={loading}
            onClick={() => onDemoLogin(portal)}
            className="w-full py-2 px-3 rounded-xl border-2 border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-black flex items-center justify-center gap-2 shadow-[1px_1px_0px_0px_#111111] transition-all cursor-pointer"
          >
            <span>⚡</span>
            <span>
              {portal === 'hospital_management'
                ? 'Login as Shree Medical Institute (1-Click)'
                : 'Login as Patient: Ramesh Kumar (1-Click)'}
            </span>
          </button>
        </div>
      )}
    </form>
  )
}
