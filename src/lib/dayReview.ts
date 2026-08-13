import { collection, query, where, onSnapshot, doc, getDoc, getDocs, addDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from './authFetch';
import { DayReview } from '../types';

// Day View Phase 4 — "Review with AI". Generation itself happens server-side
// (POST /api/day-review/generate, see server.ts) since that's the only place
// holding the Anthropic API key; this module is just the client's read path
// (subscribe to the cache) and the call-the-endpoint path, plus the one
// write this module *does* do directly — appending a generated review into
// the day's Daily Journal note, a plain client-side Firestore write like any
// other journal edit, not something that needs the server's involvement.

// Bulk-subscribes every cached review for a user, mirroring the
// `noteSessionIds` pattern already used for Daily Journal notes in
// DayViewScreen — one live query, a Map keyed by sessionDate, so each day
// card's "Review with AI" vs "View AI Review" label is a single lookup
// instead of a per-card query.
export function subscribeDayReviews(userId: string, onChange: (reviews: Map<string, DayReview>) => void): () => void {
  const q = query(collection(db, 'session_reviews'), where('userId', '==', userId));
  return onSnapshot(q, snap => {
    const map = new Map<string, DayReview>();
    snap.docs.forEach(d => {
      const data = d.data() as Omit<DayReview, 'id'>;
      map.set(data.sessionDate, { id: d.id, ...data });
    });
    onChange(map);
  });
}

export async function fetchDayReview(userId: string, sessionDate: string): Promise<DayReview | null> {
  const snap = await getDoc(doc(db, 'session_reviews', `${userId}_${sessionDate}`));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<DayReview, 'id'>) };
}

export interface DayReviewTradeSummary {
  symbol: string;
  direction: string;
  isWinner: boolean;
  pnlCurrency: number;
  entryTime: string;
  exitTime: string;
}

export async function generateDayReview(payload: {
  userId: string;
  sessionDate: string;
  dayLabel: string;
  trades: DayReviewTradeSummary[];
  journalNote?: string;
  strategyNotes?: string[];
  forceRegenerate?: boolean;
}): Promise<DayReview> {
  // userId isn't sent — the server now derives it from the caller's real ID
  // token (see server.ts's requireAuth) rather than trusting whatever this
  // payload claims, which used to let anyone generate or overwrite anyone
  // else's cached review. Kept as a param here only to build the client-side
  // id below, which must match what the server independently computes from
  // its own verified uid.
  const { userId, ...body } = payload;
  const res = await authFetch('/api/day-review/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to generate review (${res.status})`);
  }
  const data = await res.json();
  return { id: `${userId}_${payload.sessionDate}`, ...data };
}

// Appends the generated review into that day's Daily Journal note — "meant
// to be dropped straight into the day's notes", per how TradeZella's own
// docs describe this feature. Uses the exact same find-or-create match
// (sessionId + no tradeId) and title convention JournalScreen's own
// selectedSessionForJournal effect and Day View's "Add note" flow already
// use, so this never creates a second, disconnected note for the day.
export async function appendReviewToJournal(
  userId: string,
  sessionId: string,
  sessionDate: string,
  review: DayReview
): Promise<void> {
  const reviewHtml = [
    '<p><strong>Review with AI</strong></p>',
    `<p>${review.narrative}</p>`,
    review.wins.length > 0 ? `<p><strong>Wins</strong></p><ul>${review.wins.map(w => `<li>${w}</li>`).join('')}</ul>` : '',
    review.mistakes.length > 0 ? `<p><strong>Mistakes</strong></p><ul>${review.mistakes.map(m => `<li>${m}</li>`).join('')}</ul>` : '',
    review.themes.length > 0 ? `<p><strong>Themes</strong></p><ul>${review.themes.map(t => `<li>${t}</li>`).join('')}</ul>` : '',
  ].join('');

  const q = query(collection(db, 'journals'), where('userId', '==', userId), where('sessionId', '==', sessionId));
  const snap = await getDocs(q);
  const existing = snap.docs.find(d => !d.data().tradeId);

  if (existing) {
    const prevContent = existing.data().content || '';
    await updateDoc(doc(db, 'journals', existing.id), {
      content: prevContent + reviewHtml,
      updatedAt: new Date().toISOString(),
    });
  } else {
    await addDoc(collection(db, 'journals'), {
      userId,
      sessionId,
      date: sessionDate,
      title: `Daily Journal — ${sessionDate}`,
      content: reviewHtml,
      tags: [],
      status: 'private',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}
