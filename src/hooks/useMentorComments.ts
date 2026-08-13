import { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
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

export async function postMentorComment(
  journalId: string,
  author: { authorId: string; authorName: string; authorRole: 'Mentor' | 'Student' | 'Admin' },
  text: string
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(db, 'journals', journalId, 'mentorComments'), {
    ...author,
    text: trimmed,
    createdAt: serverTimestamp(),
  });
}

// Full date + time, not a relative "2h ago" — a mentor or student coming
// back to a thread later should see exactly when feedback landed.
export function fmtCommentTimestamp(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return 'Just now';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
