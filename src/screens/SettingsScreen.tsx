import React, { useState, useEffect, useRef } from 'react';
import { SectionHeader, Card, Button, Toast, Modal, Input } from '../components/Shared';
import { Bell, Shield, User, Database, Wallet, AlertTriangle, Link2, UserCheck, Zap, Upload, LogOut, Trash2, ShieldCheck } from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  MultiFactorInfo,
  RecaptchaVerifier,
  updateProfile as updateAuthProfile,
  verifyBeforeUpdateEmail,
  updatePassword,
  EmailAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
import { RiskSettings, NotificationPrefs } from '../types';
import { revokeAllSessions } from '../lib/accountSecurity';
import { sendEnrollmentCode, finishPhoneEnrollment, listEnrolledFactors, unenrollFactor } from '../lib/mfa';
import TradingAccountsSettings from './TradingAccountsSettings';
import ReferralsSettings from './ReferralsSettings';
import MentorSettings from './MentorSettings';
import DataConnectionsScreen from './DataConnectionsScreen';
import ImportOrdersScreen from './ImportOrdersScreen';

const EMPTY_RISK_FORM = {
  maxDailyLossUsd: '',
  maxDailyLossPct: '',
  riskPerTradePct: '',
  maxPositionSize: '',
  maxConsecutiveLosses: '',
  dailyProfitTarget: '',
  weeklyProfitTarget: '',
  monthlyProfitTarget: '',
};

