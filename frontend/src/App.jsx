import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { IntroductionPage } from './pages/IntroductionPage'

const ConsentPage = lazy(() => import('./pages/ConsentPage').then((module) => ({ default: module.ConsentPage })))
const MeasurementPage = lazy(() => import('./pages/MeasurementPage').then((module) => ({ default: module.MeasurementPage })))
const CameraScanPage = lazy(() => import('./pages/CameraScanPage').then((module) => ({ default: module.CameraScanPage })))
const PhotoUploadPage = lazy(() => import('./pages/PhotoUploadPage').then((module) => ({ default: module.PhotoUploadPage })))
const PreferencesPage = lazy(() => import('./pages/PreferencesPage').then((module) => ({ default: module.PreferencesPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const ResultPage = lazy(() => import('./pages/ResultPage').then((module) => ({ default: module.ResultPage })))

export function App() {
  return (
    <Layout>
      <Suspense fallback={<div className="loading-state">Loading workspace…</div>}>
        <Routes>
          <Route path="/" element={<IntroductionPage />} />
          <Route path="/consent" element={<ConsentPage />} />
          <Route path="/measurements" element={<MeasurementPage />} />
          <Route path="/measurements/camera" element={<CameraScanPage />} />
          <Route path="/measurements/photos" element={<PhotoUploadPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/results/:id" element={<ResultPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
