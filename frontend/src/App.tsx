import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import GamePage from './pages/GamePage'
import MyGamesPage from './pages/MyGamesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/my-games" element={<MyGamesPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
