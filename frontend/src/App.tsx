import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { SendPage } from './pages/SendPage';
import { ClaimPage } from './pages/ClaimPage';
import { HistoryPage } from './pages/HistoryPage';
import { useXAuth } from './hooks/useXAuth';
import { Shield, ExternalLink } from 'lucide-react';

export const App: React.FC = () => {
  const { user, login, logout } = useXAuth();

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-dark-bg text-slate-100 flex flex-col font-sans selection:bg-brand-500/30 selection:text-white">
        {/* Navigation */}
        <Navbar user={user} onLogin={login} onLogout={logout} />

        {/* Main Content Area */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
          <Routes>
            <Route path="/" element={<SendPage />} />
            <Route path="/claim" element={<ClaimPage />} />
            <Route path="/claim/:id" element={<ClaimPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="w-full border-t border-dark-border bg-dark-bg/60 backdrop-blur-md py-6 sm:py-8 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-slate-200">UPRAIL.app</span>
              <span>•</span>
              <span className="flex items-center text-slate-400">
                <Shield className="w-3.5 h-3.5 text-brand-400 mr-1 inline" />
                Confidential Intents powered by NEAR & WebAuthn
              </span>
            </div>

            <div className="flex items-center space-x-6">
              <a
                href="https://docs.near-intents.org"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors flex items-center"
              >
                NEAR Intents Docs
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
              <a
                href="https://uprail.app"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                Privacy
              </a>
              <span className="text-slate-600">v0.1.0-beta</span>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
};

export default App;
