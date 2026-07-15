import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const USE_EMULATOR = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  loginAsTestUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        // Ensure user document exists in Firestore
        await setDoc(doc(db, 'users', result.user.uid), {
          id: result.user.uid,
          name: result.user.displayName || 'User',
          email: result.user.email || '',
          role: 'Student', // Default role
          status: 'active',
          updatedAt: serverTimestamp()
        }, { merge: true });
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
      await ensureUserDoc(result.user);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserDoc(result.user);
      } else {
        throw error;
      }
    }
  };

  const ensureUserDoc = async (user: User) => {
    await setDoc(doc(db, 'users', user.uid), {
      id: user.uid,
      name: user.displayName || 'Test Trader',
      email: user.email || '',
      role: 'Student',
      status: 'active',
      updatedAt: serverTimestamp()
    }, { merge: true });
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginAsTestUser, logout }}>
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
