import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../firebase';
import {
  onAuthStateChanged,
  User,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  getMultiFactorResolver,
  MultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  ApplicationVerifier,
} from 'firebase/auth';
import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, increment, onSnapshot, serverTimestamp } from 'firebase/firestore';

const PENDING_INVITE_KEY = 'pendingInviteCode';

// Captures ?invite=CODE from the URL into sessionStorage (survives the
// Google sign-in popup, which navigates a *different* window) and strips
// it from the visible URL/history immediately so it doesn't linger in the
// address bar or get reprocessed on a refresh mid-flow. Read once at
// module load — this only ever matters on the very first page load a
// fresh invite link produces.
function capturePendingInviteFromUrl() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('invite');
  if (!code) return;
  sessionStorage.setItem(PENDING_INVITE_KEY, code);
  params.delete('invite');
  const rest = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
}
capturePendingInviteFromUrl();

const USE_EMULATOR = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

export type Role = 'Admin' | 'Mentor' | 'Student' | 'Viewer';

interface AuthContextType {
  user: User | null;
  // Live-synced from users/{uid}.role — null while it's still loading, or
  // if the signed-in account genuinely has no Firestore profile doc yet.
  // This is the real source of truth for role (see firestore.rules: only
  // an Admin can change it after first sign-in); nothing in the app
  // should default this to 'Admin' the way App.tsx used to.
  role: Role | null;
  // True from the moment `user` is set until the first role snapshot
  // resolves — lets callers avoid rendering with a fallback role (which
  // must be the least-privileged one, never Admin) during that gap.
  roleLoading: boolean;
  loading: boolean;
  login: () => Promise<void>;
  // Real production email/password sign-in — distinct from loginAsTestUser
  // below, which is hard-guarded to the Auth Emulator only. Both this and
  // login() (Google) can trigger a second-factor challenge (see
  // mfaResolver) if the account has TOTP enrolled; neither resolves the
  // sign-in itself in that case, resolveMfaChallenge() below does.
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  // Firebase requires a verified email before enrolling a second factor —
  // lets Settings' Security tab offer a resend for an account that missed
  // its original verification email or signed up before this existed.
  resendVerificationEmail: () => Promise<void>;
  // Unauthenticated by design — this is the "I can't sign in" recovery
  // path on the login screen itself, not a Settings action. Sets
  // loginError on the same field the sign-in form already renders,
  // rather than a separate error slot, since only one of the two forms is
  // ever visible at once.
  sendPasswordReset: (email: string) => Promise<void>;
  loginAsTestUser: () => Promise<void>;
  logout: () => Promise<void>;
  // Set by login()/signInWithEmail() when the account has a second factor
  // (phone/SMS) enrolled and Firebase is asking for it before completing
  // sign-in — the sign-in itself is paused, not failed. Unlike an
  // authenticator app, a phone code isn't already sitting on the user's
  // device, so App.tsx's challenge screen has two steps: sendMfaCode()
  // (send the SMS, needs a reCAPTCHA verifier tied to a DOM node it owns),
  // then resolveMfaChallenge() once they type what arrived.
  mfaResolver: MultiFactorResolver | null;
  mfaCodeSent: boolean;
  mfaError: string | null;
  sendMfaCode: (verifier: ApplicationVerifier) => Promise<void>;
  resolveMfaChallenge: (code: string) => Promise<void>;
  cancelMfaChallenge: () => void;
  // Set by login() when it actually fails — rendered inline on the sign-in
  // screen (see App.tsx) instead of the native alert() this used to throw
  // up, which was both jarring and, for a transient network blip, showed
  // Firebase's raw internal error text ("Failed to get document because
  // the client is offline") with no actionable next step. null whenever
  // there's nothing to show; login() clears it at the start of every
  // attempt so a retry doesn't leave a stale message behind.
  loginError: string | null;
  clearLoginError: () => void;
  // Set when the role listener's error callback fires (e.g. a connection
  // that never completes its first Firestore round-trip — see the
  // 2026-09-16 incident where a network that kept killing long-polling
  // connections made a real Admin account look like a brand-new, roleless
  // Student one). Distinct from role simply being null for a genuinely new
  // account with no profile doc yet: that case has no error, this one
  // does. App.tsx uses this to show a retryable connection-problem screen
  // instead of silently falling back to the least-privileged role.
  roleError: string | null;
  retryRole: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRetryKey, setRoleRetryKey] = useState(0);
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaVerificationId, setMfaVerificationId] = useState<string | null>(null);
  const [mfaCodeSent, setMfaCodeSent] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setRole(null); setRoleLoading(false); setRoleError(null); return; }
    setRoleLoading(true);
    setRoleError(null);
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => { setRole((snap.data()?.role as Role) || null); setRoleLoading(false); setRoleError(null); },
      (err) => {
        setRole(null);
        setRoleLoading(false);
        setRoleError(
          err.message?.includes('client is offline')
            ? "Couldn't verify your account — you appear to be offline."
            : "Couldn't verify your account. Please try again."
        );
      }
    );
    return () => unsubscribe();
  }, [user?.uid, roleRetryKey]);

  // Brand-new-account-only: if an invite code is waiting in sessionStorage
  // (see capturePendingInviteFromUrl above), look it up and fold its
  // role/mentorId/groupId into the new profile doc instead of the plain
  // Student default — plus referredBy/referredByName, copied from the
  // invite's own createdBy/createdByName, which is true whether the
  // invite is an Admin-generated cohort invite or someone's personal
  // Viewer-only referral link (Settings → Referrals): either way,
  // whoever made the invite gets referral credit for who joins through
  // it. This is the entire tracking layer an eventual reward system would
  // read from — nothing beyond attribution is built yet.
  // firestore.rules' users/{userId} create rule is what actually enforces
  // this is legitimate (isValidInvite + an exact match against the
  // invite's own fields) — this client-side lookup only decides what to
  // *try*; a stale/expired/revoked/forged code simply gets rejected
  // server-side and we fall back to the default below.
  //
  // Deliberately read-only: does NOT bump the invite's useCount. Doing that
  // here, before the users/{uid} doc is actually created, raced the two
  // writes — on a maxUses:1 invite, if the useCount update happened to
  // reach the server first, isValidInvite() would see it as already
  // exhausted and reject the very account creation it was meant to permit.
  // markInviteUsed() below is called only after the create succeeds.
  const lookupInviteGrant = async (): Promise<{ code: string; grant: Record<string, any> } | null> => {
    const code = sessionStorage.getItem(PENDING_INVITE_KEY);
    sessionStorage.removeItem(PENDING_INVITE_KEY); // one attempt per code, ever
    if (!code) return null;
    try {
      const snap = await getDoc(doc(db, 'invites', code));
      if (!snap.exists()) return null;
      const invite = snap.data();
      const expiresAt = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt);
      const isValid = !invite.revoked && expiresAt > new Date() && (invite.useCount ?? 0) < (invite.maxUses ?? 1);
      if (!isValid) return null;
      const grant: Record<string, any> = {
        role: invite.role,
        inviteCode: code,
        referredBy: invite.createdBy,
        referredByName: invite.createdByName ?? null,
      };
      if (invite.mentorId) grant.mentorId = invite.mentorId;
      if (invite.groupId) grant.groupId = invite.groupId;
      return { code, grant };
    } catch (err) {
      console.error('Invite lookup failed, falling back to default role:', err);
      return null;
    }
  };

  // Best-effort, and only ever called after the users/{uid} doc it's
  // granting already exists — if this particular write loses a race or
  // fails, the new account still exists with the granted role; only the
  // invite's own use-counter might read stale, which an Admin can always
  // see and revoke manually.
  const markInviteUsed = (code: string) => {
    updateDoc(doc(db, 'invites', code), { useCount: increment(1) }).catch((err) =>
      console.error('Failed to mark invite as used (account was still created):', err)
    );
  };

  // Creates the Firestore profile doc on first sign-in only. On every
  // later sign-in this re-syncs just name/email/updatedAt/lastLoginAt —
  // deliberately never role/status. firestore.rules now protects role (and
  // mentorId) from self-modification once the doc exists, so re-including
  // a hardcoded 'role: Student' default here on every login would either
  // get rejected by the rules for an Admin/Mentor account, or (before
  // that rule existed) silently clobber whatever an Admin had assigned
  // in Users & Permissions back to the default on that person's next
  // sign-in.
  //
  // lastLoginAt is deliberately separate from updatedAt: updatedAt also
  // gets bumped by Admin-driven writes (role change, status toggle, mentor
  // reassignment in Users & Permissions), so it answers "when did this
  // profile record last change" — not "when did this person actually last
  // sign in", which is what Users & Permissions' Last Login column needs.
  // This function is the only place lastLoginAt is ever written.
  const syncUserDoc = async (user: User, fallbackName: string) => {
    const ref = doc(db, 'users', user.uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await setDoc(ref, {
        id: user.uid,
        name: user.displayName || existing.data().name || fallbackName,
        email: user.email || '',
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      }, { merge: true });
    } else {
      const invite = await lookupInviteGrant();
      await setDoc(ref, {
        id: user.uid,
        name: user.displayName || fallbackName,
        email: user.email || '',
        role: 'Student', // Default role for a brand-new account, overridden below if invited
        status: 'active',
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        ...invite?.grant,
      }, { merge: true });
      // Only mark the invite used once the account it grants actually
      // exists — see markInviteUsed()'s comment for why the ordering matters.
      if (invite) markInviteUsed(invite.code);
    }
  };

  const login = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        await syncUserDoc(result.user, 'User');
      }
    } catch (error: any) {
      // Not a real failure — the user just closed the Google popup or
      // clicked it again before the first one settled. Surfacing "Login
      // failed" for either one is actively wrong: nothing failed, they
      // just didn't finish. Silently doing nothing (they're still looking
      // at the sign-in button) is the correct outcome here.
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return;
      }
      // Not a failure either — the account has a second factor enrolled
      // and Firebase is pausing sign-in to ask for it. See mfaResolver.
      if (error.code === 'auth/multi-factor-auth-required') {
        setMfaResolver(getMultiFactorResolver(auth, error));
        return;
      }
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        setLoginError("Sign-in popup was blocked by your browser. Please allow popups for this site and try again.");
      } else if (error.code === 'auth/network-request-failed' || error.message?.includes('client is offline')) {
        // The same recurring Firestore/Auth connectivity quirk already
        // anticipated in firebase.ts/TradeContext.tsx's own connection-test
        // logging — here it can surface either from the popup sign-in
        // itself or from syncUserDoc's Firestore write right after it
        // succeeds. Either way, the fix is the same: check your connection
        // and try again, not the raw internal error text.
        setLoginError("You appear to be offline. Check your connection and try again.");
      } else {
        setLoginError("Couldn't sign you in. Please try again.");
      }
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setLoginError(null);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await syncUserDoc(result.user, email.split('@')[0]);
    } catch (error: any) {
      if (error.code === 'auth/multi-factor-auth-required') {
        setMfaResolver(getMultiFactorResolver(auth, error));
        return;
      }
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        setLoginError('Incorrect email or password.');
      } else if (error.code === 'auth/too-many-requests') {
        setLoginError('Too many attempts. Please wait a moment and try again.');
      } else if (error.code === 'auth/network-request-failed') {
        setLoginError('You appear to be offline. Check your connection and try again.');
      } else {
        console.error('Email sign-in failed', error);
        setLoginError("Couldn't sign you in. Please try again.");
      }
    }
  };

  const signUpWithEmail = async (email: string, password: string, name: string) => {
    setLoginError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(result.user, { displayName: name });
      // Firebase requires a verified email before it'll let an account
      // enroll a second factor (TOTP) — see Settings' Security tab, which
      // gates the "Enable 2FA" button on user.emailVerified. Best-effort:
      // a delivery hiccup here shouldn't block account creation itself.
      sendEmailVerification(result.user).catch(err => console.error('Failed to send verification email:', err));
      await syncUserDoc(result.user, name || email.split('@')[0]);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        setLoginError('An account with this email already exists. Try signing in instead.');
      } else if (error.code === 'auth/weak-password') {
        setLoginError('Password should be at least 6 characters.');
      } else if (error.code === 'auth/invalid-email') {
        setLoginError('Enter a valid email address.');
      } else if (error.code === 'auth/network-request-failed') {
        setLoginError('You appear to be offline. Check your connection and try again.');
      } else {
        console.error('Sign-up failed', error);
        setLoginError("Couldn't create your account. Please try again.");
      }
    }
  };

  // First step of the challenge: sends the SMS to whichever phone number
  // is enrolled on this account, using the resolver's own session (not the
  // user's — sign-in isn't complete yet, there is no current user). The
  // caller (App.tsx) owns the reCAPTCHA verifier's DOM node and lifecycle;
  // this just needs a verifier instance to hand to Firebase.
  const sendMfaCode = async (verifier: ApplicationVerifier) => {
    if (!mfaResolver) return;
    setMfaError(null);
    const phoneHint = mfaResolver.hints.find(h => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) ?? mfaResolver.hints[0];
    if (!phoneHint) {
      setMfaError('No supported second factor found for this account.');
      return;
    }
    try {
      const provider = new PhoneAuthProvider(auth);
      const verificationId = await provider.verifyPhoneNumber(
        { multiFactorHint: phoneHint, session: mfaResolver.session },
        verifier
      );
      setMfaVerificationId(verificationId);
      setMfaCodeSent(true);
    } catch (error: any) {
      console.error('Failed to send MFA code', error);
      setMfaError("Couldn't send a verification code. Please try again.");
    }
  };

  // Second step: completes whichever sign-in (Google or email/password)
  // most recently set mfaResolver above, using the code that arrived by
  // SMS from sendMfaCode(). Deliberately provider-agnostic — the second
  // factor is on the *account*, not tied to how the first factor was
  // presented.
  const resolveMfaChallenge = async (code: string) => {
    if (!mfaResolver || !mfaVerificationId) return;
    setMfaError(null);
    try {
      const credential = PhoneAuthProvider.credential(mfaVerificationId, code);
      const assertion = PhoneMultiFactorGenerator.assertion(credential);
      const result = await mfaResolver.resolveSignIn(assertion);
      setMfaResolver(null);
      setMfaVerificationId(null);
      setMfaCodeSent(false);
      await syncUserDoc(result.user, 'User');
    } catch (error: any) {
      if (error.code === 'auth/invalid-verification-code') {
        setMfaError('Incorrect code. Please try again.');
      } else if (error.code === 'auth/code-expired') {
        setMfaError('That code expired — request a new one.');
      } else {
        console.error('MFA sign-in failed', error);
        setMfaError("Couldn't verify that code. Please try again.");
      }
    }
  };

  const cancelMfaChallenge = () => {
    setMfaResolver(null);
    setMfaVerificationId(null);
    setMfaCodeSent(false);
    setMfaError(null);
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const sendPasswordReset = async (email: string) => {
    setLoginError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // This project has Identity Platform's email-enumeration
        // protection on, so Firebase normally reports success either way
        // regardless of whether the account exists. If this ever
        // surfaces anyway, still treat it as success rather than
        // confirming/denying the account exists to the caller.
        return;
      }
      const message = error.code === 'auth/invalid-email'
        ? 'Enter a valid email address.'
        : error.code === 'auth/network-request-failed'
        ? 'You appear to be offline. Check your connection and try again.'
        : "Couldn't send the reset email. Please try again.";
      if (error.code !== 'auth/invalid-email' && error.code !== 'auth/network-request-failed') {
        console.error('Failed to send password reset email', error);
      }
      setLoginError(message);
      throw error;
    }
  };

  // Emulator-only test sign-in. signInWithPopup's postMessage relay between
  // the popup and opener doesn't work in every automated browser context, and
  // email/password auth sidesteps that entirely — useful for local/CI testing
  // against the Auth Emulator. Hard-guarded so it can never run against
  // production auth even if something calls it by mistake.
  const loginAsTestUser = async () => {
    if (!USE_EMULATOR) {
      throw new Error('loginAsTestUser is only available against the Firebase Auth Emulator.');
    }
    // An invitee redeeming a link is, by definition, someone who doesn't
    // have an account yet — reusing the one fixed dev account here would
    // make it impossible to ever test invite redemption locally (it always
    // hits the existing-doc branch of syncUserDoc, which never looks at
    // invites). When a pending invite is waiting, sign in as a code-scoped
    // account instead of the shared one. (The code is cleared from
    // sessionStorage the moment it's redeemed, same as the real flow — a
    // second click without a fresh ?invite= link just falls back to the
    // shared test account, which is fine.)
    const pendingCode = sessionStorage.getItem(PENDING_INVITE_KEY);
    const email = pendingCode ? `invitee-${pendingCode}@example.com` : 'test-trader@example.com';
    const password = 'test-password-123';
    const fallbackName = pendingCode ? 'Test Invitee' : 'Test Trader';
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await syncUserDoc(result.user, fallbackName);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await syncUserDoc(result.user, fallbackName);
      } else {
        throw error;
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <AuthContext.Provider value={{
      user, role, roleLoading, loading,
      login, signInWithEmail, signUpWithEmail, resendVerificationEmail, sendPasswordReset, loginAsTestUser, logout,
      loginError, clearLoginError: () => setLoginError(null),
      roleError, retryRole: () => setRoleRetryKey(k => k + 1),
      mfaResolver, mfaCodeSent, mfaError, sendMfaCode, resolveMfaChallenge, cancelMfaChallenge,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
