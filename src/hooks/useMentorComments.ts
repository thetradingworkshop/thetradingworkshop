import { useEffect, useState } from 'react';
import { collection, doc, query, where, orderBy, onSnapshot, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { MentorComment } from '../types';

// journals/{journalId}/mentorComments/{commentId} — the real two-way
// feedback thread on a journal entry (see firestore.rules for the access
// boundary: journal owner, an Admin, or the owner's assigned mentor).
// Shared between MentorDashboardScreen's per-note drill-down and
// JournalScreen's own entry view — both read/write the exact same thread.

export function useMentorComments(journalId: string | null | undefined) {
  const [comments, setComments] = useState<MentorComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!journalId) { setComments(null); setError(null); return; }
    setComments(null);
    setError(null);
    const unsubscribe = onSnapshot(
      query(collection(db, 'journals', journalId, 'mentorComments'), orderBy('createdAt', 'asc')),
      (snap) => setComments(snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id,
          authorId: data.authorId,
          authorName: data.authorName,
          authorRole: data.authorRole,
          text: data.text,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        } as MentorComment;
      })),
      (err) => {
        console.error('Failed to load mentor comments:', err);
        setComments([]);
        setError("Couldn't load comments — you may not have permission.");
      }
    );
    return () => unsubscribe();
  }, [journalId]);

  return { comments, error };
}

// Posts the comment and updates the parent journal doc's own unread
// summary fields as one atomic batch — not two sequential awaited calls.
// That was the original shape (matching useSupportChat.ts's "write the
// message, then the thread summary" pattern), but two back-to-back writes
// to a doc and its own subcollection turned out to race under this app's
// forced-long-polling transport (see firebase.ts): the comment would land
// but the summary write immediately after it would spuriously get
// PERMISSION_DENIED against rules that a standalone repro of the exact
// same write, same user, same data, always passed — a client/transport
// ordering quirk, not a rules bug. A single batch.commit() is one request,
// so there's no ordering for the transport to get wrong, and it's more
// correct anyway: a comment should never exist without its unread flag
// actually landing.
export async function postMentorComment(
  journalId: string,
  author: { authorId: string; authorName: string; authorRole: 'Mentor' | 'Student' | 'Admin' },
  text: string
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const isFromMentorSide = author.authorRole === 'Mentor' || author.authorRole === 'Admin';
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'journals', journalId, 'mentorComments')), {
    ...author,
    text: trimmed,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'journals', journalId), {
    unreadByStudent: isFromMentorSide,
    unreadByMentor: !isFromMentorSide,
    lastCommentAt: serverTimestamp(),
    lastCommentByRole: author.authorRole,
  }, { merge: true });
  await batch.commit();
}

// Called when the viewer actually opens a thread — clears whichever side's
// flag belongs to them, same "opening a thread auto-marks read" pattern
// SupportInboxTab uses. Best-effort: a failed clear leaves the badge
// showing, which is a stale-but-safe state, not a broken one.
export async function markMentorCommentsRead(journalId: string, viewerRole: 'Mentor' | 'Student' | 'Admin') {
  const field = (viewerRole === 'Mentor' || viewerRole === 'Admin') ? 'unreadByMentor' : 'unreadByStudent';
  try {
    await setDoc(doc(db, 'journals', journalId), { [field]: false }, { merge: true });
  } catch (err) {
    console.error('Failed to mark mentor comments read:', err);
  }
}

// Drives the header Bell badge for a Student — how many of their own
// journal entries have mentor feedback they haven't opened yet. Two
// equality filters (userId + unreadByStudent), so no composite index is
// needed — same reasoning as useSupportChat's useUnreadSupportCount.
export function useUnreadMentorFeedbackCount(userId: string | null | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) { setCount(0); return; }
    const unsubscribe = onSnapshot(
      query(collection(db, 'journals'), where('userId', '==', userId), where('unreadByStudent', '==', true)),
      (snap) => setCount(snap.size),
      (err) => console.error('unread mentor feedback count listener error:', err)
    );
    return () => unsubscribe();
  }, [userId]);

  return count;
}

// Full date + time, not a relative "2h ago" — a mentor or student coming
// back to a thread later should see exactly when feedback landed.
export function fmtCommentTimestamp(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return 'Just now';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
