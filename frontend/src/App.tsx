import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { AppHome } from './pages/AppHome';
import { SendPage } from './pages/SendPage';
import { ReceivePage } from './pages/ReceivePage';
import { ClaimPage } from './pages/ClaimPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { AppLayout } from './components/AppLayout';

const isSubdomainApp = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('app.');
};

export const App: React.FC = () => {
  const isAppDomain = isSubdomainApp();

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing Page on uprail.world, or App Home on app.uprail.world */}
        <Route
          path="/"
          element={
            isAppDomain ? (
              <AppLayout>
                <AppHome />
              </AppLayout>
            ) : (
              <LandingPage />
            )
          }
        />

        {/* Dedicated App Dashboard */}
        <Route
          path="/app"
          element={
            <AppLayout>
              <AppHome />
            </AppLayout>
          }
        />
        <Route
          path="/app/home"
          element={
            <AppLayout>
              <AppHome />
            </AppLayout>
          }
        />

        {/* Dedicated Send Page (𝕏 Handle & Wallet via Intents) */}
        <Route
          path="/app/send"
          element={
            <AppLayout>
              <SendPage />
            </AppLayout>
          }
        />
        <Route path="/send" element={<Navigate to="/app/send" replace />} />

        {/* Dedicated Receive Page (Cross-chain Intents) */}
        <Route
          path="/app/receive"
          element={
            <AppLayout>
              <ReceivePage />
            </AppLayout>
          }
        />
        <Route path="/receive" element={<Navigate to="/app/receive" replace />} />

        {/* Dedicated Claim Page (Hardware Biometrics) */}
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
        <Route path="/claim" element={<Navigate to="/app/claim" replace />} />
        <Route
          path="/claim/:id"
          element={
            <AppLayout>
              <ClaimPage />
            </AppLayout>
          }
        />

        {/* Dedicated History Page (Simple clean list) */}
        <Route
          path="/app/history"
          element={
            <AppLayout>
              <HistoryPage />
            </AppLayout>
          }
        />
        <Route path="/history" element={<Navigate to="/app/history" replace />} />

        {/* Dedicated Login Page (Not a modal) */}
        <Route path="/login" element={<LoginPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
