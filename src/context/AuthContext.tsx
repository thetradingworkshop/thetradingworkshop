import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
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
  loginAsTestUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setRole(null); setRoleLoading(false); return; }
    setRoleLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => { setRole((snap.data()?.role as Role) || null); setRoleLoading(false); },
      () => { setRole(null); setRoleLoading(false); }
    );
    return () => unsubscribe();
  }, [user?.uid]);

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
  // later sign-in this re-syncs just name/email/updatedAt — deliberately
  // never role/status. firestore.rules now protects role (and mentorId)
  // from self-modification once the doc exists, so re-including a
  // hardcoded 'role: Student' default here on every login would either
  // get rejected by the rules for an Admin/Mentor account, or (before
  // that rule existed) silently clobber whatever an Admin had assigned
  // in Users & Permissions back to the default on that person's next
  // sign-in.
  const syncUserDoc = async (user: User, fallbackName: string) => {
    const ref = doc(db, 'users', user.uid);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await setDoc(ref, {
        id: user.uid,
        name: user.displayName || existing.data().name || fallbackName,
        email: user.email || '',
        updatedAt: serverTimestamp(),
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
        ...invite?.grant,
      }, { merge: true });
      // Only mark the invite used once the account it grants actually
      // exists — see markInviteUsed()'s comment for why the ordering matters.
      if (invite) markInviteUsed(invite.code);
    }
  };

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        await syncUserDoc(result.user, 'User');
      }
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        alert("Sign-in popup was blocked by your browser. Please allow popups for this site and try again.");
      } else {
        alert("Login failed: " + error.message);
      }
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
    <AuthContext.Provider value={{ user, role, roleLoading, loading, login, loginAsTestUser, logout }}>
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
