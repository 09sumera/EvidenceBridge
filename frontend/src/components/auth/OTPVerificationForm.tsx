import React, { useState, useEffect } from 'react'
import type { PortalType } from '../../context/AuthContext'
import { OTPInput } from './OTPInput'

interface OTPVerificationFormProps {
  email: string
  portal: PortalType
  hospitalName?: string
  expiresInSeconds?: number
  resendCooldownSeconds?: number
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
  onChangeEmail: () => void
  loading: boolean
  error: string | null
  onClearError?: () => void
  devOtp?: string
  title?: string
  submitLabel?: string
  contextTag?: string
}

export const OTPVerificationForm: React.FC<OTPVerificationFormProps> = ({
  email,
  portal,
  expiresInSeconds = 600,
  resendCooldownSeconds = 30,
  onVerify,
  onResend,
  onChangeEmail,
  loading,
  error,
  onClearError,
  devOtp,
  title = 'Verify Passcode',
  submitLabel = 'Verify & Login',
  contextTag,
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [cooldown, setCooldown] = useState<number>(resendCooldownSeconds)
  const [isCooldownActive, setIsCooldownActive] = useState<boolean>(true)
  const [expiryRemaining, setExpiryRemaining] = useState<number>(expiresInSeconds)
  const [resending, setResending] = useState<boolean>(false)
  const [resendSuccessNotice, setResendSuccessNotice] = useState<string | null>(null)

  // Resend Cooldown Countdown
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>
    if (isCooldownActive && cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prev) => prev - 1)
      }, 1000)
    } else if (cooldown <= 0) {
      setIsCooldownActive(false)
    }
    return () => clearInterval(timer)
  }, [isCooldownActive, cooldown])

  // Expiration Countdown
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>
    if (expiryRemaining > 0) {
      timer = setInterval(() => {
        setExpiryRemaining((prev) => prev - 1)
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [expiryRemaining])

  const formatExpiryTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  const handleDigitsChange = (newDigits: string[]) => {
    setDigits(newDigits)
    if (onClearError) onClearError()
    setResendSuccessNotice(null)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (onClearError) onClearError()
    setResendSuccessNotice(null)

    const code = digits.join('')
    if (code.length !== 6) {
      return
    }

    await onVerify(code)
  }

  const handleTriggerResend = async () => {
    if (isCooldownActive || resending) return
    setResending(true)
    if (onClearError) onClearError()
    setResendSuccessNotice(null)

    try {
      await onResend()
      setResendSuccessNotice('A new 6-digit verification code has been dispatched!')
      setCooldown(resendCooldownSeconds)
      setIsCooldownActive(true)
      setDigits(['', '', '', '', '', ''])
    } catch {
      // Error handled by parent
    } finally {
      setResending(false)
    }
  }

  const isComplete = digits.join('').length === 6

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Step Indicator (Multi-Step Flow) */}
      {contextTag === 'Registration' && (
        <div className="flex items-center justify-between text-[11px] font-black tracking-wide border-b-2 border-neutral-900 pb-3 mb-2">
          <span className="text-emerald-700 flex items-center gap-1">
            <span>✓</span> 1. DETAILS
          </span>
          <span className="text-neutral-400">•••</span>
          <span className="text-orange-600 flex items-center gap-1 bg-orange-100 px-2 py-0.5 rounded-full border border-orange-300">
            <span>②</span> 2. VERIFY OTP
          </span>
          <span className="text-neutral-400">•••</span>
          <span className="text-neutral-500">③ 3. CREATE PASSWORD</span>
        </div>
      )}

      {/* Verification Notice Card */}
      <div className="p-3.5 rounded-2xl border-2 border-neutral-900 bg-[#FAF8F5] shadow-[1px_1px_0px_0px_#111111]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-xl flex-shrink-0">📨</span>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-600 block">
                STEP 2: ENTER EMAIL VERIFICATION CODE
              </span>
              <p className="text-xs font-bold text-neutral-900 mt-0.5 truncate">
                We&apos;ve sent a 6-digit passcode to{' '}
                <span className="text-orange-600 font-black">{email}</span>
              </p>
              <p className="text-[11px] text-neutral-600 font-medium mt-0.5">
                Enter the code below. Once verified, you will immediately proceed.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onChangeEmail}
            disabled={loading}
            className="flex-shrink-0 px-2.5 py-1 text-xs font-bold border-2 border-neutral-900 bg-white text-neutral-900 hover:bg-neutral-100 rounded-lg shadow-[1px_1px_0px_0px_#111111] transition-all cursor-pointer"
          >
            Change
          </button>
        </div>
      </div>

      {/* Dev Helper if present */}
      {devOtp && (
        <div className="p-2.5 rounded-xl border-2 border-amber-500 bg-amber-50 text-amber-900 text-xs font-bold flex items-center justify-between shadow-[1px_1px_0px_0px_#111111]">
          <span>⚡ Local Dev Mode OTP:</span>
          <span className="font-mono text-base font-black tracking-widest">{devOtp}</span>
        </div>
      )}

      {/* 6-Digit OTP Input */}
      <div className="py-2">
        <label className="block text-center text-xs font-black text-neutral-900 mb-3">
          Enter 6-Digit Passcode
        </label>
        <OTPInput
          value={digits}
          onChange={handleDigitsChange}
          onComplete={() => handleSubmit()}
          disabled={loading}
          hasError={!!error}
          autoFocus={true}
        />
        <div className="text-center mt-2.5">
          <span className="text-[11px] font-bold text-neutral-500">
            Code expires in{' '}
            <span className="font-mono font-black text-neutral-900">{formatExpiryTime(expiryRemaining)}</span>
          </span>
        </div>
      </div>

      {/* Resend Notice */}
      {resendSuccessNotice && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border-2 border-emerald-400 text-emerald-900 text-xs font-bold text-center">
          {resendSuccessNotice}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-900 text-xs font-bold flex items-start gap-2 shadow-[1px_1px_0px_0px_#111111]"
        >
          <span className="text-sm flex-shrink-0">⚠️</span>
          <div className="flex-1">
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Resend Action */}
      <div className="flex items-center justify-between text-xs pt-1">
        <span className="font-bold text-neutral-600">Did not receive code?</span>
        <button
          type="button"
          onClick={handleTriggerResend}
          disabled={isCooldownActive || resending || loading}
          className={`font-black flex items-center gap-1.5 transition-colors ${
            isCooldownActive || resending || loading
              ? 'text-neutral-400 cursor-not-allowed'
              : 'text-orange-600 hover:text-orange-700 hover:underline cursor-pointer'
          }`}
        >
          <span>🔄</span>
          <span>{isCooldownActive ? `Resend code in ${cooldown}s` : 'Resend New Passcode'}</span>
        </button>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading || !isComplete}
        className={`w-full py-3 px-4 rounded-xl font-black text-sm text-white bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          loading ? 'opacity-75 cursor-wait' : 'active:translate-x-[2px] active:translate-y-[2px]'
        }`}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>Verifying Passcode...</span>
          </span>
        ) : (
          <span>{submitLabel} &rarr;</span>
        )}
      </button>
    </form>
  )
}
