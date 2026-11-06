import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  getHospitalAvailability,
  updateHospitalAvailability,
  listHospitalSOS,
  updateSOSStatus,
  type HospitalAvailabilityResponse,
  type EmergencySOSRecord,
  type HospitalAvailabilityUpdatePayload,
} from '../api/client'

// Pre-configured managed hospital facility registry
export const MANAGED_HOSPITAL_FACILITIES = [
  {
    id: 'hosp_davg_shree_institute',
    name: 'Shree Medical Institute',
    district: 'Davangere',
    address: 'MCC B Block, Davangere, Karnataka 577004',
    phone: '+91 8192 284900',
    emergency_helpline: '108 / +91 8192 284911',
  },
  {
    id: 'hosp_blr_manipal',
    name: 'Manipal Hospital Old Airport Road',
    district: 'Bengaluru',
    address: '98 HAL Old Airport Rd, Kodihalli, Bengaluru 560017',
    phone: '+91 80 2502 4444',
    emergency_helpline: '080 2222 1111',
  },
  {
    id: 'hosp_blr_apollo',
    name: 'Apollo Hospital Bannerghatta Road',
    district: 'Bengaluru',
    address: '154/11 Bannerghatta Main Rd, Bengaluru 560076',
    phone: '+91 80 2630 4050',
    emergency_helpline: '1066',
  },
  {
    id: 'hosp_davg_chigateri',
    name: 'Chigateri District Hospital',
    district: 'Davangere',
    address: 'Near Railway Station, Davangere 577001',
    phone: '+91 8192 231433',
    emergency_helpline: '108 / 08192 231433',
  },
  {
    id: 'hosp_blr_fortis',
    name: 'Fortis Hospital Cunningham Road',
    district: 'Bengaluru',
    address: '14 Cunningham Rd, Vasanth Nagar, Bengaluru 560052',
    phone: '+91 80 4199 4444',
    emergency_helpline: '080 4199 4444',
  },
  {
    id: 'hosp_mys_columbia',
    name: 'Columbia Asia Hospital Mysuru',
    district: 'Mysuru',
    address: 'No. 85-86, Bangalore-Mysore Ring Road, Mysuru 570015',
    phone: '+91 821 398 9898',
    emergency_helpline: '0821 398 9898',
  },
  {
    id: 'hosp_hub_tatwadarsha',
    name: 'Tatwadarsha Hospital Hubballi',
    district: 'Dharwad',
    address: 'Vidyanagar, Hubballi 580021',
    phone: '+91 836 221 8888',
    emergency_helpline: '0836 221 8888',
  },
]

