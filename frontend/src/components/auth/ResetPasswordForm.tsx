import React, { useState } from 'react'
import { PasswordInput } from './PasswordInput'

interface ResetPasswordFormProps {
  email: string
  onSubmitReset: (newPassword: string) => Promise<void>
  onBackToLogin: () => void
  loading: boolean
  error: string | null
  onClearError?: () => void
}

export const ResetPasswordForm: React.FC<ResetPasswordFormProps> = ({
  email,
  onSubmitReset,
  onBackToLogin,
  loading,
  error,
  onClearError,
}) => {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const validate = (): boolean => {
    if (password.length < 4) {
      setLocalErr('Password must be at least 4 characters long.')
      return false
    }
    if (password !== confirmPassword) {
      setLocalErr('Passwords do not match. Please verify your confirm password entry.')
      return false
    }
    setLocalErr(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (onClearError) onClearError()

    if (!validate()) return

    try {
      await onSubmitReset(password.trim())
      setIsSuccess(true)
    } catch {
      // Error handled by parent component
    }
  }

  const currentError = localErr || error

  if (isSuccess) {
    return (
      <div className="space-y-4 text-center py-4 animate-fadeIn">
        <div className="w-12 h-12 rounded-full border-2 border-neutral-900 bg-emerald-100 text-emerald-900 mx-auto flex items-center justify-center text-xl font-black shadow-[1px_1px_0px_0px_#111111]">
          ✓
        </div>
        <div>
          <h3 className="text-lg font-black text-neutral-900">Password Reset Complete</h3>
          <p className="text-xs text-neutral-600 font-bold mt-1 max-w-sm mx-auto leading-relaxed">
            Your EvidenceBridge password has been successfully updated for{' '}
            <span className="font-black text-neutral-900">{email}</span>. You can now login with your new credentials.
          </p>
        </div>
        <div className="pt-2">
          <button
            type="button"
            onClick={onBackToLogin}
            className="w-full py-3 px-4 rounded-xl font-black text-sm text-white bg-orange-600 hover:bg-orange-700 border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:translate-x-[1px] hover:translate-y-[1px] cursor-pointer"
          >
            Login with New Password &rarr;
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="p-3 rounded-xl bg-emerald-50 border-2 border-neutral-900 text-left text-xs shadow-[1px_1px_0px_0px_#111111]">
        <span className="font-black text-emerald-800">Identity Verified:</span>{' '}
        <span className="text-neutral-900 font-bold">Resetting credentials for </span>
        <span className="font-mono font-black text-neutral-900">{email}</span>
      </div>

      {/* New Password */}
      <div>
        <label htmlFor="reset-password-input" className="block text-xs font-bold text-neutral-900 mb-1.5">
          🔑 New Account Password *
        </label>
        <PasswordInput
          id="reset-password-input"
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

      {/* Confirm New Password */}
      <div>
        <label htmlFor="reset-confirm-password-input" className="block text-xs font-bold text-neutral-900 mb-1.5">
          🔒 Confirm New Password *
        </label>
        <PasswordInput
          id="reset-confirm-password-input"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value)
            if (onClearError) onClearError()
            setLocalErr(null)
          }}
          disabled={loading}
          placeholder="Re-enter your new password"
          autoComplete="new-password"
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
            <span>Updating Password...</span>
          </span>
        ) : (
          <span>Save New Password &amp; Login &rarr;</span>
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
