import React, { useState, useEffect } from 'react'
import { runEvaluation, listEvaluationRuns, getEvaluationReport, ensureAuthToken } from '../api/client'
import type { EvaluationReport } from '../types'
import { ModelStatusCard } from '../components/ModelStatusCard'

export default function Evaluation() {
  const [report, setReport] = useState<EvaluationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [offlineMode, setOfflineMode] = useState(true)
  const [activeTab, setActiveTab] = useState<'metrics' | 'samples' | 'markdown'>('metrics')
  const [historicalRuns, setHistoricalRuns] = useState<EvaluationReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copiedMd, setCopiedMd] = useState(false)

  // Load existing runs on mount
  useEffect(() => {
    let active = true
    ensureAuthToken()
      .then(() => listEvaluationRuns(5))
      .then((res) => {
        if (active) {
          setHistoricalRuns(res.runs)
          if (res.runs.length > 0) {
            setReport(res.runs[0])
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load evaluation runs:', err)
      })
    return () => {
      active = false
    }
  }, [])

  const handleRunEvaluation = async () => {
    setLoading(true)
    setError(null)
    try {
      await ensureAuthToken()
      const res = await runEvaluation({ offline_mode: offlineMode, force_reverify: true })
      setReport(res.report)
      // Refresh historical list
      listEvaluationRuns(5).then((r) => setHistoricalRuns(r.runs)).catch(() => {})
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSelectRun = async (runId: string) => {
    setLoading(true)
    setError(null)
    try {
      await ensureAuthToken()
      const rep = await getEvaluationReport(runId)
      setReport(rep)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCopyMarkdown = () => {
    if (report?.markdown_report) {
      navigator.clipboard.writeText(report.markdown_report)
      setCopiedMd(true)
      setTimeout(() => setCopiedMd(false), 2000)
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* 5 AI Models Live Status Architecture Banner */}
      <ModelStatusCard />

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 text-[11px] font-bold uppercase tracking-wider mb-1.5 border border-sky-200">
            System Reliability Benchmark
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Evaluation &amp; Calibration Harness
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Evaluates clinical verdict accuracy, action alignment (Approved / Flagged / Held), financial price anomaly detection, and abstention safety across gold-standard cases.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 cursor-pointer shadow-subtle">
            <input
              type="checkbox"
              checked={offlineMode}
              onChange={(e) => setOfflineMode(e.target.checked)}
              className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
            />
            <span>Deterministic Local Mode</span>
          </label>

          <button
            type="button"
            onClick={handleRunEvaluation}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-sky-600 text-white text-xs sm:text-sm font-bold hover:bg-sky-700 transition-colors shadow-md disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Evaluating Benchmark Suite...
              </>
            ) : (
              'Run Evaluation Suite'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm">
          <strong>Evaluation Error:</strong> {error}
        </div>
      )}

      {/* Historical Runs Dropdown */}
      {historicalRuns.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-600 bg-white p-3.5 rounded-xl border border-slate-200 shadow-subtle">
          <span className="font-bold text-slate-700">Past Evaluation Runs:</span>
          <select
            value={report?.run_id || ''}
            onChange={(e) => handleSelectRun(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1 text-xs font-mono text-slate-800 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {historicalRuns.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id} &bull; {new Date(r.timestamp).toLocaleTimeString()} ({r.total_samples} samples)
              </option>
            ))}
          </select>
        </div>
      )}

      {!report && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-card">
          <div className="text-4xl mb-3">📊</div>
          <h3 className="text-base font-bold text-slate-800">No Evaluation Report Selected</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Click &ldquo;Run Evaluation Suite&rdquo; to execute the harness across the controlled clinical benchmark cases.
          </p>
        </div>
      )}

      {report && (
        <div className="space-y-6">
          {/* Executive Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Clinical Accuracy</div>
              <div className="text-2xl font-black font-mono text-emerald-600 mt-1">
                {(report.overall_verdict_accuracy * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Verdict Concordance</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Macro Verdict F1</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">
                {report.macro_verdict_f1.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Multi-class Average</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Action Accuracy</div>
              <div className="text-2xl font-black font-mono text-sky-600 mt-1">
                {(report.overall_action_accuracy * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Approve / Flag / Hold</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Price Alert F1</div>
              <div className="text-2xl font-black font-mono text-rose-600 mt-1">
                {report.cost_anomaly_metrics.f1_score.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Markup Detection</div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Safety Abstention</div>
              <div className="text-2xl font-black font-mono text-emerald-600 mt-1">
                {(report.abstention_metrics.abstention_recall * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {report.abstention_metrics.correct_abstentions}/{report.abstention_metrics.correct_abstentions + report.abstention_metrics.under_abstentions} Safe Refusals
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-subtle">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Calibration (ECE)</div>
              <div className="text-2xl font-black font-mono text-amber-600 mt-1">
                {report.expected_calibration_error.toFixed(4)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Expected Error</div>
            </div>
          </div>

          {/* Recommendations Banner */}
          {report.recommendations.length > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 shadow-subtle">
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-950 mb-2 flex items-center gap-1.5">
                <span>🛡️</span>
                <span>Harness Diagnostic Recommendations &amp; Safeguards</span>
              </h3>
              <ul className="space-y-1.5 text-xs text-sky-900 leading-relaxed">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold">&bull;</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="border-b border-slate-200 flex gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('metrics')}
              className={`pb-3 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
                activeTab === 'metrics'
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Detailed Breakdown
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('samples')}
              className={`pb-3 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
                activeTab === 'samples'
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Benchmark Cases ({report.sample_evaluations.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('markdown')}
              className={`pb-3 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
                activeTab === 'markdown'
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Executive Markdown Report
            </button>
          </div>

          {/* Tab 1: Detailed Breakdown */}
          {activeTab === 'metrics' && (
            <div className="space-y-6">
              {/* Verdict Classification Table */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Clinical Verdict Performance Breakdown
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-3.5">Verdict Class</th>
                        <th className="px-6 py-3.5 text-center">Precision</th>
                        <th className="px-6 py-3.5 text-center">Recall</th>
                        <th className="px-6 py-3.5 text-center">F1 Score</th>
                        <th className="px-6 py-3.5 text-center">Gold Count</th>
                        <th className="px-6 py-3.5 text-center">Predicted Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {Object.entries(report.verdict_metrics).map(([cls, m]) => (
                        <tr key={cls} className="hover:bg-slate-50">
                          <td className="px-6 py-3.5 font-sans font-bold text-slate-800">{cls}</td>
                          <td className="px-6 py-3.5 text-center">{(m.precision * 100).toFixed(1)}%</td>
                          <td className="px-6 py-3.5 text-center">{(m.recall * 100).toFixed(1)}%</td>
                          <td className="px-6 py-3.5 text-center font-bold text-slate-900">{m.f1_score.toFixed(3)}</td>
                          <td className="px-6 py-3.5 text-center text-slate-500">{m.support_count}</td>
                          <td className="px-6 py-3.5 text-center text-slate-500">{m.predicted_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Table & Calibration Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Actions */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card">
                  <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Decision Action Alignment
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-3">Action</th>
                          <th className="px-6 py-3 text-center">Precision</th>
                          <th className="px-6 py-3 text-center">Recall</th>
                          <th className="px-6 py-3 text-center">F1</th>
                          <th className="px-6 py-3 text-center">Samples</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {Object.entries(report.action_metrics).map(([act, m]) => (
                          <tr key={act} className="hover:bg-slate-50">
                            <td className="px-6 py-3 font-sans font-bold text-slate-800">{act}</td>
                            <td className="px-6 py-3 text-center">{(m.precision * 100).toFixed(0)}%</td>
                            <td className="px-6 py-3 text-center">{(m.recall * 100).toFixed(0)}%</td>
                            <td className="px-6 py-3 text-center font-bold text-slate-900">{m.f1_score.toFixed(3)}</td>
                            <td className="px-6 py-3 text-center text-slate-500">{m.support_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Reliability Calibration Bins */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card">
                  <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Confidence Reliability Calibration
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Bin Range</th>
                          <th className="px-4 py-3 text-center">Count</th>
                          <th className="px-4 py-3 text-center">Avg Conf</th>
                          <th className="px-4 py-3 text-center">Accuracy</th>
                          <th className="px-4 py-3 text-center">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {report.calibration_bins.map((b) => (
                          <tr key={b.bin_index} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-sans text-slate-700">[{b.bin_lower.toFixed(2)}, {b.bin_upper.toFixed(2)})</td>
                            <td className="px-4 py-3 text-center text-slate-600">{b.sample_count}</td>
                            <td className="px-4 py-3 text-center">{b.avg_confidence.toFixed(2)}</td>
                            <td className="px-4 py-3 text-center">{(b.empirical_accuracy * 100).toFixed(0)}%</td>
                            <td className="px-4 py-3 text-center font-bold text-slate-900">{b.calibration_error.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Sample Cases */}
          {activeTab === 'samples' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3.5">Case ID</th>
                      <th className="px-6 py-3.5">Verdict (Pred / Gold)</th>
                      <th className="px-6 py-3.5">Action (Pred / Gold)</th>
                      <th className="px-6 py-3.5 text-center">Price Alert</th>
                      <th className="px-6 py-3.5 text-center">Confidence</th>
                      <th className="px-6 py-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.sample_evaluations.map((s) => {
                      const allPass = s.verdict_correct && s.action_correct && s.cost_anomaly_correct
                      return (
                        <tr key={s.case_id} className="hover:bg-slate-50 font-mono">
                          <td className="px-6 py-3.5 font-bold text-slate-900 font-sans">{s.case_id}</td>
                          <td className="px-6 py-3.5">
                            <span className={s.verdict_correct ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-bold'}>
                              {s.predicted_verdict}
                            </span>{' '}
                            <span className="text-slate-400">/ {s.gold_verdict}</span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className={s.action_correct ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-bold'}>
                              {s.predicted_action}
                            </span>{' '}
                            <span className="text-slate-400">/ {s.gold_action}</span>
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            {s.predicted_cost_anomaly ? (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-rose-50 text-rose-800 border border-rose-200 font-sans font-bold">
                                ⚠️ Price Alert
                              </span>
                            ) : (
                              <span className="text-slate-400 font-sans">Normal</span>
                            )}
                          </td>
                          <td className="px-6 py-3.5 text-center font-bold text-slate-800">
                            {s.support_score.toFixed(2)}
                          </td>
                          <td className="px-6 py-3.5 font-sans">
                            {allPass ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                ✓ Pass
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-rose-700 font-bold text-xs bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                ⚠️ Mismatch
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Markdown Report */}
          {activeTab === 'markdown' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-card">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Formatted Markdown Evaluation Report
                </span>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="px-3.5 py-1.5 text-xs rounded-xl border border-slate-300 hover:bg-slate-50 font-bold text-slate-700 transition-colors shadow-2xs"
                >
                  {copiedMd ? '✓ Copied to Clipboard' : 'Copy Markdown'}
                </button>
              </div>
              <pre className="p-5 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[600px] leading-relaxed">
                {report.markdown_report}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
