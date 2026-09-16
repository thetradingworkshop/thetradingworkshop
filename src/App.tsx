import React, { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { TradeProvider } from './context/TradeContext';
import { AppShell, navItems } from './components/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardScreen from './screens/DashboardScreen';
import ImportOrdersScreen from './screens/ImportOrdersScreen';
import SessionDetailScreen from './screens/SessionDetailScreen';
import TradesScreen from './screens/TradesScreen';
import JournalScreen from './screens/JournalScreen';
import RangeAnalysisScreen from './screens/RangeAnalysisScreen';
import StrategiesScreen from './screens/StrategiesScreen';
import DayViewScreen from './screens/DayViewScreen';
import ReportsScreen from './screens/ReportsScreen';
import MentorDashboardScreen from './screens/MentorDashboardScreen';
import WeeklyReportsScreen from './screens/WeeklyReportsScreen';
import SettingsScreen from './screens/SettingsScreen';
import UsersPermissionsScreen from './screens/UsersPermissionsScreen';
import DataConnectionsScreen from './screens/DataConnectionsScreen';
import { DateProvider } from './context/DateContext';
import { Loader2, LogIn, WifiOff, RotateCcw } from 'lucide-react';
import { Button } from './components/Shared';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SharePage } from './components/SharePage';

// This app otherwise has no path-based routing at all — every other screen
// is client-side tab state (`activePage`), gated behind AuthProvider's sign-
// in wall. A share link has to work for someone with no account, so it's
// checked here, before any of that — matched purely on window.location,
// bypassing AuthProvider/TradeProvider/etc. entirely rather than teaching
// them about an unauthenticated case. (The production server's catch-all —
// server.ts's `app.get("*", ...)` — already serves index.html for any path,
// so /share/xyz reaches this same bundle same as every other URL does.)
function shareTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

function AppContent() {
  const [activePage, setActivePage] = useState('dashboard');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { user, role, roleLoading, loading, login, loginAsTestUser, loginError, roleError, retryRole } = useAuth();

  const handleLogin = async () => {
    setIsSigningIn(true);
    try {
      await login();
    } finally {
      setIsSigningIn(false);
    }
  };

  if (loading || (user && roleLoading)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // A connection that never completed its first Firestore round-trip (see
  // the 2026-09-16 incident: a network that kept killing long-polling
  // connections made a real Admin account render as a brand-new, roleless
  // Student one) is NOT the same as a genuinely new account with no
  // profile doc — only the latter should fall back to Student below.
  if (user && roleError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <WifiOff className="w-8 h-8 text-slate-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">Couldn't verify your account</h1>
          <p className="text-sm text-slate-400">{roleError}</p>
          <Button variant="outline" icon={RotateCcw} onClick={retryRole}>Retry</Button>
        </div>
      </div>
    );
  }

  // Real role from users/{uid}.role (see AuthContext.tsx) — falls back to
  // the least-privileged role only in the edge case where a signed-in
  // account genuinely has no Firestore profile doc, never to Admin.
  const userRole = role || 'Student';

  if (!user) {
    // Set by AuthContext.tsx when the page was loaded from an invite link
    // (?invite=CODE) — the code itself isn't looked up until after sign-in
    // (reading it requires being authenticated at all, see firestore.rules),
    // so this is just a "you have one" indicator, not invite details.
    const hasPendingInvite = typeof window !== 'undefined' && !!sessionStorage.getItem('pendingInviteCode');
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-white">Trading Workshop OS</h1>
            <p className="text-slate-400">Sign in to access your trading dashboard and analytics.</p>
            {hasPendingInvite && (
              <p className="text-sm text-indigo-400 font-medium pt-2">
                You've been invited — sign in to join with your assigned access.
              </p>
            )}
          </div>
          {loginError && (
            <p className="text-sm text-rose-400 font-medium -mt-2">{loginError}</p>
          )}
          <Button
            className="w-full h-14 text-lg font-bold rounded-2xl shadow-lg shadow-indigo-500/20"
            icon={isSigningIn ? Loader2 : LogIn}
            onClick={handleLogin}
            disabled={isSigningIn}
          >
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </Button>
          {import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && (
            <Button
              variant="outline"
              className="w-full h-12 text-sm font-bold rounded-2xl"
              icon={LogIn}
              onClick={loginAsTestUser}
            >
              Sign in as Test User (Emulator)
            </Button>
          )}
        </div>
      </div>
    );
  }

  // AppShell's sidebar already hides pages a role can't see, but hiding a
  // nav link isn't the same as enforcing the boundary — anything else that
  // calls setActivePage with a page id outside the current role's list
  // (e.g. a Viewer somehow reaching Dashboard's "Add Trade Manually"
  // button, which navigates to 'trades') would previously have rendered it
  // anyway. Falls back to Dashboard, same as an unrecognized page id would.
  const activeNavItem = navItems.find(item => item.id === activePage);
  const isPageAllowed = !activeNavItem || activeNavItem.roles.includes(userRole);
  const effectivePage = isPageAllowed ? activePage : 'dashboard';

  const renderScreen = () => {
    switch (effectivePage) {
      case 'dashboard':
        return <DashboardScreen setActivePage={setActivePage} />;
      case 'import':
        return <ImportOrdersScreen setActivePage={setActivePage} />;
      case 'connections':
        return <DataConnectionsScreen />;
      case 'sessions':
        return <SessionDetailScreen />;
      case 'dayview':
        return <DayViewScreen setActivePage={setActivePage} />;
      case 'trades':
        return <TradesScreen />;
      case 'journal':
        return <JournalScreen setActivePage={setActivePage} />;
      case 'range':
        return <RangeAnalysisScreen />;
      case 'trade-reports':
        return <ReportsScreen />;
      case 'strategies':
        return <StrategiesScreen />;
      case 'mentor':
        return <MentorDashboardScreen />;
      case 'reports':
        return <WeeklyReportsScreen />;
      case 'settings':
        return <SettingsScreen />;
      case 'admin':
        return <UsersPermissionsScreen />;
      default:
        return <DashboardScreen />;
    }
  };

  return (
    <AppShell
      activePage={effectivePage}
      setActivePage={setActivePage}
      userRole={userRole}
    >
      <ErrorBoundary resetKey={effectivePage}>
        {renderScreen()}
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  const shareToken = shareTokenFromPath();
  if (shareToken) {
    return (
      <ThemeProvider>
        <SharePage token={shareToken} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <DateProvider>
          <TradeProvider>
            <AppContent />
          </TradeProvider>
        </DateProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
