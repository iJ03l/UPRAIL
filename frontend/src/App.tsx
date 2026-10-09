import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './views/LandingPage';
import { AppHome } from './views/AppHome';
import { SendPage } from './views/SendPage';
import { ReceivePage } from './views/ReceivePage';
import { ClaimPage } from './views/ClaimPage';
import { HistoryPage } from './views/HistoryPage';
import { LoginPage } from './views/LoginPage';
import { ParkingPage } from './views/ParkingPage';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ArrowRight, ShieldAlert } from 'lucide-react';

const isSubdomainApp = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('app.');
};

const isApexDomain = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'uprail.world' || host === 'www.uprail.world';
};

/**
 * Strictly forbidden screen shown whenever an /app or internal route
 * is accessed directly on the apex uprail.world domain.
 */
const ForbiddenOnApex: React.FC = () => {
  return (
    <div className="min-h-screen bg-stone-950 text-white flex flex-col items-center justify-center p-6 text-center select-none font-sans">
      <div className="max-w-md w-full bg-stone-900 border border-stone-800 rounded-3xl p-8 sm:p-10 shadow-2xl space-y-6">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono font-bold uppercase tracking-wider">
          <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
          <span>403 Forbidden</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-white">
            Application Restricted
          </h1>
          <p className="text-xs sm:text-sm text-stone-400 font-sans leading-relaxed">
            The application is strictly forbidden on <strong className="text-stone-200">uprail.world</strong> and is only accessible on the dedicated secure subdomain:
          </p>
        </div>

        <div className="p-3 bg-black/60 border border-stone-800 rounded-2xl font-mono text-xs sm:text-sm text-[#E05326] font-bold">
          https://app.uprail.world
        </div>

        <div className="pt-2">
          <a
            href="https://app.uprail.world"
            className="w-full inline-flex items-center justify-center space-x-2 px-6 py-3.5 rounded-2xl bg-white hover:bg-stone-200 text-black font-display font-bold text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
          >
            <span>Launch app.uprail.world</span>
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const isAppDomain = isSubdomainApp();
  const isApex = isApexDomain();

  // If on apex uprail.world:
  // - Landing page on `/`
  // - 403 Forbidden on `/app` or `/app/*`
  // - Immediate redirect to app.uprail.world for `/login` and any other routes
  if (isApex) {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      if (pathname === '/login' || pathname.startsWith('/login/')) {
        window.location.href = `https://app.uprail.world${pathname}${window.location.search}`;
        return null;
      }
      if (
        pathname !== '/' &&
        !pathname.startsWith('/app')
      ) {
        window.location.href = `https://app.uprail.world${pathname}${window.location.search}`;
        return null;
      }
    }

    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="*" element={<ForbiddenOnApex />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Landing Page on root (or App Home if on app.uprail.world) */}
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

        {/* Dedicated Login Page */}
        <Route path="/login" element={<LoginPage />} />

        {/* Comical First-Time User Parking Page */}
        <Route path="/parking" element={<ParkingPage />} />
        <Route path="/app/parking" element={<Navigate to="/parking" replace />} />

        {/* Server Auth Route Passthrough */}
        <Route
          path="/auth/*"
          element={
            <div className="min-h-screen bg-stone-50 flex items-center justify-center font-mono text-xs text-stone-500">
              Connecting...
            </div>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to={isAppDomain ? '/app' : '/'} replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
