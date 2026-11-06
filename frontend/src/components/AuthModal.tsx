import React, { useState, useEffect, useRef } from 'react'
import { useAuth, type PortalType } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { EbMark } from './Logo'
import { verifyOtpApi } from '../api/client'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'login' | 'signup'
  initialPortal?: PortalType
  onSuccess?: () => void
}

type AuthTab = 'signin' | 'signup'
type SignInMethod = 'password' | 'otp'
type SignupStep = 'details' | 'verify_otp' | 'create_password'

export function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  initialPortal = 'patient',
  onSuccess,
}: AuthModalProps) {
  const { login, signup, demoLogin, otpRequest, otpVerify } = useAuth()
  const { isDark } = useTheme()

  // Primary navigation state (only Sign In and Sign Up tabs)
  const [portal, setPortal] = useState<PortalType>(initialPortal)
  const [authTab, setAuthTab] = useState<AuthTab>(initialMode === 'signup' ? 'signup' : 'signin')
  const [signInMethod, setSignInMethod] = useState<SignInMethod>('password')

  // Sign Up Multi-Step Flow (1: Details -> 2: Verify OTP -> 3: Create Password)
  const [signupStep, setSignupStep] = useState<SignupStep>('details')
  const [isOtpVerified, setIsOtpVerified] = useState(false)
  const [signupEmail, setSignupEmail] = useState('')

  // OTP flow state (shared for sign up step 2 and optional OTP sign in)
  const [otpStep, setOtpStep] = useState<'input' | 'verify'>('input')
  const [otpIdentifier, setOtpIdentifier] = useState('')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [resendTimer, setResendTimer] = useState<number>(30)
  const [isTimerActive, setIsTimerActive] = useState(false)
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([])

  // User input states
  const [patientName, setPatientName] = useState('Ramesh Kumar')
  const [hospitalName, setHospitalName] = useState('Shree Medical Institute')
  const [passwordEmail, setPasswordEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupOrg, setSignupOrg] = useState('')

  // UI status state
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Initialize and reset modal on open
  useEffect(() => {
    if (isOpen) {
      setPortal(initialPortal)
      setAuthTab(initialMode === 'signup' ? 'signup' : 'signin')
      setSignInMethod('password')
      setSignupStep('details')
      setIsOtpVerified(false)
      setOtpStep('input')
      setError(null)
      setOtpDigits(['', '', '', '', '', ''])
      setPassword('')
      setConfirmPassword('')

      if (initialPortal === 'hospital_management') {
        setOtpIdentifier('admin@shreemedical.local')
        setHospitalName('Shree Medical Institute')
        setPasswordEmail('admin@shreemedical.local')
        setSignupEmail('admin@shreemedical.local')
      } else {
        setOtpIdentifier('ramesh.kumar@patient.local')
        setPatientName('Ramesh Kumar')
        setPasswordEmail('ramesh.kumar@patient.local')
        setSignupEmail('ramesh.kumar@patient.local')
      }
    }
  }, [isOpen, initialPortal, initialMode])

  // Timer countdown for OTP resend
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    if (isTimerActive && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1)
      }, 1000)
    } else if (resendTimer === 0) {
      setIsTimerActive(false)
    }
    return () => clearInterval(interval)
  }, [isTimerActive, resendTimer])

  if (!isOpen) return null

  const isHospital = portal === 'hospital_management'

  const handlePortalChange = (newPortal: PortalType) => {
    setPortal(newPortal)
    setError(null)
    setOtpStep('input')
    setSignupStep('details')
    setIsOtpVerified(false)
    setOtpDigits(['', '', '', '', '', ''])
    setPassword('')
    setConfirmPassword('')

    if (newPortal === 'hospital_management') {
      setOtpIdentifier('admin@shreemedical.local')
      setHospitalName('Shree Medical Institute')
      setPasswordEmail('admin@shreemedical.local')
      setSignupEmail('admin@shreemedical.local')
    } else {
      setOtpIdentifier('ramesh.kumar@patient.local')
      setPatientName('Ramesh Kumar')
      setPasswordEmail('ramesh.kumar@patient.local')
      setSignupEmail('ramesh.kumar@patient.local')
    }
  }

  // Handle single digit OTP change
  const handleDigitChange = (index: number, val: string) => {
    const char = val.slice(-1).replace(/\D/g, '')
    const updated = [...otpDigits]
    updated[index] = char
    setOtpDigits(updated)

    if (char && index < 5) {
      digitInputRefs.current[index + 1]?.focus()
    }
  }

  // Handle backspace navigation in OTP boxes
  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus()
    }
  }

  // Handle pasting full 6 digits
  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').trim().replace(/\D/g, '')
    if (pasted.length >= 6) {
      const chars = pasted.slice(0, 6).split('')
      setOtpDigits(chars)
      digitInputRefs.current[5]?.focus()
    }
  }

  // ---------------------------------------------------------------------------
  // SIGN IN FLOW HANDLERS
  // ---------------------------------------------------------------------------

  // Sign In with Password
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!passwordEmail.trim()) {
      setError('Please enter your registered email address.')
      return
    }
    if (!password.trim()) {
      setError('Please enter your account password.')
      return
    }

    setLoading(true)
    try {
      await login(passwordEmail.trim(), password.trim(), portal)
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid login credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Sign In with OTP (Request code)
  const handleSignInRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)
    if (!otpIdentifier.trim()) {
      setError('Please enter your email address to receive your OTP code.')
      return
    }

    setLoading(true)
    try {
      await otpRequest(
        otpIdentifier.trim(),
        portal,
        isHospital ? hospitalName.trim() : undefined,
        !isHospital ? patientName.trim() : undefined
      )
      setOtpStep('verify')
      setResendTimer(30)
      setIsTimerActive(true)
      setTimeout(() => {
        digitInputRefs.current[0]?.focus()
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not dispatch verification passcode.')
    } finally {
      setLoading(false)
    }
  }

  // Sign In with OTP (Verify code and log in)
  const handleSignInVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)
    const fullCode = otpDigits.join('')
    if (fullCode.length !== 6) {
      setError('Please enter all 6 digits of the verification code.')
      return
    }

    setLoading(true)
    try {
      await otpVerify(
        otpIdentifier.trim(),
        fullCode,
        portal,
        isHospital ? hospitalName.trim() : undefined,
        !isHospital ? patientName.trim() : undefined
      )
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid OTP verification code.')
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // SIGN UP FLOW: STEP 1 -> STEP 2 (OTP) -> STEP 3 (PASSWORD CREATION)
  // ---------------------------------------------------------------------------

  // Sign Up Step 1: Send OTP to verify email before password creation
  const handleSignupSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const targetEmail = signupEmail.trim()
    if (!targetEmail || !targetEmail.includes('@')) {
      setError('Please enter a valid email address to receive your OTP verification code.')
      return
    }

    const displayName = isHospital ? hospitalName.trim() : patientName.trim()
    if (!displayName) {
      setError(isHospital ? 'Please enter the hospital name.' : 'Please enter your full name.')
      return
    }

    setLoading(true)
    try {
      await otpRequest(
        targetEmail,
        portal,
        isHospital ? hospitalName.trim() : undefined,
        !isHospital ? patientName.trim() : undefined
      )
      setOtpDigits(['', '', '', '', '', ''])
      setSignupStep('verify_otp')
      setResendTimer(30)
      setIsTimerActive(true)

      // Auto-focus first digit
      setTimeout(() => {
        digitInputRefs.current[0]?.focus()
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send verification code.')
    } finally {
      setLoading(false)
    }
  }

  // Sign Up Step 2: Verify 6-digit OTP code before proceeding to password creation
  const handleSignupVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const fullCode = otpDigits.join('')
    if (fullCode.length !== 6) {
      setError('Please enter all 6 digits of the OTP code.')
      return
    }

    setLoading(true)
    try {
      let verified = false

      // Check session storage cache
      try {
        const raw = sessionStorage.getItem('eb_pending_otp')
        if (raw) {
          const stored = JSON.parse(raw)
          if (stored.code === fullCode) {
            verified = true
          }
        }
      } catch {}

      // Verify with backend verification endpoint
      if (!verified) {
        try {
          const res = await verifyOtpApi({
            email: signupEmail.trim(),
            code: fullCode,
            portal,
            name: isHospital ? hospitalName.trim() : patientName.trim(),
            organization: isHospital ? hospitalName.trim() : 'Personal Health Vault',
          })
          if (res.success) {
            verified = true
          }
        } catch (apiErr: any) {
          // If backend offline, check if code matches fallback
          const raw = sessionStorage.getItem('eb_pending_otp')
          if (raw) {
            const stored = JSON.parse(raw)
            if (stored.code === fullCode) {
              verified = true
            }
          }
          if (!verified) {
            throw apiErr
          }
        }
      }

      if (verified) {
        setIsOtpVerified(true)
        setSignupStep('create_password')
        setError(null)
      } else {
        setError('Incorrect OTP code. Please enter the valid 6 digits received on your email.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Sign Up Step 3: Create password & finish registration
  const handleSignupCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!isOtpVerified) {
      setError('Your email must be verified with OTP before creating a password.')
      setSignupStep('verify_otp')
      return
    }

    if (password.length < 4) {
      setError('Password must be at least 4 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify both fields.')
      return
    }

    setLoading(true)
    try {
      const displayName = isHospital ? hospitalName.trim() : patientName.trim()
      await signup(
        displayName,
        signupEmail.trim(),
        password.trim(),
        portal,
        isHospital ? hospitalName.trim() : signupOrg.trim() || 'Personal Health Vault'
      )
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register account.')
    } finally {
      setLoading(false)
    }
  }

  // 1-Click Fast Prototype Demo Access
  const handleDemoAccess = async () => {
    setError(null)
    setLoading(true)
    try {
      await demoLogin(portal)
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not launch demo session.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div
        className={`relative rounded-3xl max-w-lg w-full p-6 sm:p-8 border-2 transition-all animate-in fade-in zoom-in-95 duration-200 overflow-hidden ${
          isDark
            ? 'bg-[#13161c] border-neutral-700 text-white shadow-2xl'
            : 'bg-white border-neutral-900 text-neutral-900 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]'
        }`}
        style={{ backgroundColor: isDark ? '#13161c' : '#ffffff', opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 transition-colors duration-300 ${
            isHospital ? 'bg-orange-500' : 'bg-neutral-900 dark:bg-orange-500'
          }`}
        />

        {/* Close Modal Button */}
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
            isDark
              ? 'text-neutral-400 hover:text-white hover:bg-neutral-800 border-neutral-700 bg-neutral-800/80'
              : 'text-neutral-800 hover:text-black hover:bg-neutral-100 border-neutral-900 bg-white shadow-adjudo-sm'
          }`}
          aria-label="Close modal"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header Branding */}
        <div className="text-center mb-5 pt-1">
          <div className="flex justify-center mb-2.5">
            <div
              className={`p-2.5 rounded-2xl border shadow-sm ${
                isDark ? 'bg-neutral-800 border-neutral-700' : 'bg-cream-100 border-neutral-900 shadow-adjudo-sm'
              }`}
            >
              <EbMark size={34} />
            </div>
          </div>
          <h2 className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-neutral-900'}`}>
            EvidenceBridge Portal
          </h2>
          <p className={`text-xs mt-1 font-medium tracking-wide ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
            Clinical Evidence &amp; Medical Price Auditing Network
          </p>
        </div>

        {/* Dual Portal Switcher Tabs (Patient vs Hospital Management) */}
        <div className="mb-4">
          <div
            className={`grid grid-cols-2 p-1.5 rounded-2xl border-2 ${
              isDark ? 'bg-[#181b22] border-neutral-700' : 'bg-cream-100 border-neutral-900'
            }`}
          >
            {/* Patient Portal Option */}
            <button
              type="button"
              onClick={() => handlePortalChange('patient')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                portal === 'patient'
                  ? isDark
                    ? 'bg-[#252b38] text-white shadow-md border border-neutral-600'
                    : 'bg-white text-neutral-950 font-black shadow-adjudo-sm border-2 border-neutral-900'
                  : isDark
                  ? 'text-neutral-400 hover:text-white border border-transparent'
                  : 'text-neutral-700 hover:text-neutral-950 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-black">
                <span className="text-sm">👤</span>
                <span>Patient Portal</span>
              </div>
              <span
                className={`text-[10px] font-medium ${
                  portal === 'patient' ? (isDark ? 'text-neutral-300' : 'text-neutral-700') : 'opacity-70'
                }`}
              >
                Personal Bills &amp; Rx Audit
              </span>
            </button>

            {/* Hospital Management Option */}
            <button
              type="button"
              onClick={() => handlePortalChange('hospital_management')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                portal === 'hospital_management'
                  ? isDark
                    ? 'bg-[#252b38] text-white shadow-md border border-orange-500/60'
                    : 'bg-white text-neutral-950 font-black shadow-adjudo-sm border-2 border-neutral-900 ring-2 ring-orange-500/30'
                  : isDark
                  ? 'text-neutral-400 hover:text-white border border-transparent'
                  : 'text-neutral-700 hover:text-neutral-950 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-black">
                <span className="text-sm">🏥</span>
                <span>Hospital Mgmt</span>
              </div>
              <span
                className={`text-[10px] font-medium ${
                  portal === 'hospital_management'
                    ? isDark
                      ? 'text-orange-400'
                      : 'text-orange-600 font-bold'
                    : 'opacity-70'
                }`}
              >
                Provider Tariff &amp; Billing Desk
              </span>
            </button>
          </div>
        </div>

        {/* Fast 1-Click Prototype Testing Banner */}
        <div
          className={`mb-4 p-4 rounded-2xl border-2 transition-all ${
            isHospital
              ? isDark
                ? 'bg-[#181d26] border-orange-500/40 shadow-sm'
                : 'bg-orange-50 border-orange-300 shadow-adjudo-sm'
              : isDark
              ? 'bg-[#181c24] border-neutral-700'
              : 'bg-cream-50 border-neutral-900 shadow-adjudo-sm'
          }`}
        >
          <div className="flex items-center justify-between mb-2 text-xs">
            <span
              className={`font-black flex items-center gap-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}
            >
              <span className="text-orange-500">⚡</span>
              <span>Fast 1-Click Prototype Demo</span>
            </span>
            <span
              className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                isHospital
                  ? isDark
                    ? 'bg-orange-950 text-orange-300 border-orange-700'
                    : 'bg-orange-100 text-orange-900 border-orange-300'
                  : isDark
                  ? 'bg-neutral-800 text-neutral-300 border-neutral-700'
                  : 'bg-white text-neutral-900 border-neutral-900 shadow-adjudo-sm'
              }`}
            >
              {isHospital ? '🏥 Hospital Entity' : '👤 Patient User'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDemoAccess}
            disabled={loading}
            className={`w-full py-2.5 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
              isHospital
                ? isDark
                  ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-orange-500/20'
                  : 'bg-orange-600 hover:bg-orange-700 text-white border-2 border-neutral-900 shadow-adjudo-sm'
                : isDark
                ? 'bg-orange-600 hover:bg-orange-700 text-white shadow-orange-500/20'
                : 'bg-neutral-900 hover:bg-neutral-800 text-white border-2 border-neutral-900 shadow-adjudo-sm'
            }`}
          >
            <span>
              {isHospital
                ? 'Sign In as Hospital: Shree Medical Institute (1-Click)'
                : 'Sign In as Patient: Ramesh Kumar (1-Click)'}
            </span>
            <span>&rarr;</span>
          </button>
          <div
            className={`text-[11px] font-medium mt-1.5 text-center ${
              isDark ? 'text-neutral-400' : 'text-neutral-600'
            }`}
          >
            {isHospital
              ? 'Institutional account: Shree Medical Institute • Pre-loaded with Karnataka provider audits'
              : 'Patient account: Ramesh Kumar • Pre-loaded with personal medical bills & prescriptions'}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TWO-TAB NAVIGATOR: ONLY "Sign In" AND "Sign Up"                           */}
        {/* ========================================================================= */}
        <div
          className={`grid grid-cols-2 p-1.5 rounded-2xl mb-4 border-2 ${
            isDark ? 'bg-[#181b22] border-neutral-700' : 'bg-cream-100 border-neutral-900'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setAuthTab('signin')
              setSignInMethod('password')
              setError(null)
            }}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              authTab === 'signin'
                ? isDark
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-neutral-900 text-white shadow-adjudo-sm'
                : isDark
                ? 'text-neutral-400 hover:text-white'
                : 'text-neutral-700 hover:text-neutral-950'
            }`}
          >
            <span className="text-sm">🔐</span>
            <span>Sign In</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthTab('signup')
              setSignupStep('details')
              setError(null)
            }}
            className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              authTab === 'signup'
                ? isDark
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-neutral-900 text-white shadow-adjudo-sm'
                : isDark
                ? 'text-neutral-400 hover:text-white'
                : 'text-neutral-700 hover:text-neutral-950'
            }`}
          >
            <span className="text-sm">📝</span>
            <span>Sign Up</span>
          </button>
        </div>

        {/* Error Alert Box */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
            <span className="text-sm font-bold">⚠️</span>
            <div className="flex-1 leading-relaxed font-medium">{error}</div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: SIGN IN VIEW (Password Login with optional OTP fallback)           */}
        {/* ========================================================================= */}
        {authTab === 'signin' && (
          <div>
            {signInMethod === 'password' ? (
              /* Standard Password Sign In Form */
              <form onSubmit={handlePasswordSignIn} className="space-y-3.5">
                <div>
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-800'
                    }`}
                  >
                    {isHospital ? '🏥 Hospital Billing Desk Email' : '👤 Patient Account Email'}{' '}
                    <span className="text-orange-600">*</span>
                  </label>
                  <input
                    type="email"
                    value={passwordEmail}
                    onChange={(e) => setPasswordEmail(e.target.value)}
                    placeholder={isHospital ? 'admin@shreemedical.local' : 'ramesh.kumar@patient.local'}
                    required
                    className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                      isDark
                        ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                        : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                    }`}
                  />
                </div>

                <div>
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-800'
                    }`}
                  >
                    Account Password <span className="text-orange-600">*</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                      isDark
                        ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                        : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                    }`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-1 ${
                    isDark
                      ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                      : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Signing In...
                    </span>
                  ) : (
                    <span>Sign In to {isHospital ? 'Hospital Desk' : 'Patient Vault'} &rarr;</span>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSignInMethod('otp')
                      setOtpStep('input')
                      setError(null)
                    }}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700 dark:text-orange-400 hover:underline cursor-pointer"
                  >
                    📱 Sign in with Email OTP passcode instead
                  </button>
                </div>
              </form>
            ) : (
              /* Optional Email OTP Sign In Form */
              <div>
                {otpStep === 'input' ? (
                  <form onSubmit={handleSignInRequestOtp} className="space-y-3.5">
                    <div>
                      <label
                        className={`block text-xs font-bold mb-1.5 ${
                          isDark ? 'text-neutral-200' : 'text-neutral-800'
                        }`}
                      >
                        {isHospital ? 'Hospital Billing Desk Email' : 'Email Address'}{' '}
                        <span className="text-orange-600">*</span>
                      </label>
                      <input
                        type="email"
                        value={otpIdentifier}
                        onChange={(e) => setOtpIdentifier(e.target.value)}
                        placeholder="your.email@example.com"
                        required
                        className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                          isDark
                            ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                            : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                        }`}
                      />
                      <p
                        className={`text-[11px] mt-1 font-medium ${
                          isDark ? 'text-neutral-400' : 'text-neutral-600'
                        }`}
                      >
                        A 6-digit one-time login passcode will be dispatched to this email address.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-1 ${
                        isDark
                          ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                          : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                      }`}
                    >
                      {loading ? 'Dispatching Passcode...' : 'Send Login OTP to Email →'}
                    </button>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSignInMethod('password')
                          setError(null)
                        }}
                        className="text-xs font-bold text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 hover:underline cursor-pointer"
                      >
                        🔑 Sign in with password instead
                      </button>
                    </div>
                  </form>
                ) : (
                  /* OTP Digit Entry for Sign In */
                  <form onSubmit={handleSignInVerifyOtp} className="space-y-4">
                    <div
                      className={`p-3 rounded-xl border-2 flex items-center justify-between text-xs ${
                        isDark ? 'bg-[#181b22] border-neutral-700' : 'bg-cream-50 border-neutral-900 shadow-adjudo-sm'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div
                          className={`text-[10px] uppercase font-black tracking-wider ${
                            isDark ? 'text-neutral-400' : 'text-neutral-600'
                          }`}
                        >
                          Login Passcode Sent To:
                        </div>
                        <div className="font-bold truncate mt-0.5 text-orange-600 dark:text-orange-400 font-mono">
                          {otpIdentifier}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpStep('input')
                          setError(null)
                        }}
                        className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                          isDark
                            ? 'border-neutral-700 hover:bg-neutral-800 text-neutral-200'
                            : 'border-neutral-900 bg-white hover:bg-cream-200 text-neutral-900 shadow-adjudo-sm'
                        }`}
                      >
                        ✏️ Change
                      </button>
                    </div>

                    <div>
                      <label
                        className={`block text-xs font-bold text-center mb-2.5 ${
                          isDark ? 'text-neutral-200' : 'text-neutral-900'
                        }`}
                      >
                        Enter 6-Digit Login Passcode
                      </label>
                      <div className="flex justify-center items-center gap-2 sm:gap-2.5">
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={(el) => {
                              digitInputRefs.current[idx] = el
                            }}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleDigitChange(idx, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                            onPaste={idx === 0 ? handleOtpPaste : undefined}
                            className={`w-11 sm:w-12 h-13 sm:h-14 text-center font-mono font-black text-xl sm:text-2xl rounded-xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                              digit
                                ? isDark
                                  ? 'border-orange-500 bg-[#1c222c] text-white ring-1 ring-orange-500/30'
                                  : 'border-orange-600 bg-white text-neutral-950 shadow-adjudo-sm ring-1 ring-orange-500/20'
                                : isDark
                                ? 'border-neutral-700 bg-[#181b22] text-white hover:border-neutral-600'
                                : 'border-neutral-900 bg-white text-neutral-950 hover:border-black shadow-adjudo-sm'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs px-1">
                      <span
                        className={`text-[11px] font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}
                      >
                        Did not receive code?
                      </span>
                      {isTimerActive ? (
                        <span
                          className={`text-[11px] font-mono font-bold ${
                            isDark ? 'text-neutral-400' : 'text-neutral-600'
                          }`}
                        >
                          Resend in {resendTimer}s
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSignInRequestOtp()}
                          className="text-xs font-black cursor-pointer text-orange-600 hover:text-orange-700 dark:text-orange-400"
                        >
                          🔄 Resend New Passcode
                        </button>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={loading || otpDigits.join('').length !== 6}
                      className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                        isDark
                          ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                          : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                      }`}
                    >
                      {loading ? 'Verifying Passcode...' : 'Verify Code & Sign In →'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SIGN UP VIEW (VERIFY OTP FIRST, THEN CREATE PASSWORD)              */}
        {/* ========================================================================= */}
        {authTab === 'signup' && (
          <div>
            {/* Step Progress Stepper */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider mb-2">
                <span
                  className={`flex items-center gap-1.5 ${
                    signupStep === 'details'
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] bg-orange-100 dark:bg-orange-950/60 border border-orange-500">
                    {signupStep === 'details' ? '1' : '✓'}
                  </span>
                  <span>1. Details</span>
                </span>

                <span className="text-neutral-400">&bull;&bull;&bull;</span>

                <span
                  className={`flex items-center gap-1.5 ${
                    signupStep === 'verify_otp'
                      ? 'text-orange-600 dark:text-orange-400 font-black'
                      : isOtpVerified
                      ? 'text-emerald-600 dark:text-emerald-400 font-black'
                      : 'text-neutral-400'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                      isOtpVerified
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700'
                        : signupStep === 'verify_otp'
                        ? 'bg-orange-100 dark:bg-orange-950/60 border-orange-500 text-orange-700'
                        : 'border-neutral-500 text-neutral-400'
                    }`}
                  >
                    {isOtpVerified ? '✓' : '2'}
                  </span>
                  <span>2. Verify OTP</span>
                </span>

                <span className="text-neutral-400">&bull;&bull;&bull;</span>

                <span
                  className={`flex items-center gap-1.5 ${
                    signupStep === 'create_password'
                      ? 'text-orange-600 dark:text-orange-400 font-black'
                      : 'text-neutral-400'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                      signupStep === 'create_password'
                        ? 'bg-orange-100 dark:bg-orange-950/60 border-orange-500 text-orange-700'
                        : 'border-neutral-500 text-neutral-400'
                    }`}
                  >
                    3
                  </span>
                  <span>3. Create Password</span>
                </span>
              </div>

              {/* Visual Progress Bar */}
              <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-600 transition-all duration-300"
                  style={{
                    width:
                      signupStep === 'details'
                        ? '33%'
                        : signupStep === 'verify_otp'
                        ? '66%'
                        : '100%',
                  }}
                />
              </div>
            </div>

            {/* STEP 1: Enter User Info & Send OTP */}
            {signupStep === 'details' && (
              <form onSubmit={handleSignupSendOtp} className="space-y-3.5">
                {isHospital ? (
                  <div>
                    <label
                      className={`block text-xs font-bold mb-1.5 ${
                        isDark ? 'text-neutral-200' : 'text-neutral-800'
                      }`}
                    >
                      🏥 Hospital / Healthcare Institution Name <span className="text-orange-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={hospitalName}
                      onChange={(e) => setHospitalName(e.target.value)}
                      placeholder="e.g. Shree Medical Institute, Davangere"
                      required
                      className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                        isDark
                          ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                          : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                      }`}
                    />
                  </div>
                ) : (
                  <div>
                    <label
                      className={`block text-xs font-bold mb-1.5 ${
                        isDark ? 'text-neutral-200' : 'text-neutral-800'
                      }`}
                    >
                      Patient Full Name <span className="text-orange-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="e.g. Ramesh Kumar"
                      required
                      className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                        isDark
                          ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                          : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                      }`}
                    />
                  </div>
                )}

                <div>
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-800'
                    }`}
                  >
                    Email Address (OTP will be sent here) <span className="text-orange-600">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                      <span>✉️</span>
                    </div>
                    <input
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="name@example.com"
                      required
                      className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                        isDark
                          ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                          : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                      }`}
                    />
                  </div>
                  <p
                    className={`text-[11px] mt-1 font-medium ${
                      isDark ? 'text-neutral-400' : 'text-neutral-600'
                    }`}
                  >
                    We will send a 6-digit one-time passcode to verify your email before setting your password.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2 ${
                    isDark
                      ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                      : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Sending Verification Code...
                    </span>
                  ) : (
                    <span>Send Verification Code to Email &rarr;</span>
                  )}
                </button>
              </form>
            )}

            {/* STEP 2: Verify 6-Digit OTP */}
            {signupStep === 'verify_otp' && (
              <form onSubmit={handleSignupVerifyOtp} className="space-y-4">
                <div
                  className={`p-3.5 rounded-xl border-2 text-xs flex items-start gap-3 ${
                    isDark
                      ? 'bg-[#181d26] border-orange-500/30 text-neutral-200'
                      : 'bg-orange-50 border-orange-300 text-neutral-950 shadow-adjudo-sm'
                  }`}
                >
                  <span className="text-xl flex-shrink-0 mt-0.5">📨</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase font-black tracking-wider text-orange-600 dark:text-orange-400">
                      Step 2: Enter Email Verification Code
                    </div>
                    <div className="font-bold text-xs mt-0.5 leading-snug">
                      We've sent a 6-digit passcode to{' '}
                      <strong className="font-mono font-bold text-orange-600 dark:text-orange-400 break-all">
                        {signupEmail}
                      </strong>
                    </div>
                    <p className="text-[11px] font-medium opacity-80 mt-1 leading-normal">
                      Enter the code below. Once verified, you will immediately create your password.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSignupStep('details')
                      setError(null)
                    }}
                    className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      isDark
                        ? 'border-neutral-700 hover:bg-neutral-800 text-neutral-200'
                        : 'border-neutral-900 bg-white hover:bg-cream-200 text-neutral-900 shadow-adjudo-sm'
                    }`}
                  >
                    Change
                  </button>
                </div>

                <div>
                  <label
                    className={`block text-xs font-bold text-center mb-2.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-900'
                    }`}
                  >
                    Enter 6-Digit Passcode
                  </label>
                  <div className="flex justify-center items-center gap-2 sm:gap-2.5">
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          digitInputRefs.current[idx] = el
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                        onPaste={idx === 0 ? handleOtpPaste : undefined}
                        className={`w-11 sm:w-12 h-13 sm:h-14 text-center font-mono font-black text-xl sm:text-2xl rounded-xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                          digit
                            ? isDark
                              ? 'border-orange-500 bg-[#1c222c] text-white ring-1 ring-orange-500/30'
                              : 'border-orange-600 bg-white text-neutral-950 shadow-adjudo-sm ring-1 ring-orange-500/20'
                            : isDark
                            ? 'border-neutral-700 bg-[#181b22] text-white hover:border-neutral-600'
                            : 'border-neutral-900 bg-white text-neutral-950 hover:border-black shadow-adjudo-sm'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs px-1">
                  <span
                    className={`text-[11px] font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}
                  >
                    Did not receive code?
                  </span>
                  {isTimerActive ? (
                    <span
                      className={`text-[11px] font-mono font-bold ${
                        isDark ? 'text-neutral-400' : 'text-neutral-600'
                      }`}
                    >
                      Resend in {resendTimer}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSignupSendOtp({ preventDefault: () => {} } as any)}
                      className="text-xs font-black cursor-pointer text-orange-600 hover:text-orange-700 dark:text-orange-400"
                    >
                      🔄 Resend New Passcode
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || otpDigits.join('').length !== 6}
                  className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                    isDark
                      ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                      : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                  }`}
                >
                  {loading ? 'Verifying Code...' : 'Verify Code & Create Password →'}
                </button>
              </form>
            )}

            {/* STEP 3: Create Account Password (Reached ONLY after OTP is verified!) */}
            {signupStep === 'create_password' && (
              <form onSubmit={handleSignupCreatePassword} className="space-y-3.5">
                {/* Email Verified Success Banner */}
                <div
                  className={`p-3 rounded-xl border-2 flex items-center gap-2.5 text-xs ${
                    isDark
                      ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-adjudo-sm'
                  }`}
                >
                  <span className="text-lg">✅</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-black uppercase text-[10px] tracking-wider text-emerald-600 dark:text-emerald-400">
                      Email Verified Successfully
                    </div>
                    <div className="font-bold truncate mt-0.5">
                      {isHospital ? hospitalName : patientName} &bull;{' '}
                      <span className="font-mono">{signupEmail}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-800'
                    }`}
                  >
                    Create Account Password <span className="text-orange-600">*</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 4 characters"
                    required
                    minLength={4}
                    className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                      isDark
                        ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                        : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                    }`}
                  />
                </div>

                <div>
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? 'text-neutral-200' : 'text-neutral-800'
                    }`}
                  >
                    Confirm Password <span className="text-orange-600">*</span>
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    minLength={4}
                    className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                      isDark
                        ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                        : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                    }`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-1 ${
                    isDark
                      ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                      : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Creating Account &amp; Logging In...
                    </span>
                  ) : (
                    <span>Set Password &amp; Complete Registration &rarr;</span>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Security & Isolation Trust Footer */}
        <div
          className={`mt-5 pt-3.5 border-t-2 flex items-center justify-between text-[11px] ${
            isDark ? 'border-neutral-800 text-neutral-400' : 'border-neutral-900 text-neutral-800'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <span className="text-emerald-600 font-bold">🔒</span>
            <span>256-Bit Encrypted Passcodes</span>
          </div>
          <div className="flex items-center gap-1.5 font-bold">
            <span>🛡️</span>
            <span>Per-Account Data Isolation</span>
          </div>
        </div>
      </div>
    </div>
  )
}
