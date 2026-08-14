import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/src/utils';
import { useAuth } from '../context/AuthContext';
import { useSupportMessages, sendSupportMessage } from '../hooks/useSupportChat';
import { MessageSquare, X, Send } from 'lucide-react';

const LAST_SEEN_KEY = 'supportChatLastSeen';

// A global floating support chat, fixed bottom-right on every screen (see
// AppShell.tsx) for anyone signed in except Admin (Admin has the inbox
// instead — Users & Permissions → Support — not a copy of this widget).
// Every user gets exactly one thread with the whole Admin team, keyed by
// their own uid (support_threads/{uid}), same one-thread-per-user shape as
// the personal referral link earlier in this app. Sending a message is
// what actually notifies Admin — see useSupportChat.ts's sendSupportMessage,
// which is what flips unreadByAdmin, the field the header Bell badge and
// the inbox's unread sort are both driven by.
export function SupportChatWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [hasUnseenReply, setHasUnseenReply] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = useSupportMessages(user?.uid);

  // Unread badge on the bubble itself is tracked per-browser (localStorage),
  // not a Firestore field — see SupportThread's own doc comment in types.ts
  // for why unreadByUser isn't a reliable signal for this yet. Good enough
  // for "did I open this and see the latest reply", not meant to sync
  // across devices.
  useEffect(() => {
    if (!messages || messages.length === 0) { setHasUnseenReply(false); return; }
    const lastAdminMsg = [...messages].reverse().find(m => m.senderRole === 'admin');
    if (!lastAdminMsg) { setHasUnseenReply(false); return; }
    const lastSeen = localStorage.getItem(`${LAST_SEEN_KEY}:${user?.uid}`);
    setHasUnseenReply(!lastSeen || new Date(lastAdminMsg.createdAt) > new Date(lastSeen));
  }, [messages, user?.uid]);

  useEffect(() => {
    if (isOpen && user) {
      localStorage.setItem(`${LAST_SEEN_KEY}:${user.uid}`, new Date().toISOString());
      setHasUnseenReply(false);
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (isOpen) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isOpen]);

  if (!user) return null;

  const handleSend = async () => {
    if (!draft.trim() || isSending) return;
    setIsSending(true);
    try {
      await sendSupportMessage(
        { uid: user.uid, name: user.displayName || user.email || 'A user', email: user.email || '' },
        draft
      );
      setDraft('');
    } catch (err) {
      console.error('Failed to send support message:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[70] flex flex-col items-end gap-3">
      {isOpen && (
        <div className="w-[340px] h-[440px] bg-card border border-border rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-accent/10 shrink-0">
            <div>
              <p className="text-sm font-bold">Support</p>
              <p className="text-[11px] text-muted-foreground">We usually reply within a day</p>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
            {messages === null ? (
              <p className="text-xs text-muted-foreground text-center pt-8">Loading…</p>
            ) : messages.length === 0 ? (
              <div className="text-center pt-10 px-4">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">
                  Have a question or ran into something odd? Send a message and we'll get back to you here.
                </p>
              </div>
            ) : messages.map(m => (
              <div key={m.id} className={cn('flex', m.senderRole === 'admin' ? 'justify-start' : 'justify-end')}>
                <div className={cn(
                  'max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm',
                  m.senderRole === 'admin'
                    ? 'bg-accent/50 text-foreground rounded-bl-md'
                    : 'bg-primary text-primary-foreground rounded-br-md'
                )}>
                  <p className="whitespace-pre-wrap break-words leading-snug">{m.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-border shrink-0 flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 resize-none bg-accent/30 border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 max-h-24"
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim() || isSending}
              className="w-10 h-10 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(o => !o)}
        className="relative w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        title="Support"
      >
        {isOpen ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
        {!isOpen && hasUnseenReply && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-background" />
        )}
      </button>
    </div>
  );
}
