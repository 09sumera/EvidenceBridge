import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, type PortalType } from '../context/AuthContext'
import { PasswordLoginForm } from './auth/PasswordLoginForm'
import { EmailLoginForm } from './auth/EmailLoginForm'
import { OTPVerificationForm } from './auth/OTPVerificationForm'
import { SignupForm } from './auth/SignupForm'
import { ForgotPasswordForm } from './auth/ForgotPasswordForm'
import { ResetPasswordForm } from './auth/ResetPasswordForm'
import { EbMark } from './Logo'
import type { AuthViewMode } from './auth/LoginPage'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'login' | 'signup' | 'forgot'
  initialPortal?: PortalType
  onSuccess?: () => void
}

export function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  initialPortal = 'patient',
  onSuccess,
}: AuthModalProps) {
  const {
    login,
    signup,
    otpRequest,
    otpVerify,
    updateUserPassword,
    demoLogin,
  } = useAuth()
  const navigate = useNavigate()

  const [portal, setPortal] = useState<PortalType>(initialPortal)
  const [mode, setMode] = useState<AuthViewMode>('login_password')
  const [email, setEmail] = useState<string>('')
  const [hospitalName, setHospitalName] = useState<string>('Shree Medical Institute')
  const [pendingSignupData, setPendingSignupData] = useState<{
    name: string
    email: string
    password: string
    portal: PortalType
    organization?: string
  } | null>(null)

  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(600)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState<number>(30)
  const [devOtp, setDevOtp] = useState<string | undefined>(undefined)

  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setPortal(initialPortal)
      setMode(
        initialMode === 'signup'
          ? 'signup'
          : initialMode === 'forgot'
          ? 'forgot_password'
          : 'login_password',
      )
      setEmail(
        initialPortal === 'hospital_management'
          ? 'admin@shreemedical.local'
          : 'ramesh.kumar@patient.local',
      )
      setError(null)
      setLoading(false)
      setDevOtp(undefined)
      setPendingSignupData(null)
    }
  }, [isOpen, initialPortal, initialMode])

  if (!isOpen) return null

  const clearStatus = () => {
    setError(null)
  }

  const isHospital = portal === 'hospital_management'

  const handlePortalSwitch = (newPortal: PortalType) => {
    setPortal(newPortal)
    clearStatus()
    if (newPortal === 'hospital_management') {
      setEmail('admin@shreemedical.local')
      setHospitalName('Shree Medical Institute')
    } else {
      setEmail('ramesh.kumar@patient.local')
    }
  }

  // 1. Password Login
  const handlePasswordLogin = async (
    submittedEmail: string,
    submittedPass: string,
    submittedPortal: PortalType,
  ) => {
    setLoading(true)
    setError(null)
    try {
      await login(submittedEmail, submittedPass, submittedPortal)
      if (onSuccess) {
        onSuccess()
      } else {
        onClose()
        navigate(submittedPortal === 'hospital_management' ? '/hospital/management' : '/audit')
      }
    } catch (err: any) {
      setError(err?.message || 'Incorrect email or password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // 2. Request OTP for Login
  const handleOtpLoginRequest = async (
    submittedEmail: string,
    submittedPortal: PortalType,
    orgName?: string,
  ) => {
    setLoading(true)
    setError(null)
    setEmail(submittedEmail)
    setPortal(submittedPortal)
    if (orgName) setHospitalName(orgName)

    try {
      const res = await otpRequest(
        submittedEmail,
        submittedPortal,
        submittedPortal === 'hospital_management' ? orgName || hospitalName : undefined,
        undefined,
        'login',
      )
      if (res.expiresInSeconds) setExpiresInSeconds(res.expiresInSeconds)
      if (res.resendCooldownSeconds) setResendCooldownSeconds(res.resendCooldownSeconds)
      if (res.devOtp) setDevOtp(res.devOtp)

      setMode('login_otp_verify')
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // 3. Verify OTP for Login
  const handleVerifyLoginOtp = async (code: string) => {
    setLoading(true)
    setError(null)

    try {
      const res = await otpVerify(
        email,
        code,
        portal,
        portal === 'hospital_management' ? hospitalName : undefined,
      )
      if (onSuccess) {
        onSuccess()
      } else {
        onClose()
        if (res.redirectPath) {
          navigate(res.redirectPath)
        } else if (res.user?.role === 'HOSPITAL_MANAGEMENT' || res.user?.portal === 'hospital_management') {
          navigate('/hospital/management')
        } else {
          navigate('/audit')
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Incorrect verification code. Please check and try again.')
    } finally {
      setLoading(false)
    }
  }

  // 4. Request Signup Registration & Dispatch OTP
  const handleSignupSubmit = async (data: {
    name: string
    email: string
    password: string
    portal: PortalType
    organization?: string
  }) => {
    setLoading(true)
    setError(null)
    setEmail(data.email)
    setPortal(data.portal)
    if (data.organization) setHospitalName(data.organization)
    setPendingSignupData(data)

    try {
      const res = await otpRequest(
        data.email,
        data.portal,
        data.organization,
        data.name,
        'registration',
      )
      if (res.expiresInSeconds) setExpiresInSeconds(res.expiresInSeconds)
      if (res.resendCooldownSeconds) setResendCooldownSeconds(res.resendCooldownSeconds)
      if (res.devOtp) setDevOtp(res.devOtp)

      setMode('signup_otp_verify')
    } catch (err: any) {
      setError(err?.message || 'Failed to dispatch registration verification code.')
    } finally {
      setLoading(false)
    }
  }

  // 5. Verify Registration OTP & Complete Account Creation
  const handleVerifySignupOtp = async (code: string) => {
    if (!pendingSignupData) {
      setError('Registration session expired. Please enter your details again.')
      setMode('signup')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await otpVerify(
        email,
        code,
        portal,
        pendingSignupData.organization,
        pendingSignupData.name,
      )

      await signup(
        pendingSignupData.name,
        pendingSignupData.email,
        pendingSignupData.password,
        pendingSignupData.portal,
        pendingSignupData.organization,
      )

      if (onSuccess) {
        onSuccess()
      } else {
        onClose()
        navigate(pendingSignupData.portal === 'hospital_management' ? '/hospital/management' : '/audit')
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Please verify the code and try again.')
    } finally {
      setLoading(false)
    }
  }

  // 6. Request Forgot Password Code
  const handleForgotSubmit = async (submittedEmail: string, submittedPortal: PortalType) => {
    setLoading(true)
    setError(null)
    setEmail(submittedEmail)
    setPortal(submittedPortal)

    try {
      const res = await otpRequest(
        submittedEmail,
        submittedPortal,
        undefined,
        undefined,
        'reset_password',
      )
      if (res.expiresInSeconds) setExpiresInSeconds(res.expiresInSeconds)
      if (res.resendCooldownSeconds) setResendCooldownSeconds(res.resendCooldownSeconds)
      if (res.devOtp) setDevOtp(res.devOtp)

      setMode('forgot_otp_verify')
    } catch (err: any) {
      setError(err?.message || 'Unable to send recovery passcode. Please verify your email.')
    } finally {
      setLoading(false)
    }
  }

  // 7. Verify Forgot Password Code
  const handleVerifyForgotOtp = async (code: string) => {
    setLoading(true)
    setError(null)

    try {
      await otpVerify(email, code, portal)
      setMode('reset_password_new')
    } catch (err: any) {
      setError(err?.message || 'Incorrect recovery code. Please check and try again.')
    } finally {
      setLoading(false)
    }
  }

  // 8. Submit New Reset Password
  const handleResetPasswordSubmit = async (newPassword: string) => {
    setLoading(true)
    setError(null)

    try {
      await updateUserPassword(email, newPassword)
    } catch (err: any) {
      setError(err?.message || 'Failed to update password. Please try again.')
      throw err
    } finally {
      setLoading(false)
    }
  }

  // Resend Handler
  const handleResendCurrentOtp = async () => {
    setError(null)
    const purpose =
      mode === 'signup_otp_verify'
        ? 'registration'
        : mode === 'forgot_otp_verify'
        ? 'reset_password'
        : 'login'

    try {
      const res = await otpRequest(
        email,
        portal,
        portal === 'hospital_management' ? hospitalName : undefined,
        pendingSignupData?.name,
        purpose,
      )
      if (res.expiresInSeconds) setExpiresInSeconds(res.expiresInSeconds)
      if (res.resendCooldownSeconds) setResendCooldownSeconds(res.resendCooldownSeconds)
      if (res.devOtp) setDevOtp(res.devOtp)
    } catch (err: any) {
      setError(err?.message || 'Unable to resend verification code right now.')
      throw err
    }
  }

  // Demo Login
  const handleDemoLogin = async (demoPortal: PortalType) => {
    setLoading(true)
    setError(null)
    try {
      await demoLogin(demoPortal)
      if (onSuccess) {
        onSuccess()
      } else {
        onClose()
        if (demoPortal === 'hospital_management') {
          navigate('/hospital/management')
        } else {
          navigate('/audit')
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Demo login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex justify-center items-start sm:items-center p-2 sm:p-4 py-3 sm:py-6 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="my-auto relative rounded-3xl max-w-[460px] w-full p-4 sm:p-5 border-2 border-neutral-900 bg-white text-neutral-900 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] transition-all overflow-hidden max-h-[94vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 transition-colors duration-200 ${
            isHospital ? 'bg-orange-500' : 'bg-neutral-900'
          }`}
        />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Close dialog"
          className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full border-2 border-neutral-900 bg-white shadow-[1px_1px_0px_0px_#111111] text-neutral-900 hover:bg-neutral-100 flex items-center justify-center transition-all cursor-pointer select-none z-10"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Brand Header */}
        <div className="text-center mb-2.5 pt-0.5 flex-shrink-0">
          <div className="flex justify-center mb-1.5">
            <div className="p-1.5 rounded-xl border-2 border-neutral-900 bg-[#FAF8F5] shadow-[1px_1px_0px_0px_#111111]">
              <EbMark size={28} />
            </div>
          </div>
          <h2 id="auth-modal-title" className="text-xl font-black tracking-tight text-neutral-900">
            EvidenceBridge Portal
          </h2>
          <p className="text-[11px] mt-0.5 font-bold text-neutral-600">
            Clinical Evidence &amp; Medical Price Auditing Network
          </p>
        </div>

        {/* Scrollable Modal Body Container */}
        <div className="overflow-y-auto flex-1 pr-0.5" style={{ scrollbarWidth: 'thin' }}>
          {/* Dual Portal Switcher Tabs (Patient vs Hospital Management) */}
          <div className="mb-2.5">
            <div className="grid grid-cols-2 p-1 rounded-xl border-2 border-neutral-900 bg-[#FAF8F5]">
              {/* Patient Portal Option */}
              <button
                type="button"
                onClick={() => handlePortalSwitch('patient')}
                className={`py-1.5 px-2 rounded-lg transition-all duration-150 flex flex-col items-center justify-center text-center cursor-pointer ${
                  portal === 'patient'
                    ? 'bg-white text-neutral-950 font-black shadow-[1px_1px_0px_0px_#111111] border-2 border-neutral-900'
                    : 'text-neutral-700 hover:text-neutral-950 font-bold border-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-black">
                  <span className="text-sm">👤</span>
                  <span>Patient Portal</span>
                </div>
                <span
                  className={`text-[9px] sm:text-[10px] font-medium ${
                    portal === 'patient' ? 'text-neutral-700 font-bold' : 'text-neutral-500'
                  }`}
                >
                  Personal Bills &amp; Rx Audit
                </span>
              </button>

              {/* Hospital Management Option */}
              <button
                type="button"
                onClick={() => handlePortalSwitch('hospital_management')}
                className={`py-1.5 px-2 rounded-lg transition-all duration-150 flex flex-col items-center justify-center text-center cursor-pointer ${
                  portal === 'hospital_management'
                    ? 'bg-white text-neutral-950 font-black shadow-[1px_1px_0px_0px_#111111] border-2 border-neutral-900 ring-2 ring-orange-500/30'
                    : 'text-neutral-700 hover:text-neutral-950 font-bold border-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-black">
                  <span className="text-sm">🏥</span>
                  <span>Hospital Mgmt</span>
                </div>
                <span
                  className={`text-[9px] sm:text-[10px] font-medium ${
                    portal === 'hospital_management' ? 'text-orange-600 font-bold' : 'text-neutral-500'
                  }`}
                >
                  Provider Tariff &amp; Billing Desk
                </span>
              </button>
            </div>
          </div>

          {/* Fast 1-Click Prototype Demo Card (Shown on Login to keep Sign Up compact) */}
          {mode.startsWith('login') && (
            <div className="mb-2.5 p-2.5 rounded-xl border-2 border-neutral-900 bg-[#FAF8F5] shadow-[1px_1px_0px_0px_#111111]">
              <div className="flex items-center justify-between mb-1.5 text-xs">
                <span className="font-black text-neutral-900 flex items-center gap-1 text-[11px]">
                  <span className="text-orange-500">⚡</span>
                  <span>Fast 1-Click Prototype Demo</span>
                </span>
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full border-2 border-neutral-900 bg-white text-neutral-900 shadow-[1px_1px_0px_0px_#111111]">
                  {isHospital ? '🏥 Hospital Entity' : '👤 Patient User'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDemoLogin(portal)}
                disabled={loading}
                className="w-full py-2 px-3 rounded-lg text-xs font-black bg-neutral-900 hover:bg-neutral-800 text-white border-2 border-neutral-900 shadow-[1px_1px_0px_0px_#111111] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>
                  {isHospital
                    ? 'Login as Hospital: Shree Medical Institute (1-Click) →'
                    : 'Login as Patient: Ramesh Kumar (1-Click) →'}
                </span>
              </button>
              <p className="text-[9px] text-center font-bold text-neutral-600 mt-1">
                {isHospital
                  ? 'Hospital account: Shree Medical Institute • Provider tariff & billing desk'
                  : 'Patient account: Ramesh Kumar • Pre-loaded with personal medical bills & prescriptions'}
              </p>
            </div>
          )}

          {/* Two-Tab Navigator (Login vs Sign Up) */}
          {(mode === 'login_password' || mode === 'login_otp' || mode === 'signup') && (
            <div className="grid grid-cols-2 p-1 rounded-xl border-2 border-neutral-900 bg-[#FAF8F5] mb-2.5">
              <button
                type="button"
                onClick={() => {
                  setMode('login_password')
                  clearStatus()
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode.startsWith('login')
                    ? 'bg-neutral-900 text-white shadow-[1px_1px_0px_0px_#111111]'
                    : 'text-neutral-700 hover:text-neutral-950 font-bold'
                }`}
              >
                <span>🔒</span>
                <span>Login</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup')
                  clearStatus()
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-neutral-900 text-white shadow-[1px_1px_0px_0px_#111111]'
                    : 'text-neutral-700 hover:text-neutral-950 font-bold'
                }`}
              >
                <span>📝</span>
                <span>Sign Up</span>
              </button>
            </div>
          )}

          {/* Mode 1: Password Login */}
          {mode === 'login_password' && (
            <PasswordLoginForm
              portal={portal}
              onPortalChange={handlePortalSwitch}
              onSubmitLogin={handlePasswordLogin}
              onSwitchToOtp={() => {
                setMode('login_otp')
                clearStatus()
              }}
              onSwitchToSignup={() => {
                setMode('signup')
                clearStatus()
              }}
              onForgotPassword={() => {
                setMode('forgot_password')
                clearStatus()
              }}
              onDemoLogin={handleDemoLogin}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              hidePortalSelector={true}
              hideDemo={true}
            />
          )}

          {/* Mode 2: Email OTP Login */}
          {mode === 'login_otp' && (
            <EmailLoginForm
              portal={portal}
              onPortalChange={handlePortalSwitch}
              onSubmitEmail={handleOtpLoginRequest}
              onSwitchToPassword={() => {
                setMode('login_password')
                clearStatus()
              }}
              onSwitchToSignup={() => {
                setMode('signup')
                clearStatus()
              }}
              onDemoLogin={handleDemoLogin}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              hidePortalSelector={true}
            />
          )}

          {/* Mode 3: Login OTP Verification */}
          {mode === 'login_otp_verify' && (
            <OTPVerificationForm
              email={email}
              portal={portal}
              hospitalName={hospitalName}
              expiresInSeconds={expiresInSeconds}
              resendCooldownSeconds={resendCooldownSeconds}
              onVerify={handleVerifyLoginOtp}
              onResend={handleResendCurrentOtp}
              onChangeEmail={() => {
                setMode('login_otp')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              devOtp={devOtp}
              title="Verify Passcode"
              submitLabel="Verify & Login"
            />
          )}

          {/* Mode 4: Signup Registration */}
          {mode === 'signup' && (
            <SignupForm
              portal={portal}
              onPortalChange={handlePortalSwitch}
              onSubmitSignup={handleSignupSubmit}
              onSwitchToLogin={() => {
                setMode('login_password')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              hidePortalSelector={true}
            />
          )}

          {/* Mode 5: Signup OTP Verification */}
          {mode === 'signup_otp_verify' && (
            <OTPVerificationForm
              email={email}
              portal={portal}
              hospitalName={hospitalName}
              expiresInSeconds={expiresInSeconds}
              resendCooldownSeconds={resendCooldownSeconds}
              onVerify={handleVerifySignupOtp}
              onResend={handleResendCurrentOtp}
              onChangeEmail={() => {
                setMode('signup')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              devOtp={devOtp}
              title="Verify Account Email"
              submitLabel="Verify & Complete Account"
              contextTag="Registration"
            />
          )}

          {/* Mode 6: Forgot Password Email */}
          {mode === 'forgot_password' && (
            <ForgotPasswordForm
              portal={portal}
              onPortalChange={handlePortalSwitch}
              onSubmitForgot={handleForgotSubmit}
              onBackToLogin={() => {
                setMode('login_password')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              hidePortalSelector={true}
            />
          )}

          {/* Mode 7: Forgot Password OTP Verification */}
          {mode === 'forgot_otp_verify' && (
            <OTPVerificationForm
              email={email}
              portal={portal}
              hospitalName={hospitalName}
              expiresInSeconds={expiresInSeconds}
              resendCooldownSeconds={resendCooldownSeconds}
              onVerify={handleVerifyForgotOtp}
              onResend={handleResendCurrentOtp}
              onChangeEmail={() => {
                setMode('forgot_password')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
              devOtp={devOtp}
              title="Verify Recovery Passcode"
              submitLabel="Verify & Reset Password"
              contextTag="Recovery"
            />
          )}

          {/* Mode 8: Reset Password New */}
          {mode === 'reset_password_new' && (
            <ResetPasswordForm
              email={email}
              onSubmitReset={handleResetPasswordSubmit}
              onBackToLogin={() => {
                setMode('login_password')
                clearStatus()
              }}
              loading={loading}
              error={error}
              onClearError={clearStatus}
            />
          )}
        </div>

        {/* Security & Isolation Trust Footer (From Image 5) */}
        <div className="mt-2.5 pt-2 border-t-2 border-neutral-900 flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-800 flex-shrink-0">
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

export default AuthModal