export default function SettingsScreen({ setActivePage }: { setActivePage: (page: string) => void }) {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'trading-parameters' | 'risk-parameters' | 'accounts' | 'connections' | 'import' | 'referrals' | 'mentor' | 'notifications' | 'security'>('trading-parameters');
  const { clearTrades } = useTrades();
  const { user, role, logout, resendVerificationEmail } = useAuth();
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [isClearingTrades, setIsClearingTrades] = useState(false);

  // Profile — firstName/lastName/address live only in Firestore; name stays
  // in sync (derived as "first last") so every existing screen that reads
  // users/{uid}.name as a single string (Users & Permissions, mentor
  // assignment, audit logs, initials avatars, etc.) keeps working
  // unchanged. Email/password are real Firebase Auth account attributes,
  // not Firestore fields, so each gets its own save action and its own
  // Auth-specific error handling (recent-login, weak-password, etc.).
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', address: '' });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const hasPasswordProvider = user?.providerData.some(p => p.providerId === 'password') ?? false;

  const [riskForm, setRiskForm] = useState(EMPTY_RISK_FORM);
  const [isLoadingRisk, setIsLoadingRisk] = useState(true);
  const [isSavingRisk, setIsSavingRisk] = useState(false);

  // Notifications — mute toggles for the app's only two real in-app unread
  // badges (AppShell.tsx). No email/push infra exists anywhere in the app,
  // so this is deliberately scoped to just these two real signals.
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>({});
  const [isSavingNotificationPrefs, setIsSavingNotificationPrefs] = useState(false);

  // Security
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isDeletionConfirmOpen, setIsDeletionConfirmOpen] = useState(false);

  // Two-factor authentication (phone/SMS) — enroll/unenroll acts on the
  // live Firebase User object directly (multiFactor()), not Firestore, so
  // there's nothing to load from a doc; enrolledFactors is re-read off
  // `user` itself after every change via refreshEnrolledFactors.
  const [enrolledFactors, setEnrolledFactors] = useState<MultiFactorInfo[]>([]);
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [enrollPhoneNumber, setEnrollPhoneNumber] = useState('');
  const [enrollVerificationId, setEnrollVerificationId] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState('');
  const [isSendingEnrollCode, setIsSendingEnrollCode] = useState(false);
  const [isFinishingEnroll, setIsFinishingEnroll] = useState(false);
  const [unenrollingUid, setUnenrollingUid] = useState<string | null>(null);
  const enrollRecaptchaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const data = snap.data();
      setNotificationPrefs(data?.notificationPrefs || {});
      setDeletionRequested(!!data?.deletionRequested);
      // Older accounts only ever had a single combined `name` field —
      // split it as a starting guess so the form isn't blank the first
      // time someone visits, without ever writing that guess back until
      // they actually hit Save.
      const existingName: string = data?.name || user.displayName || '';
      const [firstGuess, ...restGuess] = existingName.split(' ').filter(Boolean);
      setProfileForm({
        firstName: data?.firstName ?? firstGuess ?? '',
        lastName: data?.lastName ?? restGuess.join(' '),
        address: data?.address ?? '',
      });
    });
    setNewEmail(user.email || '');
  }, [user?.uid]);

  const saveNotificationPrefs = async (patch: Partial<NotificationPrefs>) => {
    if (!user) return;
    const next = { ...notificationPrefs, ...patch };
    setNotificationPrefs(next);
    setIsSavingNotificationPrefs(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { notificationPrefs: next }, { merge: true });
    } catch (err: any) {
      setToast({ message: `Failed to save notification settings: ${err?.message || 'Unknown error'}`, type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsSavingNotificationPrefs(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    try {
      const fullName = `${profileForm.firstName} ${profileForm.lastName}`.trim();
      await setDoc(doc(db, 'users', user.uid), {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        address: profileForm.address,
        ...(fullName ? { name: fullName } : {}),
      }, { merge: true });
      if (fullName && fullName !== user.displayName) {
        await updateAuthProfile(user, { displayName: fullName });
      }
      setToast({ message: 'Profile updated.', type: 'success' });
    } catch (err: any) {
      setToast({ message: `Failed to update profile: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSavingProfile(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleChangeEmail = async () => {
    if (!user || !newEmail.trim()) return;
    setIsSavingEmail(true);
    try {
      // Sends a confirmation link to the NEW address rather than swapping
      // it immediately — the safer of the two SDK options, since an
      // instant swap would let anyone who briefly gets hold of a signed-in
      // session redirect account recovery to an address they control.
      await verifyBeforeUpdateEmail(user, newEmail.trim());
      setEmailChangePending(true);
      setToast({ message: `Verification link sent to ${newEmail.trim()} — click it to finish changing your email.`, type: 'success' });
    } catch (err: any) {
      const message = err?.code === 'auth/requires-recent-login'
        ? 'For security, please sign out and back in, then try again.'
        : err?.code === 'auth/email-already-in-use'
        ? 'That email is already in use by another account.'
        : err?.code === 'auth/invalid-email'
        ? 'Enter a valid email address.'
        : `Failed to update email: ${err?.message || 'Unknown error'}`;
      setToast({ message, type: 'error' });
    } finally {
      setIsSavingEmail(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleSavePassword = async () => {
    if (!user || !user.email || newPassword.length < 6) return;
    setIsSavingPassword(true);
    try {
      if (hasPasswordProvider) {
        await updatePassword(user, newPassword);
      } else {
        // No password provider linked yet (e.g. a Google-only account) —
        // this adds one rather than changing one, so they gain email/
        // password as an additional way in without losing Google sign-in.
        await linkWithCredential(user, EmailAuthProvider.credential(user.email, newPassword));
      }
      setNewPassword('');
      await refreshEnrolledFactors(); // also reloads `user`, so hasPasswordProvider reflects the change
      setToast({
        message: hasPasswordProvider ? 'Password updated.' : 'Password set — you can now also sign in with email and password.',
        type: 'success',
      });
    } catch (err: any) {
      const message = err?.code === 'auth/requires-recent-login'
        ? 'For security, please sign out and back in, then try again.'
        : err?.code === 'auth/weak-password'
        ? 'Password should be at least 6 characters.'
        : `Failed to update password: ${err?.message || 'Unknown error'}`;
      setToast({ message, type: 'error' });
    } finally {
      setIsSavingPassword(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleRevokeSessions = async () => {
    setIsRevokingSessions(true);
    try {
      await revokeAllSessions();
      await logout();
    } catch (err: any) {
      setToast({ message: `Failed to sign out other devices: ${err?.message || 'Unknown error'}`, type: 'error' });
      setTimeout(() => setToast(null), 3000);
      setIsRevokingSessions(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (!user) return;
    setIsRequestingDeletion(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { deletionRequested: true, deletionRequestedAt: new Date().toISOString() }, { merge: true });
      setDeletionRequested(true);
      setToast({ message: 'Deletion request submitted — an admin will follow up.', type: 'success' });
    } catch (err: any) {
      setToast({ message: `Failed to submit request: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsRequestingDeletion(false);
      setIsDeletionConfirmOpen(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const refreshEnrolledFactors = async () => {
    if (!user) { setEnrolledFactors([]); return; }
    try {
      await user.reload();
    } catch {
      // A stale/offline reload still leaves the previously-known factor
      // list correct often enough not to worry the user over it here.
    }
    setEnrolledFactors(listEnrolledFactors(user));
  };

  useEffect(() => { refreshEnrolledFactors(); }, [user?.uid]);

  const handleResendVerification = async () => {
    setIsResendingVerification(true);
    try {
      await resendVerificationEmail();
      setVerificationSent(true);
      setToast({ message: 'Verification email sent — check your inbox.', type: 'success' });
    } catch (err: any) {
      setToast({ message: `Failed to send verification email: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsResendingVerification(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleOpenEnroll = () => {
    setEnrollPhoneNumber('');
    setEnrollVerificationId(null);
    setEnrollCode('');
    setIsEnrollOpen(true);
  };

  const closeEnroll = () => {
    setIsEnrollOpen(false);
    setEnrollPhoneNumber('');
    setEnrollVerificationId(null);
    setEnrollCode('');
  };

  const handleSendEnrollCode = async () => {
    if (!user || !enrollRecaptchaRef.current) return;
    setIsSendingEnrollCode(true);
    const verifier = new RecaptchaVerifier(auth, enrollRecaptchaRef.current, { size: 'invisible' });
    try {
      const verificationId = await sendEnrollmentCode(auth, user, enrollPhoneNumber, verifier);
      setEnrollVerificationId(verificationId);
      setEnrollCode('');
    } catch (err: any) {
      const message = err?.code === 'auth/requires-recent-login'
        ? 'For security, please sign out and back in, then try again.'
        : err?.code === 'auth/unverified-email'
        ? 'Verify your email address first, then try again.'
        : err?.code === 'auth/invalid-phone-number'
        ? 'Enter a valid phone number in international format, e.g. +1 555 123 4567.'
        : `Failed to send verification code: ${err?.message || 'Unknown error'}`;
      setToast({ message, type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      verifier.clear();
      setIsSendingEnrollCode(false);
    }
  };

  const handleFinishEnroll = async () => {
    if (!user || !enrollVerificationId) return;
    setIsFinishingEnroll(true);
    try {
      await finishPhoneEnrollment(user, enrollVerificationId, enrollCode, `Phone ending in ${enrollPhoneNumber.slice(-4)}`);
      closeEnroll();
      await refreshEnrolledFactors();
      setToast({ message: 'Two-factor authentication enabled.', type: 'success' });
    } catch (err: any) {
      const message = err?.code === 'auth/invalid-verification-code'
        ? 'Incorrect code. Please try again.'
        : err?.code === 'auth/code-expired'
        ? 'That code expired — request a new one.'
        : `Failed to enable 2FA: ${err?.message || 'Unknown error'}`;
      setToast({ message, type: 'error' });
    } finally {
      setIsFinishingEnroll(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleUnenroll = async (factor: MultiFactorInfo) => {
    if (!user) return;
    setUnenrollingUid(factor.uid);
    try {
      await unenrollFactor(user, factor);
      await refreshEnrolledFactors();
      setToast({ message: 'Two-factor authentication removed.', type: 'success' });
    } catch (err: any) {
      const message = err?.code === 'auth/requires-recent-login'
        ? 'For security, please sign out and back in, then try again.'
        : `Failed to remove: ${err?.message || 'Unknown error'}`;
      setToast({ message, type: 'error' });
    } finally {
      setUnenrollingUid(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  useEffect(() => {
    if (!user) { setIsLoadingRisk(false); return; }
    setIsLoadingRisk(true);
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const risk: RiskSettings = snap.data()?.riskSettings || {};
      setRiskForm({
        maxDailyLossUsd: risk.maxDailyLossUsd?.toString() ?? '',
        maxDailyLossPct: risk.maxDailyLossPct?.toString() ?? '',
        riskPerTradePct: risk.riskPerTradePct?.toString() ?? '',
        maxPositionSize: risk.maxPositionSize?.toString() ?? '',
        maxConsecutiveLosses: risk.maxConsecutiveLosses?.toString() ?? '',
        dailyProfitTarget: risk.dailyProfitTarget?.toString() ?? '',
        weeklyProfitTarget: risk.weeklyProfitTarget?.toString() ?? '',
        monthlyProfitTarget: risk.monthlyProfitTarget?.toString() ?? '',
      });
    }).finally(() => setIsLoadingRisk(false));
  }, [user?.uid]);

  const handleSaveRisk = async () => {
    if (!user) return;
    setIsSavingRisk(true);
    try {
      const riskSettings: RiskSettings = {};
      (Object.keys(riskForm) as (keyof typeof riskForm)[]).forEach(key => {
        const raw = riskForm[key];
        if (raw !== '') riskSettings[key] = Number(raw);
      });
      await setDoc(doc(db, 'users', user.uid), { riskSettings }, { merge: true });
      setToast({ message: 'Risk parameters saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: `Failed to save risk parameters: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSavingRisk(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Settings" 
        subtitle="Configure your trading parameters and account preferences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Navigation */}
        <div className="lg:col-span-3 space-y-2">
          <button
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'profile' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <User className="w-4 h-4" />
            <span>Profile</span>
          </button>
          <button
            onClick={() => setActiveTab('trading-parameters')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'trading-parameters' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Database className="w-4 h-4" />
            <span>Trading Parameters</span>
          </button>
          <button
            onClick={() => setActiveTab('risk-parameters')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'risk-parameters' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>Risk Parameters</span>
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'accounts' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Wallet className="w-4 h-4" />
            <span>Accounts</span>
          </button>
          {/* Broker Connections and Import Orders used to be their own
              top-level sidebar items — moved here since they're account
              setup/data-ingestion concerns, not something reached daily,
              same reasoning as Accounts/Referrals/Mentor already living
              under Settings. Same Admin/Student gating the sidebar used to
              apply (see the now-hidden entries in AppShell's navItems). */}
          {(role === 'Admin' || role === 'Student') && (
            <button
              onClick={() => setActiveTab('connections')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'connections' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
            >
              <Zap className="w-4 h-4" />
              <span>Broker Connections</span>
            </button>
          )}
          {(role === 'Admin' || role === 'Student') && (
            <button
              onClick={() => setActiveTab('import')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'import' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
            >
              <Upload className="w-4 h-4" />
              <span>Import Orders</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('referrals')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'referrals' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Link2 className="w-4 h-4" />
            <span>Referrals</span>
          </button>
          {/* Mentor pickup is only meaningful for Students — Mentors don't
              have mentors, and Admins manage assignments directly from
              Users & Permissions instead. */}
          {role === 'Student' && (
            <button
              onClick={() => setActiveTab('mentor')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'mentor' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Mentor</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('notifications')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'notifications' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Bell className="w-4 h-4" />
            <span>Notifications</span>
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'security' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Shield className="w-4 h-4" />
            <span>Security</span>
          </button>
        </div>

        {/* Right: Content */}
        <div className="lg:col-span-9 space-y-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <Card className="p-8">
                <h3 className="text-lg font-bold mb-2">Profile</h3>
                <p className="text-xs text-muted-foreground mb-6">Your name and address, shown wherever your account is referenced across the app.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">First Name</label>
                    <Input
                      value={profileForm.firstName}
                      onChange={e => setProfileForm(f => ({ ...f, firstName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Last Name</label>
                    <Input
                      value={profileForm.lastName}
                      onChange={e => setProfileForm(f => ({ ...f, lastName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Address <span className="text-muted-foreground/50 font-normal">(optional)</span></label>
                    <Input
                      value={profileForm.address}
                      onChange={e => setProfileForm(f => ({ ...f, address: e.target.value }))}
                    />
                  </div>
                </div>
                <Button
                  className="mt-6"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile || !profileForm.firstName.trim() || !profileForm.lastName.trim()}
                >
                  {isSavingProfile ? 'Saving...' : 'Save Profile'}
                </Button>
              </Card>

              <Card className="p-8">
                <h3 className="text-lg font-bold mb-2">Email</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  The email address you sign in with. Changing it sends a confirmation link to the new address —
                  nothing changes until you click it.
                </p>
                <div className="max-w-sm space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Email</label>
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={e => { setNewEmail(e.target.value); setEmailChangePending(false); }}
                  />
                </div>
                <Button
                  className="mt-6"
                  onClick={handleChangeEmail}
                  disabled={isSavingEmail || !newEmail.trim() || newEmail.trim() === user?.email || emailChangePending}
                >
                  {isSavingEmail ? 'Sending...' : emailChangePending ? 'Verification link sent' : 'Update Email'}
                </Button>
              </Card>

              <Card className="p-8">
                <h3 className="text-lg font-bold mb-2">Password</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  {hasPasswordProvider
                    ? 'Change the password you sign in with.'
                    : "You currently sign in another way (e.g. Google) — set a password to also sign in with email and password."}
                </p>
                <div className="max-w-sm space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">New Password</label>
                  <Input
                    type="password"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                  />
                </div>
                <Button className="mt-6" onClick={handleSavePassword} disabled={isSavingPassword || newPassword.length < 6}>
                  {isSavingPassword ? 'Saving...' : hasPasswordProvider ? 'Change Password' : 'Set Password'}
                </Button>
              </Card>
            </div>
          )}

          {activeTab === 'accounts' && <TradingAccountsSettings />}
          {activeTab === 'connections' && <DataConnectionsScreen />}
          {activeTab === 'import' && <ImportOrdersScreen setActivePage={setActivePage} />}
          {activeTab === 'referrals' && <ReferralsSettings />}
          {activeTab === 'mentor' && role === 'Student' && <MentorSettings />}

          {activeTab === 'notifications' && (
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-2">Notifications</h3>
              <p className="text-xs text-muted-foreground mb-6">
                The only in-app notifications this app has today are the two unread badges below — there's no
                email or push notification system to configure. Muting a badge only hides it; it keeps tracking
                in the background, so nothing is lost if you turn it back on later.
              </p>
              <div className="space-y-4">
                {role === 'Admin' && (
                  <div className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl border border-border/40">
                    <div>
                      <p className="text-sm font-bold">Unread Support Messages</p>
                      <p className="text-xs text-muted-foreground mt-0.5">The badge count on Support for new student messages.</p>
                    </div>
                    <button
                      onClick={() => saveNotificationPrefs({ supportBadgeMuted: !notificationPrefs.supportBadgeMuted })}
                      disabled={isSavingNotificationPrefs}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${notificationPrefs.supportBadgeMuted ? 'bg-muted' : 'bg-primary'}`}
                      aria-label="Toggle support message badge"
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notificationPrefs.supportBadgeMuted ? 'translate-x-0.5' : 'translate-x-5'}`} />
                    </button>
                  </div>
                )}
                {role === 'Student' && (
                  <div className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl border border-border/40">
                    <div>
                      <p className="text-sm font-bold">Unread Mentor Feedback</p>
                      <p className="text-xs text-muted-foreground mt-0.5">The badge count for new mentor comments on your journal notes.</p>
                    </div>
                    <button
                      onClick={() => saveNotificationPrefs({ mentorFeedbackBadgeMuted: !notificationPrefs.mentorFeedbackBadgeMuted })}
                      disabled={isSavingNotificationPrefs}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${notificationPrefs.mentorFeedbackBadgeMuted ? 'bg-muted' : 'bg-primary'}`}
                      aria-label="Toggle mentor feedback badge"
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notificationPrefs.mentorFeedbackBadgeMuted ? 'translate-x-0.5' : 'translate-x-5'}`} />
                    </button>
                  </div>
                )}
                {(role === 'Mentor' || role === 'Viewer') && (
                  <p className="text-sm text-muted-foreground italic">No notification badge exists for your role yet.</p>
                )}
              </div>
            </Card>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <Card className="p-8">
                <h3 className="text-lg font-bold mb-2">Sessions</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  Immediately revokes access on every other device signed into your account. Already-open sessions
                  elsewhere will be signed out within about an hour as their tokens naturally expire — this is a
                  Firebase Auth limit, not something that can be made instant. You'll be signed out here too.
                </p>
                <Button variant="outline" icon={LogOut} onClick={handleRevokeSessions} disabled={isRevokingSessions}>
                  {isRevokingSessions ? 'Signing out everywhere...' : 'Sign Out of All Devices'}
                </Button>
              </Card>

              <Card className="p-8">
                <h3 className="text-lg font-bold mb-2">Two-Factor Authentication</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  Adds a 6-digit code texted to your phone as a second step when signing in, on top of your password.
                </p>
                {enrolledFactors.length > 0 ? (
                  <div className="space-y-3">
                    {enrolledFactors.map(factor => (
                      <div key={factor.uid} className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl border border-border/40">
                        <div>
                          <p className="text-sm font-bold flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-emerald-500" />
                            {(factor as { phoneNumber?: string }).phoneNumber || factor.displayName || 'Phone'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Enrolled {new Date(factor.enrollmentTime).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          icon={Trash2}
                          onClick={() => handleUnenroll(factor)}
                          disabled={unenrollingUid === factor.uid}
                        >
                          {unenrollingUid === factor.uid ? 'Removing...' : 'Remove'}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : user && !user.emailVerified ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Verify your email address before enabling two-factor authentication — Firebase requires it so
                      you always have a way back into your account.
                    </p>
                    <Button variant="outline" onClick={handleResendVerification} disabled={isResendingVerification || verificationSent}>
                      {isResendingVerification ? 'Sending...' : verificationSent ? 'Verification email sent' : 'Send Verification Email'}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" icon={ShieldCheck} onClick={handleOpenEnroll}>
                    Enable Two-Factor Authentication
                  </Button>
                )}
              </Card>

              <Modal
                isOpen={isEnrollOpen}
                onClose={closeEnroll}
                title="Set up two-factor authentication"
                maxWidth="sm"
                footer={
                  enrollVerificationId ? (
                    <>
                      <Button variant="outline" onClick={closeEnroll}>Cancel</Button>
                      <Button onClick={handleFinishEnroll} disabled={isFinishingEnroll || enrollCode.length < 6}>
                        {isFinishingEnroll ? 'Verifying...' : 'Verify & Enable'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={closeEnroll}>Cancel</Button>
                      <Button onClick={handleSendEnrollCode} disabled={isSendingEnrollCode || enrollPhoneNumber.trim().length < 8}>
                        {isSendingEnrollCode ? 'Sending...' : 'Send Code'}
                      </Button>
                    </>
                  )
                }
              >
                <div ref={enrollRecaptchaRef} />
                {!enrollVerificationId ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Enter your phone number in international format (e.g. +1 555 123 4567). We'll text you a
                      verification code.
                    </p>
                    <Input
                      type="tel"
                      placeholder="+1 555 123 4567"
                      value={enrollPhoneNumber}
                      onChange={e => setEnrollPhoneNumber(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Enter the 6-digit code we texted to {enrollPhoneNumber}.
                    </p>
                    <Input
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="123456"
                      value={enrollCode}
                      onChange={e => setEnrollCode(e.target.value.replace(/\D/g, ''))}
                      className="text-center text-lg tracking-[0.3em] font-bold"
                    />
                  </div>
                )}
              </Modal>

              <Card className="p-8 border-rose-500/20 bg-rose-500/5">
                <h3 className="text-lg font-bold mb-2 text-rose-500">Delete Account</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  Submits a request for an admin to review and process — your account and trade data aren't deleted
                  instantly, given how trade/financial records are handled.
                </p>
                {deletionRequested ? (
                  <p className="text-sm text-muted-foreground italic">Deletion requested — an admin will follow up.</p>
                ) : (
                  <Button variant="ghost" className="bg-rose-500 text-white hover:bg-rose-600" icon={Trash2} onClick={() => setIsDeletionConfirmOpen(true)}>
                    Request Account Deletion
                  </Button>
                )}
              </Card>

              <Modal
                isOpen={isDeletionConfirmOpen}
                onClose={() => setIsDeletionConfirmOpen(false)}
                title="Request account deletion?"
                maxWidth="sm"
                footer={
                  <>
                    <Button variant="outline" onClick={() => setIsDeletionConfirmOpen(false)}>Cancel</Button>
                    <Button variant="destructive" icon={Trash2} onClick={handleRequestDeletion} disabled={isRequestingDeletion}>
                      {isRequestingDeletion ? 'Submitting...' : 'Request Deletion'}
                    </Button>
                  </>
                }
              >
                <p className="text-sm text-muted-foreground">This flags your account for an admin to review and delete. It isn't instant, and you can keep using your account until it's processed.</p>
              </Modal>
            </div>
          )}

          {activeTab === 'trading-parameters' && (
          <Card className="p-8">
            <h3 className="text-lg font-bold mb-2">Trading Parameters</h3>
            <p className="text-xs text-muted-foreground mb-6">
              These are the fixed thresholds the grading engine currently uses (see <span className="font-mono">SessionBuilder.ts</span>).
              Making them configurable per-account isn't built yet, so they're shown read-only rather than as inputs that would silently do nothing.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Re-entry Threshold (Seconds)</label>
                <input type="number" value={300} disabled className="w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm text-muted-foreground cursor-not-allowed" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Fast Loser Threshold (Seconds)</label>
                <input type="number" value={60} disabled className="w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm text-muted-foreground cursor-not-allowed" />
              </div>
            </div>
          </Card>
          )}

          {activeTab === 'risk-parameters' && (
          <Card className="p-8">
            <h3 className="text-lg font-bold mb-2">Risk Parameters</h3>
            <p className="text-sm text-muted-foreground mb-6">Limits used to flag when a session or trade breaks your risk rules.</p>
            {isLoadingRisk ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Daily Loss (USD)</label>
                    <input
                      type="number"
                      placeholder="e.g. 500"
                      value={riskForm.maxDailyLossUsd}
                      onChange={e => setRiskForm(f => ({ ...f, maxDailyLossUsd: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Daily Loss (%)</label>
                    <input
                      type="number"
                      placeholder="e.g. 2"
                      value={riskForm.maxDailyLossPct}
                      onChange={e => setRiskForm(f => ({ ...f, maxDailyLossPct: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Risk Per Trade (%)</label>
                    <input
                      type="number"
                      placeholder="e.g. 1"
                      value={riskForm.riskPerTradePct}
                      onChange={e => setRiskForm(f => ({ ...f, riskPerTradePct: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Position Size (Contracts)</label>
                    <input
                      type="number"
                      placeholder="e.g. 5"
                      value={riskForm.maxPositionSize}
                      onChange={e => setRiskForm(f => ({ ...f, maxPositionSize: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Consecutive Losses</label>
                    <input
                      type="number"
                      placeholder="e.g. 3"
                      value={riskForm.maxConsecutiveLosses}
                      onChange={e => setRiskForm(f => ({ ...f, maxConsecutiveLosses: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-10 pt-8 border-t border-border">
                  <h4 className="text-sm font-bold mb-1">Profit Targets</h4>
                  <p className="text-xs text-muted-foreground mb-6">
                    Feeds the Goals card on your Dashboard — leave any of these blank to skip that goal entirely.
                    Max Daily Loss above already doubles as your "don't hit your DLL" goal.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Daily Target (USD)</label>
                      <input
                        type="number"
                        placeholder="e.g. 200"
                        value={riskForm.dailyProfitTarget}
                        onChange={e => setRiskForm(f => ({ ...f, dailyProfitTarget: e.target.value }))}
                        className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Weekly Target (USD)</label>
                      <input
                        type="number"
                        placeholder="e.g. 800"
                        value={riskForm.weeklyProfitTarget}
                        onChange={e => setRiskForm(f => ({ ...f, weeklyProfitTarget: e.target.value }))}
                        className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Monthly Target (USD)</label>
                      <input
                        type="number"
                        placeholder="e.g. 3000"
                        value={riskForm.monthlyProfitTarget}
                        onChange={e => setRiskForm(f => ({ ...f, monthlyProfitTarget: e.target.value }))}
                        className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-border flex justify-end">
                  <Button variant="primary" disabled={isSavingRisk} onClick={handleSaveRisk}>
                    {isSavingRisk ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </>
            )}
          </Card>
          )}

          {activeTab === 'trading-parameters' && (
          <Card className="p-8 border-rose-500/20 bg-rose-500/5">
            <h3 className="text-lg font-bold mb-6 text-rose-500">Danger Zone</h3>
            <div className="flex items-center justify-between p-6 bg-rose-500/10 rounded-2xl border border-rose-500/20">
              <div className="space-y-1">
                <h4 className="font-bold text-rose-500">Clear All Trade Data</h4>
                <p className="text-sm text-muted-foreground">This will permanently delete all your imported trades from the database.</p>
              </div>
              <Button
                variant="ghost"
                className="bg-rose-500 text-white hover:bg-rose-600"
                disabled={isClearingTrades}
                onClick={async () => {
                  if (!window.confirm("Are you absolutely sure you want to delete ALL your trade data? This cannot be undone.")) return;
                  setIsClearingTrades(true);
                  try {
                    await clearTrades();
                    setToast({ message: 'All trades permanently deleted.', type: 'success' });
                  } catch (err: any) {
                    setToast({ message: `Failed to delete trades: ${err.message}`, type: 'error' });
                  } finally {
                    setIsClearingTrades(false);
                    setTimeout(() => setToast(null), 3000);
                  }
                }}
              >
                {isClearingTrades ? 'Deleting…' : 'Clear All Trades'}
              </Button>
            </div>
          </Card>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}
