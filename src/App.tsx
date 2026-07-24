import React, { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { TradeProvider } from './context/TradeContext';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import DashboardScreen from './screens/DashboardScreen';
import ImportOrdersScreen from './screens/ImportOrdersScreen';
import SessionDetailScreen from './screens/SessionDetailScreen';
import TradesScreen from './screens/TradesScreen';
import JournalScreen from './screens/JournalScreen';
import RangeAnalysisScreen from './screens/RangeAnalysisScreen';
import MentorDashboardScreen from './screens/MentorDashboardScreen';
import WeeklyReportsScreen from './screens/WeeklyReportsScreen';
import SettingsScreen from './screens/SettingsScreen';
import UsersPermissionsScreen from './screens/UsersPermissionsScreen';
import DataConnectionsScreen from './screens/DataConnectionsScreen';
import { DateProvider } from './context/DateContext';
import { Loader2, LogIn } from 'lucide-react';
import { Button } from './components/Shared';
import { ErrorBoundary } from './components/ErrorBoundary';

function AppContent() {
  const [activePage, setActivePage] = useState('dashboard');
  const [userRole, setUserRole] = useState<'Admin' | 'Mentor' | 'Student' | 'Viewer'>('Admin');
  const { user, loading, login, loginAsTestUser } = useAuth();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 p-4">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-white">Trading Workshop OS</h1>
            <p className="text-slate-400">Sign in to access your trading dashboard and analytics.</p>
          </div>
          <Button
            className="w-full h-14 text-lg font-bold rounded-2xl shadow-lg shadow-indigo-500/20"
            icon={LogIn}
            onClick={login}
          >
            Sign in with Google
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

  const renderScreen = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardScreen />;
      case 'import':
        return <ImportOrdersScreen setActivePage={setActivePage} />;
      case 'connections':
        return <DataConnectionsScreen />;
      case 'sessions':
        return <SessionDetailScreen />;
      case 'trades':
        return <TradesScreen />;
      case 'journal':
        return <JournalScreen setActivePage={setActivePage} />;
      case 'range':
        return <RangeAnalysisScreen />;
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
      activePage={activePage}
      setActivePage={setActivePage}
      userRole={userRole}
    >
      <ErrorBoundary resetKey={activePage}>
        {renderScreen()}
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
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
