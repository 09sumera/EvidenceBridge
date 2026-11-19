import React, { useState } from 'react'
import type { PortalType } from '../../context/AuthContext'
import { AccountTypeSelector } from './AccountTypeSelector'
import { PasswordInput } from './PasswordInput'

interface SignupFormProps {
  portal: PortalType
  onPortalChange: (portal: PortalType) => void
  onSubmitSignup: (data: {
    name: string
    email: string
    password: string
    portal: PortalType
    organization?: string
  }) => Promise<void>
  onSwitchToLogin: () => void
  loading: boolean
  error: string | null
  onClearError?: () => void
  hidePortalSelector?: boolean
}

export const SignupForm: React.FC<SignupFormProps> = ({
  portal,
  onPortalChange,
  onSubmitSignup,
  onSwitchToLogin,
  loading,
  error,
  onClearError,
  hidePortalSelector = false,
}) => {
  const [name, setName] = useState(() =>
    portal === 'hospital_management' ? 'Dr. Ananya Rao' : 'Ramesh Kumar',
  )
  const [email, setEmail] = useState(() =>
    portal === 'hospital_management' ? 'billing.desk@hospital.org' : 'ramesh.kumar@patient.local',
  )
  const [hospitalName, setHospitalName] = useState('Shree Medical Institute')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(true)

  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [localErr, setLocalErr] = useState<string | null>(null)

  const handlePortalSwitch = (p: PortalType) => {
    onPortalChange(p)
    if (onClearError) onClearError()
    setLocalErr(null)
    if (p === 'hospital_management') {
      setName('Dr. Ananya Rao')
      setEmail('billing.desk@hospital.org')
    } else {
      setName('Ramesh Kumar')
      setEmail('ramesh.kumar@patient.local')
    }
  }

  const validate = (): boolean => {
    if (!name.trim()) {
      setLocalErr('Please enter your full name.')
      return false
    }
    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setLocalErr('Please enter your email address.')
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail)) {
      setLocalErr('Please enter a valid email address.')
      return false
    }
    if (portal === 'hospital_management' && !hospitalName.trim()) {
      setLocalErr('Please enter the name of the hospital or institution.')
      return false
    }
    if (password.length < 4) {
      setLocalErr('Password must be at least 4 characters long.')
      return false
    }
    if (password !== confirmPassword) {
      setLocalErr('Passwords do not match.')
      return false
    }
    if (!agreedToTerms) {
      setLocalErr('Please acknowledge the clinical terms to proceed.')
      return false
    }
    setLocalErr(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true, confirmPassword: true })
    if (onClearError) onClearError()

    if (!validate()) return

    await onSubmitSignup({
      name: name.trim(),
      email: email.trim(),
      password: password.trim(),
      portal,
      organization: portal === 'hospital_management' ? hospitalName.trim() : undefined,
    })
  }

  const currentError = localErr || error
  const passwordMatchWarning =
    touched.confirmPassword && confirmPassword && password !== confirmPassword

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

      {/* Full Name */}
      <div>
        <label htmlFor="signup-name-input" className="block text-xs font-bold text-neutral-900 mb-1">
          {portal === 'hospital_management' ? '👤 Administrator / Officer Full Name *' : '👤 Patient Full Name *'}
        </label>
        <input
          id="signup-name-input"
          type="text"
          disabled={loading}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          placeholder={portal === 'hospital_management' ? 'Dr. Ananya Rao' : 'Ramesh Kumar'}
          className="w-full px-3 py-2 rounded-xl border-2 border-neutral-900 bg-white text-xs sm:text-sm font-bold text-neutral-950 placeholder-neutral-400 shadow-[1px_1px_0px_0px_#111111] focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
        />
      </div>

      {/* Hospital Name if Hospital Account */}
      {portal === 'hospital_management' && (
        <div>
          <label htmlFor="signup-org-input" className="block text-xs font-bold text-neutral-900 mb-1">
            🏥 Hospital / Institution Name *
          </label>
          <input
            id="signup-org-input"
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
        <label htmlFor="signup-email-input" className="block text-xs font-bold text-neutral-900 mb-1">
          📧 Official Registered Email Address *
        </label>
        <input
          id="signup-email-input"
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
            portal === 'hospital_management' ? 'billing.desk@hospital.org' : 'ramesh.kumar@patient.local'
          }
          className="w-full px-3 py-2 rounded-xl border-2 border-neutral-900 bg-white text-xs sm:text-sm font-bold text-neutral-950 placeholder-neutral-400 shadow-[1px_1px_0px_0px_#111111] focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
        />
      </div>

      {/* Password */}
      <div>
        <label htmlFor="signup-password-input" className="block text-xs font-bold text-neutral-900 mb-1">
          🔑 Create Account Password *
        </label>
        <PasswordInput
          id="signup-password-input"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          disabled={loading}
          placeholder="At least 4 characters"
          autoComplete="new-password"
        />
      </div>

      {/* Confirm Password */}
      <div>
        <label htmlFor="signup-confirm-password-input" className="block text-xs font-bold text-neutral-900 mb-1">
          🔒 Confirm Account Password *
        </label>
        <PasswordInput
          id="signup-confirm-password-input"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          disabled={loading}
          placeholder="Re-enter your password to confirm"
          autoComplete="new-password"
          hasError={!!passwordMatchWarning}
        />
        {passwordMatchWarning && (
          <p className="text-[11px] text-rose-600 font-bold mt-0.5">
            Passwords do not match.
          </p>
        )}
      </div>

      {/* Terms & Privacy Checkbox */}
      <div className="pt-0.5">
        <label className="flex items-start gap-2 cursor-pointer text-[11px] text-neutral-700 select-none">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            disabled={loading}
            className="mt-0.5 rounded border-2 border-neutral-900 text-orange-600 focus:ring-orange-500 cursor-pointer accent-orange-600"
          />
          <span className="font-bold">
            I agree to EvidenceBridge{' '}
            <span className="text-neutral-950 underline">Clinical Data Privacy</span> and{' '}
            <span className="text-neutral-950 underline">HIPAA/ABDM Auditing Policies</span>.
          </span>
        </label>
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

      {/* Submit Button */}
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
            <span>Creating Account...</span>
          </span>
        ) : (
          <span>Create Account &amp; Verify Email &rarr;</span>
        )}
      </button>

      {/* Back to Login */}
      <div className="text-center pt-1 text-xs font-bold text-neutral-600">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          disabled={loading}
          className="font-black text-orange-600 hover:text-orange-700 hover:underline cursor-pointer ml-1"
        >
          Login
        </button>
      </div>
    </form>
  )
}
