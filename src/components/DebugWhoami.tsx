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
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';

// The 2026-09-16 incident's real cause: this is the UID of the user's
// original account (see the "student"-roled users/ doc found by hand via
// the Firebase Console, holding real historical trades) — its Firebase
// Auth user record was apparently deleted at some point (likely during
// whatever set up Admin access), which mints a brand-new UID on the next
// sign-in rather than reusing the old one, orphaning this account's real
// data under an ID nothing signs into anymore.
const ORPHANED_UID = 'fewZ1V5AoOfT1NG3nvLwT9pXUTk2';

// A write's promise can hang indefinitely under this project's connection
// flakiness even after the write actually lands server-side (confirmed by
// hand: a "Migrating..." button stuck for 3 hours while a separate
// onSnapshot listener on the same doc had already picked up the change).
// Race every migration step against this instead of awaiting it bare, so
// the UI always recovers and tells the user to verify via Retry rather
// than spinning forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms / 1000}s: ${label}. It may still succeed server-side even though this call never confirmed — click Retry above to check before running this again.`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

type StepState = { running: boolean; log: string[] };
const IDLE: StepState = { running: false, log: [] };

export function DebugWhoami({ user }: { user: User }) {
  const [ownDoc, setOwnDoc] = useState<{ loaded: boolean; exists: boolean; data: any; error: string | null }>(
    { loaded: false, exists: false, data: null, error: null }
  );
  const [byEmail, setByEmail] = useState<{ loaded: boolean; docs: any[]; error: string | null }>(
    { loaded: false, docs: [], error: null }
  );
  const [tradesSample, setTradesSample] = useState<{ loaded: boolean; count: number; distinctUserIds: string[]; error: string | null }>(
    { loaded: false, count: 0, distinctUserIds: [], error: null }
  );
  const [retryKey, setRetryKey] = useState(0);
  const [tradesStep, setTradesStep] = useState<StepState>(IDLE);
  const [roleStep, setRoleStep] = useState<StepState>(IDLE);

  const reattachTrades = async () => {
    const log: string[] = [];
    const append = (line: string) => { log.push(line); setTradesStep({ running: true, log: [...log] }); };
    append('Starting...');
    try {
      append(`Fetching trades where userId == ${ORPHANED_UID}...`);
      const snap = await withTimeout(
        getDocs(query(collection(db, 'trades'), where('userId', '==', ORPHANED_UID))),
        20000,
        'fetching orphaned trades'
      );
      append(`Found ${snap.size} trade(s) to re-attach.`);
      if (snap.size === 0) {
        append('0 found — either they are all already migrated, or this was a stale read. Click Retry above, then check tradesSample before assuming this is done.');
      }

      const docs = snap.docs;
      const batchSize = 500;
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach((d) => batch.update(d.ref, { userId: user.uid }));
        await withTimeout(batch.commit(), 20000, `committing trades ${i + 1}-${i + chunk.length}`);
        append(`Re-attached trades ${i + 1}-${i + chunk.length} of ${docs.length}.`);
      }
      append('Done.');
      setTradesStep({ running: false, log });
    } catch (err: any) {
      append(`ERROR: ${err?.message || String(err)}`);
      setTradesStep({ running: false, log });
    }
  };

  const promoteToAdmin = async () => {
    const log: string[] = [];
    const append = (line: string) => { log.push(line); setRoleStep({ running: true, log: [...log] }); };
    append('Starting...');
    try {
      append(`Checking for an existing profile doc at ${user.uid}...`);
      const existing = await withTimeout(getDoc(doc(db, 'users', user.uid)), 20000, 'checking for existing profile doc');
      if (!existing.exists()) {
        append('No profile doc yet — creating one with role: Student first (required by firestore.rules\' create rule; promoted to Admin next).');
        await withTimeout(
          setDoc(doc(db, 'users', user.uid), {
            id: user.uid,
            name: user.displayName || 'Jean Paul',
            email: user.email || '',
            role: 'Student',
            status: 'active',
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          }),
          20000,
          'creating profile doc'
        );
        append('Profile doc created.');
      } else {
        append(`Profile doc already exists (role: ${existing.data()?.role ?? 'unset'}).`);
      }
      append('Promoting role to Admin...');
      await withTimeout(
        updateDoc(doc(db, 'users', user.uid), { role: 'Admin', updatedAt: serverTimestamp() }),
        20000,
        'promoting role to Admin'
      );
      append('Done. Role set to Admin — reload the main app to confirm.');
      setRoleStep({ running: false, log });
    } catch (err: any) {
      append(`ERROR: ${err?.message || String(err)}`);
      setRoleStep({ running: false, log });
    }
  };

  const [serverMigration, setServerMigration] = useState<StepState>(IDLE);
  const runServerMigration = async () => {
    const log: string[] = [];
    const append = (line: string) => { log.push(line); setServerMigration({ running: true, log: [...log] }); };
    append('Calling server-side migration (Admin SDK, bypasses the browser connection entirely)...');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/debug/migrate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      append(`Done. Re-attached ${body.tradesReattached} trade(s), role set to ${body.roleSetTo} for ${body.uid}.`);
      append('Reload the main app to confirm.');
      setServerMigration({ running: false, log });
    } catch (err: any) {
      append(`ERROR: ${err?.message || String(err)}`);
      setServerMigration({ running: false, log });
    }
  };

  useEffect(() => {
    setOwnDoc({ loaded: false, exists: false, data: null, error: null });
    setByEmail({ loaded: false, docs: [], error: null });
    setTradesSample({ loaded: false, count: 0, distinctUserIds: [], error: null });

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
    const unsubTrades = onSnapshot(
      query(collection(db, 'trades'), limit(25)),
      (snap) => setTradesSample({
        loaded: true,
        count: snap.size,
        distinctUserIds: Array.from(new Set(snap.docs.map((d) => (d.data() as any).userId))),
        error: null,
      }),
      (err) => setTradesSample({ loaded: true, count: 0, distinctUserIds: [], error: err.message })
    );
    return () => { unsubOwn(); unsubEmail(); unsubTrades(); };
  }, [user.uid, user.email, retryKey]);

  const output = JSON.stringify(
    {
      authUid: user.uid,
      authEmail: user.email,
      authEmailVerified: user.emailVerified,
      ownDoc,
      byEmail,
      tradesSample,
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

      <div className="space-y-2">
        <button
          className="px-4 py-2 rounded-lg border border-emerald-700 bg-emerald-950 text-emerald-200 text-sm font-bold hover:bg-emerald-900 disabled:opacity-50"
          onClick={runServerMigration}
          disabled={serverMigration.running}
        >
          {serverMigration.running ? 'Running server migration...' : 'RECOMMENDED: Run migration server-side (Admin SDK)'}
        </button>
        {serverMigration.log.length > 0 && (
          <pre className="whitespace-pre-wrap text-xs bg-slate-900 p-4 rounded-lg border border-emerald-800 text-emerald-100">
            {serverMigration.log.join('\n')}
          </pre>
        )}
      </div>

      <p className="text-xs text-slate-500">Below: the old client-side, browser-dependent buttons — kept only as a fallback.</p>

      <div className="space-y-2">
        <button
          className="px-4 py-2 rounded-lg border border-amber-700 bg-amber-950 text-amber-200 text-sm font-bold hover:bg-amber-900 disabled:opacity-50"
          onClick={reattachTrades}
          disabled={tradesStep.running}
        >
          {tradesStep.running ? 'Re-attaching trades...' : `1. Re-attach trades from ${ORPHANED_UID.slice(0, 8)}...`}
        </button>
        {tradesStep.log.length > 0 && (
          <pre className="whitespace-pre-wrap text-xs bg-slate-900 p-4 rounded-lg border border-amber-800 text-amber-100">
            {tradesStep.log.join('\n')}
          </pre>
        )}
      </div>

      <div className="space-y-2">
        <button
          className="px-4 py-2 rounded-lg border border-amber-700 bg-amber-950 text-amber-200 text-sm font-bold hover:bg-amber-900 disabled:opacity-50"
          onClick={promoteToAdmin}
          disabled={roleStep.running}
        >
          {roleStep.running ? 'Setting role...' : '2. Set my role to Admin'}
        </button>
        {roleStep.log.length > 0 && (
          <pre className="whitespace-pre-wrap text-xs bg-slate-900 p-4 rounded-lg border border-amber-800 text-amber-100">
            {roleStep.log.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}
