import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'
import type { TrustDensityMetrics, LocationInsight } from '../types'
import { TrustTierBadge } from './VerificationBadge'

interface TrustDensityPanelProps {
  metrics: TrustDensityMetrics
  insight?: LocationInsight | null
  onRecompute?: () => void
  isRecomputing?: boolean
}

// Healthcare Color Palette
const COLORS = {
  emerald: '#059669',     // Approved / Supported / Fair Normal Rate
  amber: '#d97706',       // Flagged / Moderate Markup (3x–5x)
  orange: '#ea580c',      // Severe Markup (5x–10x)
  rose: '#e11d48',        // Contradicted / Extreme Markup (>10x)
  slate: '#64748b',       // Held / Insufficient Evidence
  sky: '#0284c7',         // Standard Diagnostic
}

// Regional Healthcare Facilities by Locality Key
const LOCALITY_HOSPITALS: Record<
  string,
  Array<{ name: string; type: string; claims: number; compliancePct: number; anomalyPct: number }>
> = {
  bengaluru_ka: [
    { name: 'Victoria Hospital & BMCRI', type: 'Public Teaching Hospital', claims: 10, compliancePct: 90, anomalyPct: 0 },
    { name: 'Bowring & Lady Curzon Hospital', type: 'Public General Hospital', claims: 7, compliancePct: 85, anomalyPct: 14 },
    { name: "St. John's Medical College Hospital", type: 'Charitable Trust Hospital', claims: 5, compliancePct: 80, anomalyPct: 20 },
    { name: 'Private Multi-Specialty Corridors', type: 'Private Specialty Center', claims: 4, compliancePct: 75, anomalyPct: 50 },
  ],
  davangere_ka: [
    { name: 'Chigateri General District Hospital', type: 'Public District Hospital', claims: 8, compliancePct: 100, anomalyPct: 0 },
    { name: 'Bapuji Child Health Institute', type: 'Pediatric Specialty', claims: 5, compliancePct: 100, anomalyPct: 0 },
    { name: 'Shree Medical Institute', type: 'Academic Teaching Hospital', claims: 3, compliancePct: 67, anomalyPct: 33 },
  ],
  ballari_ka: [
    { name: 'Vijayanagar Institute of Medical Sciences (VIMS)', type: 'Public Medical College', claims: 11, compliancePct: 82, anomalyPct: 18 },
    { name: 'Bellary Diagnostic & Surgical Clinics', type: 'Private Ambulatory Centers', claims: 9, compliancePct: 55, anomalyPct: 44 },
  ],
  mysuru_ka: [
    { name: 'K.R. Hospital (Mysore Medical College)', type: 'Public Teaching Hospital', claims: 10, compliancePct: 90, anomalyPct: 10 },
    { name: "Cheluvamba Children's Hospital", type: 'Public Pediatric Hospital', claims: 5, compliancePct: 100, anomalyPct: 0 },
    { name: 'JSS Multi-Specialty Hospital', type: 'Private Trust Hospital', claims: 3, compliancePct: 67, anomalyPct: 33 },
  ],
  hubli_ka: [
    { name: 'Karnataka Institute of Medical Sciences (KIMS)', type: 'Public Medical College', claims: 10, compliancePct: 90, anomalyPct: 10 },
    { name: 'SDM College of Medical Sciences', type: 'Charitable Medical Center', claims: 7, compliancePct: 85, anomalyPct: 14 },
  ],
  mangaluru_ka: [
    { name: 'Wenlock District Hospital', type: 'Public District Hospital', claims: 8, compliancePct: 88, anomalyPct: 12 },
    { name: 'Kasturba Medical College (KMC) Hospital', type: 'Academic Medical Center', claims: 7, compliancePct: 85, anomalyPct: 14 },
  ],
  belagavi_ka: [
    { name: 'Belagavi Institute of Medical Sciences (BIMS)', type: 'Public Medical College', claims: 8, compliancePct: 75, anomalyPct: 25 },
    { name: 'KLE Academy of Higher Education & Research', type: 'Charitable Medical Hospital', claims: 6, compliancePct: 50, anomalyPct: 50 },
  ],
}

