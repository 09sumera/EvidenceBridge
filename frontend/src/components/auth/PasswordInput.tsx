import React, { useState } from 'react'

interface PasswordInputProps {
  id?: string
  name?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  placeholder?: string
  disabled?: boolean
  autoComplete?: string
  hasError?: boolean
  label?: string
  required?: boolean
  className?: string
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  id = 'password-input',
  name = 'password',
  value,
  onChange,
  onBlur,
  placeholder = '••••••••',
  disabled = false,
  autoComplete = 'current-password',
  hasError = false,
  label,
  className = '',
}) => {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={id} className="block text-xs font-bold text-neutral-900">
            {label}
          </label>
        </div>
      )}
      <div className="relative">
        {/* Lock Icon */}
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-500">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        {/* Input */}
        <input
          id={id}
          name={name}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          className={`w-full pl-9 pr-10 py-2 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all shadow-[1px_1px_0px_0px_#111111] focus:outline-none ${
            hasError
              ? 'border-rose-500 bg-rose-50/40 text-neutral-950 focus:border-rose-600 focus:ring-2 focus:ring-rose-500/20'
              : 'border-neutral-900 bg-white text-neutral-950 placeholder-neutral-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'
          } ${disabled ? 'opacity-60 cursor-not-allowed bg-neutral-100' : ''}`}
        />

        {/* Show/Hide Toggle Button */}
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          disabled={disabled}
          tabIndex={-1}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer select-none"
        >
          {showPassword ? (
            /* Eye Slash Icon (Hide) */
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
              />
            </svg>
          ) : (
            /* Eye Icon (Show) */
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
