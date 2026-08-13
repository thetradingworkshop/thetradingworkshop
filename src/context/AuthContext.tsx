import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

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
      await setDoc(ref, {
        id: user.uid,
        name: user.displayName || fallbackName,
        email: user.email || '',
        role: 'Student', // Default role for a brand-new account
        status: 'active',
        updatedAt: serverTimestamp(),
      }, { merge: true });
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
    const email = 'test-trader@example.com';
    const password = 'test-password-123';
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await syncUserDoc(result.user, 'Test Trader');
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await syncUserDoc(result.user, 'Test Trader');
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
