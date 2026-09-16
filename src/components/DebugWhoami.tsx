// Temporary, read-only diagnostic page for tracking down the 2026-09-16
// "signed in as a blank Student profile" production incident. Reads the
// signed-in account's own users/{uid} doc plus every users/{*} doc sharing
// its email (catches the case where a second, brand-new uid got created
// for the same person, orphaning their original Admin doc under a
// different id) directly via the client SDK, using the already-signed-in
// session's own credentials — no admin access required, since
// firestore.rules' users/{userId} allows read to any authenticated user.
//
// Uses onSnapshot (like AuthContext's own role listener) rather than a
// one-shot getDoc/getDocs — a plain getDoc() on a brand-new page load
// kept failing with "client is offline" even after several retries, while
// this app's real dashboard (which only ever uses onSnapshot) loads fine
// on the same connection. onSnapshot tolerates the same initial
// long-polling handshake delay without throwing.
//
// Gated to a single hardcoded email so this never shows for any other
// account; remove this file and its App.tsx wiring once the incident is
// resolved.
import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';

export function DebugWhoami({ user }: { user: User }) {
  const [ownDoc, setOwnDoc] = useState<{ loaded: boolean; exists: boolean; data: any; error: string | null }>(
    { loaded: false, exists: false, data: null, error: null }
  );
  const [byEmail, setByEmail] = useState<{ loaded: boolean; docs: any[]; error: string | null }>(
    { loaded: false, docs: [], error: null }
  );
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setOwnDoc({ loaded: false, exists: false, data: null, error: null });
    setByEmail({ loaded: false, docs: [], error: null });

    const unsubOwn = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setOwnDoc({ loaded: true, exists: snap.exists(), data: snap.exists() ? snap.data() : null, error: null }),
      (err) => setOwnDoc({ loaded: true, exists: false, data: null, error: err.message })
    );
    const unsubEmail = onSnapshot(
      query(collection(db, 'users'), where('email', '==', user.email)),
      (snap) => setByEmail({ loaded: true, docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: null }),
      (err) => setByEmail({ loaded: true, docs: [], error: err.message })
    );
    return () => { unsubOwn(); unsubEmail(); };
  }, [user.uid, user.email, retryKey]);

  const output = JSON.stringify(
    {
      authUid: user.uid,
      authEmail: user.email,
      authEmailVerified: user.emailVerified,
      ownDoc,
      byEmail,
    },
    null,
    2
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-4">
      <h1 className="text-lg font-bold">Account Diagnostic (temporary)</h1>
      <pre className="whitespace-pre-wrap text-xs bg-slate-900 p-4 rounded-lg border border-slate-800">
        {output}
      </pre>
      <button
        className="px-4 py-2 rounded-lg border border-slate-700 text-sm font-bold hover:bg-slate-800"
        onClick={() => setRetryKey((k) => k + 1)}
      >
        Retry
      </button>
    </div>
  );
}
