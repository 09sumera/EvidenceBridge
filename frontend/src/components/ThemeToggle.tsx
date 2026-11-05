import React from 'react'
import { useTheme } from '../context/ThemeContext'

interface ThemeToggleProps {
  className?: string
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export default function ThemeToggle({
  className = '',
  showLabel = false,
  size = 'md',
}: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme()

  const isSm = size === 'sm'

  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`}>
      {showLabel && (
        <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
          {isDark ? 'Dark Mode' : 'Light Mode'}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        onClick={toggleTheme}
        className={`relative inline-flex items-center rounded-full transition-all duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 border ${
          isSm ? 'w-12 h-6 p-0.5' : 'w-14 h-7 p-0.5'
        } ${
          isDark
            ? 'bg-neutral-900 border-neutral-700 shadow-inner'
            : 'bg-cream-200 border-neutral-900 shadow-adjudo-sm'
        }`}
      >
        {/* Background Icons in Track */}
        <div className="absolute inset-0 flex items-center justify-between px-1.5 pointer-events-none">
          {/* Sun icon on left */}
          <svg
            className={`${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-orange-600 transition-opacity duration-200 ${
              isDark ? 'opacity-30' : 'opacity-0'
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
              clipRule="evenodd"
            />
          </svg>
          {/* Moon icon on right */}
          <svg
            className={`${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-orange-400 transition-opacity duration-200 ${
              isDark ? 'opacity-0' : 'opacity-30'
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        </div>

        {/* Sliding Thumb Knob */}
        <span
          className={`inline-flex items-center justify-center rounded-full shadow-md transform transition-transform duration-300 ease-out z-10 ${
            isSm ? 'w-5 h-5' : 'w-6 h-6'
          } ${
            isDark
              ? `${isSm ? 'translate-x-6' : 'translate-x-7'} bg-neutral-900 border border-neutral-700 text-orange-400`
              : 'translate-x-0 bg-neutral-950 border border-neutral-900 text-white'
          }`}
        >
          {isDark ? (
            <svg className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          ) : (
            <svg className={isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </span>
      </button>
    </div>
  )
}
