import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Toast } from '../components/Shared';
import { generateInviteCode } from '../lib/inviteCode';
import { Link2, Copy, Check, RefreshCw, Users } from 'lucide-react';

// Every signed-in user (any role) gets exactly one personal referral link,
// stored on their own profile as `referralCode` and backed by an
// `invites/{code}` doc — the same collection Users & Permissions' cohort
// invites live in, just created by a regular user instead of an Admin. A
// personal link is hard-capped server-side to grant role: 'Viewer' — the
// lowest-privilege role in the app — no matter who made it or who redeems
// it (see firestore.rules' isValidSelfServiceInvite()), so this can never
// be a privilege-escalation path. What this screen actually tracks: who
// referred whom (referredBy on the new account). Turning that into an
// actual reward system isn't built yet — this is the attribution layer it
// would read from.
const EXPIRES_IN_DAYS = 365;
const MAX_USES = 500;

interface ReferredUser {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

function fmtDate(v: any): string {
  if (!v) return 'Unknown';
  const d = v.toDate ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReferralsSettings() {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [useCount, setUseCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [referred, setReferred] = useState<ReferredUser[]>([]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const createPersonalLink = async (uid: string, displayName: string) => {
    const newCode = generateInviteCode();
    await setDoc(doc(db, 'invites', newCode), {
      code: newCode,
      role: 'Viewer',
      mentorId: null,
      groupId: null,
      label: 'Personal Referral Link',
      createdBy: uid,
      createdByName: displayName,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000)),
      maxUses: MAX_USES,
      useCount: 0,
      revoked: false,
    });
    await updateDoc(doc(db, 'users', uid), { referralCode: newCode });
    return newCode;
  };

  // Find-or-create: read the user's own referralCode; if it's missing, or
  // points at an invite that's since expired/exhausted/revoked, mint a
  // fresh one automatically so this section always has a working link to
  // show rather than a dead one.
  useEffect(() => {
    if (!user) { setIsLoading(false); return; }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const existingCode = userSnap.data()?.referralCode as string | undefined;
        if (existingCode) {
          const inviteSnap = await getDoc(doc(db, 'invites', existingCode));
          const invite = inviteSnap.data();
          const expiresAt = invite?.expiresAt?.toDate ? invite.expiresAt.toDate() : null;
          const stillGood = invite && !invite.revoked && expiresAt && expiresAt > new Date() && (invite.useCount ?? 0) < (invite.maxUses ?? 1);
          if (stillGood) {
            if (!cancelled) { setCode(existingCode); setUseCount(invite.useCount ?? 0); }
            return;
          }
        }
        const newCode = await createPersonalLink(user.uid, user.displayName || user.email || 'A user');
        if (!cancelled) { setCode(newCode); setUseCount(0); }
      } catch (err: any) {
        showToast(`Couldn't load your referral link: ${err.message}`, 'error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Live count of who's used this specific code, refreshed as it changes.
  useEffect(() => {
    if (!code) return;
    const unsubscribe = onSnapshot(doc(db, 'invites', code), (snap) => {
      setUseCount(snap.data()?.useCount ?? 0);
    });
    return () => unsubscribe();
  }, [code]);

  // Everyone this user has ever referred, regardless of which of their
  // links (current or since-regenerated) was used — referredBy points
  // straight at the uid, not at any particular invite code.
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), where('referredBy', '==', user.uid)),
      (snapshot) => {
        setReferred(snapshot.docs.map(d => {
          const data: any = d.data();
          return {
            id: d.id,
            name: data.name || data.email || 'Unnamed user',
            email: data.email || '',
            role: data.role || 'Viewer',
            joinedAt: fmtDate(data.updatedAt),
          };
        }));
      },
      (err) => console.error('referred-users listener error:', err)
    );
    return () => unsubscribe();
  }, [user?.uid]);

  const link = code ? `${window.location.origin}${window.location.pathname}?invite=${code}` : null;

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy — select and copy the link manually.', 'error');
    }
  };

  const handleRegenerate = async () => {
    if (!user || !code) return;
    if (!window.confirm('Generate a new link? Your current one stops working immediately — anyone who already joined through it stays exactly as they are.')) return;
    setIsGenerating(true);
    try {
      await updateDoc(doc(db, 'invites', code), { revoked: true });
      const newCode = await createPersonalLink(user.uid, user.displayName || user.email || 'A user');
      setCode(newCode);
      setUseCount(0);
      showToast('New referral link generated.');
    } catch (err: any) {
      showToast(`Failed to regenerate: ${err.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Your Referral Link</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Share this to bring new people into the app. Anyone who signs up through it joins as a read-only Viewer —
          it never grants more than that, no matter whose link it is — and you'll see them below.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your link…</p>
        ) : link ? (
          <>
            <div className="flex items-center gap-2 p-3 bg-accent/20 border border-border rounded-xl">
              <code className="flex-1 text-xs font-mono truncate">{link}</code>
              <Button variant="ghost" size="icon" onClick={handleCopy}>
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground tabular-nums">{useCount} / {MAX_USES} used</p>
              <Button variant="outline" size="sm" icon={RefreshCw} disabled={isGenerating} onClick={handleRegenerate}>
                {isGenerating ? 'Generating…' : 'Regenerate Link'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-rose-500">Couldn't generate a link — try reloading this page.</p>
        )}
      </Card>

      <Card noPadding>
        <div className="p-6 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold">People You've Referred</h3>
          <span className="text-xs text-muted-foreground ml-auto tabular-nums">{referred.length} total</span>
        </div>
        {referred.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground italic">No one has joined through your link yet.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {referred.map(r => (
              <div key={r.id} className="p-4 px-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">{r.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium">{r.role}</p>
                  <p className="text-[10px] text-muted-foreground">Joined {r.joinedAt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
