import React from 'react'
import type { PortalType } from '../../context/AuthContext'

interface AccountTypeSelectorProps {
  selected: PortalType
  onChange: (portal: PortalType) => void
  disabled?: boolean
}

export const AccountTypeSelector: React.FC<AccountTypeSelectorProps> = ({
  selected,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="w-full mb-3">
      <div
        className="grid grid-cols-2 p-1.5 rounded-2xl border-2 border-neutral-900 bg-[#FAF8F5]"
        role="radiogroup"
        aria-label="Portal Selection"
      >
        {/* Patient Portal Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'patient'}
          disabled={disabled}
          onClick={() => onChange('patient')}
          className={`py-2 px-3 rounded-xl transition-all duration-150 flex flex-col items-center justify-center text-center cursor-pointer ${
            selected === 'patient'
              ? 'bg-white text-neutral-950 font-black shadow-[1px_1px_0px_0px_#111111] border-2 border-neutral-900'
              : 'text-neutral-700 hover:text-neutral-950 font-bold border-2 border-transparent'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-1.5 text-xs font-black">
            <span className="text-sm">👤</span>
            <span>Patient Portal</span>
          </div>
          <span
            className={`text-[10px] font-medium mt-0.5 ${
              selected === 'patient' ? 'text-neutral-700 font-bold' : 'text-neutral-500'
            }`}
          >
            Personal Bills &amp; Rx Audit
          </span>
        </button>

        {/* Hospital Management Option */}
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'hospital_management'}
          disabled={disabled}
          onClick={() => onChange('hospital_management')}
          className={`py-2 px-3 rounded-xl transition-all duration-150 flex flex-col items-center justify-center text-center cursor-pointer ${
            selected === 'hospital_management'
              ? 'bg-white text-neutral-950 font-black shadow-[1px_1px_0px_0px_#111111] border-2 border-neutral-900 ring-2 ring-orange-500/30'
              : 'text-neutral-700 hover:text-neutral-950 font-bold border-2 border-transparent'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-1.5 text-xs font-black">
            <span className="text-sm">🏥</span>
            <span>Hospital Mgmt</span>
          </div>
          <span
            className={`text-[10px] font-medium mt-0.5 ${
              selected === 'hospital_management' ? 'text-orange-600 font-bold' : 'text-neutral-500'
            }`}
          >
            Provider Tariff &amp; Billing Desk
          </span>
        </button>
      </div>
    </div>
  )
}
