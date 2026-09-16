// Temporary, read-only diagnostic page for tracking down the 2026-09-16
// "signed in as a blank Student profile" production incident. Calls
// server.ts's /api/debug/whoami, which uses the Admin SDK directly —
// bypassing firestore.rules and, more importantly, the client SDK's own
// "client is offline" connectivity quirk that hit this page's first,
// client-SDK-based version. Gated server-side to a single email; remove
// this file, its App.tsx wiring, and the server route once resolved.
import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';

const MAX_ATTEMPTS = 5;

export function DebugWhoami({ user }: { user: User }) {
  const [output, setOutput] = useState('Loading...');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOutput('Loading...');
    (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const token = await user.getIdToken();
          const res = await fetch('/api/debug/whoami', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await res.json();
          if (cancelled) return;
          if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
          setOutput(JSON.stringify(body, null, 2));
          return;
        } catch (err: any) {
          if (cancelled) return;
          if (attempt === MAX_ATTEMPTS) {
            setOutput(`ERROR after ${attempt} attempts: ` + (err?.message || String(err)));
            return;
          }
          setOutput(`Attempt ${attempt} failed (${err?.message || err}), retrying...`);
          await new Promise((r) => setTimeout(r, attempt * 800));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user.uid, retryKey]);

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
