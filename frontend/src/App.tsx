import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './views/LandingPage';
import { AppHome } from './views/AppHome';
import { SendPage } from './views/SendPage';
import { ReceivePage } from './views/ReceivePage';
import { ClaimPage } from './views/ClaimPage';
import { HistoryPage } from './views/HistoryPage';
import { LoginPage } from './views/LoginPage';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';

const isSubdomainApp = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('app.');
};

export const App: React.FC = () => {
  const isAppDomain = isSubdomainApp();

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing Page on uprail.world, or App Home on app.uprail.world (protected) */}
        <Route
          path="/"
          element={
            isAppDomain ? (
              <ProtectedRoute>
                <AppLayout>
                  <AppHome />
                </AppLayout>
              </ProtectedRoute>
            ) : (
              <LandingPage />
            )
          }
        />

        {/* Dedicated App Dashboard (Strictly Protected) */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppLayout>
                <AppHome />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/home"
          element={
            <ProtectedRoute>
              <AppLayout>
                <AppHome />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* Dedicated Send Page (𝕏 Handle & Wallet via Intents - Strictly Protected) */}
        <Route
          path="/app/send"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SendPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/send" element={<Navigate to="/app/send" replace />} />

        {/* Dedicated Receive Page (Cross-chain Intents - Strictly Protected) */}
        <Route
          path="/app/receive"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ReceivePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/receive" element={<Navigate to="/app/receive" replace />} />

        {/* Dedicated Claim Page (Hardware Biometrics - Strictly Protected) */}
        <Route
          path="/app/claim"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ClaimPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/claim/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ClaimPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/claim" element={<Navigate to="/app/claim" replace />} />
        <Route
          path="/claim/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ClaimPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* Dedicated History Page (Strictly Protected) */}
        <Route
          path="/app/history"
          element={
            <ProtectedRoute>
              <AppLayout>
                <HistoryPage />
              </AppLayout>
            </ProtectedRoute>
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
