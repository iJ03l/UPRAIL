import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { LandingPage } from './pages/LandingPage';
import { SendPage } from './pages/SendPage';
import { ClaimPage } from './pages/ClaimPage';
import { HistoryPage } from './pages/HistoryPage';
import { useXAuth } from './hooks/useXAuth';
import { Shield, ExternalLink } from 'lucide-react';

const isSubdomainApp = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('app.');
};

// Layout for app routes
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, login, logout } = useXAuth();

  return (
    <div className="min-h-screen bg-[#0A0807] text-[#F5F2EF] flex flex-col font-sans selection:bg-[#E05326] selection:text-white">
      <Navbar user={user} onLogin={login} onLogout={logout} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {children}
      </main>

      <footer className="w-full border-t border-[#2C221D] bg-[#0A0807] py-6 sm:py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8A7E76]">
          <div className="flex items-center space-x-2">
            <span className="font-display font-bold text-white">UPRAIL</span>
            <span>•</span>
            <span className="flex items-center text-[#C3B9B2]">
              <Shield className="w-3.5 h-3.5 text-[#E05326] mr-1.5 inline" />
              Confidential Value Railway • app.uprail.world
            </span>
          </div>

          <div className="flex items-center space-x-6">
            <a
              href="https://docs.near-intents.org"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors flex items-center"
            >
              NEAR Intents
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
            <a
              href="https://uprail.world"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              uprail.world
            </a>
            <span className="font-mono text-[#E05326]">v1.0.0-GA</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  const isAppDomain = isSubdomainApp();

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing Page on uprail.world (or / if not on app. subdomain) */}
        <Route
          path="/"
          element={
            isAppDomain ? (
              <AppLayout>
                <SendPage />
              </AppLayout>
            ) : (
              <LandingPage />
            )
          }
        />

        {/* Functional App Routes on app.uprail.world or /app */}
        <Route
          path="/app"
          element={
            <AppLayout>
              <SendPage />
            </AppLayout>
          }
        />
        <Route
          path="/app/send"
          element={
            <AppLayout>
              <SendPage />
            </AppLayout>
          }
        />
        <Route
          path="/app/claim"
          element={
            <AppLayout>
              <ClaimPage />
            </AppLayout>
          }
        />
        <Route
          path="/app/claim/:id"
          element={
            <AppLayout>
              <ClaimPage />
            </AppLayout>
          }
        />
        <Route
          path="/app/history"
          element={
            <AppLayout>
              <HistoryPage />
            </AppLayout>
          }
        />

        {/* Direct shortcuts */}
        <Route
          path="/claim"
          element={
            <AppLayout>
              <ClaimPage />
            </AppLayout>
          }
        />
        <Route
          path="/claim/:id"
          element={
            <AppLayout>
              <ClaimPage />
            </AppLayout>
          }
        />
        <Route
          path="/history"
          element={
            <AppLayout>
              <HistoryPage />
            </AppLayout>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
