import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AuthModal } from '../components/AuthModal'
import Logo, { EbMark } from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'

export default function Landing() {
  const { user, isAuthenticated, demoLogin, logout } = useAuth()
  const { isDark } = useTheme()
  const navigate = useNavigate()
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login')
  const [authModalPortal, setAuthModalPortal] = useState<'patient' | 'hospital_management'>('patient')

  const handleGetStarted = async (portal: 'patient' | 'hospital_management' = 'patient') => {
    if (isAuthenticated) {
      navigate('/audit')
    } else {
      await demoLogin(portal)
      navigate('/audit')
    }
  }

  const handleOpenAuth = (mode: 'login' | 'signup', portal: 'patient' | 'hospital_management' = 'patient') => {
    setAuthModalMode(mode)
    setAuthModalPortal(portal)
    setAuthModalOpen(true)
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 ${
      isDark ? 'bg-adjudo-dark text-neutral-100' : 'bg-cream-100 text-neutral-950'
    }`}>
      {/* Top Navbar */}
      <header className={`backdrop-blur-sm sticky top-0 z-40 border-b transition-colors duration-200 shadow-adjudo-sm ${
        isDark ? 'bg-adjudo-dark/95 border-neutral-800' : 'bg-cream-100/95 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Logo size="md" showText={true} subtext="Medical Evidence & Billing Audit" />
          </div>

            {/* Navigation & CTAs */}
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href="#how-it-works"
                className={`hidden md:inline-block text-xs font-black px-2.5 py-1.5 transition-colors ${
                  isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-800 hover:text-black'
                }`}
              >
                How It Works
              </a>
              <a
                href="#prescription-clarity"
                className={`hidden md:inline-block text-xs font-black px-2.5 py-1.5 transition-colors ${
                  isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-800 hover:text-black'
                }`}
              >
                Prescription Clarity
              </a>
              <Link
                to="/community"
                className={`hidden lg:inline-block text-xs font-black px-2.5 py-1.5 transition-colors ${
                  isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-800 hover:text-black'
                }`}
              >
                Community Stories
              </Link>
              <Link
                to="/hospitals"
                className={`hidden lg:inline-block text-xs font-black px-2.5 py-1.5 transition-colors ${
                  isDark ? 'text-neutral-300 hover:text-white' : 'text-neutral-800 hover:text-black'
                }`}
              >
                Hospital Finder
              </Link>

              {/* Theme Toggle in Landing Header */}
              <div className="flex-shrink-0">
                <ThemeToggle size="sm" />
              </div>

              {isAuthenticated && user ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={`px-2.5 py-1 rounded-xl text-xs font-black border shadow-adjudo-sm flex items-center gap-1.5 ${
                    user.portal === 'hospital_management'
                      ? isDark ? 'bg-orange-950/80 border-orange-800 text-orange-300' : 'bg-orange-100 border-neutral-900 text-orange-950'
                      : isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-200' : 'bg-white border-neutral-900 text-neutral-950'
                  }`}>
                    <span>{user.portal === 'hospital_management' ? '🏥' : '👤'}</span>
                    <span className="truncate max-w-[120px]">{user.name}</span>
                    <span className="text-[9px] uppercase px-1 py-0.2 rounded border border-neutral-900/30">
                      {user.portal === 'hospital_management' ? 'Hospital' : 'Patient'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/audit')}
                    className="px-3.5 py-1.5 text-xs font-black rounded-xl bg-orange-600 hover:bg-orange-700 text-white border border-neutral-900 shadow-adjudo-sm transition-all"
                  >
                    Open Workspace &rarr;
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      logout()
                      navigate('/')
                    }}
                    className={`text-xs font-black px-2.5 py-1.5 rounded-xl border border-neutral-900 shadow-adjudo-sm transition-all ${
                      isDark
                        ? 'text-rose-400 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-900/60 border-rose-800'
                        : 'text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border-neutral-900'
                    }`}
                    title="Sign Out"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenAuth('login', 'patient')}
                    className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl border border-neutral-900 bg-white hover:bg-cream-200 text-neutral-950 shadow-adjudo-sm transition-all cursor-pointer"
                    title="Sign in as Patient"
                  >
                    <span>👤</span>
                    <span>Patient Sign In</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenAuth('login', 'hospital_management')}
                    className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl border border-neutral-900 bg-orange-600 hover:bg-orange-700 text-white shadow-adjudo-sm transition-all cursor-pointer"
                    title="Sign in as Hospital Management"
                  >
                    <span>🏥</span>
                    <span>Hospital Mgmt</span>
                  </button>
                </div>
              )}
            </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className={`relative overflow-hidden pt-10 pb-16 sm:pt-14 sm:pb-20 border-b ${
        isDark
          ? 'bg-adjudo-dark border-neutral-800'
          : 'bg-cream-50 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Headline & Action */}
            <div className="lg:col-span-7 space-y-6">
              {/* Pill Banner */}
              <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-black shadow-adjudo-sm ${
                isDark
                  ? 'bg-neutral-900 border-neutral-700 text-orange-400'
                  : 'bg-cream-200 border-neutral-900 text-neutral-950'
              }`}>
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                <span>Local-First Clinical Audit &bull; Karnataka &amp; Pan-India Benchmarks &bull; Zero Data Leaks</span>
              </div>

              {/* Main Headline */}
              <h1 className={`text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.12] ${
                isDark ? 'text-white' : 'text-neutral-950'
              }`}>
                Audit hospital bills &amp; medical claims with{' '}
                <span className="text-orange-600 dark:text-orange-500">
                  total transparency.
                </span>
              </h1>

              {/* Subtitle */}
              <p className={`text-base sm:text-lg leading-relaxed max-w-2xl ${
                isDark ? 'text-neutral-300' : 'text-neutral-700'
              }`}>
                Cross-reference hospital bills, clinical notes, and prescriptions against authoritative medical guidelines (WHO, ICMR) and public pricing benchmarks (CGHS, PM-JAY). Every decision is backed by an inspectable 7-stage audit trail — no black boxes, no arbitrary denials.
              </p>

              {/* CTA Group */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleGetStarted('patient')}
                  className="adjudo-btn-dark px-6 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <span>👤 Audit as Patient</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleGetStarted('hospital_management')}
                  className="adjudo-btn-primary px-6 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <span>🏥 Hospital Management Desk</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/claims')}
                  className="adjudo-btn-secondary px-5 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Browse Audited Claims</span>
                </button>
              </div>

              {/* Trust Markers */}
              <div className="pt-4 border-t border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  <span>100% Local &amp; Private</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  <span>CGHS &amp; Indian Benchmarks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  <span>SHA-256 Tamper Proof</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  <span>Deterministic Safety</span>
                </div>
              </div>
            </div>

            {/* Right Column: Visual Showcase featuring Bill Review Photo */}
            <div className="lg:col-span-5 relative">
              <div className="relative rounded-2xl overflow-hidden border-2 border-neutral-900 shadow-adjudo-lg bg-white dark:bg-neutral-900 group">
                {/* Photo: Medical Bill Review in Clinical Setting */}
                <div className="relative overflow-hidden aspect-[4/3] bg-cream-100">
                  <img
                    src="/medical-bill-review.jpg"
                    alt="Healthcare advisor and patient reviewing an itemized hospital bill at clinic desk"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                    loading="eager"
                  />
                  {/* Subtle Gradient Scrim */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                  {/* Top Floating Badge */}
                  <div className="absolute top-3.5 left-3.5 bg-white/95 backdrop-blur-md px-3 py-1 rounded-full border border-neutral-900 shadow-adjudo-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span className="text-[11px] font-black text-neutral-950">Live Itemized Bill Review</span>
                  </div>

                  {/* Bottom Text Overlay */}
                  <div className="absolute bottom-3 left-3 right-3 text-white">
                    <div className="text-[11px] font-black text-orange-400 uppercase tracking-wider">
                      Transparent Verification
                    </div>
                    <div className="text-sm font-bold text-white mt-0.5 leading-snug">
                      Comparing hospital charges against public CGHS &amp; Indian market rates
                    </div>
                  </div>
                </div>

                {/* Floating Metric Callout Card */}
                <div className="p-4 bg-white dark:bg-neutral-900 border-t-2 border-neutral-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <span className="text-xs font-black text-neutral-950 dark:text-neutral-100">Saline Infusion Markup</span>
                    </div>
                    <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-neutral-900 shadow-adjudo-sm">
                      ⚠ 30.0× Anomaly
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-cream-100 dark:bg-neutral-800 p-2.5 rounded-xl border border-neutral-900 text-center">
                    <div>
                      <div className="text-[10px] uppercase font-black text-neutral-600 dark:text-neutral-400">Billed Charge</div>
                      <div className="text-base font-black font-mono text-rose-600 mt-0.5">₹1,800</div>
                    </div>
                    <div className="border-l border-neutral-900 dark:border-neutral-700">
                      <div className="text-[10px] uppercase font-black text-neutral-600 dark:text-neutral-400">CGHS / Market</div>
                      <div className="text-base font-black font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">₹30 – ₹60</div>
                    </div>
                  </div>

                  <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-normal font-medium">
                    Medically justified for acute fluid loss, but flagged for billing desk audit prior to payment.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Real Audit Card */}
          <div className="mt-14 max-w-4xl mx-auto bg-white dark:bg-adjudo-dark-surface rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo-lg overflow-hidden">
            <div className="bg-neutral-950 text-white p-4 sm:px-6 flex items-center justify-between border-b border-neutral-900">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full bg-rose-500 border border-neutral-900" />
                <span className="w-3 h-3 rounded-full bg-amber-500 border border-neutral-900" />
                <span className="w-3 h-3 rounded-full bg-emerald-500 border border-neutral-900" />
                <span className="text-xs font-mono font-bold text-neutral-300 ml-2">
                  Sample Audit Record &bull; Bengaluru General Care
                </span>
              </div>
              <span className="text-[11px] font-mono font-bold bg-neutral-900 border border-neutral-700 px-2.5 py-0.5 rounded text-neutral-300">
                SHA-256 Verified
              </span>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              {/* Claim Description */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 pb-6 border-b border-neutral-200 dark:border-neutral-800">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400">
                    Billed Hospital Item
                  </span>
                  <h3 className="text-lg font-black text-neutral-950 dark:text-white mt-0.5">
                    0.9% Sodium Chloride (Normal Saline) IV Solution, 1,000 mL Infusion Bag
                  </h3>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 font-medium">
                    Indication: Emergency department acute dehydration &bull; Bengaluru, Karnataka
                  </p>
                </div>

                <div className="text-right sm:self-start bg-cream-100 dark:bg-neutral-900 p-3.5 rounded-xl border border-neutral-900 shadow-adjudo-sm">
                  <div className="text-[10px] uppercase font-black text-neutral-600 dark:text-neutral-400">Billed Charge</div>
                  <div className="text-2xl font-black font-mono text-neutral-950 dark:text-white mt-0.5">₹1,800.00</div>
                  <div className="text-[10px] text-neutral-600 dark:text-neutral-400 font-bold">Benchmark: ₹30 – ₹60</div>
                </div>
              </div>

              {/* The Dual Decision Outcome */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Clinical Guideline Review */}
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-neutral-900 shadow-adjudo-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-black text-emerald-950 dark:text-emerald-300 uppercase tracking-wide">
                      1. Medical Guidelines
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-black bg-emerald-200 text-emerald-950 border border-neutral-900">
                      ✓ Supported
                    </span>
                  </div>
                  <p className="text-xs text-emerald-950 dark:text-emerald-200 leading-relaxed font-medium">
                    Normal saline is standard, essential clinical therapy for extracellular fluid replacement and acute dehydration under WHO &amp; ICMR guidelines.
                  </p>
                </div>

                {/* Price Benchmark Audit */}
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-neutral-900 shadow-adjudo-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-black text-amber-950 dark:text-amber-300 uppercase tracking-wide">
                      2. Price Benchmark Audit
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-black bg-amber-200 text-amber-950 border border-neutral-900">
                      ⚠ 30.0× Markup Anomaly
                    </span>
                  </div>
                  <p className="text-xs text-amber-950 dark:text-amber-200 leading-relaxed font-medium">
                    Typical hospital acquisition and supply benchmark is ₹30 to ₹60. The billed charge of ₹1,800.00 is an extreme markup requiring review.
                  </p>
                </div>
              </div>

              {/* Final Operational Decision Callout */}
              <div className="p-4 rounded-xl bg-neutral-950 text-white border border-neutral-900 shadow-adjudo flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center font-black text-lg border border-neutral-900 shadow-adjudo-sm flex-shrink-0">
                    !
                  </div>
                  <div>
                    <div className="text-xs font-black text-orange-400 uppercase tracking-wider">
                      Audit Policy Decision: Flag for Human Itemization Review
                    </div>
                    <div className="text-xs text-neutral-300 mt-0.5 font-medium">
                      Safety policy intervened: Flagged for extreme price markup despite medical necessity.
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleGetStarted('patient')}
                  className="px-5 py-2.5 text-xs font-black bg-orange-600 hover:bg-orange-700 text-white rounded-xl border border-neutral-900 shadow-adjudo-sm transition-all whitespace-nowrap cursor-pointer"
                >
                  Inspect Full 7-Stage Audit Graph &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Core Pillars Section */}
      <section className={`py-16 border-b transition-colors ${
        isDark ? 'bg-adjudo-dark border-neutral-800' : 'bg-cream-50 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-neutral-900 bg-cream-200 dark:bg-neutral-900 text-neutral-950 dark:text-orange-400 text-xs font-black shadow-adjudo-sm mb-3">
              <span>🛡️ Evidence &amp; Pricing Foundations</span>
            </div>
            <h2 className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-2">
              Why Healthcare Auditing Needs Transparency
            </h2>
            <p className={`text-2xl sm:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-neutral-950'}`}>
              Built to replace black-box automated denials with clear evidence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Pillar 1 */}
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-6 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-xl bg-cream-100 dark:bg-neutral-800 text-neutral-950 dark:text-neutral-100 border border-neutral-900 shadow-adjudo-sm flex items-center justify-center text-xl mb-4">
                  🩺
                </div>
                <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Evidence-Based Clinical Auditing
                </h3>
                <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                  No cryptic reason codes. Every audit cites authoritative excerpts from recognized medical organizations like WHO, ICMR, ADA, and ACR, clearly explaining clinical relevance and indication.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-orange-600 dark:text-orange-400 font-black">
                WHO &bull; ICMR &bull; ADA &bull; ACR
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-6 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-xl bg-cream-100 dark:bg-neutral-800 text-neutral-950 dark:text-neutral-100 border border-neutral-900 shadow-adjudo-sm flex items-center justify-center text-xl mb-4">
                  💰
                </div>
                <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Transparent Pricing &amp; Anomaly Detection
                </h3>
                <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                  Compares line items against CGHS rate lists and regional public benchmarks. Instantly flags 3×, 5×, and 30× markup anomalies on routine items like saline bags, syringes, and venipuncture.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-orange-600 dark:text-orange-400 font-black">
                CGHS &bull; PM-JAY &bull; Regional Karnataka Tariffs
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="bg-white dark:bg-neutral-900 rounded-2xl p-6 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-xl bg-cream-100 dark:bg-neutral-800 text-neutral-950 dark:text-neutral-100 border border-neutral-900 shadow-adjudo-sm flex items-center justify-center text-xl mb-4">
                  🛡️
                </div>
                <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Safe Refusals — We Never Guess
                </h3>
                <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                  When guidelines are missing or price benchmarks do not exist for high-cost experimental procedures, EvidenceBridge safely holds the claim for human review instead of hallucinating.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-orange-600 dark:text-orange-400 font-black">
                Abstention Gates &bull; Zero Hallucinations
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Prescription Guidance & Medication Clarity Spotlight (New visual feature) */}
      <section id="prescription-clarity" className={`py-20 border-b overflow-hidden transition-colors ${
        isDark ? 'bg-adjudo-dark-surface border-neutral-800' : 'bg-cream-100 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            {/* Left Column: Visual of Doctor / Pharmacist Prescription Guidance */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-2xl overflow-hidden border-2 border-neutral-900 shadow-adjudo-lg bg-white dark:bg-neutral-900 group">
                <img
                  src="/prescription-guidance.jpg"
                  alt="Doctor patiently explaining prescription schedule and generic medicines to patient"
                  className="w-full h-auto object-cover aspect-[4/3] group-hover:scale-105 transition-transform duration-700"
                  loading="lazy"
                />

                {/* Floating Prescription Clarity Pill */}
                <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-6 p-3.5 sm:p-4 rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border border-neutral-900 shadow-adjudo-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center text-xl flex-shrink-0 border border-neutral-900">
                    💊
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Prescription Schedule &amp; Generic Alternatives
                    </div>
                    <div className="text-[11px] text-neutral-600 dark:text-neutral-400 font-medium leading-tight mt-0.5">
                      Clear timings (Morning/Night, Before/After Food) and Jan Aushadhi generic equivalents.
                    </div>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-center sm:text-left text-xs text-neutral-600 dark:text-neutral-400 font-medium italic">
                Upload or capture any prescription photo to decode handwritten medicine names, instructions, and fair pricing.
              </p>
            </div>

            {/* Right Column: Prescription Features & Benefits */}
            <div className="lg:col-span-6 space-y-6">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-cream-200 dark:bg-neutral-900 text-neutral-950 dark:text-orange-400 border border-neutral-900 shadow-adjudo-sm mb-3">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Prescription &amp; Medication Intelligence
                </span>
                <h2 className={`text-2xl sm:text-4xl font-black tracking-tight leading-tight ${
                  isDark ? 'text-white' : 'text-neutral-950'
                }`}>
                  Clear medicine schedules you can follow with confidence.
                </h2>
                <p className={`mt-3 text-sm sm:text-base leading-relaxed font-medium ${
                  isDark ? 'text-neutral-300' : 'text-neutral-700'
                }`}>
                  Doctor prescriptions are often rushed or written in medical shorthand. EvidenceBridge transcribes your prescription, provides plain-language daily schedules, and checks whether affordable generic equivalents are available.
                </p>
              </div>

              <div className="space-y-3.5 pt-1">
                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    ⏰
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      When to Take Each Medicine
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      Instant breakdown of dosage timings: Morning, Noon, Night, Before Meals, or After Meals to avoid stomach irritation or missed doses.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-neutral-950 text-white flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    🏷️
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Generic Equivalents (Jan Aushadhi)
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      Identify exact molecule names and generic options that cost 60%–80% less than branded formulations for chronic conditions like diabetes and hypertension.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-amber-500 text-black flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    ⚠️
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Unnecessary Antibiotic Detection
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      Flags when broad-spectrum antibiotics are prescribed for routine viral coughs or colds, protecting you from antibiotic resistance and unnecessary expense.
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleGetStarted('patient')}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xs border border-neutral-900 shadow-adjudo transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Upload Prescription or Bill</span>
                  <span>&rarr;</span>
                </button>
                <Link
                  to="/community"
                  className="text-xs font-black text-orange-600 hover:text-orange-700 dark:text-orange-400 px-3 py-2 transition-colors"
                >
                  Read how patients saved on medicines &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Human-Centered Story & Patient Advocacy Spotlight */}
      <section className={`py-20 border-b overflow-hidden transition-colors ${
        isDark ? 'bg-adjudo-dark border-neutral-800' : 'bg-cream-50 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            {/* Left Column: Narrative & Values */}
            <div className="lg:col-span-6 space-y-6 order-2 lg:order-1">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-cream-200 dark:bg-neutral-900 text-neutral-950 dark:text-orange-400 border border-neutral-900 shadow-adjudo-sm mb-3">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Human-Centered Patient Advocacy
                </span>
                <h2 className={`text-2xl sm:text-4xl font-black tracking-tight leading-tight ${
                  isDark ? 'text-white' : 'text-neutral-950'
                }`}>
                  Healthcare bills you can actually understand and discuss.
                </h2>
                <p className={`mt-3 text-sm sm:text-base leading-relaxed font-medium ${
                  isDark ? 'text-neutral-300' : 'text-neutral-700'
                }`}>
                  Medical bills shouldn&apos;t feel like a foreign language or an unchallengeable demand. EvidenceBridge replaces confusing denial codes and opaque hospital charges with clear, evidence-based explanations.
                </p>
              </div>

              <div className="space-y-3.5 pt-1">
                {/* Benefit 1 */}
                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    ✓
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Plain-English Explanations, Not Bureaucratic Acronyms
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      See exactly why an IV bag, MRI scan, or medication was prescribed and how established clinical guidelines evaluate its medical indication.
                    </div>
                  </div>
                </div>

                {/* Benefit 2 */}
                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    ⚠
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Transparent Protection Against Extreme Markups
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      Identify when routine items like a saline bag are marked up 30× above public health benchmarks (₹1,800 vs ₹30–₹60).
                    </div>
                  </div>
                </div>

                {/* Benefit 3 */}
                <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-900 shadow-adjudo-sm">
                  <div className="w-8 h-8 rounded-lg bg-neutral-950 text-white flex items-center justify-center font-black text-sm flex-shrink-0 mt-0.5 border border-neutral-900">
                    🤝
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Constructive, Evidence-Backed Dialogue
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed font-medium">
                      Equip patients, hospital billing desks, and insurance reviewers with objective, reproducible audit reports so discussions remain respectful and fact-based.
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleGetStarted('patient')}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-neutral-950 hover:bg-black text-white font-black text-xs border border-neutral-900 shadow-adjudo transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Audit a Bill with EvidenceBridge</span>
                  <span>&rarr;</span>
                </button>
                <a
                  href="#sample-scenarios"
                  className="text-xs font-black text-orange-600 hover:text-orange-700 dark:text-orange-400 px-3 py-2 transition-colors"
                >
                  Explore real benchmark examples &darr;
                </a>
              </div>
            </div>

            {/* Right Column: Doctor-Patient Image Card */}
            <div className="lg:col-span-6 relative order-1 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden border-2 border-neutral-900 shadow-adjudo-lg bg-white dark:bg-neutral-900 group">
                <img
                  src="/doctor-patient.jpg"
                  alt="Doctor showing healthcare brochure to patient during consultation"
                  className="w-full h-auto object-cover aspect-[4/3] group-hover:scale-105 transition-transform duration-700"
                  loading="lazy"
                />

                {/* Floating Trust Overlay Card */}
                <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-6 p-3.5 sm:p-4 rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border border-neutral-900 shadow-adjudo-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center text-xl flex-shrink-0 border border-neutral-900">
                    🤝
                  </div>
                  <div>
                    <div className="text-xs font-black text-neutral-950 dark:text-white">
                      Patient Advocacy &amp; Fact-Based Reviews
                    </div>
                    <div className="text-[11px] text-neutral-600 dark:text-neutral-400 font-medium leading-tight mt-0.5">
                      Citing medical guidelines and regional fair prices so patients can understand their care.
                    </div>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-center sm:text-left text-xs text-neutral-600 dark:text-neutral-400 font-medium italic">
                EvidenceBridge helps patients and clinical reviewers verify that every charge is medically sound and reasonably priced.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Community Stories & Regional Trust Spotlight */}
      <section className={`py-16 border-b transition-colors ${
        isDark ? 'bg-adjudo-dark-surface border-neutral-800' : 'bg-cream-100 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
            <div>
              <span className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400">
                Patient Voices Across Karnataka
              </span>
              <h2 className={`text-2xl sm:text-3xl font-black tracking-tight mt-1 ${
                isDark ? 'text-white' : 'text-neutral-950'
              }`}>
                Real recovery stories &amp; hospital billing experiences
              </h2>
              <p className={`text-xs sm:text-sm mt-1 max-w-2xl font-medium ${
                isDark ? 'text-neutral-300' : 'text-neutral-700'
              }`}>
                Read how patients and families across Bengaluru, Mysuru, Hubli, Davangere, and Ballari navigated unexpected hospital charges and prescription schedules.
              </p>
            </div>
            <Link
              to="/community"
              className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 hover:text-orange-700 dark:text-orange-400 flex-shrink-0"
            >
              <span>View all 8 Community Stories &rarr;</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Story Teaser 1 */}
            <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between hover:translate-y-[-2px] transition-transform">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-neutral-900">
                    Billing Dispute
                  </span>
                  <span className="text-[11px] text-neutral-500 font-bold">📍 Bengaluru</span>
                </div>
                <h4 className={`text-sm font-black mb-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Challenged a ₹1,800 Saline Charge in Whitefield
                </h4>
                <p className={`text-xs line-clamp-3 leading-relaxed font-medium ${
                  isDark ? 'text-neutral-300' : 'text-neutral-700'
                }`}>
                  My father was admitted for acute food poisoning. When I reviewed the itemized bill, they had charged ₹1,800 for two normal saline bottles (MRP ₹45 each). I requested an itemized reconciliation at the billing desk and they corrected it to ₹90.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
                <span className="text-neutral-500 font-medium">By Rajesh M. (Engineer)</span>
                <span className="font-mono font-black text-emerald-700 dark:text-emerald-400">Saved ₹1,710</span>
              </div>
            </div>

            {/* Story Teaser 2 */}
            <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between hover:translate-y-[-2px] transition-transform">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-950 border border-neutral-900">
                    Prescription Clarity
                  </span>
                  <span className="text-[11px] text-neutral-500 font-bold">📍 Mysuru</span>
                </div>
                <h4 className={`text-sm font-black mb-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Decoded Handwritten Diabetic Prescriptions
                </h4>
                <p className={`text-xs line-clamp-3 leading-relaxed font-medium ${
                  isDark ? 'text-neutral-300' : 'text-neutral-700'
                }`}>
                  My mother takes 5 different daily tablets. The doctor’s slip was completely unreadable and she took Metformin on an empty stomach. Getting the exact morning/night schedule and Jan Aushadhi generic equivalents reduced her monthly cost from ₹1,400 to ₹320.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
                <span className="text-neutral-500 font-medium">By Sunitha R. (Teacher)</span>
                <span className="font-mono font-black text-emerald-700 dark:text-emerald-400">Saved ₹1,080/mo</span>
              </div>
            </div>

            {/* Story Teaser 3 */}
            <div className="bg-white dark:bg-neutral-900 p-5 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo flex flex-col justify-between hover:translate-y-[-2px] transition-transform">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-neutral-900">
                    Transparent Pricing
                  </span>
                  <span className="text-[11px] text-neutral-500 font-bold">📍 Davangere</span>
                </div>
                <h4 className={`text-sm font-black mb-2 ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  Normal Delivery Package With No Hidden Surcharges
                </h4>
                <p className={`text-xs line-clamp-3 leading-relaxed font-medium ${
                  isDark ? 'text-neutral-300' : 'text-neutral-700'
                }`}>
                  We opted for a mother and child hospital near MCC B Block that published clear package tariffs (₹28,000 all-inclusive for normal delivery). Every item from nursing to nursery charges matched the quotation perfectly.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
                <span className="text-neutral-500 font-medium">By Deepa &amp; Santosh</span>
                <span className="font-mono font-black text-orange-600 dark:text-orange-400">100% Transparent</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className={`py-16 border-b transition-colors ${
        isDark ? 'bg-adjudo-dark border-neutral-800' : 'bg-cream-50 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-2">
              Simple 3-Step Verification
            </h2>
            <p className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isDark ? 'text-white' : 'text-neutral-950'
            }`}>
              From raw hospital bill to verifiable decision.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo relative">
              <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 bg-orange-600 text-white border border-neutral-900 shadow-adjudo-sm mb-3">
                1
              </div>
              <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Paste Text or Upload Photo</h3>
              <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                Provide a raw clinical note, hospital bill line, or take a picture with OCR text extraction. The system calculates an immutable SHA-256 digital fingerprint to prevent tampering.
              </p>
            </div>

            <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo relative">
              <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 bg-neutral-950 text-white border border-neutral-900 shadow-adjudo-sm mb-3">
                2
              </div>
              <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Hybrid Evidence &amp; Price Match</h3>
              <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                Local-first AI and BM25 search evaluate authoritative guidelines and check billed charges against standard CGHS, PM-JAY, and regional Karnataka price schedules.
              </p>
            </div>

            <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo relative">
              <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 bg-emerald-600 text-white border border-neutral-900 shadow-adjudo-sm mb-3">
                3
              </div>
              <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Inspect the 7-Stage Audit Graph</h3>
              <p className={`text-xs mt-2 leading-relaxed font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                Review the step-by-step decision trail: extraction, provenance, evidence retrieval, cost audit, clinical judgment, safety gates, and final action.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Real-World Controlled Cases Showcase */}
      <section id="sample-scenarios" className={`py-16 border-b transition-colors ${
        isDark ? 'bg-adjudo-dark-surface border-neutral-800' : 'bg-cream-100 border-neutral-900/80'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-2">
              Tested Against Real Clinical Benchmarks
            </h2>
            <p className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isDark ? 'text-white' : 'text-neutral-950'
            }`}>
              Pre-built scenarios ready to audit in one click.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo transition-transform hover:translate-y-[-2px]">
              <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-950 border border-neutral-900 mb-2">
                ACCEPT &bull; Supported
              </span>
              <h4 className={`text-xs font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Type 2 Diabetes Metformin</h4>
              <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                30-day generic supply (₹75.00) matching ICMR first-line standards.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo transition-transform hover:translate-y-[-2px]">
              <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-950 border border-neutral-900 mb-2">
                ACCEPT &bull; Supported
              </span>
              <h4 className={`text-xs font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Brain MRI (CPT 70551)</h4>
              <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                Neurological trauma scan (₹5,500 regional diagnostic fee).
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo transition-transform hover:translate-y-[-2px]">
              <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-950 border border-neutral-900 mb-2">
                FLAG &bull; 30× Markup
              </span>
              <h4 className={`text-xs font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Normal Saline IV Overcharge</h4>
              <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                ₹1,800 billed for commodity saline (typical benchmark ₹30–₹60).
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border-2 border-neutral-900 dark:border-neutral-700 shadow-adjudo transition-transform hover:translate-y-[-2px]">
              <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-950 border border-neutral-900 mb-2">
                FLAG &bull; Contradicted
              </span>
              <h4 className={`text-xs font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>Antibiotics for Viral Coryza</h4>
              <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                Azithromycin (₹450) prescribed for mild cold against ICMR guidelines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action Banner */}
      <section className="py-16 bg-neutral-950 text-white text-center border-b-2 border-neutral-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Ready to audit medical claims with verifiable clinical integrity?
          </h2>
          <p className="mt-3 text-sm text-neutral-300 max-w-xl mx-auto font-medium">
            Run the local-first engine on your machine. Zero cloud accounts required.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => handleGetStarted('patient')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black text-sm border border-neutral-900 shadow-adjudo transition-all cursor-pointer"
            >
              Launch Auditor Workspace &rarr;
            </button>
            <Link
              to="/hospitals"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-white hover:bg-cream-200 text-neutral-950 font-black text-sm border border-neutral-900 shadow-adjudo transition-all cursor-pointer"
            >
              Explore Karnataka Hospitals
            </Link>
          </div>
        </div>
      </section>

      {/* Modern Medical Footer */}
      <footer className="bg-neutral-950 text-neutral-400 py-12 border-t-2 border-neutral-900 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-neutral-800">
            {/* Column 1: Brand */}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center gap-2.5">
                <EbMark size={24} />
                <span className="font-black text-white text-base">EvidenceBridge</span>
              </div>
              <p className="text-xs text-neutral-400 max-w-md leading-relaxed font-medium">
                Healthcare Evidence Auditing &amp; Price Anomaly Engine. Empowering patients, hospital administrators, and reviewers with verifiable clinical evidence and fair regional pricing benchmarks.
              </p>
              <div className="text-[11px] text-neutral-500 font-mono">
                Built for Karnataka &bull; Bengaluru &bull; Ballari &bull; Mysuru &bull; Davangere &bull; Hubli &bull; Mangaluru &bull; Belagavi
              </div>
            </div>

            {/* Column 2: Navigation */}
            <div>
              <div className="text-white font-black mb-3 uppercase tracking-wider text-[11px]">
                Features &amp; Tools
              </div>
              <ul className="space-y-2 text-xs font-bold">
                <li>
                  <button type="button" onClick={() => handleGetStarted('patient')} className="hover:text-white transition-colors cursor-pointer">
                    Audit Claim &amp; Bill
                  </button>
                </li>
                <li>
                  <Link to="/claims" className="hover:text-white transition-colors">
                    Claims History Explorer
                  </Link>
                </li>
                <li>
                  <Link to="/hospitals" className="hover:text-white transition-colors">
                    Hospital Finder &amp; Fees
                  </Link>
                </li>
                <li>
                  <Link to="/trust-density" className="hover:text-white transition-colors">
                    Regional Trust Scores
                  </Link>
                </li>
                <li>
                  <Link to="/insights" className="hover:text-white transition-colors">
                    Audit Insights &amp; Analytics
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Community & Safety */}
            <div>
              <div className="text-white font-black mb-3 uppercase tracking-wider text-[11px]">
                Community &amp; Ethics
              </div>
              <ul className="space-y-2 text-xs font-bold">
                <li>
                  <Link to="/community" className="hover:text-white transition-colors">
                    Patient Recovery Stories
                  </Link>
                </li>
                <li>
                  <Link to="/evaluation" className="hover:text-white transition-colors">
                    7-Stage Audit Benchmark Runs
                  </Link>
                </li>
                <li>
                  <span className="text-neutral-500">WHO &amp; ICMR Aligned</span>
                </li>
                <li>
                  <span className="text-neutral-500">CGHS / PM-JAY Rate Index</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-[11px] text-neutral-500 font-medium">
            <div>
              &copy; {new Date().getFullYear()} EvidenceBridge. Open-source under Apache-2.0.
            </div>
            <div className="text-center sm:text-right">
              Informational &amp; auditing tool only. Not a substitute for formal medical advice.
            </div>
          </div>
        </div>
      </footer>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authModalMode}
        initialPortal={authModalPortal}
        onSuccess={() => navigate('/audit')}
      />
    </div>
  )
}
