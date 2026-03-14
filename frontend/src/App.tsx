import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WalletContext, useWalletProvider } from './hooks/useWallet'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import GamePage from './pages/GamePage'
import MyGamesPage from './pages/MyGamesPage'

export default function App() {
  const wallet = useWalletProvider()

  return (
    <WalletContext.Provider value={wallet}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/game/:id" element={<GamePage />} />
            <Route path="/my-games" element={<MyGamesPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </WalletContext.Provider>
  )
}