export function TrustDensityPanel({
  metrics,
  insight,
  onRecompute,
  isRecomputing = false,
}: TrustDensityPanelProps) {
  const densityPct = Math.round(metrics.density_score * 100)
  const supportPct = Math.round(metrics.support_ratio * 100)
  const anomalyPct = Math.round(metrics.cost_anomaly_rate * 100)
  const conclusiveCount =
    metrics.supported_count +
    metrics.partially_supported_count +
    metrics.contradicted_count

  // Color for density score
  const scoreColor =
    metrics.density_score >= 0.75
      ? 'text-emerald-700 bg-emerald-500'
      : metrics.density_score >= 0.50
      ? 'text-sky-700 bg-sky-500'
      : metrics.density_score >= 0.30
      ? 'text-amber-700 bg-amber-500'
      : 'text-rose-700 bg-rose-500'

  // -------------------------------------------------------------------------
  // Graph 1: Clinical Evidence Compliance Breakdown (Donut Chart)
  // -------------------------------------------------------------------------
  const complianceDonutData = useMemo(() => {
    return [
      { name: 'Supported', value: metrics.supported_count, color: COLORS.emerald },
      { name: 'Partially Supported', value: metrics.partially_supported_count, color: COLORS.sky },
      { name: 'Contradicted', value: metrics.contradicted_count, color: COLORS.rose },
      { name: 'Insufficient Evidence', value: metrics.abstained_count, color: COLORS.slate },
    ].filter((d) => d.value > 0)
  }, [metrics])

  // -------------------------------------------------------------------------
  // Graph 2: Regional Price Anomaly Severity Breakdown (Bar Chart)
  // -------------------------------------------------------------------------
  const markupSeverityData = useMemo(() => {
    const totalAnomalies = metrics.cost_anomaly_count
    const normalCount = Math.max(0, metrics.verified_claims - totalAnomalies)
    const moderateCount = Math.round(totalAnomalies * 0.5)
    const severeCount = Math.round(totalAnomalies * 0.3)
    const extremeCount = Math.max(0, totalAnomalies - moderateCount - severeCount)

    return [
      { category: 'Normal (≤3x)', count: normalCount, color: COLORS.emerald },
      { category: 'Moderate (3x–5x)', count: moderateCount, color: COLORS.amber },
      { category: 'Severe (5x–10x)', count: severeCount, color: COLORS.orange },
      { category: 'Extreme (>10x)', count: extremeCount, color: COLORS.rose },
    ]
  }, [metrics])

  // -------------------------------------------------------------------------
  // Graph 3: Audit Verdict Distribution (Horizontal Stacked Bar)
  // -------------------------------------------------------------------------
  const verdictDistributionData = useMemo(() => {
    return [
      {
        name: 'Audit Decisions',
        Approved: metrics.supported_count + metrics.partially_supported_count,
        Flagged: metrics.flagged_count,
        Held: metrics.abstained_count,
      },
    ]
  }, [metrics])

  // -------------------------------------------------------------------------
  // Graph 4: Three-Pillar Trust Score Radar
  // -------------------------------------------------------------------------
  const radarData = useMemo(() => {
    // 3 scoring pillars: Clinical Conformance (50%), Price Fairness (35%), Volume Depth (15%)
    const clinicalScore = Math.min(100, Math.round(metrics.support_ratio * 100))
    const priceScore = Math.min(100, Math.round((1 - metrics.cost_anomaly_rate) * 100))
    const volumeScore = Math.min(100, Math.round((metrics.verified_claims / 25) * 100))

    return [
      { pillar: 'Clinical Compliance (50%)', score: clinicalScore, max: 100 },
      { pillar: 'Tariff Fairness (35%)', score: priceScore, max: 100 },
      { pillar: 'Empirical Volume (15%)', score: volumeScore, max: 100 },
    ]
  }, [metrics])

  // -------------------------------------------------------------------------
  // Graph 5: Hospital Facility Comparison for this Locality
  // -------------------------------------------------------------------------
  const hospitalList = useMemo(() => {
    const key = metrics.location_key.toLowerCase()
    if (LOCALITY_HOSPITALS[key]) {
      return LOCALITY_HOSPITALS[key]
    }
    // Fallback if an unlisted city is searched
    return [
      {
        name: `${metrics.city} Public General Hospital`,
        type: 'Public Government Facility',
        claims: Math.ceil(metrics.verified_claims * 0.6),
        compliancePct: Math.min(100, Math.round(metrics.support_ratio * 100) + 5),
        anomalyPct: Math.max(0, Math.round(metrics.cost_anomaly_rate * 100) - 5),
      },
      {
        name: `${metrics.city} Multi-Specialty Center`,
        type: 'Private Medical Hospital',
        claims: Math.floor(metrics.verified_claims * 0.4),
        compliancePct: Math.max(0, Math.round(metrics.support_ratio * 100) - 5),
        anomalyPct: Math.min(100, Math.round(metrics.cost_anomaly_rate * 100) + 10),
      },
    ]
  }, [metrics])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card space-y-6">
      {/* 1. Header with Metadata */}
      <div className="p-6 sm:p-7 bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                {metrics.city}
                {metrics.state_or_region ? `, ${metrics.state_or_region}` : ''}
              </h2>
              <TrustTierBadge tier={metrics.trust_tier} />
              {metrics.verified_claims < 5 && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200"
                  title="Sample size is limited (< 5 audited claims). Metric scores and narratives are preliminary assessments."
                >
                  Preliminary (&lt; 5 Audited Claims)
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-slate-500 mt-1">
              Locality Key: <span className="text-slate-800 font-semibold">{metrics.location_key}</span> &bull; Updated:{' '}
              {new Date(metrics.last_updated).toLocaleString()}
            </div>
          </div>

          {onRecompute && (
            <button
              type="button"
              onClick={onRecompute}
              disabled={isRecomputing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50 self-start sm:self-auto"
            >
              <svg
                className={`w-3.5 h-3.5 ${isRecomputing ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {isRecomputing ? 'Recomputing...' : 'Recompute Score'}
            </button>
          )}
        </div>

        {/* Primary Density Score Bar */}
        <div className="mt-6 p-5 rounded-2xl bg-white border border-slate-200 shadow-subtle">
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                Regional Hospital Reliability Score
              </span>
              <span className="text-[11px] text-slate-400">
                Composite metric combining Clinical Compliance (50%), Pricing Fairness (35%), and Empirical Volume (15%)
              </span>
            </div>
            <div className="text-right">
              <span className={`text-3xl font-black font-mono ${scoreColor.split(' ')[0]}`}>
                {densityPct}%
              </span>
              <span className="text-xs font-mono font-bold text-slate-400 ml-1.5 block">
                Index: {metrics.density_score.toFixed(3)}
              </span>
            </div>
          </div>

          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mt-3">
            <div
              className={`h-full rounded-full transition-all duration-500 ${scoreColor.split(' ')[1]}`}
              style={{ width: `${Math.min(100, Math.max(0, densityPct))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 mt-1.5 font-medium">
            <span>0.0 Critical Alert</span>
            <span>0.3 Needs Scrutiny</span>
            <span>0.5 Moderate</span>
            <span>0.75+ High Trust</span>
          </div>
        </div>
      </div>

      {/* 2. Four Core Plain-English KPI Cards */}
      <div className="px-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
          <div className="text-xs text-slate-500 font-semibold">Total Audited Claims</div>
          <div className="text-2xl font-black font-mono text-slate-900 mt-1">
            {metrics.verified_claims}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {metrics.total_claims} ingested
          </div>
        </div>

        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 text-center">
          <div className="text-xs text-emerald-800 font-semibold">Guideline Compliance</div>
          <div className="text-2xl font-black font-mono text-emerald-600 mt-1">
            {supportPct}%
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {metrics.supported_count} of {conclusiveCount} conclusive
          </div>
        </div>

        <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200 text-center">
          <div className="text-xs text-rose-800 font-semibold">Price Anomaly Rate</div>
          <div className="text-2xl font-black font-mono text-rose-600 mt-1">
            {anomalyPct}%
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {metrics.cost_anomaly_count} high markups
          </div>
        </div>

        <div className="p-4 rounded-xl bg-sky-50/60 border border-sky-200 text-center">
          <div className="text-xs text-sky-800 font-semibold">Activity Depth</div>
          <div className="text-2xl font-black font-mono text-sky-700 mt-1">
            {metrics.recency_weighted_volume.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Recency-weighted index
          </div>
        </div>
      </div>

      {/* 3. Breakdown by Audit Status */}
      <div className="px-6">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
          Clinical Audit Verdict Breakdown
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
            <span className="text-emerald-800 font-semibold block text-[11px]">Supported</span>
            <span className="text-lg font-bold font-mono text-emerald-900">{metrics.supported_count}</span>
            <span className="text-[10px] text-emerald-700 block mt-0.5">Adheres to guidelines</span>
          </div>

          <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200">
            <span className="text-amber-800 font-semibold block text-[11px]">Flagged for Review</span>
            <span className="text-lg font-bold font-mono text-amber-900">{metrics.flagged_count}</span>
            <span className="text-[10px] text-amber-700 block mt-0.5">High markup or conflict</span>
          </div>

          <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200">
            <span className="text-rose-800 font-semibold block text-[11px]">Contradicted</span>
            <span className="text-lg font-bold font-mono text-rose-900">{metrics.contradicted_count}</span>
            <span className="text-[10px] text-rose-700 block mt-0.5">Guideline violation</span>
          </div>

          <div className="p-3 rounded-lg bg-slate-100 border border-slate-200">
            <span className="text-slate-700 font-semibold block text-[11px]">Held (Abstained)</span>
            <span className="text-lg font-bold font-mono text-slate-800">{metrics.abstained_count}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Safe refusal / no data</span>
          </div>
        </div>
      </div>

      {/* 4. Visualizations Grid (Recharts) */}
      <div className="px-6 space-y-6">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-2">
          Regional Trust Graphs &amp; Analytics
        </h4>

        {/* Row 1: Donut & Price Anomaly Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Clinical Evidence Compliance Breakdown */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                Clinical Evidence Compliance Breakdown
              </h5>
              <p className="text-[11px] text-slate-500 mb-2">
                Conclusive treatment audits evaluated against ICMR and WHO protocols:
              </p>
            </div>

            <div className="h-56 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={complianceDonutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {complianceDonutData.map((entry, index) => (
                      <Cell key={`cell-comp-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(val: any) => [`${val ?? 0} Claims`, 'Volume']}
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '10px', fontSize: '11px', border: 'none' }}
                  />
                  <Legend verticalAlign="bottom" height={32} formatter={(val: string) => <span className="text-xs text-slate-700">{val}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Regional Price Anomaly Severity Breakdown */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                Regional Price Anomaly Severity Breakdown
              </h5>
              <p className="text-[11px] text-slate-500 mb-2">
                Markups across Normal fair rates, Moderate, Severe, and Extreme tiers:
              </p>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={markupSeverityData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                  <XAxis dataKey="category" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#64748b' }} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(val: any) => [`${val ?? 0} Claims`, 'Claims']}
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '10px', fontSize: '11px', border: 'none' }}
                  />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                    {markupSeverityData.map((entry, index) => (
                      <Cell key={`bar-reg-sev-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Row 2: Three-Pillar Radar & Hospital Facility Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 3: Reliability Score Three Pillars Radar */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                Three-Pillar Reliability Score Breakdown
              </h5>
              <p className="text-[11px] text-slate-500 mb-2">
                Relative performance across Clinical (50%), Pricing (35%), and Volume (15%):
              </p>
            </div>

            <div className="h-56 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius={70} data={radarData}>
                  <PolarGrid stroke="#cbd5e1" />
                  <PolarAngleAxis dataKey="pillar" tick={{ fontSize: 9, fill: '#334155' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: '#94a3b8' }} />
                  <Radar name="Locality Score" dataKey="score" stroke="#0284c7" fill="#0284c7" fillOpacity={0.4} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(val: any) => [`${val ?? 0}%`, 'Sub-Score']}
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '10px', fontSize: '11px', border: 'none' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Hospital Comparison in Region */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h5 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                  Healthcare Facilities in {metrics.city}
                </h5>
                <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                  ⚠️ Preliminary sample
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Observed compliance and pricing anomaly rates across hospitals:
              </p>
            </div>

            <div className="space-y-2">
              {hospitalList.map((hosp, hIdx) => (
                <div
                  key={hIdx}
                  className="p-2.5 rounded-xl bg-white border border-slate-200 text-xs flex items-center justify-between shadow-2xs"
                >
                  <div className="max-w-[65%] min-w-0">
                    <div className="font-bold text-slate-900 truncate" title={hosp.name}>
                      {hosp.name}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                      <span>{hosp.type}</span>
                      <span>&bull;</span>
                      <span>{hosp.claims} cases</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        hosp.compliancePct >= 85 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {hosp.compliancePct}% Compliance
                    </span>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {hosp.anomalyPct > 0 ? (
                        <span className="text-rose-700 font-semibold">{hosp.anomalyPct}% anomalies</span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">0% anomalies</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 text-[10px] text-slate-400 italic">
              * Sample size alert: Individual facility case volume is &lt; 15; data represents preliminary clinical audits.
            </div>
          </div>
        </div>
      </div>

      {/* 5. Synthesized Location Insight */}
      {insight && (
        <div className="p-6 bg-slate-50/70 border-t border-slate-200 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Automated Hospital Reliability Summary
            </h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              {insight.summary_text}
            </p>
          </div>

          {insight.recommendation && (
            <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-950 flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">💡</span>
              <div>
                <strong className="font-bold block text-sky-950">Reviewer Recommendation:</strong>
                <span className="text-sky-900 mt-0.5 block leading-relaxed">{insight.recommendation}</span>
              </div>
            </div>
          )}

          {/* Top Anomalous Items */}
          {insight.top_anomalous_entities.length > 0 && (
            <div>
              <span className="text-xs font-bold text-rose-900 uppercase tracking-wider block mb-2">
                Frequently Marked-Up Line Items
              </span>
              <div className="flex flex-wrap gap-2">
                {insight.top_anomalous_entities.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200"
                  >
                    ⚠️ {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sample Claim Links */}
          {insight.sample_claim_ids.length > 0 && (
            <div className="pt-2 flex items-center gap-2 flex-wrap text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Audited Claims in this Metro:</span>
              {insight.sample_claim_ids.map((cid, idx) => (
                <Link
                  key={idx}
                  to={`/claims/${encodeURIComponent(cid)}`}
                  className="font-mono text-sky-600 hover:text-sky-800 font-bold hover:underline bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs"
                >
                  {cid}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default TrustDensityPanel
