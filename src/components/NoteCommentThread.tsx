import React, { useState, useEffect } from 'react';
import { cn } from '@/src/utils';
import { Button } from './Shared';
import { Send } from 'lucide-react';
import { useMentorComments, postMentorComment, markMentorCommentsRead, fmtCommentTimestamp } from '../hooks/useMentorComments';

// Real two-way feedback thread on one journal entry — a mentor leaving
// notes for their student, or the student replying on their own entry.
// Used by JournalScreen (student's own view of a note), MentorDashboardScreen
// (Notes tab), and TradePerformanceLog's own read-only mentor mode (a
// mentor leaving feedback on a trade's linked note). Lives in its own file
// since it owns its own draft state per note card; the data layer itself
// is shared (useMentorComments), not reimplemented here.
export function NoteCommentThread({ journalId, authorId, authorName, authorRole }: {
  journalId: string;
  authorId: string;
  authorName: string;
  authorRole: 'Mentor' | 'Admin';
}) {
  const { comments } = useMentorComments(journalId);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This component only ever renders for a Mentor/Admin viewer (it's the
  // mentor-feedback UI, not the student's own reply box — see
  // JournalScreen for that side), so opening it always clears
  // unreadByMentor, the flag a Student's own reply sets.
  useEffect(() => {
    markMentorCommentsRead(journalId, authorRole);
  }, [journalId]);

  const postComment = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await postMentorComment(journalId, { authorId, authorName, authorRole }, draft);
      setDraft('');
    } catch (err: any) {
      console.error('Failed to post comment:', err);
      setError("Couldn't post — you may not have permission.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
      {comments === null ? (
        <p className="text-[11px] text-muted-foreground italic">Loading comments…</p>
      ) : comments.length > 0 && (
        <div className="space-y-2">
          {comments.map(c => (
            <div key={c.id} className={cn(
              "p-2.5 rounded-xl text-xs",
              c.authorRole === 'Student' ? "bg-accent/40" : "bg-indigo-500/10 border border-indigo-500/20"
            )}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-bold text-foreground">{c.authorName}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{fmtCommentTimestamp(c.createdAt)}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{c.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave feedback on this note…"
          maxLength={2000}
          rows={1}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button variant="primary" size="sm" className="h-9 w-9 p-0 shrink-0" icon={Send} onClick={postComment} disabled={!draft.trim() || posting} />
      </div>
      {error && <p className="text-[10px] text-rose-500">{error}</p>}
    </div>
  );
}
