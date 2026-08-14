import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, query, orderBy, onSnapshot, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useSupportMessages } from '../hooks/useSupportChat';
import { cn } from '@/src/utils';
import { Card, Badge, Button } from '../components/Shared';
import { MessageSquare, Send } from 'lucide-react';
import { SupportThread } from '../types';

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The Admin side of support_threads/{userId} — see SupportChatWidget.tsx
// for the user-facing half of the same collection. A simple list+detail
// split: browse every thread on the left (list is Admin-only per
// firestore.rules), read/reply to one on the right. Opening a thread
// clears unreadByAdmin, which is the same field the header Bell badge
// counts — this is the only place that field ever gets cleared.
export default function SupportInboxTab() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'support_threads'), orderBy('lastMessageAt', 'desc')),
      (snap) => setThreads(snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id,
          userId: data.userId,
          userName: data.userName || 'Unknown user',
          userEmail: data.userEmail || '',
          lastMessageText: data.lastMessageText || '',
          lastMessageAt: data.lastMessageAt?.toDate ? data.lastMessageAt.toDate().toISOString() : new Date().toISOString(),
          lastMessageBy: data.lastMessageBy || 'user',
          unreadByAdmin: !!data.unreadByAdmin,
          unreadByUser: !!data.unreadByUser,
        } as SupportThread;
      })),
      (err) => console.error('support_threads listener error:', err)
    );
    return () => unsubscribe();
  }, []);

  const selected = threads.find(t => t.id === selectedId) || null;
  const messages = useSupportMessages(selectedId);

  useEffect(() => {
    if (selected?.unreadByAdmin) {
      setDoc(doc(db, 'support_threads', selected.id), { unreadByAdmin: false }, { merge: true }).catch(err =>
        console.error('Failed to mark support thread read:', err)
      );
    }
  }, [selected?.id, selected?.unreadByAdmin]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleReply = async () => {
    if (!draft.trim() || !selected || !user || isSending) return;
    setIsSending(true);
    const text = draft.trim();
    try {
      await Promise.all([
        addDoc(collection(db, 'support_threads', selected.id, 'messages'), {
          senderId: user.uid,
          senderName: user.displayName || user.email || 'Admin',
          senderRole: 'admin',
          text,
          createdAt: serverTimestamp(),
        }),
        setDoc(doc(db, 'support_threads', selected.id), {
          lastMessageText: text,
          lastMessageAt: serverTimestamp(),
          lastMessageBy: 'admin',
          unreadByAdmin: false,
          unreadByUser: true,
        }, { merge: true }),
      ]);
      setDraft('');
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" style={{ minHeight: '600px' }}>
      <Card noPadding className="lg:col-span-4 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border">
          <p className="text-sm font-bold">Conversations</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{threads.length} total</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/50">
          {threads.length === 0 ? (
            <p className="p-6 text-xs text-muted-foreground italic text-center">No support messages yet.</p>
          ) : threads.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                'w-full text-left p-4 hover:bg-accent/20 transition-colors',
                selectedId === t.id && 'bg-accent/30'
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-bold truncate">{t.userName}</p>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelative(t.lastMessageAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground truncate flex-1">
                  {t.lastMessageBy === 'admin' ? 'You: ' : ''}{t.lastMessageText}
                </p>
                {t.unreadByAdmin && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card noPadding className="lg:col-span-8 overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <MessageSquare className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Select a conversation to view it.</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border">
              <p className="text-sm font-bold">{selected.userName}</p>
              <p className="text-[11px] text-muted-foreground">{selected.userEmail}</p>
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto p-5 space-y-3">
              {messages === null ? (
                <p className="text-xs text-muted-foreground text-center pt-8">Loading…</p>
              ) : messages.map(m => (
                <div key={m.id} className={cn('flex', m.senderRole === 'admin' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm',
                    m.senderRole === 'admin'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-accent/50 text-foreground rounded-bl-md'
                  )}>
                    <p className="whitespace-pre-wrap break-words leading-snug">{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                placeholder="Reply…"
                rows={1}
                className="flex-1 resize-none bg-accent/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 max-h-28"
              />
              <Button variant="primary" size="icon" disabled={!draft.trim() || isSending} onClick={handleReply}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
