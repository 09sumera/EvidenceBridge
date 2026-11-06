import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { getHealth, API_BASE } from '../api/client'
import type { HealthResponse } from '../types'
import { useAuth, type PortalType } from '../context/AuthContext'
import { useVoice } from '../context/VoiceContext'
import { useTheme } from '../context/ThemeContext'
import { getUserClaims } from '../services/userDataStore'
import { AuthModal } from './AuthModal'
import { VoiceAssistant } from './VoiceAssistant'
import Logo, { EbMark } from './Logo'
import ThemeToggle from './ThemeToggle'

export default function Layout() {
  const { user, isAuthenticated, logout, isHospitalManagement } = useAuth()
  const { setIsOpen: setVoiceOpen, setIsEnabled: setIsVoiceEnabled } = useVoice()
  const { isDark } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login')
  const [authModalPortal, setAuthModalPortal] = useState<PortalType>('patient')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [moreDropdownOpen, setMoreDropdownOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const openAuth = (mode: 'login' | 'signup', portal: PortalType = 'patient') => {
    setAuthModalMode(mode)
    setAuthModalPortal(portal)
    setAuthModalOpen(true)
  }

  const [health, setHealth] = useState<{
    loading: boolean
    ok: boolean
    data?: HealthResponse
  }>({ loading: true, ok: false })

  useEffect(() => {
    let active = true
    getHealth()
      .then((data) => {
        if (active) setHealth({ loading: false, ok: data.status === 'ok' || data.status === 'healthy', data })
      })
      .catch(() => {
        if (active) setHealth({ loading: false, ok: false })
      })
    return () => {
      active = false
    }
  }, [])

  // Close menus on page navigation
  useEffect(() => {
    setMobileMenuOpen(false)
    setMoreDropdownOpen(false)
  }, [location.pathname])

  // Click outside to close 'More' dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center px-2.5 py-1 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
      isActive
        ? isDark
          ? 'bg-neutral-100 text-neutral-950 border border-neutral-100 shadow-adjudo-sm'
          : 'bg-neutral-900 text-white border border-neutral-900 shadow-adjudo-sm'
        : isDark
          ? 'text-neutral-300 hover:text-white hover:bg-neutral-800'
          : 'text-neutral-800 hover:text-black hover:bg-cream-200'
    }`

  const handleSignOut = () => {
    logout()
    navigate('/')
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans w-full max-w-full overflow-x-hidden transition-colors duration-200 ${
      isDark ? 'bg-adjudo-dark text-neutral-100' : 'bg-cream-100 text-adjudo-black'
    }`}>
      {/* Top Header */}
      <header className={`backdrop-blur-sm border-b sticky top-0 z-30 shadow-adjudo-sm w-full transition-colors duration-200 ${
        isDark ? 'bg-adjudo-dark/95 border-neutral-800' : 'bg-cream-100/95 border-neutral-900/80'
      }`}>
        <div className="w-full max-w-[1536px] mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-2 sm:gap-4 flex-nowrap">
            {/* Left Cluster: Logo + Navigation Links */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
              {/* Logo */}
              <NavLink to="/welcome" className="flex items-center flex-shrink-0 mr-1 sm:mr-2">
                <Logo size="sm" showText={true} />
              </NavLink>

              {/* Clean Desktop Navigation (>= 768px) */}
              <nav className="hidden md:flex items-center gap-1 min-w-0 flex-shrink-0">
                {isHospitalManagement ? (
                  /* HOSPITAL_MANAGEMENT role: ONLY 1 operational page */
                  <NavLink
                    to="/hospital/management"
                    className={navLinkClasses}
                    title="Hospital Staff & SOS Management Desk"
                  >
                    🏥 Staff &amp; SOS Management
                  </NavLink>
                ) : (
                  /* PATIENT or Guest role: Standard Patient Workflows */
                  <>
                    <NavLink to="/audit" className={navLinkClasses} title="Audit a healthcare claim or hospital bill">
                      Audit Claim
                    </NavLink>
                    <NavLink to="/claims" className={navLinkClasses} title="Browse verified claims history">
                      Claims Explorer
                    </NavLink>
                    <NavLink to="/hospitals" className={navLinkClasses} title="Find nearby hospitals, fair costs & live doctor availability">
                      Hospitals
                    </NavLink>
                    <NavLink to="/insights" className={navLinkClasses} title="Interactive statistics and summary charts">
                      Insights
                    </NavLink>

                    {/* More Dropdown for secondary pages */}
                    <div className="relative flex-shrink-0" ref={moreRef}>
                      <button
                        type="button"
                        onClick={() => setMoreDropdownOpen((prev) => !prev)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-black rounded-lg transition-colors border shadow-adjudo-sm cursor-pointer ${
                          isDark
                            ? 'text-neutral-200 hover:text-white bg-neutral-900 border-neutral-700'
                            : 'text-neutral-900 hover:text-black bg-white border-neutral-900'
                        }`}
                      >
                        <span>More</span>
                        <span className="text-[10px]">▾</span>
                      </button>
                      {moreDropdownOpen && (
                        <div className={`absolute left-0 mt-1.5 w-52 rounded-xl shadow-adjudo border py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                          isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-100' : 'bg-white border-neutral-900 text-neutral-900'
                        }`}>
                          <NavLink
                            to="/community"
                            onClick={() => setMoreDropdownOpen(false)}
                            className={({ isActive }) =>
                              `block px-3.5 py-2 text-xs font-bold transition-colors ${
                                isActive
                                  ? isDark ? 'bg-neutral-800 text-orange-400' : 'bg-cream-200 text-orange-600'
                                  : isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-cream-100'
                              }`
                            }
                          >
                            Community Stories
                          </NavLink>
                          <NavLink
                            to="/welcome"
                            onClick={() => setMoreDropdownOpen(false)}
                            className={({ isActive }) =>
                              `block px-3.5 py-2 text-xs font-bold transition-colors ${
                                isActive
                                  ? isDark ? 'bg-neutral-800 text-orange-400' : 'bg-cream-200 text-orange-600'
                                  : isDark ? 'text-neutral-300 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-cream-100'
                              }`
                            }
                          >
                            Platform Overview
                          </NavLink>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </nav>
            </div>

            {/* Right Cluster: Local Engine, Theme Switch, Voice AI, User Profile, Sign Out */}
            <div className="flex-shrink-0 flex items-center gap-1.5 sm:gap-2 flex-nowrap">
              {/* Backend Health Pill */}
              <div
                className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border flex-shrink-0 ${
                  isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-300' : 'bg-white border-neutral-900 shadow-adjudo-sm text-neutral-800'
                }`}
                title={
                  health.loading
                    ? 'Checking backend status...'
                    : health.ok
                    ? `Backend Online (${health.data?.app_name || 'FastAPI'} v${health.data?.version || '0.1'})`
                    : `Backend Offline (${API_BASE})`
                }
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    health.loading
                      ? 'bg-amber-500 animate-pulse'
                      : health.ok
                      ? 'bg-emerald-500'
                      : 'bg-rose-500'
                  }`}
                />
                <span className="text-[11px] font-bold whitespace-nowrap">
                  {health.loading
                    ? 'Connecting...'
                    : health.ok
                    ? 'Online'
                    : 'Offline'}
                </span>
              </div>

              {/* Theme Toggle Switch */}
              <div className="flex-shrink-0">
                <ThemeToggle size="sm" />
              </div>

              {/* Voice AI Header Button (Patient accounts only) */}
              {isAuthenticated && !isHospitalManagement && (
                <button
                  type="button"
                  onClick={() => {
                    setIsVoiceEnabled(true)
                    setVoiceOpen(true)
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all shadow-adjudo-sm cursor-pointer flex-shrink-0 ${
                    isDark
                      ? 'border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-100'
                      : 'border-neutral-900 bg-white hover:bg-cream-200 text-neutral-900'
                  }`}
                  title="Open AI Voice Assistant (English / ಕನ್ನಡ)"
                >
                  <span className="text-xs leading-none">🎙️</span>
                  <span className="hidden sm:inline text-xs font-black">Voice AI</span>
                </button>
              )}

              {/* User Authentication Pill & Always-Visible Sign Out */}
              {isAuthenticated && user ? (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setProfileModalOpen(true)}
                    className={`flex items-center gap-1.5 py-1 px-2 sm:px-2.5 rounded-xl border shadow-adjudo-sm transition-all cursor-pointer group text-left flex-shrink-0 ${
                      isDark
                        ? 'bg-neutral-900 hover:bg-neutral-800 border-neutral-700'
                        : 'bg-white hover:bg-cream-200 border-neutral-900'
                    }`}
                    title={`Logged in as ${user.name} (${user.portal === 'hospital_management' ? 'Hospital Management' : 'Patient'}) - Click to view account`}
                  >
                    <div className={`w-6 h-6 rounded-full text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0 ${
                      user.portal === 'hospital_management' ? 'bg-orange-600' : 'bg-neutral-900'
                    }`}>
                      {user.portal === 'hospital_management' ? '🏥' : '👤'}
                    </div>
                    <div className="text-left hidden sm:block max-w-[120px] md:max-w-[150px]">
                      <div className={`text-xs font-black leading-tight truncate ${isDark ? 'text-neutral-100' : 'text-neutral-900'}`}>
                        {user.name}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={`text-[9px] font-black uppercase px-1 py-0.2 rounded border flex-shrink-0 ${
                          user.portal === 'hospital_management'
                            ? isDark ? 'bg-orange-950/80 text-orange-300 border-orange-800' : 'bg-orange-100 text-orange-900 border-orange-300'
                            : isDark ? 'bg-neutral-800 text-neutral-200 border-neutral-700' : 'bg-cream-200 text-neutral-900 border-neutral-400'
                        }`}>
                          {user.portal === 'hospital_management' ? 'Hospital' : 'Patient'}
                        </span>
                        <span className={`text-[9px] font-mono truncate max-w-[60px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                          {user.email.split('@')[0]}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Sign Out Button - Always visible in the top bar */}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all whitespace-nowrap shadow-adjudo-sm cursor-pointer flex-shrink-0 ${
                      isDark
                        ? 'text-rose-400 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-900/60 border-rose-800'
                        : 'text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border-neutral-900'
                    }`}
                    title="Sign Out of Session"
                  >
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => openAuth('login', 'patient')}
                    className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1.5 rounded-lg transition-all border shadow-adjudo-sm cursor-pointer ${
                      isDark
                        ? 'text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border-neutral-700'
                        : 'text-white bg-neutral-950 hover:bg-black border-neutral-900'
                    }`}
                    title="Sign In to Patient Portal"
                  >
                    <span>👤</span>
                    <span>Patient Sign In</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAuth('login', 'hospital_management')}
                    className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1.5 rounded-lg transition-all border border-neutral-900 bg-orange-600 hover:bg-orange-700 text-white shadow-adjudo-sm cursor-pointer"
                    title="Sign In to Hospital Management Portal"
                  >
                    <span>🏥</span>
                    <span className="hidden sm:inline">Hospital Mgmt</span>
                    <span className="sm:hidden">Hospital</span>
                  </button>
                </div>
              )}

              {/* Mobile Menu Hamburger (screens < md) */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className={`md:hidden p-1.5 rounded-lg transition-colors border ${
                  isDark
                    ? 'text-neutral-300 hover:text-white hover:bg-neutral-800 border-neutral-700'
                    : 'text-neutral-700 hover:text-black hover:bg-cream-200 border-neutral-900/70'
                }`}
                aria-label="Toggle Navigation Menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Dropdown (< md screens) */}
        {mobileMenuOpen && (
          <div className={`md:hidden border-t px-3 py-2 space-y-1 shadow-adjudo border-b ${
            isDark ? 'border-neutral-800 bg-adjudo-dark-surface' : 'border-neutral-900 bg-cream-100'
          }`}>
            {isHospitalManagement ? (
              <>
                <NavLink to="/hospital/management" className={navLinkClasses}>
                  🏥 Staff &amp; SOS Management
                </NavLink>
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-black text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    Sign Out ({user?.email})
                  </button>
                </div>
              </>
            ) : (
              <>
                <NavLink to="/audit" className={navLinkClasses}>
                  Audit Claim
                </NavLink>
                <NavLink to="/claims" className={navLinkClasses}>
                  Claims Explorer
                </NavLink>
                <NavLink to="/hospitals" className={navLinkClasses}>
                  Hospitals
                </NavLink>
                <NavLink to="/insights" className={navLinkClasses}>
                  Insights
                </NavLink>
                <NavLink to="/community" className={navLinkClasses}>
                  Community Stories
                </NavLink>
                <NavLink to="/welcome" className={navLinkClasses}>
                  Overview
                </NavLink>
              </>
            )}

            {/* Mobile Theme Toggle Row */}
            <div className={`pt-2 pb-1 border-t flex items-center justify-between px-2 mt-2 ${
              isDark ? 'border-neutral-800 text-neutral-300' : 'border-neutral-300 text-neutral-700'
            }`}>
              <span className="text-xs font-bold">Display Theme</span>
              <ThemeToggle showLabel={true} size="sm" />
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>

      {/* Trust-Focused Medical Footer */}
      <footer className={`border-t py-6 text-xs w-full transition-colors duration-200 ${
        isDark ? 'bg-adjudo-dark border-neutral-800 text-neutral-400' : 'bg-cream-100 border-neutral-900/80 text-neutral-600'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <EbMark size={20} />
            <span className={`font-black ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>EvidenceBridge</span>
            <span>&bull;</span>
            <span>Local-First Clinical Evidence &amp; Medical Price Auditing</span>
          </div>

          <div className={`flex items-center gap-4 text-[11px] flex-wrap justify-center font-bold ${
            isDark ? 'text-neutral-400' : 'text-neutral-600'
          }`}>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              100% Offline Engine
            </span>
            <span>&bull;</span>
            <span>Zero PHI Cloud Leakage</span>
            <span>&bull;</span>
            <span>9-Stage Traceable Graph</span>
            <span>&bull;</span>
            <span>Layers 1&ndash;6 Complete</span>
          </div>
        </div>
      </footer>

      {/* Global Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        initialPortal={authModalPortal}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* User Profile Modal */}
      {profileModalOpen && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/75 backdrop-blur-md animate-in fade-in duration-150">
          <div
            className={`rounded-3xl max-w-md w-full p-6 sm:p-7 border relative animate-in zoom-in-95 duration-150 ${
              isDark
                ? 'bg-[#121418] border-neutral-700/80 text-white shadow-2xl'
                : 'bg-white border-neutral-200/90 text-neutral-900 shadow-xl'
            }`}
            style={{ backgroundColor: isDark ? '#121418' : '#ffffff', opacity: 1 }}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setProfileModalOpen(false)}
              className={`absolute top-4 right-4 p-1.5 rounded-lg transition-colors border ${
                isDark ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 border-neutral-700' : 'text-neutral-500 hover:text-black hover:bg-cream-200 border-neutral-900'
              }`}
              title="Close modal"
            >
              ✕
            </button>

            {/* Profile Header */}
            <div className="flex items-center gap-4 mb-5">
              <div className={`w-14 h-14 rounded-2xl text-white font-black text-2xl flex items-center justify-center shadow-adjudo-sm border border-neutral-900 ${
                user.portal === 'hospital_management' ? 'bg-orange-600' : 'bg-neutral-950'
              }`}>
                {user.portal === 'hospital_management' ? '🏥' : '👤'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className={`text-lg font-black ${isDark ? 'text-white' : 'text-neutral-900'}`}>{user.name}</h3>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                    user.portal === 'hospital_management'
                      ? isDark ? 'bg-orange-950/80 text-orange-300 border-orange-800' : 'bg-orange-100 text-orange-900 border-neutral-900'
                      : isDark ? 'bg-neutral-800 text-neutral-300 border-neutral-700' : 'bg-cream-200 text-neutral-900 border-neutral-900'
                  }`}>
                    {user.portal === 'hospital_management' ? 'Hospital Management' : 'Patient Portal'}
                  </span>
                </div>
                <p className={`text-xs font-bold ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>{user.role}</p>
                <p className={`text-[11px] mt-0.5 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {user.organization || (user.portal === 'hospital_management' ? 'Hospital Billing Desk' : 'Personal Health Vault')}
                </p>
              </div>
            </div>

            {/* Details Cards */}
            <div className={`space-y-2.5 text-xs p-4 rounded-xl border mb-5 ${
              isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-cream-50 border-neutral-900'
            }`}>
              <div className={`flex items-center justify-between py-1 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-300'}`}>
                <span className={`font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>Account Email:</span>
                <span className={`font-bold font-mono ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>{user.email}</span>
              </div>
              <div className={`flex items-center justify-between py-1 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-300'}`}>
                <span className={`font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {isHospitalManagement ? 'Assigned Facility ID:' : 'Isolated Data Scoping:'}
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  {isHospitalManagement
                    ? user.hospital_id || 'hosp_davg_shree_institute'
                    : `${getUserClaims(user.email).length} Claim${getUserClaims(user.email).length === 1 ? '' : 's'} in Personal Memory`}
                </span>
              </div>
              <div className={`flex items-center justify-between py-1 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-300'}`}>
                <span className={`font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>Portal Role:</span>
                <span className={`font-bold ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>
                  {user.portal === 'hospital_management' ? 'Hospital Administrator / Billing Desk' : 'Patient / Citizen Policyholder'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className={`font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>Assigned Territory:</span>
                <span className={`font-bold ${isDark ? 'text-neutral-200' : 'text-neutral-900'}`}>Karnataka &bull; Pan-India Public Benchmarks</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className={`flex-1 py-2.5 px-4 rounded-xl border text-xs font-black transition-all shadow-adjudo-sm cursor-pointer ${
                  isDark ? 'border-neutral-700 text-neutral-200 hover:bg-neutral-800' : 'border-neutral-900 text-neutral-900 bg-white hover:bg-cream-200'
                }`}
              >
                Close Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileModalOpen(false)
                  handleSignOut()
                }}
                className="py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black transition-all border border-neutral-900 shadow-adjudo-sm cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Voice Assistant (Patient Accounts Only) */}
      {!isHospitalManagement && <VoiceAssistant />}
    </div>
  )
}