export default function HospitalManagement() {
  const { user, logout, isHospitalManagement } = useAuth()
  const { isDark } = useTheme()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  // Determine read-only mode (when viewing from patient portal or via ?mode=read_only)
  const isReadOnly =
    searchParams.get('mode') === 'read_only' ||
    searchParams.get('mode') === 'read' ||
    (location.state as any)?.mode === 'read_only' ||
    !isHospitalManagement ||
    user?.portal === 'patient'

  // 1. Identify target hospital from query params, router state, or cached hospital selection
  const queryHospitalId = searchParams.get('hospital_id')
  const stateHospital = (location.state as any)?.hospital

  let cachedHospital: any = null
  try {
    const raw = localStorage.getItem('eb_active_management_hospital')
    if (raw) cachedHospital = JSON.parse(raw)
  } catch {
    // ignore
  }

  const effectiveHospitalId =
    queryHospitalId ||
    stateHospital?.id ||
    (cachedHospital?.id ? cachedHospital.id : user?.hospital_id) ||
    'hosp_davg_shree_institute'

  const matchedManaged = MANAGED_HOSPITAL_FACILITIES.find((h) => h.id === effectiveHospitalId)

  const hospitalFacility =
    (queryHospitalId && cachedHospital?.id === queryHospitalId ? cachedHospital : null) ||
    (queryHospitalId && stateHospital?.id === queryHospitalId ? stateHospital : null) ||
    matchedManaged ||
    stateHospital ||
    cachedHospital || {
      id: effectiveHospitalId,
      name: cachedHospital?.name || 'Selected Medical Facility',
      district: cachedHospital?.district || 'Karnataka',
      address: cachedHospital?.address || 'Hospital Facility Campus, Karnataka',
      phone: cachedHospital?.phone || '+91 80 2502 4444',
      emergency_helpline: cachedHospital?.emergency_helpline || '108 / 112',
    }

  const assignedHospitalId = hospitalFacility.id

  // Form State: Staff & Capacity
  const [doctorsAvailable, setDoctorsAvailable] = useState<number>(9)
  const [emergencyDoctors, setEmergencyDoctors] = useState<number>(3)
  const [nursesAvailable, setNursesAvailable] = useState<number>(18)
  const [emergencyNurses, setEmergencyNurses] = useState<number>(5)
  const [availableBeds, setAvailableBeds] = useState<number>(45)
  const [icuBedsAvailable, setIcuBedsAvailable] = useState<number>(8)
  const [emergencyDeptStatus, setEmergencyDeptStatus] = useState<string>('Operational')
  const [dutyStatus, setDutyStatus] = useState<string>('Accepting Patients')
  const [notes, setNotes] = useState<string>(
    'Trauma Bay 1 & 2 fully staffed. 24/7 emergency imaging, CT and lab on standby.'
  )

  // Department Specialists State
  const [specialists, setSpecialists] = useState<Record<string, number>>({
    Cardiology: 2,
    Neurology: 1,
    Orthopaedics: 3,
    'General Medicine': 4,
    'Emergency Medicine': 3,
    Paediatrics: 2,
    Gynaecology: 2,
    'Intensive Care': 2,
  })

  // Management Metadata State
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(true)
  const [isSavingAvailability, setIsSavingAvailability] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // SOS Emergency Desk State
  const [sosList, setSosList] = useState<EmergencySOSRecord[]>([])
  const [sosFilter, setSosFilter] = useState<'ALL' | 'PENDING' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED'>('ALL')
  const [updatingSosId, setUpdatingSosId] = useState<string | null>(null)
  const [protocolModalRecord, setProtocolModalRecord] = useState<EmergencySOSRecord | null>(null)
  const lastPendingCount = useRef<number>(0)

  // Load initial hospital availability from backend / local cache
  const loadHospitalAvailability = useCallback(async () => {
    try {
      setIsLoadingAvailability(true)

      // 1. Check local storage cache for this facility
      try {
        const localAvailRaw = localStorage.getItem(`eb_avail_${assignedHospitalId}`)
        if (localAvailRaw) {
          const localAvail = JSON.parse(localAvailRaw)
          setDoctorsAvailable(localAvail.doctors_available ?? 12)
          setEmergencyDoctors(localAvail.emergency_doctors ?? 4)
          setNursesAvailable(localAvail.nurses_available ?? 24)
          setEmergencyNurses(localAvail.emergency_nurses ?? 6)
          setAvailableBeds(localAvail.available_beds ?? 45)
          setIcuBedsAvailable(localAvail.icu_beds_available ?? 8)
          if (localAvail.duty_status) setDutyStatus(localAvail.duty_status)
          if (localAvail.emergency_dept_status) setEmergencyDeptStatus(localAvail.emergency_dept_status)
          if (localAvail.notes) setNotes(localAvail.notes)
          if (localAvail.last_updated) setLastUpdated(localAvail.last_updated)
        }
      } catch {
        // ignore
      }

      // 2. Query backend availability API
      const data = await getHospitalAvailability(assignedHospitalId)
      if (data) {
        setDoctorsAvailable(data.doctors_available ?? 0)
        setEmergencyDoctors(data.emergency_doctors ?? 0)
        setNursesAvailable(data.nurses_available ?? 0)
        if (typeof data.emergency_nurses === 'number') {
          setEmergencyNurses(data.emergency_nurses)
        }
        if (typeof data.available_beds === 'number') {
          setAvailableBeds(data.available_beds)
        }
        if (typeof data.icu_beds_available === 'number') {
          setIcuBedsAvailable(data.icu_beds_available)
        }
        if (data.emergency_dept_status) {
          setEmergencyDeptStatus(data.emergency_dept_status)
        }
        if (data.duty_status) {
          setDutyStatus(data.duty_status)
        }
        if (data.notes) {
          setNotes(data.notes)
        }
        if (data.department_specialists && Object.keys(data.department_specialists).length > 0) {
          setSpecialists((prev) => ({ ...prev, ...data.department_specialists }))
        }
        if (data.last_updated) {
          setLastUpdated(data.last_updated)
        }
      }
    } catch (err: any) {
      console.warn('Could not load existing availability for hospital:', err)
    } finally {
      setIsLoadingAvailability(false)
    }
  }, [assignedHospitalId])

  // SOS Desk Polling - STRICTLY SCOPED TO THIS HOSPITAL
  const pollHospitalSos = useCallback(async () => {
    try {
      let records: EmergencySOSRecord[] = []
      try {
        records = await listHospitalSOS(assignedHospitalId)
      } catch (err) {
        console.warn('API listHospitalSOS note, checking local store:', err)
      }

      // Merge local emergency records created for this specific hospital
      try {
        const rawLocal = localStorage.getItem('eb_emergency_sos_records')
        if (rawLocal) {
          const localRecords: EmergencySOSRecord[] = JSON.parse(rawLocal)
          const mergedMap = new Map<string, EmergencySOSRecord>()
          records.forEach((r) => mergedMap.set(r.sos_id, r))
          localRecords.forEach((r) => {
            const matchesId = r.hospital_id === assignedHospitalId
            const matchesName =
              r.hospital_name &&
              hospitalFacility.name &&
              (r.hospital_name.toLowerCase().trim() === hospitalFacility.name.toLowerCase().trim() ||
               hospitalFacility.name.toLowerCase().includes(r.hospital_name.toLowerCase()) ||
               r.hospital_name.toLowerCase().includes(hospitalFacility.name.toLowerCase()))

            if (matchesId || matchesName) {
              if (!mergedMap.has(r.sos_id)) {
                mergedMap.set(r.sos_id, r)
              }
            }
          })
          records = Array.from(mergedMap.values())
        }
      } catch {
        // ignore
      }

      // STRICT ISOLATION: Keep ONLY records belonging to this hospital!
      const strictlyThisHospitalRecords = records.filter(
        (r) =>
          r.hospital_id === assignedHospitalId ||
          (r.hospital_name &&
            hospitalFacility.name &&
            (r.hospital_name.toLowerCase().trim() === hospitalFacility.name.toLowerCase().trim() ||
             hospitalFacility.name.toLowerCase().includes(r.hospital_name.toLowerCase()) ||
             r.hospital_name.toLowerCase().includes(hospitalFacility.name.toLowerCase())))
      )

      setSosList(strictlyThisHospitalRecords)

      // Audio notification on new pending emergency call ONLY FOR THIS HOSPITAL!
      const pendingCount = strictlyThisHospitalRecords.filter((r) => r.status === 'PENDING').length
      if (pendingCount > lastPendingCount.current) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          if (AudioContextClass) {
            const ctx = new AudioContextClass()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            gain.gain.setValueAtTime(0.25, ctx.currentTime)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start()
            osc.stop(ctx.currentTime + 0.35)
          }
        } catch {
          // Audio autoplay policy fallback
        }
      }
      lastPendingCount.current = pendingCount
    } catch (err) {
      console.warn('Could not poll hospital SOS records:', err)
    }
  }, [assignedHospitalId, hospitalFacility.name])

  useEffect(() => {
    loadHospitalAvailability()
    if (!isReadOnly) {
      pollHospitalSos()
      const sosInterval = setInterval(pollHospitalSos, 4000)
      return () => clearInterval(sosInterval)
    }
  }, [loadHospitalAvailability, pollHospitalSos, isReadOnly])

  // Validation rules:
  // 1. Counts cannot be negative
  // 2. Emergency staff cannot exceed corresponding available staff
  const doctorError =
    emergencyDoctors > doctorsAvailable
      ? `Emergency doctors (${emergencyDoctors}) cannot exceed total available doctors (${doctorsAvailable})`
      : doctorsAvailable < 0 || emergencyDoctors < 0
      ? 'Doctor counts cannot be negative'
      : null

  const nurseError =
    emergencyNurses > nursesAvailable
      ? `Emergency nurses (${emergencyNurses}) cannot exceed total available nurses (${nursesAvailable})`
      : nursesAvailable < 0 || emergencyNurses < 0
      ? 'Nurse counts cannot be negative'
      : null

  const isFormValid = !doctorError && !nurseError && availableBeds >= 0 && icuBedsAvailable >= 0

  // Save Availability Handler
  const handleSaveAvailability = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isReadOnly) return
    if (!isFormValid) {
      setFeedback({
        type: 'error',
        message: doctorError || nurseError || 'Please correct errors before saving.',
      })
      return
    }

    setIsSavingAvailability(true)
    setFeedback(null)

    try {
      const payload: HospitalAvailabilityUpdatePayload = {
        hospital_id: assignedHospitalId,
        hospital_name: hospitalFacility.name,
        doctors_available: Number(doctorsAvailable),
        emergency_doctors: Number(emergencyDoctors),
        nurses_available: Number(nursesAvailable),
        emergency_nurses: Number(emergencyNurses),
        department_specialists: specialists,
        available_beds: Number(availableBeds),
        icu_beds_available: Number(icuBedsAvailable),
        emergency_dept_status: emergencyDeptStatus,
        duty_status: dutyStatus,
        notes: notes.trim() || undefined,
      }

      const res = await updateHospitalAvailability(assignedHospitalId, payload)
      setLastUpdated(res.last_updated)

      try {
        localStorage.setItem(
          `eb_avail_${assignedHospitalId}`,
          JSON.stringify({
            ...payload,
            last_updated: res.last_updated,
          })
        )
      } catch {
        // ignore
      }

      setFeedback({
        type: 'success',
        message: `Live availability saved and broadcast to Karnataka citizen network for ${hospitalFacility.name}.`,
      })
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to update hospital availability. Please check credentials.',
      })
    } finally {
      setIsSavingAvailability(false)
    }
  }

  // Handle SOS Status Transition
  const handleUpdateSOSStatus = async (
    sosId: string,
    newStatus: 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED'
  ) => {
    setUpdatingSosId(sosId)
    try {
      const updated = await updateSOSStatus(sosId, newStatus)
      setSosList((prev) => prev.map((item) => (item.sos_id === sosId ? updated : item)))
      try {
        const stored = JSON.parse(localStorage.getItem('eb_emergency_sos_records') || '[]')
        const updatedStored = stored.map((item: any) =>
          item.sos_id === sosId ? { ...item, status: newStatus } : item
        )
        localStorage.setItem('eb_emergency_sos_records', JSON.stringify(updatedStored))
      } catch {
        // ignore
      }
    } catch (err: any) {
      // Local fallback in case of network issue
      setSosList((prev) =>
        prev.map((item) => (item.sos_id === sosId ? { ...item, status: newStatus } : item))
      )
      try {
        const stored = JSON.parse(localStorage.getItem('eb_emergency_sos_records') || '[]')
        const updatedStored = stored.map((item: any) =>
          item.sos_id === sosId ? { ...item, status: newStatus } : item
        )
        localStorage.setItem('eb_emergency_sos_records', JSON.stringify(updatedStored))
      } catch {
        // ignore
      }
    } finally {
      setUpdatingSosId(null)
    }
  }

  const filteredSos = sosList.filter((item) => {
    if (sosFilter === 'ALL') return true
    return item.status === sosFilter
  })

  const pendingSosCount = sosList.filter((s) => s.status === 'PENDING').length

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Read-Only Mode Banner */}
      {isReadOnly && (
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-adjudo-sm ${
            isDark
              ? 'bg-cyan-950/30 border-cyan-800 text-neutral-100'
              : 'bg-cyan-50 border-cyan-300 text-cyan-950'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-xl shrink-0">
              📋
            </div>
            <div>
              <div className="text-sm font-black flex items-center gap-2 flex-wrap">
                <span>Hospital Staff &amp; Operational Capacity — Read-Only Mode</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-cyan-600 text-white font-black">
                  Verified Public View
                </span>
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5">
                You are viewing real-time staff on duty, bed availability, and operational capacity for <strong>{hospitalFacility.name}</strong>. Modifications are locked to hospital staff login.
              </p>
            </div>
          </div>
          <Link
            to="/hospitals"
            className={`px-3.5 py-2 rounded-xl text-xs font-black border transition-all text-center whitespace-nowrap shadow-adjudo-sm cursor-pointer ${
              isDark
                ? 'bg-neutral-800 border-neutral-700 text-cyan-300 hover:bg-neutral-700'
                : 'bg-white border-neutral-900 text-neutral-900 hover:bg-slate-100'
            }`}
          >
            ← Back to Hospitals
          </Link>
        </div>
      )}

      {/* Back to Hospitals Navigation (shown when not in read-only banner) */}
      {!isReadOnly && (
        <div>
          <Link
            to="/hospitals"
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-black transition-all shadow-adjudo-sm cursor-pointer ${
              isDark
                ? 'border-neutral-700 bg-neutral-900 text-cyan-300 hover:bg-neutral-800'
                : 'border-neutral-900 bg-white text-neutral-900 hover:bg-slate-50'
            }`}
          >
            <span>←</span>
            <span>Back to Available Hospitals</span>
          </Link>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION A: HOSPITAL INFORMATION BANNER                              */}
      {/* ==================================================================== */}
      <section
        className={`rounded-2xl border p-5 sm:p-6 shadow-adjudo transition-colors ${
          isDark
            ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
            : 'bg-white border-neutral-900 text-neutral-900'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isReadOnly ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  Staff &amp; SOS Management (Read-Only)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Hospital Management Portal
                </span>
              )}
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
                ID: {assignedHospitalId}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{hospitalFacility.name}</h1>
            <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 flex items-center gap-2 flex-wrap">
              <span>📍 {hospitalFacility.address}</span>
              <span>&bull;</span>
              <span>📞 {hospitalFacility.phone}</span>
              <span>&bull;</span>
              <span className="text-rose-600 dark:text-rose-400 font-bold">
                🚨 Emergency: {hospitalFacility.emergency_helpline}
              </span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="text-left sm:text-right text-xs">
              <div className="text-neutral-500 dark:text-neutral-400">
                {isReadOnly ? 'Viewing Mode:' : 'Authenticated Staff Account:'}
              </div>
              <div className="font-bold text-neutral-900 dark:text-neutral-100">
                {isReadOnly
                  ? user?.email
                    ? `${user.email} (Patient / Citizen)`
                    : 'Public Citizen (Read-Only)'
                  : user?.email || 'admin@hospital.local'}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                Last Live Broadcast:{' '}
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {lastUpdated
                    ? new Date(lastUpdated).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : 'Live KPME Sync'}
                </span>
              </div>
            </div>

            {isReadOnly ? (
              <Link
                to="/hospitals"
                className="px-3.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-black hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors shadow-adjudo-sm cursor-pointer whitespace-nowrap"
              >
                Close Read View
              </Link>
            ) : (
              <button
                type="button"
                onClick={logout}
                className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-black hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors shadow-adjudo-sm cursor-pointer whitespace-nowrap"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm font-semibold flex items-center justify-between gap-3 animate-in fade-in duration-150 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{feedback.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION B: LIVE STAFF AVAILABILITY MANAGEMENT                        */}
      {/* ==================================================================== */}
      <section
        className={`rounded-2xl border p-5 sm:p-6 shadow-adjudo transition-colors ${
          isDark
            ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
            : 'bg-white border-neutral-900 text-neutral-900'
        }`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-neutral-200 dark:border-neutral-800 mb-6 flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🩺</span>
              <h2 className="text-xl font-black">Live Staff &amp; Operational Capacity</h2>
              {isReadOnly && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-100 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                  🔒 READ-ONLY MODE
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {isReadOnly
                ? `Real-time verified on-site staffing, beds, and specialist shifts for ${hospitalFacility.name}.`
                : 'Updates made here immediately propagate to citizen hospital cards and GPS emergency dispatch.'}
            </p>
          </div>
          {isLoadingAvailability && (
            <span className="text-xs text-neutral-500 animate-pulse">Syncing with hospital record...</span>
          )}
        </div>

        <form onSubmit={handleSaveAvailability} className="space-y-6">
          {/* Top Primary Staffing Counts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Doctors */}
            <div
              className={`p-4 rounded-xl border ${
                isDark ? 'bg-neutral-800/60 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Total Doctors Available *
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={doctorsAvailable}
                onChange={(e) => !isReadOnly && setDoctorsAvailable(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full text-2xl font-black p-2 rounded-lg border outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-900/70 border-neutral-800 text-cyan-300 cursor-default'
                      : 'bg-slate-100/90 border-slate-300 text-slate-900 cursor-default'
                    : isDark
                    ? 'bg-neutral-900 border-neutral-700 text-white focus:border-orange-500'
                    : 'bg-white border-neutral-300 text-neutral-900 focus:border-neutral-900'
                }`}
                required
              />
              <span className="text-[11px] text-neutral-500 mt-1 block">Active on-site hospital doctors</span>
            </div>

            {/* Emergency Doctors */}
            <div
              className={`p-4 rounded-xl border ${
                doctorError
                  ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="block text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">
                Emergency Doctors on Duty *
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={emergencyDoctors}
                onChange={(e) => !isReadOnly && setEmergencyDoctors(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full text-2xl font-black p-2 rounded-lg border outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-900/70 border-neutral-800 text-rose-400 cursor-default'
                      : 'bg-slate-100/90 border-slate-300 text-rose-600 cursor-default'
                    : doctorError
                    ? 'border-rose-500 text-rose-600 bg-rose-50/30'
                    : isDark
                    ? 'bg-neutral-900 border-neutral-700 text-rose-400 focus:border-rose-500'
                    : 'bg-white border-neutral-300 text-rose-600 focus:border-rose-600'
                }`}
                required
              />
              {doctorError ? (
                <span className="text-[11px] text-rose-600 dark:text-rose-400 font-bold mt-1 block">
                  {doctorError}
                </span>
              ) : (
                <span className="text-[11px] text-neutral-500 mt-1 block">Triage &amp; Trauma Bay ER specialists</span>
              )}
            </div>

            {/* Total Nurses */}
            <div
              className={`p-4 rounded-xl border ${
                isDark ? 'bg-neutral-800/60 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Total Nurses Available *
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={nursesAvailable}
                onChange={(e) => !isReadOnly && setNursesAvailable(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full text-2xl font-black p-2 rounded-lg border outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-900/70 border-neutral-800 text-cyan-300 cursor-default'
                      : 'bg-slate-100/90 border-slate-300 text-slate-900 cursor-default'
                    : isDark
                    ? 'bg-neutral-900 border-neutral-700 text-white focus:border-orange-500'
                    : 'bg-white border-neutral-300 text-neutral-900 focus:border-neutral-900'
                }`}
                required
              />
              <span className="text-[11px] text-neutral-500 mt-1 block">Ward &amp; general floor nursing staff</span>
            </div>

            {/* Emergency Nurses */}
            <div
              className={`p-4 rounded-xl border ${
                nurseError
                  ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                  : isDark
                  ? 'bg-neutral-800/60 border-neutral-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="block text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">
                Emergency Nurses on Duty *
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={emergencyNurses}
                onChange={(e) => !isReadOnly && setEmergencyNurses(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full text-2xl font-black p-2 rounded-lg border outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-900/70 border-neutral-800 text-rose-400 cursor-default'
                      : 'bg-slate-100/90 border-slate-300 text-rose-600 cursor-default'
                    : nurseError
                    ? 'border-rose-500 text-rose-600 bg-rose-50/30'
                    : isDark
                    ? 'bg-neutral-900 border-neutral-700 text-rose-400 focus:border-rose-500'
                    : 'bg-white border-neutral-300 text-rose-600 focus:border-rose-600'
                }`}
                required
              />
              {nurseError ? (
                <span className="text-[11px] text-rose-600 dark:text-rose-400 font-bold mt-1 block">
                  {nurseError}
                </span>
              ) : (
                <span className="text-[11px] text-neutral-500 mt-1 block">Critical care &amp; resuscitation nurses</span>
              )}
            </div>
          </div>

          {/* Department Specialists Availability */}
          <div
            className={`p-4 sm:p-5 rounded-xl border ${
              isDark ? 'bg-neutral-800/40 border-neutral-700' : 'bg-neutral-50/80 border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                Department Specialist Headcount (On Duty Now)
              </h3>
              <span className="text-[11px] text-neutral-500">8 key medical departments</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(specialists).map(([dept, count]) => (
                <div
                  key={dept}
                  className={`p-2.5 rounded-lg border flex items-center justify-between ${
                    isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-white border-neutral-200'
                  }`}
                >
                  <span className="text-xs font-semibold">{dept}</span>
                  <input
                    type="number"
                    min="0"
                    disabled={isReadOnly}
                    readOnly={isReadOnly}
                    value={count}
                    onChange={(e) => {
                      if (isReadOnly) return
                      const val = Math.max(0, parseInt(e.target.value) || 0)
                      setSpecialists((prev) => ({ ...prev, [dept]: val }))
                    }}
                    className={`w-14 text-right font-black px-1.5 py-0.5 rounded border text-sm ${
                      isReadOnly
                        ? isDark
                          ? 'bg-neutral-800/80 border-neutral-700 text-cyan-300 cursor-default'
                          : 'bg-slate-100 border-slate-300 text-slate-900 cursor-default'
                        : isDark
                        ? 'bg-neutral-800 border-neutral-700 text-white'
                        : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Operational Status & Bed Capacities */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* General Hospital Duty Status */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Hospital Duty Status *
              </label>
              <select
                disabled={isReadOnly}
                value={dutyStatus}
                onChange={(e) => !isReadOnly && setDutyStatus(e.target.value)}
                className={`w-full p-2.5 rounded-lg border font-bold text-xs sm:text-sm outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-800/80 border-neutral-700 text-neutral-200 cursor-default'
                      : 'bg-slate-100 border-slate-300 text-slate-800 cursor-default'
                    : isDark
                    ? 'bg-neutral-800 border-neutral-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              >
                <option value="Accepting Patients">Accepting Patients (Normal Operation)</option>
                <option value="Limited">Limited (High Occupancy / Triaged Intake)</option>
                <option value="Unavailable">Unavailable (Emergency Diversion / Full)</option>
              </select>
            </div>

            {/* Emergency Dept Operational Status */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Emergency Dept Status *
              </label>
              <select
                disabled={isReadOnly}
                value={emergencyDeptStatus}
                onChange={(e) => !isReadOnly && setEmergencyDeptStatus(e.target.value)}
                className={`w-full p-2.5 rounded-lg border font-bold text-xs sm:text-sm outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-800/80 border-neutral-700 text-neutral-200 cursor-default'
                      : 'bg-slate-100 border-slate-300 text-slate-800 cursor-default'
                    : isDark
                    ? 'bg-neutral-800 border-neutral-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              >
                <option value="Operational">Operational (Full Trauma / ER Ready)</option>
                <option value="Limited">Limited (Staff Constraints / Delays)</option>
                <option value="Critical">Critical (Resuscitation Bay Priority)</option>
                <option value="Closed">Closed (Diverted to District Facility)</option>
              </select>
            </div>

            {/* Inpatient Beds Available */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Available Inpatient Beds
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={availableBeds}
                onChange={(e) => !isReadOnly && setAvailableBeds(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full p-2 rounded-lg border font-bold text-sm outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-800/80 border-neutral-700 text-cyan-300 cursor-default'
                      : 'bg-slate-100 border-slate-300 text-slate-900 cursor-default'
                    : isDark
                    ? 'bg-neutral-800 border-neutral-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            {/* Available ICU Beds */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                Available ICU Beds
              </label>
              <input
                type="number"
                min="0"
                disabled={isReadOnly}
                readOnly={isReadOnly}
                value={icuBedsAvailable}
                onChange={(e) => !isReadOnly && setIcuBedsAvailable(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-full p-2 rounded-lg border font-bold text-sm outline-none ${
                  isReadOnly
                    ? isDark
                      ? 'bg-neutral-800/80 border-neutral-700 text-rose-400 cursor-default'
                      : 'bg-slate-100 border-slate-300 text-rose-600 cursor-default'
                    : isDark
                    ? 'bg-neutral-800 border-neutral-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>
          </div>

          {/* Operational Triage Notes */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
              Operational Triage Notes (Public for Citizens &amp; Dispatchers)
            </label>
            <textarea
              rows={2}
              disabled={isReadOnly}
              readOnly={isReadOnly}
              value={notes}
              onChange={(e) => !isReadOnly && setNotes(e.target.value)}
              placeholder="e.g. Trauma Bay 1 & 2 fully staffed. 24/7 CT scan and emergency surgical team on call."
              className={`w-full p-2.5 rounded-lg border text-xs sm:text-sm outline-none ${
                isReadOnly
                  ? isDark
                    ? 'bg-neutral-800/80 border-neutral-700 text-neutral-200 cursor-default'
                    : 'bg-slate-100 border-slate-300 text-slate-800 cursor-default'
                  : isDark
                  ? 'bg-neutral-800 border-neutral-700 text-white'
                  : 'bg-white border-neutral-300 text-neutral-900'
              }`}
            />
          </div>

          {/* Save Availability Button / Read-Only View Notice */}
          <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
            <div className="text-xs text-neutral-500">
              {isReadOnly
                ? `* Telemetry Feed: Real-time operational data verified by ${hospitalFacility.name}.`
                : `* Verification: Only authenticated management personnel of ${hospitalFacility.name} can broadcast.`}
            </div>

            {isReadOnly ? (
              <div
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold ${
                  isDark
                    ? 'bg-neutral-800/80 border-neutral-700 text-cyan-300'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
              >
                <span>🔒</span>
                <span>Read-Only Citizen View: Operational capacity broadcast is verified by {hospitalFacility.name}.</span>
              </div>
            ) : (
              <button
                type="submit"
                disabled={isSavingAvailability || !isFormValid}
                className={`px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm border transition-all shadow-adjudo flex items-center gap-2 cursor-pointer ${
                  !isFormValid
                    ? 'opacity-50 cursor-not-allowed bg-neutral-300 border-neutral-400 text-neutral-600'
                    : 'bg-emerald-600 hover:bg-emerald-700 border-emerald-900 text-white'
                }`}
              >
                {isSavingAvailability ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Broadcasting Availability...</span>
                  </>
                ) : (
                  <>
                    <span>📡</span>
                    <span>Save Availability &amp; Broadcast Live</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </section>

      {/* ==================================================================== */}
      {/* SECTION C: CONNECTED EMERGENCY SOS DESK (STAFF ONLY)                 */}
      {/* ==================================================================== */}
      {!isReadOnly && (
        <section
          className={`rounded-2xl border p-5 sm:p-6 shadow-adjudo transition-colors ${
            isDark
              ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
              : 'bg-white border-neutral-900 text-neutral-900'
          }`}
        >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🚨</span>
              <h2 className="text-xl font-black">Connected Emergency SOS Dispatch Desk</h2>
              {pendingSosCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-black bg-rose-600 text-white animate-pulse">
                  {pendingSosCount} PENDING
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {isReadOnly
                ? `Live distress calls and response status routed to ${hospitalFacility.name} (View-Only).`
                : `Live distress calls routed directly to ${hospitalFacility.name} by citizens with GPS coordinates.`}
            </p>
          </div>

          {/* SOS Filter Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-bold">
            {(['ALL', 'PENDING', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSosFilter(filter)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  sosFilter === filter
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-black'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* SOS Records List */}
        {filteredSos.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
            <span className="text-3xl block mb-2">🛡️</span>
            <div className="text-sm font-bold text-neutral-700 dark:text-neutral-300">
              No distress calls match filter ({sosFilter})
            </div>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto">
              Any citizen triggering an emergency SOS routed to {hospitalFacility.name} will immediately appear
              here with GPS coordinates and patient contact.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSos.map((sos) => {
              const isPending = sos.status === 'PENDING'
              const isAcknowledged = sos.status === 'ACKNOWLEDGED'
              const isResponding = sos.status === 'RESPONDING'
              const isResolved = sos.status === 'RESOLVED'

              return (
                <div
                  key={sos.sos_id}
                  className={`p-4 rounded-xl border transition-all ${
                    isPending
                      ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/30 shadow-md ring-2 ring-rose-500/20'
                      : isResponding
                      ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-950/20'
                      : isResolved
                      ? 'border-neutral-200 dark:border-neutral-800 opacity-70'
                      : isDark
                      ? 'bg-neutral-800/60 border-neutral-700'
                      : 'bg-white border-neutral-200'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Patient & Incident Info */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider ${
                            isPending
                              ? 'bg-rose-600 text-white animate-pulse'
                              : isAcknowledged
                              ? 'bg-amber-500 text-white'
                              : isResponding
                              ? 'bg-blue-600 text-white'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          {sos.status}
                        </span>
                        <span className="font-mono text-xs text-neutral-500">#{sos.sos_id}</span>
                        <span className="text-xs text-neutral-400">&bull;</span>
                        <span className="text-xs text-neutral-500">
                          {new Date(sos.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-sm font-black text-neutral-900 dark:text-neutral-100">
                          {sos.patient_name || 'Anonymous Citizen'}
                        </span>
                        {sos.patient_phone && (
                          <a
                            href={`tel:${sos.patient_phone}`}
                            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            title="Call Patient Directly"
                          >
                            <span>📞</span>
                            <span>{sos.patient_phone}</span>
                          </a>
                        )}
                        <span className="text-xs text-neutral-400">&bull;</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200">
                          {sos.emergency_type}
                        </span>
                      </div>

                      {sos.description && (
                        <p className="text-xs text-neutral-700 dark:text-neutral-300 italic">
                          “{sos.description}”
                        </p>
                      )}

                      {/* Location & GPS */}
                      {sos.latitude && sos.longitude && (
                        <div className="flex items-center gap-2 pt-1 text-xs">
                          <span className="text-rose-600 dark:text-rose-400 font-bold">📍 GPS Coordinates:</span>
                          <span className="font-mono text-neutral-700 dark:text-neutral-300">
                            {sos.latitude.toFixed(5)}, {sos.longitude.toFixed(5)}
                          </span>
                          <a
                            href={`https://www.google.com/maps?q=${sos.latitude},${sos.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline font-bold text-xs"
                          >
                            Open in Google Maps ↗
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Operational Action Controls */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      {/* Clinical Protocol Modal Trigger */}
                      <button
                        type="button"
                        onClick={() => setProtocolModalRecord(sos)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                          isDark
                            ? 'border-neutral-700 hover:bg-neutral-700 text-neutral-200'
                            : 'border-neutral-300 hover:bg-neutral-100 text-neutral-700'
                        }`}
                        title="View ATLS / ACLS Emergency Triage Protocol"
                      >
                        📋 Protocol
                      </button>

                      {/* Status Transition Controls */}
                      {isReadOnly ? (
                        <span
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap ${
                            isPending
                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400'
                              : isAcknowledged
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                              : isResponding
                              ? 'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {isPending
                            ? '⏳ Awaiting Hospital Triage'
                            : isAcknowledged
                            ? '🛡️ Hospital Acknowledged'
                            : isResponding
                            ? '🚑 Ambulance Dispatched'
                            : '✓ Care Resolved'}
                        </span>
                      ) : (
                        <>
                          {isPending && (
                            <button
                              type="button"
                              disabled={updatingSosId === sos.sos_id}
                              onClick={() => handleUpdateSOSStatus(sos.sos_id, 'ACKNOWLEDGED')}
                              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black text-xs transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
                            >
                              {updatingSosId === sos.sos_id ? 'Updating...' : 'Acknowledge Call'}
                            </button>
                          )}

                          {(isPending || isAcknowledged) && (
                            <button
                              type="button"
                              disabled={updatingSosId === sos.sos_id}
                              onClick={() => handleUpdateSOSStatus(sos.sos_id, 'RESPONDING')}
                              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black text-xs transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
                            >
                              {updatingSosId === sos.sos_id ? 'Updating...' : 'Dispatch / Responding'}
                            </button>
                          )}

                          {isResponding && (
                            <button
                              type="button"
                              disabled={updatingSosId === sos.sos_id}
                              onClick={() => handleUpdateSOSStatus(sos.sos_id, 'RESOLVED')}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
                            >
                              {updatingSosId === sos.sos_id ? 'Updating...' : 'Mark Resolved'}
                            </button>
                          )}

                          {isResolved && (
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              ✓ Completed
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </section>
      )}

      {/* ==================================================================== */}
      {/* CLINICAL EMERGENCY PROTOCOL MODAL                                    */}
      {/* ==================================================================== */}
      {!isReadOnly && protocolModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className={`rounded-2xl max-w-xl w-full p-6 border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 ${
              isDark ? 'bg-neutral-900 border-neutral-700 text-white' : 'bg-white border-neutral-900 text-neutral-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <div>
                  <h3 className="text-base font-black">
                    Emergency Triage Protocol: {protocolModalRecord.emergency_type}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Standard Clinical Algorithm (ATLS / ACLS / BLS Evidence-Based Directive)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProtocolModalRecord(null)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed max-h-96 overflow-y-auto pr-1">
              <div
                className={`p-3 rounded-lg border ${
                  isDark ? 'bg-neutral-800/80 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                  1. Immediate Primary Survey (ABCDE)
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-neutral-700 dark:text-neutral-300">
                  <li>
                    <strong>Airway &amp; C-Spine:</strong> Assess patency. In trauma, maintain in-line cervical stabilization.
                  </li>
                  <li>
                    <strong>Breathing &amp; Ventilation:</strong> Check SpO2, bilateral breath sounds. Administer high-flow O2 if &lt;94%.
                  </li>
                  <li>
                    <strong>Circulation &amp; Haemorrhage:</strong> Apply direct pressure to external bleeding. Secure 2 large-bore IVs (16/18G).
                  </li>
                  <li>
                    <strong>Disability:</strong> Assess GCS / AVPU and pupillary light reflexes.
                  </li>
                  <li>
                    <strong>Exposure &amp; Environment:</strong> Prevent hypothermia; keep warm resuscitation fluids ready.
                  </li>
                </ul>
              </div>

              <div
                className={`p-3 rounded-lg border ${
                  isDark ? 'bg-neutral-800/80 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">
                  2. Rapid Response Notifications
                </div>
                <p className="text-neutral-700 dark:text-neutral-300">
                  Dispatch ambulance to GPS coordinates immediately. Notify On-Duty ER Trauma Registrar, Anaesthetist, and Blood Bank for type-specific pack readiness.
                </p>
              </div>

              <div
                className={`p-3 rounded-lg border ${
                  isDark ? 'bg-neutral-800/80 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
                }`}
              >
                <div className="font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">
                  3. Case Specific Details
                </div>
                <p className="text-neutral-700 dark:text-neutral-300">
                  <strong>Patient:</strong> {protocolModalRecord.patient_name || 'Unspecified'} |{' '}
                  <strong>Contact:</strong> {protocolModalRecord.patient_phone || 'Unspecified'}
                </p>
                {protocolModalRecord.description && (
                  <p className="text-neutral-600 dark:text-neutral-400 mt-1">
                    <strong>Reported Symptoms:</strong> {protocolModalRecord.description}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setProtocolModalRecord(null)}
                className="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-black"
              >
                Close Protocol
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
