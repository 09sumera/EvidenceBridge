import { useState, useEffect } from 'react'
import { getHealth } from '../api/client'
import ExtractVerifyForm from '../components/ExtractVerifyForm'
import type { HealthResponse } from '../types'
import { useAudit } from '../context/AuditContext'
import { useTheme } from '../context/ThemeContext'

interface SampleCase {
  label: string
  category: 'Approved' | 'Markup Flag' | 'Guideline Flag' | 'Safe Abstain'
  description: string
  text: string
}

const SAMPLE_CASES: SampleCase[] = [
  {
    label: 'Saline IV Infusion Markup (₹1,800)',
    category: 'Markup Flag',
    description: '17.1× markup on routine emergency IV fluid exceeding NPPA national ceiling price benchmark (₹105.00 incl. 5% GST)',
    text: `EMERGENCY DEPARTMENT CHARGE SUMMARY
MANIPAL HOSPITAL - BENGALURU, KARNATAKA
Patient: Ramesh Kumar (Acct #MH-BLR-2026-4412)

Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency rehydration.
Billed Charge: ₹1,800.00
Clinical Note: Emergency IV hydration administered for acute gastroenteritis dehydration.`,
  },
  {
    label: 'Type 2 Diabetes Rx - Metformin (₹75)',
    category: 'Approved',
    description: 'First-line diabetes maintenance therapy conforming to ICMR & RSSDI clinical guidelines',
    text: `CLINICAL OUTPATIENT CONSULTATION & PRESCRIPTION
APOLLO CLINIC - DAVANGERE, KARNATAKA
Patient: 52-year-old male with confirmed Type 2 Diabetes Mellitus (HbA1c 7.8%).

Rx Prescribed:
1. Tab. Metformin Hydrochloride 500 mg (Glycomet)
   Dosage & Instructions: Take 1 tablet twice daily after meals (morning and night) with water for 30 days (60 tablets).

Total Pharmacy Billed Charge: ₹75.00
Clinical Assessment: First-line oral monotherapy initiated per standard ICMR/RSSDI diabetes guidelines.`,
  },
  {
    label: 'Acute Bronchitis Rx - Antibiotic (₹450)',
    category: 'Guideline Flag',
    description: 'Antibiotic overprescription flagged: ICMR advises against routine antibiotics for viral bronchitis',
    text: `DISTRICT CIVIL HOSPITAL - OUTPATIENT PRESCRIPTION
DISTRICT HOSPITAL - BALLARI, KARNATAKA
Patient: 34-year-old male presenting with acute uncomplicated bronchitis, low-grade fever, and non-productive cough for 4 days.

Rx Prescribed:
1. Tab. Azithromycin 500 mg (Zithromax)
   Dosage & Instructions: Take 1 tablet orally once daily 1 hour before meals for 5 days.
2. Tab. Paracetamol 650 mg (Dolo)
   Dosage & Instructions: Take 1 tablet as needed (SOS) for fever/body ache every 6-8 hours after food.

Total Pharmacy Charge: ₹450.00
Clinical Note: Empirical antibiotic therapy initiated for viral bronchitis without secondary infection.`,
  },
  {
    label: 'Diagnostic Brain MRI Scan (₹5,500)',
    category: 'Approved',
    description: 'Appropriate neuroimaging conforming to CGHS benchmark tariff and neurological criteria',
    text: `NEUROLOGY CONSULTATION & IMAGING ORDER
KMC HOSPITAL (KASTURBA MEDICAL COLLEGE) - MANGALURU, KARNATAKA
Patient: 46-year-old female presenting with progressive unilateral headache, papilledema, and new focal neurological signs.

Procedure: CPT 70551 Magnetic Resonance Imaging (MRI) Brain without contrast.
Total Billed Charge: ₹5,500.00
Clinical Indication: Urgent neuroimaging indicated to evaluate focal intracranial pathology per clinical guidelines.`,
  },
  {
    label: 'Uncoded Experimental Therapy (₹85,000)',
    category: 'Safe Abstain',
    description: 'Safe refusal: High-cost experimental therapy without established NPPA/CGHS tariff benchmarks',
    text: `REGENERATIVE MEDICINE SPECIALTY SUITE
CITY SUPER SPECIALITY HOSPITAL - BELAGAVI, KARNATAKA
Patient: 58-year-old with refractory degenerative musculoskeletal pain.

Administered: Autologous experimental cellular restorative therapy protocol.
Total Billed Charge: ₹85,000.00
Clinical Note: Off-label experimental regenerative restorative session administered without standard procedure code.`,
  },
  {
    label: 'US Emergency Normal Saline ($720 USD)',
    category: 'Markup Flag',
    description: 'Foreign currency demonstration: 16× markup evaluated against CMS Medicare USD schedule',
    text: `EMERGENCY ROOM CHARGE SUMMARY
MIDWEST REGIONAL MEDICAL CENTER - CLEVELAND, OH
Patient: Jane Doe (Acct #MR-2024-99120)

Supply Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency hydration.
Billed Charge: $720.00
Clinical Note: Emergency administration of normal saline for acute dehydration following gastroenteritis.`,
  },
]

