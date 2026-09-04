import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ConsentPage } from './pages/ConsentPage'
import { IntroductionPage } from './pages/IntroductionPage'
import { MeasurementPage } from './pages/MeasurementPage'
import { PreferencesPage } from './pages/PreferencesPage'
import { ResultPage } from './pages/ResultPage'
import { ReviewPage } from './pages/ReviewPage'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<IntroductionPage />} />
        <Route path="/consent" element={<ConsentPage />} />
        <Route path="/measurements" element={<MeasurementPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/results/:id" element={<ResultPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

