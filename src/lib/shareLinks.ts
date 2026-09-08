// Firestore access for share_links — public, unauthenticated links to one
// Journal note or Trade (the Share Panel on each). See the ShareLink type
// and the share_links rules block for the full security model: the
// Firestore doc ID IS the token embedded in the URL, and the actual
// content read is gated separately by the resource's own `status: 'shared'`
// field, which these functions flip alongside creating/revoking the link
// itself (one atomic batch, so a link never exists pointing at content that
// isn't actually readable, or vice versa).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ShareLink } from '../types';

function generateToken(): string {
  // Stripped of dashes for a cleaner URL — still the same 122 bits of
  // randomness crypto.randomUUID() gives everywhere else in this codebase
  // (e.g. AddTradeModal's manual-trade ids), plenty for an unguessable
  // capability token.
  return crypto.randomUUID().replace(/-/g, '');
}

// Live "is this resource currently shared, and what's the link" for the
// Share Panel — owner-scoped list query (see share_links' `allow list`
// rule), not the public `get`-by-token path other code uses.
export function subscribeShareLink(
  userId: string,
  resourceType: ShareLink['resourceType'],
  resourceId: string,
  onChange: (link: ShareLink | null) => void
): () => void {
  const q = query(
    collection(db, 'share_links'),
    where('userId', '==', userId),
    where('resourceType', '==', resourceType),
    where('resourceId', '==', resourceId),
    where('revoked', '==', false)
  );
  return onSnapshot(q, snap => {
    // At most one active link per resource in practice (createShareLink
    // only ever adds a new one after revoking whatever was active), but
    // nothing enforces that server-side — take the most recent if somehow
    // more than one slipped through.
    const links = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<ShareLink, 'id'>) }));
    links.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    onChange(links[0] ?? null);
  });
}

// The public path — anyone with the token, no auth required (see
// share_links' `allow get: if true`).
export async function getShareLinkByToken(token: string): Promise<ShareLink | null> {
  const snap = await getDoc(doc(db, 'share_links', token));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<ShareLink, 'id'>) };
}

// Creates a new link and flips the resource (and, for a trade, its linked
// Trade Note if one exists) to 'shared' in one batch — see the module
// comment for why these two things always move together.
export async function createShareLink(
  userId: string,
  resourceType: ShareLink['resourceType'],
  resourceId: string
): Promise<string> {
  const token = generateToken();
  const batch = writeBatch(db);

  batch.set(doc(db, 'share_links', token), {
    userId,
    resourceType,
    resourceId,
    createdAt: new Date().toISOString(),
    revoked: false,
  });

  if (resourceType === 'journal') {
    batch.update(doc(db, 'journals', resourceId), { status: 'shared' });
  } else {
    batch.update(doc(db, 'trades', resourceId), { status: 'shared' });
    const linkedNote = await findLinkedNote(userId, resourceId);
    if (linkedNote) batch.update(doc(db, 'journals', linkedNote), { status: 'shared' });
  }

  await batch.commit();
  return token;
}

// Turns a link off: marks it revoked (rules only allow this one-way
// false→true transition) and sets the resource back to 'private' — plus,
// for a trade, its linked note, so sharing a trade and later revoking it
// doesn't leave that note silently still public on its own.
export async function revokeShareLink(link: ShareLink): Promise<void> {
  const batch = writeBatch(db);

  batch.update(doc(db, 'share_links', link.id), { revoked: true });

  if (link.resourceType === 'journal') {
    batch.update(doc(db, 'journals', link.resourceId), { status: 'private' });
  } else {
    batch.update(doc(db, 'trades', link.resourceId), { status: 'private' });
    const linkedNote = await findLinkedNote(link.userId, link.resourceId);
    if (linkedNote) batch.update(doc(db, 'journals', linkedNote), { status: 'private' });
  }

  await batch.commit();
}

// The userId filter isn't just belt-and-suspenders here — without it,
// Firestore's rules engine can't statically verify the journals read rule's
// `resource.data.userId == request.auth.uid` branch against a query that
// doesn't constrain userId at all, and rejects the whole list with a
// confusing permission-denied ("Property userId is undefined") rather than
// a clean "no matches" (confirmed by hand: this failed with that exact
// error until the filter was added).
async function findLinkedNote(userId: string, tradeId: string): Promise<string | null> {
  const snap = await getDocs(query(
    collection(db, 'journals'),
    where('userId', '==', userId),
    where('tradeId', '==', tradeId)
  ));
  return snap.docs[0]?.id ?? null;
}

export function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}
