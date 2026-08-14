import { useEffect, useState } from 'react';
import { collection, doc, setDoc, addDoc, onSnapshot, query, orderBy, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { SupportMessage } from '../types';

// support_threads/{userId} + support_threads/{userId}/messages/{id} — the
// floating support chat widget's own side of the thread (see
// UsersPermissionsScreen's Support tab for the Admin-facing side of the
// same collection). One thread per user, keyed by their own uid.

export function useSupportMessages(userId: string | null | undefined) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);

  useEffect(() => {
    if (!userId) { setMessages(null); return; }
    setMessages(null);
    const unsubscribe = onSnapshot(
      query(collection(db, 'support_threads', userId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => setMessages(snap.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id,
          senderId: data.senderId,
          senderName: data.senderName,
          senderRole: data.senderRole,
          text: data.text,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        } as SupportMessage;
      })),
      (err) => {
        console.error('Failed to load support messages:', err);
        setMessages([]);
      }
    );
    return () => unsubscribe();
  }, [userId]);

  return messages;
}

// Sends a message as the thread's own owner — the only path the floating
// widget uses. Writes both the message itself and the thread's summary
// doc (create-or-update via merge, matching firestore.rules' owner-write
// branch: lastMessageBy is always 'user' and unreadByAdmin always flips
// true, which is the actual "notify Admin" signal).
export async function sendSupportMessage(user: { uid: string; name: string; email: string }, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const threadRef = doc(db, 'support_threads', user.uid);
  await Promise.all([
    addDoc(collection(db, 'support_threads', user.uid, 'messages'), {
      senderId: user.uid,
      senderName: user.name,
      senderRole: 'user',
      text: trimmed,
      createdAt: serverTimestamp(),
    }),
    setDoc(threadRef, {
      userId: user.uid,
      userName: user.name,
      userEmail: user.email,
      lastMessageText: trimmed,
      lastMessageAt: serverTimestamp(),
      lastMessageBy: 'user',
      unreadByAdmin: true,
      unreadByUser: false,
    }, { merge: true }),
  ]);
}

// Admin-only — the actual "notify admin" signal, live. Drives the header
// Bell badge (AppShell.tsx) and would drive any other admin-facing
// notification surface later. A single equality filter, so no composite
// index needed (see the migration index audit — this app has been bitten
// by assuming that before).
export function useUnreadSupportCount(isAdmin: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) { setCount(0); return; }
    const unsubscribe = onSnapshot(
      query(collection(db, 'support_threads'), where('unreadByAdmin', '==', true)),
      (snap) => setCount(snap.size),
      (err) => console.error('unread support count listener error:', err)
    );
    return () => unsubscribe();
  }, [isAdmin]);

  return count;
}
