import React, { useRef, useEffect } from 'react'

interface OTPInputProps {
  value: string[]
  onChange: (digits: string[]) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  hasError?: boolean
  autoFocus?: boolean
}

export const OTPInput: React.FC<OTPInputProps> = ({
  value,
  onChange,
  onComplete,
  disabled = false,
  hasError = false,
  autoFocus = true,
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Ensure digits array is always length 6
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '')

  useEffect(() => {
    if (autoFocus && inputRefs.current[0] && !disabled) {
      inputRefs.current[0].focus()
    }
  }, [autoFocus, disabled])

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value
    // Extract only digits
    const cleaned = rawVal.replace(/\D/g, '')

    if (!cleaned) {
      const next = [...digits]
      next[index] = ''
      onChange(next)
      return
    }

    // Handle single digit input
    const char = cleaned.slice(-1)
    const next = [...digits]
    next[index] = char
    onChange(next)

    // Auto advance focus to next input
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus()
    }

    // Check if code is complete
    const fullCode = next.join('')
    if (fullCode.length === 6 && onComplete) {
      onComplete(fullCode)
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Move to previous input and clear it
        e.preventDefault()
        const next = [...digits]
        next[index - 1] = ''
        onChange(next)
        inputRefs.current[index - 1]?.focus()
      } else if (digits[index]) {
        // Just clear current
        e.preventDefault()
        const next = [...digits]
        next[index] = ''
        onChange(next)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return

    const next = [...digits]
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || ''
    }
    onChange(next)

    // Focus appropriate box
    const targetIdx = Math.min(pasted.length, 5)
    inputRefs.current[targetIdx]?.focus()

    if (pasted.length === 6 && onComplete) {
      onComplete(pasted)
    }
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 sm:gap-2.5 max-w-[340px] mx-auto">
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => (inputRefs.current[idx] = el)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            autoComplete={idx === 0 ? 'one-time-code' : 'off'}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleInputChange(idx, e)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            aria-label={`Verification digit ${idx + 1} of 6`}
            className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-mono font-black rounded-xl border-2 transition-all duration-150 outline-none select-none ${
              hasError
                ? 'border-rose-500 bg-rose-50/50 text-rose-950 focus:border-rose-600 focus:ring-2 focus:ring-rose-500/20'
                : digit
                ? 'border-neutral-900 bg-orange-50/40 text-neutral-950 shadow-[1px_1px_0px_0px_#111111] focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'
                : 'border-neutral-900 bg-white text-neutral-950 shadow-[1px_1px_0px_0px_#111111] focus:border-orange-500 focus:bg-[#FAF8F5] focus:ring-2 focus:ring-orange-500/20'
            } ${disabled ? 'opacity-50 cursor-not-allowed bg-neutral-100' : 'cursor-text'}`}
          />
        ))}
      </div>
    </div>
  )
}