export default function Home() {
  const [, setHealth] = useState<{
    loading: boolean
    ok: boolean
    data?: HealthResponse
  }>({ loading: true, ok: false })

  const { activePreset, setText: setAuditText, setActivePreset } = useAudit()
  const { isDark } = useTheme()

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

  const handleSelectSample = (sample: SampleCase) => {
    setAuditText(sample.text)
    setActivePreset(sample.label)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Page Title & Plain-English Explainer */}
      <div className="text-center max-w-3xl mx-auto">
        <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider mb-3.5 border transition-all ${
          isDark
            ? 'bg-neutral-900 border-neutral-700 text-orange-400 shadow-adjudo-sm'
            : 'bg-cream-200 border-neutral-900 text-neutral-950 shadow-adjudo-sm'
        }`}>
          <span>🩺 Clinical Claims &amp; Billing Auditor</span>
        </div>
        <h1 className={`text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-neutral-950 dark:text-white ${
          isDark ? 'text-white' : 'text-neutral-950'
        }`}>
          Audit Clinical Notes &amp; Hospital Bills
        </h1>
      </div>

      {/* Stepped Process Visual */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-adjudo-dark-surface border-neutral-700 shadow-adjudo'
            : 'bg-white border-neutral-900 shadow-adjudo'
        } flex items-start gap-3.5`}>
          <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 bg-orange-600 text-white border border-neutral-900 shadow-adjudo-sm">
            1
          </div>
          <div>
            <div className={`text-sm font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
              Input Document
            </div>
            <div className={`text-xs mt-1 leading-normal ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              Upload a bill photo, take a picture with camera, paste text, or select a sample case.
            </div>
          </div>
        </div>

        <div className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-adjudo-dark-surface border-neutral-700 shadow-adjudo'
            : 'bg-white border-neutral-900 shadow-adjudo'
        } flex items-start gap-3.5`}>
          <div className={`w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 border border-neutral-900 shadow-adjudo-sm ${
            isDark ? 'bg-neutral-100 text-neutral-950' : 'bg-neutral-950 text-white'
          }`}>
            2
          </div>
          <div>
            <div className={`text-sm font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
              Check Evidence &amp; Price
            </div>
            <div className={`text-xs mt-1 leading-normal ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              Searches medical guidelines and compares against CMS price benchmarks.
            </div>
          </div>
        </div>

        <div className={`p-5 rounded-2xl border transition-all ${
          isDark
            ? 'bg-adjudo-dark-surface border-neutral-700 shadow-adjudo'
            : 'bg-white border-neutral-900 shadow-adjudo'
        } flex items-start gap-3.5`}>
          <div className="w-8 h-8 rounded-xl font-black text-sm flex items-center justify-center flex-shrink-0 bg-emerald-600 text-white border border-neutral-900 shadow-adjudo-sm">
            3
          </div>
          <div>
            <div className={`text-sm font-black ${isDark ? 'text-white' : 'text-neutral-950'}`}>
              Review 9-Stage Audit
            </div>
            <div className={`text-xs mt-1 leading-normal ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              Inspect full decision trail, guideline citations, and markup ratios.
            </div>
          </div>
        </div>
      </div>

      {/* Sample Cases Picker */}
      <div className={`rounded-2xl border p-6 sm:p-7 transition-all ${
        isDark
          ? 'bg-adjudo-dark-surface border-neutral-700 shadow-adjudo'
          : 'bg-white border-neutral-900 shadow-adjudo'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`text-xs font-black uppercase tracking-wider ${
              isDark ? 'text-white' : 'text-neutral-950'
            }`}>
              Try a Pre-Configured Sample Case
            </h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              Click any realistic clinical scenario to pre-populate the input form
            </p>
          </div>
          {activePreset && (
            <button
              type="button"
              onClick={() => {
                setActivePreset(null)
              }}
              className="text-xs text-neutral-500 hover:text-black dark:hover:text-white font-bold cursor-pointer"
            >
              Clear selection
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SAMPLE_CASES.map((sample) => {
            const isSelected = activePreset === sample.label
            const badgeColor =
              sample.category === 'Approved'
                ? isDark
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                  : 'bg-emerald-100 text-emerald-950 border border-emerald-600'
                : sample.category === 'Markup Flag'
                ? isDark
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-700'
                  : 'bg-amber-100 text-amber-950 border border-amber-600'
                : sample.category === 'Guideline Flag'
                ? isDark
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-700'
                  : 'bg-rose-100 text-rose-950 border border-rose-600'
                : isDark
                ? 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                : 'bg-stone-200 text-stone-900 border border-stone-500'

            return (
              <button
                key={sample.label}
                type="button"
                onClick={() => handleSelectSample(sample)}
                className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? isDark
                      ? 'border-2 border-orange-500 bg-orange-950/40 shadow-adjudo-orange'
                      : 'border-2 border-orange-500 bg-orange-50/80 shadow-adjudo-orange'
                    : isDark
                    ? 'border-neutral-700 bg-neutral-900/60 hover:bg-neutral-900 hover:border-neutral-500 shadow-adjudo-sm'
                    : 'border-neutral-900 bg-cream-50 hover:bg-cream-200/60 shadow-adjudo-sm hover:-translate-y-0.5'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-black ${badgeColor}`}>
                    {sample.category}
                  </span>
                  <span className={`text-xs font-black ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
                    Select &rarr;
                  </span>
                </div>
                <div className={`font-black text-sm ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                  {sample.label}
                </div>
                <div className={`text-xs mt-1 line-clamp-2 leading-relaxed ${
                  isDark ? 'text-neutral-400' : 'text-neutral-600'
                }`}>
                  {sample.description}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Extract & Verify Form */}
      <ExtractVerifyForm />
    </div>
  )
}
