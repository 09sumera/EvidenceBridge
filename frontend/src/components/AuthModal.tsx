import React, { useState, useEffect, useRef } from 'react'
import { useAuth, type PortalType } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { EbMark } from './Logo'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'login' | 'signup'
  initialPortal?: PortalType
  onSuccess?: () => void
}

type AuthMethod = 'otp' | 'password' | 'signup'

export function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  initialPortal = 'patient',
  onSuccess,
}: AuthModalProps) {
  const { login, signup, demoLogin, otpRequest, otpVerify } = useAuth()
  const { isDark } = useTheme()

  // Primary state
  const [portal, setPortal] = useState<PortalType>(initialPortal)
  const [authMethod, setAuthMethod] = useState<AuthMethod>(initialMode === 'signup' ? 'signup' : 'otp')
  
  // OTP flow state
  const [otpStep, setOtpStep] = useState<'input' | 'verify'>('input')
  const [otpIdentifier, setOtpIdentifier] = useState('')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [resendTimer, setResendTimer] = useState<number>(30)
  const [isTimerActive, setIsTimerActive] = useState(false)
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([])

  // User details state
  const [patientName, setPatientName] = useState('Ramesh Kumar')
  const [hospitalName, setHospitalName] = useState('Shree Medical Institute')
  const [passwordEmail, setPasswordEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [signupOrg, setSignupOrg] = useState('')

  // UI state
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Initialize and reset on open
  useEffect(() => {
    if (isOpen) {
      setPortal(initialPortal)
      setAuthMethod(initialMode === 'signup' ? 'signup' : 'otp')
      setOtpStep('input')
      setError(null)
      setOtpDigits(['', '', '', '', '', ''])

      if (initialPortal === 'hospital_management') {
        setOtpIdentifier('admin@shreemedical.local')
        setHospitalName('Shree Medical Institute')
        setPasswordEmail('admin@shreemedical.local')
      } else {
        setOtpIdentifier('ramesh.kumar@patient.local')
        setPatientName('Ramesh Kumar')
        setPasswordEmail('ramesh.kumar@patient.local')
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
    setOtpDigits(['', '', '', '', '', ''])

    if (newPortal === 'hospital_management') {
      setOtpIdentifier('admin@shreemedical.local')
      setHospitalName('Shree Medical Institute')
      setPasswordEmail('admin@shreemedical.local')
    } else {
      setOtpIdentifier('ramesh.kumar@patient.local')
      setPatientName('Ramesh Kumar')
      setPasswordEmail('ramesh.kumar@patient.local')
    }
  }

  // Request 6-digit OTP
  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)

    if (!otpIdentifier.trim()) {
      setError(
        isHospital
          ? 'Please enter your official hospital billing desk email address.'
          : 'Please enter your email address to receive the verification passcode.'
      )
      return
    }

    if (isHospital && !hospitalName.trim()) {
      setError('Please specify the Hospital / Healthcare Institution Name.')
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

      // Auto-focus the first digit box
      setTimeout(() => {
        digitInputRefs.current[0]?.focus()
      }, 100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not dispatch verification passcode.')
    } finally {
      setLoading(false)
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

  // Verify OTP submission
  const handleVerifyOtp = async (e?: React.FormEvent) => {
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
        otpIdentifier,
        fullCode,
        portal,
        isHospital ? hospitalName.trim() : undefined,
        !isHospital ? patientName.trim() : undefined
      )
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.')
    } finally {
      setLoading(false)
    }
  }

  // Legacy password login submission
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!passwordEmail.trim()) {
      setError('Please enter your registered email address.')
      return
    }
    if (!password.trim()) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    try {
      await login(passwordEmail, password, portal)
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid login credentials.')
    } finally {
      setLoading(false)
    }
  }

  // Account creation / registration submission
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const displayName = isHospital ? hospitalName.trim() : patientName.trim()
    if (!displayName) {
      setError(isHospital ? 'Please enter the hospital name.' : 'Please enter your full name.')
      return
    }
    if (!passwordEmail.trim() || !passwordEmail.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters long.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await signup(
        displayName,
        passwordEmail,
        password,
        portal,
        isHospital ? hospitalName.trim() : signupOrg.trim()
      )
      onClose()
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
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
        {/* Top Aesthetic Accent Bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 transition-colors duration-300 ${
            isHospital ? 'bg-orange-500' : 'bg-neutral-900 dark:bg-orange-500'
          }`}
        />

        {/* Close Button */}
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

        {/* Header & Branding */}
        <div className="text-center mb-5 pt-1">
          <div className="flex justify-center mb-2.5">
            <div className={`p-2.5 rounded-2xl border shadow-sm ${
              isDark ? 'bg-neutral-800 border-neutral-700' : 'bg-cream-100 border-neutral-900 shadow-adjudo-sm'
            }`}>
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
              <span className={`text-[10px] font-medium ${portal === 'patient' ? (isDark ? 'text-neutral-300' : 'text-neutral-700') : 'opacity-70'}`}>
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
              <span className={`text-[10px] font-medium ${portal === 'hospital_management' ? (isDark ? 'text-orange-400' : 'text-orange-600 font-bold') : 'opacity-70'}`}>
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
            <span className={`font-black flex items-center gap-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
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
          <div className={`text-[11px] font-medium mt-1.5 text-center ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
            {isHospital
              ? 'Institutional account: Shree Medical Institute • Pre-loaded with Karnataka provider audits'
              : 'Patient account: Ramesh Kumar • Pre-loaded with personal medical bills & prescriptions'}
          </div>
        </div>

        {/* Auth Method Navigation Tabs */}
        <div
          className={`grid grid-cols-3 p-1 rounded-xl mb-4 border-2 ${
            isDark ? 'bg-[#181b22] border-neutral-700' : 'bg-cream-100 border-neutral-900'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setAuthMethod('otp')
              setOtpStep('input')
              setError(null)
            }}
            className={`py-1.5 px-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              authMethod === 'otp'
                ? isDark
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-neutral-900 text-white shadow-adjudo-sm'
                : isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-700 hover:text-neutral-950'
            }`}
          >
            <span>📱 OTP Login</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('password')
              setError(null)
            }}
            className={`py-1.5 px-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              authMethod === 'password'
                ? isDark
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-neutral-900 text-white shadow-adjudo-sm'
                : isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-700 hover:text-neutral-950'
            }`}
          >
            <span>🔑 Password</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('signup')
              setError(null)
            }}
            className={`py-1.5 px-2 rounded-lg text-xs font-black transition-all cursor-pointer ${
              authMethod === 'signup'
                ? isDark
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-neutral-900 text-white shadow-adjudo-sm'
                : isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-700 hover:text-neutral-950'
            }`}
          >
            <span>📝 Register</span>
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
        {/* VIEW 1: OTP AUTHENTICATION SYSTEM (Default, Modern, ABDM Standard)      */}
        {/* ========================================================================= */}
        {authMethod === 'otp' && (
          <div>
            {otpStep === 'input' ? (
              /* STEP 1: Enter Mobile / Hospital Information & Request OTP */
              <form onSubmit={handleRequestOtp} className="space-y-3.5">
                {isHospital ? (
                  /* Hospital Management Information Form */
                  <>
                    <div>
                      <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                        🏥 Hospital / Institution Name <span className="text-orange-600">*</span>
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
                      <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                        This hospital name will be displayed as the institutional account identity across all billing queues.
                      </p>
                    </div>

                    <div>
                      <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                        Official Billing Desk Email ID <span className="text-orange-600">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                          <span>📧</span>
                        </div>
                        <input
                          type="email"
                          value={otpIdentifier}
                          onChange={(e) => setOtpIdentifier(e.target.value)}
                          placeholder="e.g. billing@shreemedical.org or admin@shreemedical.local"
                          required
                          className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                            isDark
                              ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                              : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                          }`}
                        />
                      </div>
                      <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                        The 6-digit one-time passcode will be delivered to this email inbox.
                      </p>
                    </div>
                  </>
                ) : (
                  /* Patient Email Passcode Form */
                  <>
                    <div>
                      <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                        Patient Full Name
                      </label>
                      <input
                        type="text"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        placeholder="e.g. Ramesh Kumar"
                        className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                          isDark
                            ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                            : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                        }`}
                      />
                    </div>

                    <div>
                      <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                        Email Address (You will receive your OTP here) <span className="text-orange-600">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                          <span>✉️</span>
                        </div>
                        <input
                          type="email"
                          value={otpIdentifier}
                          onChange={(e) => setOtpIdentifier(e.target.value)}
                          placeholder="e.g. yourname@gmail.com or ramesh.kumar@patient.local"
                          required
                          className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                            isDark
                              ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                              : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 shadow-adjudo-sm font-bold'
                          }`}
                        />
                      </div>
                      <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                        The 6-digit security code will be sent directly to your email address.
                      </p>
                    </div>
                  </>
                )}

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
                      Dispatching Passcode to Email...
                    </span>
                  ) : (
                    <span>Send Verification Passcode to Email &rarr;</span>
                  )}
                </button>
              </form>
            ) : (
              /* STEP 2: Verify 6-Digit OTP Code */
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {/* Destination info pill with edit option */}
                <div
                  className={`p-3 rounded-xl border-2 flex items-center justify-between text-xs ${
                    isDark ? 'bg-[#181b22] border-neutral-700' : 'bg-cream-50 border-neutral-900 shadow-adjudo-sm'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className={`text-[10px] uppercase font-black tracking-wider ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                      Passcode Issued To:
                    </div>
                    <div className="font-bold truncate mt-0.5">
                      {isHospital ? hospitalName : patientName} &bull;{' '}
                      <span className="font-mono text-orange-600 dark:text-orange-400">{otpIdentifier}</span>
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

                {/* Security Passcode Dispatched Notice */}
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
                      Security Passcode Sent to Email
                    </div>
                    <div className="font-bold text-xs mt-0.5 leading-snug">
                      We've dispatched your 6-digit verification code to{' '}
                      <strong className="font-mono font-bold text-orange-600 dark:text-orange-400 break-all">
                        {otpIdentifier}
                      </strong>
                    </div>
                    <p className="text-[11px] font-medium opacity-80 mt-1 leading-normal">
                      Please check your email inbox (and Spam/Junk folder if not visible within a minute), then enter the 6 digits below.
                    </p>
                  </div>
                </div>

                {/* 6 Individual Digit Inputs */}
                <div>
                  <label className={`block text-xs font-bold text-center mb-2.5 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                    Enter 6-Digit One-Time Passcode
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

                {/* Resend Passcode / Countdown */}
                <div className="flex items-center justify-between text-xs px-1">
                  <span className={`text-[11px] font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                    Did not receive code?
                  </span>
                  {isTimerActive ? (
                    <span className={`text-[11px] font-mono font-bold ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                      Resend in {resendTimer}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRequestOtp()}
                      className="text-xs font-black cursor-pointer text-orange-600 hover:text-orange-700 dark:text-orange-400"
                    >
                      🔄 Resend New Passcode
                    </button>
                  )}
                </div>

                {/* Verification CTA */}
                <button
                  type="submit"
                  disabled={loading || otpDigits.join('').length !== 6}
                  className={`w-full py-3 px-4 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                    isDark
                      ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/20'
                      : 'bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px]'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Authenticating Session...
                    </span>
                  ) : (
                    <span>Verify Code &amp; Access {isHospital ? 'Hospital Management Desk' : 'Patient Vault'} &rarr;</span>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: PASSWORD SIGN IN                                                 */}
        {/* ========================================================================= */}
        {authMethod === 'password' && (
          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <div>
              <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                {isHospital ? 'Hospital Billing Desk Email' : 'Patient Account Email'} <span className="text-orange-600">*</span>
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
              <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
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
              {loading ? 'Authenticating...' : `Sign In to ${isHospital ? 'Hospital Desk' : 'Patient Vault'} →`}
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* VIEW 3: NEW ACCOUNT REGISTRATION                                         */}
        {/* ========================================================================= */}
        {authMethod === 'signup' && (
          <form onSubmit={handleSignupSubmit} className="space-y-3">
            {isHospital ? (
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                  🏥 Hospital / Institution Name <span className="text-orange-600">*</span>
                </label>
                <input
                  type="text"
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  placeholder="e.g. Shree Medical Institute"
                  required
                  className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                    isDark
                      ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                      : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                  }`}
                />
              </div>
            ) : (
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
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
                      : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                  }`}
                />
              </div>
            )}

            <div>
              <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                Email Address <span className="text-orange-600">*</span>
              </label>
              <input
                type="email"
                value={passwordEmail}
                onChange={(e) => setPasswordEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                  isDark
                    ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                    : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                  Password <span className="text-orange-600">*</span>
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
              <div>
                <label className={`block text-xs font-bold mb-1 ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                  Confirm Password <span className="text-orange-600">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className={`w-full px-3.5 py-2.5 rounded-xl border-2 text-sm transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 shadow-xs ${
                    isDark
                      ? 'bg-[#181b22] border-neutral-700 text-white placeholder-neutral-500 focus:bg-[#1a1f29]'
                      : 'bg-white border-neutral-900 text-neutral-950 placeholder-neutral-400 font-bold shadow-adjudo-sm'
                  }`}
                />
              </div>
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
              {loading ? 'Creating Account...' : `Register ${isHospital ? 'Hospital Desk' : 'Patient Vault'} →`}
            </button>
          </form>
        )}

        {/* Security & Isolation Trust Footer */}
        <div className={`mt-5 pt-3.5 border-t-2 flex items-center justify-between text-[11px] ${
          isDark ? 'border-neutral-800 text-neutral-400' : 'border-neutral-900 text-neutral-800'
        }`}>
          <div className="flex items-center gap-1.5 font-bold">
            <span className="text-emerald-600 font-bold">🔒</span>
            <span>256-Bit Encrypted Passcodes</span>
          </div>
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
