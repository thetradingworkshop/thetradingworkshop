import React, { useState, useEffect, useRef } from 'react';
import { RecaptchaVerifier, PhoneMultiFactorGenerator } from 'firebase/auth';
import { auth } from './firebase';
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
import { Loader2, LogIn, WifiOff, RotateCcw, Mail, ShieldCheck } from 'lucide-react';
import { Button, Input } from './components/Shared';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SharePage } from './components/SharePage';
import { usePersistedState } from './hooks/usePersistedState';

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
  // Persisted (not plain useState) so a browser refresh reopens whatever
  // page you were on instead of always bouncing back to Dashboard — this
  // app has no path-based routing (see the module comment above), so the
  // URL itself never reflected the current page in the first place.
  const [activePage, setActivePage] = usePersistedState<string>('activePage', 'dashboard');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const {
    user, role, roleLoading, loading, login, loginAsTestUser, loginError, clearLoginError, roleError, retryRole,
    signInWithEmail, signUpWithEmail,
    mfaResolver, mfaCodeSent, mfaError, sendMfaCode, resolveMfaChallenge, cancelMfaChallenge,
  } = useAuth();

  // 'google' shows just the Google button (the original, still-default
  // entry point); 'email-signin'/'email-signup' reveal the email/password
  // form in its two modes. Kept as one piece of state so switching modes
  // always starts from a clean form instead of leaking a half-filled one.
  const [emailAuthMode, setEmailAuthMode] = useState<'google' | 'email-signin' | 'email-signup'>('google');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [isSubmittingMfa, setIsSubmittingMfa] = useState(false);
  const [isSendingMfaCode, setIsSendingMfaCode] = useState(false);
  const mfaRecaptchaRef = useRef<HTMLDivElement>(null);
  const hasAutoSentMfaCode = useRef(false);

  const handleLogin = async () => {
    setIsSigningIn(true);
    try {
      await login();
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingEmail(true);
    try {
      if (emailAuthMode === 'email-signup') {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingMfa(true);
    try {
      await resolveMfaChallenge(mfaCode);
      setMfaCode('');
    } finally {
      setIsSubmittingMfa(false);
    }
  };

  // A phone code isn't already sitting on the user's device like a TOTP
  // one would be — Firebase has to actually send it, which needs a fresh
  // reCAPTCHA verifier each time. Auto-fires once as soon as the challenge
  // screen mounts (see the effect below); "Resend code" calls this same
  // function again directly.
  const triggerSendMfaCode = async () => {
    if (!mfaRecaptchaRef.current) return;
    setIsSendingMfaCode(true);
    const verifier = new RecaptchaVerifier(auth, mfaRecaptchaRef.current, { size: 'invisible' });
    try {
      await sendMfaCode(verifier);
    } finally {
      verifier.clear();
      setIsSendingMfaCode(false);
    }
  };

  useEffect(() => {
    if (mfaResolver && !hasAutoSentMfaCode.current) {
      hasAutoSentMfaCode.current = true;
      triggerSendMfaCode();
    }
    if (!mfaResolver) hasAutoSentMfaCode.current = false;
  }, [mfaResolver]);

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

  // Set the moment either sign-in path (Google or email/password) finds
  // the account has a phone/SMS factor enrolled — `user` is still null
  // here, sign-in is paused mid-flow waiting on this code, not finished
  // yet. The reCAPTCHA container has to be in the DOM even while the code
  // is still sending (triggerSendMfaCode's effect runs before the "code
  // sent" branch below would otherwise render it).
  if (mfaResolver) {
    const phoneHint = mfaResolver.hints.find(h => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) as
      | { phoneNumber?: string }
      | undefined;
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 p-4">
        <div ref={mfaRecaptchaRef} />
        <form onSubmit={handleMfaSubmit} className="max-w-sm w-full space-y-6 text-center">
          <ShieldCheck className="w-10 h-10 text-indigo-400 mx-auto" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Two-factor verification</h1>
            <p className="text-slate-400 text-sm">
              {mfaCodeSent
                ? `Enter the code we texted to ${phoneHint?.phoneNumber || 'your phone'}.`
                : `Sending a code to ${phoneHint?.phoneNumber || 'your phone'}...`}
            </p>
          </div>
          {mfaError && <p className="text-sm text-rose-400 font-medium -mt-2">{mfaError}</p>}
          {mfaCodeSent && (
            <>
              <Input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="text-center text-lg tracking-[0.3em] font-bold bg-slate-900 border-slate-700 text-white"
              />
              <Button
                className="w-full h-12 text-sm font-bold rounded-2xl"
                icon={isSubmittingMfa ? Loader2 : ShieldCheck}
                disabled={isSubmittingMfa || mfaCode.length < 6}
              >
                {isSubmittingMfa ? 'Verifying...' : 'Verify'}
              </Button>
              <button
                type="button"
                onClick={triggerSendMfaCode}
                disabled={isSendingMfaCode}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
              >
                {isSendingMfaCode ? 'Resending...' : "Didn't get a code? Resend it"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { cancelMfaChallenge(); setMfaCode(''); }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors block w-full"
          >
            Cancel and use a different account
          </button>
        </form>
      </div>
    );
  }

  if (!user) {
    // Set by AuthContext.tsx when the page was loaded from an invite link
    // (?invite=CODE) — the code itself isn't looked up until after sign-in
    // (reading it requires being authenticated at all, see firestore.rules),
    // so this is just a "you have one" indicator, not invite details.
    const hasPendingInvite = typeof window !== 'undefined' && !!sessionStorage.getItem('pendingInviteCode');
    const isEmailMode = emailAuthMode !== 'google';
    const switchMode = (mode: typeof emailAuthMode) => {
      setEmailAuthMode(mode);
      clearLoginError();
    };
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

          {!isEmailMode && (
            <>
              <Button
                className="w-full h-14 text-lg font-bold rounded-2xl shadow-lg shadow-indigo-500/20"
                icon={isSigningIn ? Loader2 : LogIn}
                onClick={handleLogin}
                disabled={isSigningIn}
              >
                {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
              </Button>
              <button
                type="button"
                onClick={() => switchMode('email-signin')}
                className="flex items-center justify-center gap-2 w-full text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Mail className="w-4 h-4" /> Sign in with email and password instead
              </button>
            </>
          )}

          {isEmailMode && (
            <form onSubmit={handleEmailSubmit} className="space-y-4 text-left">
              {emailAuthMode === 'email-signup' && (
                <Input
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              )}
              <Input
                type="email"
                placeholder="Email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
              <Input
                type="password"
                placeholder="Password"
                autoComplete={emailAuthMode === 'email-signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
              <Button
                className="w-full h-12 text-sm font-bold rounded-2xl"
                icon={isSubmittingEmail ? Loader2 : Mail}
                disabled={isSubmittingEmail}
              >
                {isSubmittingEmail
                  ? (emailAuthMode === 'email-signup' ? 'Creating account...' : 'Signing in...')
                  : (emailAuthMode === 'email-signup' ? 'Create account' : 'Sign in')}
              </Button>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => switchMode(emailAuthMode === 'email-signup' ? 'email-signin' : 'email-signup')}
                  className="hover:text-slate-300 transition-colors"
                >
                  {emailAuthMode === 'email-signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
                </button>
                <button type="button" onClick={() => switchMode('google')} className="hover:text-slate-300 transition-colors">
                  Back
                </button>
              </div>
            </form>
          )}

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
        return <SettingsScreen setActivePage={setActivePage} />;
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
