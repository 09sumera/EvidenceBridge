import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth, type PortalType } from '../../context/AuthContext'
import Logo from '../Logo'
import { PasswordLoginForm } from './PasswordLoginForm'
import { EmailLoginForm } from './EmailLoginForm'
import { OTPVerificationForm } from './OTPVerificationForm'
import { SignupForm } from './SignupForm'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { ResetPasswordForm } from './ResetPasswordForm'

export type AuthViewMode =
  | 'login_password'
  | 'login_otp'
  | 'login_otp_verify'
  | 'signup'
  | 'signup_otp_verify'
  | 'forgot_password'
  | 'forgot_otp_verify'
  | 'reset_password_new'

interface LoginPageProps {
  embedded?: boolean
  initialPortal?: PortalType
  initialMode?: 'login' | 'signup' | 'forgot'
  onSuccess?: () => void
}

export const LoginPage: React.FC<LoginPageProps> = ({
  embedded = false,
  initialPortal,
  initialMode,
  onSuccess,
}) => {
  const {
    isAuthenticated,
    isHospitalManagement,
    login,
    signup,
    otpRequest,
    otpVerify,
    updateUserPassword,
    demoLogin,
  } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Determine initial portal
  const portalParam = searchParams.get('portal') as PortalType | null
  const [portal, setPortal] = useState<PortalType>(() => {
    if (initialPortal) return initialPortal
    if (portalParam === 'hospital_management' || portalParam === 'patient') {
      return portalParam
    }
    return 'patient'
  })

  // Determine initial mode
  const modeParam = searchParams.get('mode')
  const [mode, setMode] = useState<AuthViewMode>(() => {
    if (initialMode === 'signup' || modeParam === 'signup') return 'signup'
    if (initialMode === 'forgot' || modeParam === 'forgot') return 'forgot_password'
    if (modeParam === 'otp') return 'login_otp'
    return 'login_password'
  })

  // Shared form states
  const [email, setEmail] = useState<string>('')
  const [hospitalName, setHospitalName] = useState<string>('Shree Medical Institute')
  const [pendingSignupData, setPendingSignupData] = useState<{
    name: string
    email: string
    password: string
    portal: PortalType
    organization?: string
  } | null>(null)

  // OTP metadata
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(600)
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState<number>(30)
  const [devOtp, setDevOtp] = useState<string | undefined>(undefined)

  // Status states
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !embedded) {
      if (isHospitalManagement) {
        navigate('/hospital/management', { replace: true })
      } else {
        navigate('/audit', { replace: true })
      }
    }
  }, [isAuthenticated, isHospitalManagement, embedded, navigate])

  const clearStatus = () => {
    setError(null)
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
      } else if (!embedded) {
        if (submittedPortal === 'hospital_management') {
          navigate('/hospital/management', { replace: true })
        } else {
          navigate('/audit', { replace: true })
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Incorrect email or password. Please verify and try again.')
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
      setError(err?.message || 'Failed to dispatch verification code. Please try again.')
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
      } else if (!embedded) {
        if (res.redirectPath) {
          navigate(res.redirectPath, { replace: true })
        } else if (res.user.role === 'HOSPITAL_MANAGEMENT' || res.user.portal === 'hospital_management') {
          navigate('/hospital/management', { replace: true })
        } else {
          navigate('/audit', { replace: true })
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Incorrect verification code. Please check and try again.')
    } finally {
      setLoading(false)
    }
  }

  // 4. Request Registration & Dispatch OTP
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
      // Dispatch verification code via backend SMTP
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
      setError(err?.message || 'Failed to send registration verification code.')
    } finally {
      setLoading(false)
    }
  }

  // 5. Verify Registration OTP and Complete Account Creation
  const handleVerifySignupOtp = async (code: string) => {
    if (!pendingSignupData) {
      setError('Registration session expired. Please enter your details again.')
      setMode('signup')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 1. Verify OTP with server
      await otpVerify(
        email,
        code,
        portal,
        pendingSignupData.organization,
        pendingSignupData.name,
      )

      // 2. Complete signup registration
      await signup(
        pendingSignupData.name,
        pendingSignupData.email,
        pendingSignupData.password,
        pendingSignupData.portal,
        pendingSignupData.organization,
      )

      if (onSuccess) {
        onSuccess()
      } else if (!embedded) {
        if (pendingSignupData.portal === 'hospital_management') {
          navigate('/hospital/management', { replace: true })
        } else {
          navigate('/audit', { replace: true })
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Please check the code and try again.')
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
      // Passcode verified! Proceed to Set New Password screen
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
      // Password updated successfully!
    } catch (err: any) {
      setError(err?.message || 'Failed to update password. Please try again.')
      throw err
    } finally {
      setLoading(false)
    }
  }

  // Resend Handler for active mode
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

  // Fast Demo Login
  const handleDemoLogin = async (demoPortal: PortalType) => {
    setLoading(true)
    setError(null)
    try {
      await demoLogin(demoPortal)
      if (onSuccess) {
        onSuccess()
      } else if (!embedded) {
        if (demoPortal === 'hospital_management') {
          navigate('/hospital/management', { replace: true })
        } else {
          navigate('/audit', { replace: true })
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Demo login failed.')
    } finally {
      setLoading(false)
    }
  }

  // Dynamic header titles based on mode
  const getHeaderInfo = () => {
    switch (mode) {
      case 'login_password':
        return {
          title: 'Welcome Back',
          subtitle: 'Login securely to your EvidenceBridge account.',
          badgeIcon: '🔑',
        }
      case 'login_otp':
        return {
          title: 'Login with OTP',
          subtitle: 'Receive a secure 6-digit one-time passcode on your registered email.',
          badgeIcon: '✉️',
        }
      case 'login_otp_verify':
        return {
          title: 'Verify Your Identity',
          subtitle: 'Enter the verification passcode dispatched to your email.',
          badgeIcon: '🛡️',
        }
      case 'signup':
        return {
          title: 'Create Your Account',
          subtitle: 'Join the EvidenceBridge clinical evidence & tariff auditing network.',
          badgeIcon: '✨',
        }
      case 'signup_otp_verify':
        return {
          title: 'Verify Your Email',
          subtitle: 'Enter the 6-digit code sent to complete account activation.',
          badgeIcon: '✉️',
        }
      case 'forgot_password':
        return {
          title: 'Forgot Your Password?',
          subtitle: "Don't worry. We'll help you securely recover access to your EvidenceBridge account.",
          badgeIcon: '🔐',
        }
      case 'forgot_otp_verify':
        return {
          title: 'Verify Recovery Passcode',
          subtitle: 'Enter the 6-digit recovery passcode dispatched to your email.',
          badgeIcon: '🛡️',
        }
      case 'reset_password_new':
        return {
          title: 'Create a New Password',
          subtitle: 'Choose a strong password to protect your EvidenceBridge account.',
          badgeIcon: '🔒',
        }
    }
  }

  const headerInfo = getHeaderInfo()
  const containerClasses = embedded
    ? 'w-full'
    : 'min-h-screen bg-[#F5F9F6] text-[#172B25] flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8'

  return (
    <div className={containerClasses}>
      <div className="max-w-6xl w-full mx-auto">
        {/* Navigation link back to home */}
        {!embedded && (
          <div className="mb-6 flex items-center justify-between">
            <Link
              to="/welcome"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#718078] hover:text-[#087F5B] transition-colors"
            >
              <span>&larr;</span>
              <span>Back to EvidenceBridge Overview</span>
            </Link>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[#E8F5EE] text-[#075B45] border border-[#087F5B]/20">
              HIPAA Compliant &bull; 256-Bit SSL
            </span>
          </div>
        )}

        {/* Main Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* ================= LEFT SIDE: BRANDING & CLINICAL EVIDENCE ================= */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6 pr-0 lg:pr-6">
            <div>
              <div className="inline-flex items-center gap-2.5 mb-4">
                <Logo size="md" showText={false} />
                <div>
                  <span className="text-lg font-black tracking-tight text-[#172B25]">
                    Evidence<span className="text-[#087F5B]">Bridge</span>
                  </span>
                  <span className="block text-[10px] uppercase font-bold tracking-widest text-[#718078]">
                    Clinical Evidence &amp; Medical Price Auditing
                  </span>
                </div>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#172B25] tracking-tight leading-[1.15]">
                Healthcare Evidence.{' '}
                <span className="text-[#087F5B]">Verified with Intelligence.</span>
              </h1>

              <p className="mt-4 text-base sm:text-lg text-[#718078] leading-relaxed max-w-xl">
                EvidenceBridge audits medical prescriptions, hospital bills, and claim records against
                national clinical guidelines and regulated CGHS tariffs to eliminate price gouging and
                clinical discrepancies.
              </p>
            </div>

            {/* Visual Representation of Document Auditing */}
            <div className="rounded-2xl border border-[#E2EAE5] bg-white p-5 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between border-b border-[#E2EAE5] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#087F5B] flex items-center justify-center font-bold text-sm">
                    Rx
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-[#172B25] uppercase tracking-wider">
                      Prescription &amp; Billing Audit Stream
                    </h3>
                    <p className="text-[11px] text-[#718078]">
                      Shree Medical Institute &bull; Patient: Ramesh Kumar
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5EE] text-[#075B45] border border-[#087F5B]/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#087F5B] animate-pulse" />
                  Audit Passed (₹144.00)
                </span>
              </div>

              {/* Sample Parsed Bill Rows */}
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#F5F9F6] border border-[#E2EAE5]/60">
                  <span className="text-[#172B25]">Paracetamol 500mg (8 tabs &times; ₹5)</span>
                  <span className="font-bold text-[#075B45]">₹40.00 &bull; Verified ✓</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#F5F9F6] border border-[#E2EAE5]/60">
                  <span className="text-[#172B25]">Pantoprazole 40mg (5 tabs &times; ₹11.20)</span>
                  <span className="font-bold text-[#075B45]">₹56.00 &bull; Verified ✓</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#F5F9F6] border border-[#E2EAE5]/60">
                  <span className="text-[#172B25]">ORS Oral Rehydration (4 pkts &times; ₹12)</span>
                  <span className="font-bold text-[#075B45]">₹48.00 &bull; Verified ✓</span>
                </div>
              </div>

              {/* Engine Metrics Footer */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#718078]">
                <span className="flex items-center gap-1">
                  <span className="text-[#087F5B] font-bold">&check;</span> BioBERT NER: 99.8% Match
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-[#087F5B] font-bold">&check;</span> CGHS Tariff: 0% Anomaly
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-[#087F5B] font-bold">&check;</span> Protocol: 100% Compliant
                </span>
              </div>
            </div>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-[#E2EAE5]">
                <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#087F5B] flex items-center justify-center font-bold text-sm flex-shrink-0">
                  ⚡
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#172B25]">AI Document Verification</h4>
                  <p className="text-[11px] text-[#718078] leading-tight mt-0.5">
                    Prescriptions &amp; discharge summaries decoded with clinical BioBERT.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-[#E2EAE5]">
                <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#087F5B] flex items-center justify-center font-bold text-sm flex-shrink-0">
                  📊
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#172B25]">Medical Bill Auditing</h4>
                  <p className="text-[11px] text-[#718078] leading-tight mt-0.5">
                    Real-time cross-referencing against hospital tariffs &amp; price baselines.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-[#E2EAE5]">
                <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#087F5B] flex items-center justify-center font-bold text-sm flex-shrink-0">
                  🛡️
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#172B25]">Evidence Claim Validation</h4>
                  <p className="text-[11px] text-[#718078] leading-tight mt-0.5">
                    Strict mathematical provenance attached to every audited line item.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-[#E2EAE5]">
                <div className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#087F5B] flex items-center justify-center font-bold text-sm flex-shrink-0">
                  🔒
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#172B25]">Secure Healthcare Records</h4>
                  <p className="text-[11px] text-[#718078] leading-tight mt-0.5">
                    End-to-end SMTP authentication with isolated patient-provider boundaries.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ================= RIGHT SIDE: AUTHENTICATION CARD ================= */}
          <div className="lg:col-span-5 w-full">
            <div className="bg-white rounded-3xl border border-[#E2EAE5] p-6 sm:p-8 shadow-xl shadow-[#087F5B]/5">
              {/* Card Title & Subtitle */}
              <div className="text-center mb-6">
                <span className="inline-block p-2.5 rounded-2xl bg-[#E8F5EE] text-[#087F5B] mb-2.5">
                  <span className="text-xl">{headerInfo.badgeIcon}</span>
                </span>
                <h2 className="text-2xl font-black text-[#172B25] tracking-tight">
                  {headerInfo.title}
                </h2>
                <p className="text-xs text-[#718078] mt-1 max-w-sm mx-auto leading-relaxed">
                  {headerInfo.subtitle}
                </p>
              </div>

              {/* View 1: Password Login */}
              {mode === 'login_password' && (
                <PasswordLoginForm
                  portal={portal}
                  onPortalChange={setPortal}
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
                />
              )}

              {/* View 2: Email OTP Login */}
              {mode === 'login_otp' && (
                <EmailLoginForm
                  portal={portal}
                  onPortalChange={setPortal}
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
                />
              )}

              {/* View 3: Login OTP Verification */}
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

              {/* View 4: Registration / Signup */}
              {mode === 'signup' && (
                <SignupForm
                  portal={portal}
                  onPortalChange={setPortal}
                  onSubmitSignup={handleSignupSubmit}
                  onSwitchToLogin={() => {
                    setMode('login_password')
                    clearStatus()
                  }}
                  loading={loading}
                  error={error}
                  onClearError={clearStatus}
                />
              )}

              {/* View 5: Registration Email OTP Verification */}
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
                  submitLabel="Verify & Activate Account"
                  contextTag="Registration"
                />
              )}

              {/* View 6: Forgot Password Email Entry */}
              {mode === 'forgot_password' && (
                <ForgotPasswordForm
                  portal={portal}
                  onPortalChange={setPortal}
                  onSubmitForgot={handleForgotSubmit}
                  onBackToLogin={() => {
                    setMode('login_password')
                    clearStatus()
                  }}
                  loading={loading}
                  error={error}
                  onClearError={clearStatus}
                />
              )}

              {/* View 7: Forgot Password Recovery OTP Verification */}
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

              {/* View 8: Create New Password */}
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

            {/* Compliance badges below card */}
            <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-[#718078]">
              <span className="flex items-center gap-1">
                <span>🔐</span> Zero-Knowledge Auth
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <span>🛡️</span> SMTP Encrypted
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <span>🇮🇳</span> ABDM Aligned
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
