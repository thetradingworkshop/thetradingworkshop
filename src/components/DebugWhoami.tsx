// Temporary, read-only diagnostic page for tracking down the 2026-09-16
// "signed in as a blank Student profile" production incident. Reads the
// signed-in account's own users/{uid} doc plus every users/{*} doc sharing
// its email (catches the case where a second, brand-new uid got created
// for the same person, orphaning their original Admin doc under a
// different id) directly via the client SDK, using the already-signed-in
// session's own credentials — no admin access required, since
// firestore.rules' users/{userId} allows read to any authenticated user.
// Gated to a single hardcoded email so this never shows for any other
// account; remove this file and its App.tsx wiring once the incident is
// resolved.
import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';

export function DebugWhoami({ user }: { user: User }) {
  const [output, setOutput] = useState('Loading...');

  useEffect(() => {
    (async () => {
      try {
        const ownDocSnap = await getDoc(doc(db, 'users', user.uid));
        const byEmailSnap = await getDocs(
          query(collection(db, 'users'), where('email', '==', user.email))
        );
        const result = {
          authUid: user.uid,
          authEmail: user.email,
          authEmailVerified: user.emailVerified,
          ownDocExists: ownDocSnap.exists(),
          ownDoc: ownDocSnap.exists() ? ownDocSnap.data() : null,
          docsMatchingEmail: byEmailSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
        setOutput(JSON.stringify(result, null, 2));
      } catch (err: any) {
        setOutput('ERROR: ' + (err?.message || String(err)));
      }
    })();
  }, [user.uid, user.email]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-lg font-bold mb-4">Account Diagnostic (temporary)</h1>
      <pre className="whitespace-pre-wrap text-xs bg-slate-900 p-4 rounded-lg border border-slate-800">
        {output}
      </pre>
    </div>
  );
}
