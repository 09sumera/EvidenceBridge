import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Claim, VerificationResult } from '../types'
import { ClaimCard } from '../components/ClaimCard'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { getUserClaims, getUserVerifications } from '../services/userDataStore'

export default function Claims() {
  const { user } = useAuth()
  const { isDark } = useTheme()
  const [claims, setClaims] = useState<Claim[]>([])
  const [verifications, setVerifications] = useState<Record<string, VerificationResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  // Filter state
  const [actionFilter, setActionFilter] = useState<'all' | 'accept' | 'flag' | 'abstain'>('all')
  const [anomalyOnly, setAnomalyOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [locationQuery, setLocationQuery] = useState('')

  const activeEmail = user?.email || 'ramesh.kumar@patient.local'
  const isHospital = user?.portal === 'hospital_management'

  const loadClaims = () => {
    setLoading(true)
    setError(null)
    try {
      const userClaims = getUserClaims(activeEmail)
      const userVerifs = getUserVerifications(activeEmail)
      setClaims(userClaims)
      setVerifications(userVerifs)
      setTotal(userClaims.length)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load claims.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClaims()
  }, [activeEmail])

  // Client-side filtering for action, anomaly, location, and free text search
  const filteredClaims = claims.filter((c) => {
    const v = verifications[c.claim_id]

    if (actionFilter !== 'all') {
      if (!v || v.action.toLowerCase() !== actionFilter) {
        return false
      }
    }

    if (anomalyOnly) {
      if (!v || !v.cost_anomaly_flag) {
        return false
      }
    }

    if (locationQuery.trim()) {
      const loc = locationQuery.trim().toLowerCase()
      const cLoc = `${c.location?.city || ''} ${c.location?.state_or_region || ''} ${c.extracted_fields?.location_city || ''}`.toLowerCase()
      if (!cLoc.includes(loc)) {
        return false
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const entity = (c.extracted_fields?.entity || '').toLowerCase()
      const text = c.original_text.toLowerCase()
      const outcome = (c.extracted_fields?.effect_or_outcome || '').toLowerCase()
      const provider = ((c.extracted_fields as Record<string, any>)?.provider_name || '').toLowerCase()
      if (!entity.includes(q) && !text.includes(q) && !outcome.includes(q) && !provider.includes(q)) {
        return false
      }
    }

    return true
  })

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className={`rounded-2xl border p-6 sm:p-7 shadow-adjudo transition-all ${
        isDark ? 'bg-adjudo-dark-surface border-neutral-700' : 'bg-white border-neutral-900'
      }`}>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${
                isHospital
                  ? isDark
                    ? 'bg-orange-950/70 border-orange-800 text-orange-300'
                    : 'bg-orange-100 border-neutral-900 text-orange-950'
                  : isDark
                  ? 'bg-neutral-800 border-neutral-700 text-neutral-200'
                  : 'bg-cream-200 border-neutral-900 text-neutral-950'
              }`}>
                <span>{isHospital ? '🏥' : '👤'}</span>
                <span>{isHospital ? 'Hospital Management Portal' : 'Patient Claims Vault'}</span>
              </span>

              <span className={`text-[11px] px-2 py-0.5 rounded-md border font-mono ${
                isDark ? 'bg-neutral-900 border-neutral-700 text-neutral-300' : 'bg-cream-50 border-neutral-900/60 text-neutral-700'
              }`}>
                Data isolated to: <span className="font-bold">{activeEmail}</span>
              </span>
            </div>

            <h1 className={`text-2xl sm:text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-neutral-950'}`}>
              {isHospital ? 'Provider Claims & Billing Desk Queue' : 'My Personal Medical Claims & Bills'}
            </h1>
            <p className={`text-xs sm:text-sm mt-1 max-w-xl leading-relaxed ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {isHospital
                ? `Hospital claim review queue, benchmark markups, and billing discrepancy audits for ${user?.organization || 'your healthcare facility'}.`
                : `All medical claims, hospital invoices, and prescription audits belonging strictly to ${user?.name || 'your patient account'}.`}
            </p>
          </div>

          <div className="flex items-center gap-3 self-start">
            <div className={`text-right px-4 py-3 rounded-xl border border-neutral-900 shadow-adjudo-sm ${
              isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-cream-50'
            }`}>
              <span className={`text-[10px] uppercase font-black block ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>Personal Records</span>
              <span className={`text-xl font-black font-mono ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                {total} Claim{total === 1 ? '' : 's'}
              </span>
            </div>

            <Link
              to="/audit"
              className="adjudo-btn-primary px-4 py-2.5 rounded-xl text-xs font-black shadow-adjudo-sm flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <span>+</span>
              <span>Audit New Bill</span>
            </Link>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className={`flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pt-5 border-t ${
          isDark ? 'border-slate-800' : 'border-slate-100'
        }`}>
          {/* Action Filter Pills */}
          <div className={`flex items-center gap-1.5 p-1 rounded-xl flex-wrap border ${
            isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100/80 border-slate-200/80'
          }`}>
            <button
              type="button"
              onClick={() => setActionFilter('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                actionFilter === 'all'
                  ? isDark
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'bg-white text-slate-900 shadow-sm'
                  : isDark
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Claims ({claims.length})
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('accept')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                actionFilter === 'accept'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : isDark
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✓ Approved
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('flag')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                actionFilter === 'flag'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : isDark
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ! Flagged for Review
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('abstain')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                actionFilter === 'abstain'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : isDark
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⏸ Held for Info
            </button>
          </div>

          {/* Search Inputs */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className={`inline-flex items-center gap-2 text-xs font-bold cursor-pointer select-none px-3 py-2 rounded-lg border ${
              isDark ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-50 text-slate-700 border-slate-200'
            }`}>
              <input
                type="checkbox"
                checked={anomalyOnly}
                onChange={(e) => setAnomalyOnly(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300"
              />
              <span>Price Alerts Only</span>
            </label>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by diagnosis or treatment..."
              className={`px-3.5 py-2 rounded-xl border text-xs w-48 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
              }`}
            />

            <input
              type="text"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="City (e.g. Davangere)"
              className={`px-3 py-2 rounded-xl border text-xs w-36 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div>
            <div className="font-bold">Could not load claims</div>
            <div className="text-xs text-rose-700 mt-0.5">{error}</div>
          </div>
          <button
            type="button"
            onClick={loadClaims}
            className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs whitespace-nowrap transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`rounded-2xl border p-6 animate-pulse space-y-3 ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
              <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-2/3" />
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredClaims.length === 0 ? (
        <div className={`rounded-2xl border p-12 text-center shadow-card transition-colors ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className="text-4xl mb-3">{isHospital ? '🏥' : '📋'}</div>
          <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-800'}`}>
            {claims.length === 0
              ? isHospital
                ? 'No Hospital Claims in Queue'
                : 'No Personal Medical Claims Audited Yet'
              : 'No Matching Claims Found'}
          </h3>
          <p className={`text-xs mt-1.5 max-w-md mx-auto leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {claims.length === 0
              ? isHospital
                ? `The review queue for ${activeEmail} is currently clear. Run an itemized audit or upload an inpatient charge sheet to evaluate pricing anomalies.`
                : `You haven't audited any hospital bills under ${activeEmail} yet. Upload an invoice or take a photo of your medical bill to verify charges against public benchmarks.`
              : 'No claims match your current filter settings. Try clearing the search or status filters.'}
          </p>
          <div className="mt-5">
            <Link
              to="/audit"
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-xs font-bold transition-all shadow-sm ${
                isHospital ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-sky-600 hover:bg-sky-700'
              }`}
            >
              <span>+ Audit a Bill Now</span>
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      ) : (
        /* Claims List */
        <div className="space-y-4">
          {filteredClaims.map((claim) => (
            <ClaimCard
              key={claim.claim_id}
              claim={claim}
              verification={verifications[claim.claim_id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
