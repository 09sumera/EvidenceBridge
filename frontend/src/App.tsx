import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { VoiceProvider } from './context/VoiceContext'
import { AuditProvider } from './context/AuditContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Home from './pages/Home'
import Claims from './pages/Claims'
import ClaimDetail from './pages/ClaimDetail'
import TrustDensity from './pages/TrustDensity'
import Evaluation from './pages/Evaluation'
import CommunityStories from './pages/CommunityStories'
import Insights from './pages/Insights'
import HospitalFinder from './pages/HospitalFinder'
import HospitalManagement from './pages/HospitalManagement'

function RootRoute() {
  const { isAuthenticated, isHospitalManagement } = useAuth()
  if (!isAuthenticated) {
    return <Landing />
  }
  if (isHospitalManagement) {
    return <Navigate to="/hospital/management" replace />
  }
  return <Navigate to="/audit" replace />
}

/**
 * Route guard strictly ensuring only authenticated HOSPITAL_MANAGEMENT
 * can access the single Hospital Staff & SOS Management page.
 */
function HospitalManagementGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isHospitalManagement } = useAuth()
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  if (!isHospitalManagement) {
    // Strictly prevent patient accounts from accessing hospital management desk
    return <Navigate to="/hospitals" replace />
  }
  return <>{children}</>
}

/**
 * Route guard strictly ensuring HOSPITAL_MANAGEMENT cannot access patient
 * workflows (Audit Claim, Claims Explorer, Insights, Patient Directory, etc.)
 */
function PatientWorkflowGuard({ children }: { children: React.ReactNode }) {
  const { isHospitalManagement } = useAuth()
  if (isHospitalManagement) {
    return <Navigate to="/hospital/management" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuditProvider>
          <BrowserRouter>
            <VoiceProvider>
              <Routes>
                {/* Landing page at root when unauthenticated */}
                <Route path="/" element={<RootRoute />} />
                <Route
                  path="/welcome"
                  element={
                    <PatientWorkflowGuard>
                      <Landing />
                    </PatientWorkflowGuard>
                  }
                />

                {/* Main workspace layout */}
                <Route element={<Layout />}>
                  {/* Single Dedicated Hospital Staff & SOS Management Route */}
                  <Route
                    path="/hospital/management"
                    element={
                      <HospitalManagementGuard>
                        <HospitalManagement />
                      </HospitalManagementGuard>
                    }
                  />

                  {/* Patient Workflows (Guarded from Hospital Management) */}
                  <Route
                    path="/audit"
                    element={
                      <PatientWorkflowGuard>
                        <Home />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route
                    path="/claims"
                    element={
                      <PatientWorkflowGuard>
                        <Claims />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route
                    path="/claims/:claimId"
                    element={
                      <PatientWorkflowGuard>
                        <ClaimDetail />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route
                    path="/trust-density"
                    element={
                      <PatientWorkflowGuard>
                        <TrustDensity />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route
                    path="/insights"
                    element={
                      <PatientWorkflowGuard>
                        <Insights />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route path="/dashboard" element={<Navigate to="/insights" replace />} />
                  <Route
                    path="/hospitals"
                    element={
                      <PatientWorkflowGuard>
                        <HospitalFinder />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route path="/finder" element={<Navigate to="/hospitals" replace />} />
                  <Route
                    path="/evaluation"
                    element={
                      <PatientWorkflowGuard>
                        <Evaluation />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route
                    path="/community"
                    element={
                      <PatientWorkflowGuard>
                        <CommunityStories />
                      </PatientWorkflowGuard>
                    }
                  />
                  <Route path="/stories" element={<Navigate to="/community" replace />} />
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </VoiceProvider>
          </BrowserRouter>
        </AuditProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
