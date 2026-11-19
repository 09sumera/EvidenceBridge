import React from 'react'

interface PasswordStrengthIndicatorProps {
  password: string
  showRules?: boolean
}

export interface PasswordRuleState {
  label: string
  met: boolean
}

export function evaluatePasswordStrength(password: string): {
  score: number // 0 to 4
  level: 'Empty' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  color: string
  rules: PasswordRuleState[]
} {
  const rules: PasswordRuleState[] = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter (A-Z)', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter (a-z)', met: /[a-z]/.test(password) },
    { label: 'One number (0-9)', met: /[0-9]/.test(password) },
    { label: 'One special symbol (!@#$%^&*)', met: /[^A-Za-z0-9]/.test(password) },
  ]

  if (!password) {
    return { score: 0, level: 'Empty', color: '#E2EAE5', rules }
  }

  const metCount = rules.filter((r) => r.met).length

  if (metCount <= 2 || password.length < 6) {
    return { score: 1, level: 'Weak', color: '#EF4444', rules }
  }
  if (metCount === 3) {
    return { score: 2, level: 'Fair', color: '#F59E0B', rules }
  }
  if (metCount === 4) {
    return { score: 3, level: 'Good', color: '#10B981', rules }
  }
  return { score: 4, level: 'Strong', color: '#087F5B', rules }
}

export const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
  password,
  showRules = true,
}) => {
  const { score, level, color, rules } = evaluatePasswordStrength(password)

  if (!password) return null

  return (
    <div className="w-full space-y-2 pt-1 animate-fadeIn">
      {/* Strength Bar & Label */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#718078]">Password Strength:</span>
        <span className="font-bold uppercase tracking-wider" style={{ color }}>
          {level}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className="h-full rounded-full transition-all duration-300"
            style={{
              backgroundColor: score >= step ? color : '#E2EAE5',
            }}
          />
        ))}
      </div>

      {/* Rules Checklist */}
      {showRules && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1.5 text-[11px]">
          {rules.map((rule, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-1.5 transition-colors duration-150 ${
                rule.met ? 'text-[#075B45] font-medium' : 'text-[#718078]'
              }`}
            >
              <span
                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${
                  rule.met
                    ? 'bg-[#087F5B] text-white font-bold'
                    : 'bg-[#E2EAE5] text-[#718078]'
                }`}
              >
                {rule.met ? '✓' : '•'}
              </span>
              <span>{rule.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
