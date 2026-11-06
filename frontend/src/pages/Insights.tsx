import React, { useState } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * 5 Real Healthcare Audit Intelligence Charts for Karnataka
 * Styled to seamlessly match EvidenceBridge's Light and Dark design system.
 */
export default function Insights() {
  const { isDark } = useTheme()
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)

  // Card 1 Data: Top 5 Districts
  const districtData = [
    { name: 'Bengaluru', count: 482, max: 500 },
    { name: 'Mysuru', count: 348, max: 500 },
    { name: 'Belagavi', count: 273, max: 500 },
    { name: 'Kalaburagi', count: 195, max: 500 },
    { name: 'Davanagere', count: 162, max: 500 },
  ]

  // Shared Donut Helper
  const createDonutArcs = (
    segments: { value: number; color: string; label: string }[],
    radius: number
  ) => {
    const circumference = 2 * Math.PI * radius
    const total = segments.reduce((acc, s) => acc + s.value, 0)
    let accumulated = 0

    return segments.map((seg) => {
      const percentage = (seg.value / total) * 100
      const strokeLength = (percentage / 100) * circumference
      const offset = -accumulated
      accumulated += strokeLength

      return {
        ...seg,
        percentage: Math.round(percentage),
        strokeDasharray: `${strokeLength} ${circumference}`,
        strokeDashoffset: offset,
      }
    })
  }

  // Card 2: Evidence Quality Segments
  const evidenceQualitySegments = createDonutArcs(
    [
      { value: 58, color: '#10b981', label: 'Complete Evidence' },
      { value: 24, color: '#f59e0b', label: 'Partial Evidence' },
      { value: 18, color: '#f87171', label: 'Missing Evidence' },
    ],
    70
  )

  // Card 4: Clinical Outcome Segments
  const clinicalSegments = createDonutArcs(
    [
      { value: 52, color: '#10b981', label: 'Supported' },
      { value: 23, color: '#f59e0b', label: 'Partially Supported' },
      { value: 15, color: '#f87171', label: 'Contradicted' },
      { value: 10, color: '#94a3b8', label: 'Insufficient Evidence' },
    ],
    55
  )

  // Card 4: Financial Outcome Segments
  const financialSegments = createDonutArcs(
    [
      { value: 76, color: '#10b981', label: 'Not Flagged' },
      { value: 24, color: '#f87171', label: 'Flagged (for Review)' },
    ],
    55
  )

  // Helper styles based on theme
  const cardContainerClass = isDark
    ? 'bg-[#0b1329] border-2 border-cyan-500/60 shadow-[0_0_24px_rgba(6,182,212,0.25)] text-white'
    : 'bg-white border-2 border-slate-900 shadow-adjudo text-slate-900'

  const statBoxClass = isDark
    ? 'bg-[#060c1d] border border-cyan-800/40 text-white'
    : 'bg-slate-50 border-2 border-slate-900 text-slate-900'

  return (
    <div className="space-y-6 w-full max-w-5xl mx-auto pb-12">
      {/* 0. Top Header Banner matching Image */}
      <div
        className={`w-full max-w-3xl mx-auto px-6 py-4 rounded-2xl flex flex-col items-center justify-center text-center transition-all ${
          isDark
            ? 'bg-[#0d1629] border-2 border-cyan-400 shadow-[0_0_22px_rgba(6,182,212,0.35)] text-cyan-100'
            : 'bg-white border-2 border-slate-900 shadow-adjudo text-slate-950'
        }`}
      >
        <div className="flex items-center justify-center gap-3">
          {/* Heartbeat pulse in heart icon */}
          <div className="flex items-center justify-center flex-shrink-0">
            <svg
              className={`w-7 h-7 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h2l1.5-3 2.5 6 1.5-3h2.5" />
            </svg>
          </div>
          <div className={`h-6 w-[2px] ${isDark ? 'bg-cyan-500/50' : 'bg-slate-300'}`} />
          <h1 className="text-xl sm:text-2xl font-black italic tracking-wide">
            EvidenceBridge &ndash; Insights
          </h1>
        </div>
        <p className={`text-xs sm:text-sm font-medium mt-1 ${isDark ? 'text-cyan-300' : 'text-slate-600'}`}>
          Real Healthcare Data &bull; Audit Analytics &bull; Regional Intelligence
        </p>
      </div>

      {/* ========================================================
          GRAPH 1: Hospital Coverage - Karnataka
          ======================================================== */}
      <div className={`rounded-2xl p-5 sm:p-7 transition-all ${cardContainerClass}`}>
        {/* Card Header Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
              isDark ? 'bg-cyan-400 text-slate-950' : 'bg-slate-900 text-white'
            }`}
          >
            1
          </div>
          <h3 className="text-lg sm:text-xl font-black italic tracking-wide">
            Hospital Coverage &ndash; Karnataka
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Left Stats Column */}
          <div className="md:col-span-4 space-y-3">
            {/* Stat 1: Districts */}
            <div className={`p-3.5 rounded-xl flex items-center gap-3.5 ${statBoxClass}`}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-cyan-500/10 text-cyan-400 text-xl flex-shrink-0">
                🏢
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight leading-none">31</div>
                <div className="text-xs font-bold uppercase tracking-wider opacity-75 mt-0.5">
                  Districts
                </div>
              </div>
            </div>

            {/* Stat 2: Taluks */}
            <div className={`p-3.5 rounded-xl flex items-center gap-3.5 ${statBoxClass}`}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-cyan-500/10 text-cyan-400 text-xl flex-shrink-0">
                📍
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight leading-none">241</div>
                <div className="text-xs font-bold uppercase tracking-wider opacity-75 mt-0.5">
                  Taluks
                </div>
              </div>
            </div>

            {/* Stat 3: Hospitals */}
            <div className={`p-3.5 rounded-xl flex items-center gap-3.5 ${statBoxClass}`}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-cyan-500/10 text-cyan-400 text-xl flex-shrink-0">
                🏥
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight leading-none">2,226</div>
                <div className="text-xs font-bold uppercase tracking-wider opacity-75 mt-0.5">
                  Hospitals
                </div>
              </div>
            </div>
          </div>

          {/* Right Horizontal Bar Chart */}
          <div className="md:col-span-8 flex flex-col justify-center">
            <h4 className="text-xs font-bold uppercase tracking-wider text-center sm:text-left mb-4 opacity-80">
              Hospitals by District (Top 5)
            </h4>

            <div className="space-y-3">
              {districtData.map((d) => {
                const pct = (d.count / d.max) * 100
                return (
                  <div key={d.name} className="flex items-center gap-3 text-xs">
                    <span className="w-24 sm:w-28 text-right font-bold truncate opacity-90">
                      {d.name}
                    </span>
                    <div className="flex-1 bg-slate-200/50 dark:bg-slate-800/80 h-6 rounded-md overflow-hidden relative">
                      <div
                        className={`h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2 text-[11px] font-bold text-white ${
                          isDark
                            ? 'bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]'
                            : 'bg-gradient-to-r from-blue-700 to-indigo-600'
                        }`}
                        style={{ width: `${pct}%` }}
                      >
                        {d.count}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* X-Axis Scale */}
            <div className="flex items-center justify-between text-[11px] font-mono opacity-60 mt-3 pt-2 border-t border-slate-300 dark:border-slate-800 pl-24 sm:pl-28">
              <span>0</span>
              <span>100</span>
              <span>200</span>
              <span>300</span>
              <span>400</span>
              <span>500</span>
            </div>
            <div className="text-center text-[11px] font-semibold opacity-60 mt-1 pl-24 sm:pl-28">
              Hospital Count
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          GRAPH 2: Evidence Quality
          ======================================================== */}
      <div className={`rounded-2xl p-5 sm:p-7 transition-all ${cardContainerClass}`}>
        {/* Header Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
              isDark ? 'bg-cyan-400 text-slate-950' : 'bg-slate-900 text-white'
            }`}
          >
            2
          </div>
          <h3 className="text-lg sm:text-xl font-black italic tracking-wide">
            Evidence Quality
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Donut Chart with Centered Icon */}
          <div className="flex items-center justify-center relative">
            <svg className="w-52 h-52 sm:w-60 sm:h-60 -rotate-90" viewBox="0 0 180 180">
              {/* Background Track */}
              <circle
                cx="90"
                cy="90"
                r="70"
                fill="transparent"
                stroke={isDark ? '#1e293b' : '#e2e8f0'}
                strokeWidth="24"
              />
              {/* Colored Segments */}
              {evidenceQualitySegments.map((seg, i) => (
                <circle
                  key={i}
                  cx="90"
                  cy="90"
                  r="70"
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth="24"
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-700 hover:opacity-80 cursor-pointer"
                />
              ))}
            </svg>

            {/* Center Cutout Info */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <svg
                className={`w-7 h-7 sm:w-8 sm:h-8 mb-1 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span className="text-xs sm:text-sm font-bold tracking-tight">Evidence Records</span>
            </div>
          </div>

          {/* Legend Column */}
          <div className="space-y-4 flex flex-col justify-center">
            {evidenceQualitySegments.map((seg) => (
              <div
                key={seg.label}
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                  isDark
                    ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-md flex-shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-xs sm:text-sm font-bold">{seg.label}</span>
                </div>
                <span className="font-mono text-xs sm:text-sm font-black px-2 py-0.5 rounded bg-black/10 dark:bg-white/10">
                  {seg.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================
          GRAPH 3: Anomaly Detection
          ======================================================== */}
      <div className={`rounded-2xl p-5 sm:p-7 transition-all ${cardContainerClass}`}>
        {/* Header Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
              isDark ? 'bg-cyan-400 text-slate-950' : 'bg-slate-900 text-white'
            }`}
          >
            3
          </div>
          <h3 className="text-lg sm:text-xl font-black italic tracking-wide">
            Anomaly Detection
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Vertical Bar Chart */}
          <div className="md:col-span-7 flex flex-col justify-end">
            <div className="flex items-end gap-6 sm:gap-10 h-64 border-b border-l border-slate-300 dark:border-slate-700 pl-4 pb-2 relative">
              {/* Y-Axis Grid Lines & Numbers */}
              <div className="absolute left-0 top-0 bottom-0 -ml-10 flex flex-col justify-between text-[10px] font-mono opacity-60">
                <span>800</span>
                <span>600</span>
                <span>400</span>
                <span>200</span>
                <span>100</span>
                <span>0</span>
              </div>

              {/* Bar 1: Records Checked */}
              <div className="flex-1 flex flex-col items-center justify-end h-full group">
                <div className="text-[11px] font-bold font-mono mb-1 opacity-80">650</div>
                <div
                  className={`w-full max-w-[70px] rounded-t-lg transition-all duration-700 ${
                    isDark
                      ? 'bg-gradient-to-t from-blue-700 to-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                      : 'bg-blue-600'
                  }`}
                  style={{ height: `${(650 / 800) * 100}%` }}
                />
                <span className="text-[11px] font-bold text-center mt-2 leading-tight">
                  Records Checked
                </span>
              </div>

              {/* Bar 2: Flagged (Review) */}
              <div className="flex-1 flex flex-col items-center justify-end h-full group">
                <div className="text-[11px] font-bold font-mono mb-1 text-amber-500">150</div>
                <div
                  className={`w-full max-w-[70px] rounded-t-lg transition-all duration-700 ${
                    isDark
                      ? 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
                      : 'bg-amber-500'
                  }`}
                  style={{ height: `${(150 / 800) * 100}%` }}
                />
                <span className="text-[11px] font-bold text-center mt-2 leading-tight text-amber-500">
                  Flagged (Review)
                </span>
              </div>

              {/* Bar 3: Not Flagged */}
              <div className="flex-1 flex flex-col items-center justify-end h-full group">
                <div className="text-[11px] font-bold font-mono mb-1 text-emerald-500">100</div>
                <div
                  className={`w-full max-w-[70px] rounded-t-lg transition-all duration-700 ${
                    isDark
                      ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                      : 'bg-emerald-500'
                  }`}
                  style={{ height: `${(100 / 800) * 100}%` }}
                />
                <span className="text-[11px] font-bold text-center mt-2 leading-tight text-emerald-500">
                  Not Flagged
                </span>
              </div>
            </div>

            <div className="text-center text-[11px] font-bold opacity-60 mt-3">
              Number of Records
            </div>
          </div>

          {/* Right Callout Box */}
          <div className="md:col-span-5 flex items-center">
            <div
              className={`w-full p-5 rounded-2xl border-2 flex items-start gap-4 ${
                isDark
                  ? 'bg-amber-950/20 border-amber-400/80 text-amber-200'
                  : 'bg-amber-50/90 border-amber-500 text-amber-950'
              }`}
            >
              <span className="text-2xl flex-shrink-0">⚠️</span>
              <p className="text-xs sm:text-sm font-serif italic leading-relaxed font-medium">
                Flags indicate unusual patterns that need human review (not confirmed fraud).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          GRAPH 4: Audit Results
          ======================================================== */}
      <div className={`rounded-2xl p-5 sm:p-7 transition-all ${cardContainerClass}`}>
        {/* Header Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
              isDark ? 'bg-cyan-400 text-slate-950' : 'bg-slate-900 text-white'
            }`}
          >
            4
          </div>
          <h3 className="text-lg sm:text-xl font-black italic tracking-wide">
            Audit Results
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Sub-Donut A: Clinical Audit Outcome */}
          <div className="flex flex-col items-center pt-2 md:pt-0 md:pr-4">
            <span
              className={`px-4 py-1 rounded-full text-xs font-black tracking-wide uppercase mb-4 border ${
                isDark
                  ? 'bg-slate-900 border-cyan-800 text-cyan-300'
                  : 'bg-slate-100 border-slate-300 text-slate-800'
              }`}
            >
              Clinical Audit Outcome
            </span>

            <div className="relative w-40 h-40 flex items-center justify-center my-2">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
                <circle
                  cx="70"
                  cy="70"
                  r="55"
                  fill="transparent"
                  stroke={isDark ? '#1e293b' : '#e2e8f0'}
                  strokeWidth="18"
                />
                {clinicalSegments.map((seg, i) => (
                  <circle
                    key={i}
                    cx="70"
                    cy="70"
                    r="55"
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth="18"
                    strokeDasharray={seg.strokeDasharray}
                    strokeDashoffset={seg.strokeDashoffset}
                    strokeLinecap="round"
                  />
                ))}
              </svg>
              {/* Stethoscope Icon inside */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-2xl">
                🩺
              </div>
            </div>

            {/* Sub-A Legend */}
            <div className="grid grid-cols-2 gap-2 w-full mt-4 text-xs">
              {clinicalSegments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="truncate font-semibold text-[11px]">{seg.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sub-Donut B: Financial Audit Outcome */}
          <div className="flex flex-col items-center pt-6 md:pt-0 md:pl-4">
            <span
              className={`px-4 py-1 rounded-full text-xs font-black tracking-wide uppercase mb-4 border ${
                isDark
                  ? 'bg-slate-900 border-cyan-800 text-cyan-300'
                  : 'bg-slate-100 border-slate-300 text-slate-800'
              }`}
            >
              Financial Audit Outcome
            </span>

            <div className="relative w-40 h-40 flex items-center justify-center my-2">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
                <circle
                  cx="70"
                  cy="70"
                  r="55"
                  fill="transparent"
                  stroke={isDark ? '#1e293b' : '#e2e8f0'}
                  strokeWidth="18"
                />
                {financialSegments.map((seg, i) => (
                  <circle
                    key={i}
                    cx="70"
                    cy="70"
                    r="55"
                    fill="transparent"
                    stroke={seg.color}
                    strokeWidth="18"
                    strokeDasharray={seg.strokeDasharray}
                    strokeDashoffset={seg.strokeDashoffset}
                    strokeLinecap="round"
                  />
                ))}
              </svg>
              {/* Stack of Coins Icon inside */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-2xl">
                🪙
              </div>
            </div>

            {/* Sub-B Legend */}
            <div className="grid grid-cols-2 gap-2 w-full mt-4 text-xs">
              {financialSegments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="truncate font-semibold text-[11px]">{seg.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          GRAPH 5: Emergency Response & Patient Impact (SOS)
          ======================================================== */}
      <div className={`rounded-2xl p-5 sm:p-7 transition-all ${cardContainerClass}`}>
        {/* Header Badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
              isDark ? 'bg-cyan-400 text-slate-950' : 'bg-slate-900 text-white'
            }`}
          >
            5
          </div>
          <h3 className="text-lg sm:text-xl font-black italic tracking-wide">
            Emergency Response &amp; Patient Impact (SOS)
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Average Response Time Comparison */}
          <div className="lg:col-span-7 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider opacity-80">
              Average Response Time
            </h4>

            {/* Bar 1: Existing Process */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="opacity-90">Existing Process</span>
                <span className="font-mono text-[11px] opacity-75">(Baseline)</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 h-6 rounded-md overflow-hidden relative">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 rounded-md transition-all duration-700 flex items-center justify-end pr-2 text-xs font-black text-white"
                  style={{ width: `${(20 / 25) * 100}%` }}
                >
                  20 min
                </div>
              </div>
            </div>

            {/* Bar 2: With EvidenceBridge (SOS) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-500">With EvidenceBridge (SOS)</span>
                <span className="font-mono text-[11px] text-emerald-500 font-black">50% Faster</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 h-6 rounded-md overflow-hidden relative">
                <div
                  className="h-full bg-emerald-500 rounded-md transition-all duration-700 flex items-center justify-end pr-2 text-xs font-black text-white shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  style={{ width: `${(10 / 25) * 100}%` }}
                >
                  10 min
                </div>
              </div>
            </div>

            {/* Scale Line */}
            <div className="flex items-center justify-between text-[11px] font-mono opacity-60 pt-2 border-t border-slate-300 dark:border-slate-800">
              <span>0</span>
              <span>5</span>
              <span>10</span>
              <span>15</span>
              <span>20</span>
              <span>25</span>
            </div>
            <div className="text-center text-[11px] font-semibold opacity-60">
              Response Time (minutes)
            </div>
          </div>

          {/* Right: Potential for Higher Survival Rate */}
          <div className="lg:col-span-5 lg:border-l lg:border-slate-200 dark:lg:border-slate-800 lg:pl-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
              {/* Heart with ECG Pulse and Arrow */}
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h2l1-2 2 4 1-2h2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 7l3 0m0 0l0 3m0-3l-5 5" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="text-base sm:text-lg font-black italic tracking-tight">
                Potential for Higher Survival Rate
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed opacity-80 font-medium">
                Faster hospital communication and earlier medical support can improve the chances of patient survival in emergencies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
