// Firestore access for reusable trading-strategy playbooks (`strategies`,
// global to the user's account — same shape/rules as `drawing_templates`).
// A Strategy's categories/rules are entirely user-authored; this file only
// handles the playbook itself. Which strategy a given trade is tagged with,
// and which of its rules were actually checked off for that trade, live on
// the Trade document itself (strategyId/strategyChecklist — see types.ts),
// written via TradeContext's updateTradeFields, not through here.
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Strategy, StrategyCategory } from '../types';

export function subscribeStrategies(userId: string, onChange: (strategies: Strategy[]) => void): () => void {
  const q = query(collection(db, 'strategies'), where('userId', '==', userId));
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Strategy, 'id'>) })));
  });
}

export async function createStrategy(userId: string, name: string, icon: string | undefined, categories: StrategyCategory[]): Promise<string> {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, 'strategies'), {
    userId,
    name,
    ...(icon ? { icon } : {}),
    status: 'active' as const,
    categories,
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateStrategy(id: string, patch: Partial<Pick<Strategy, 'name' | 'icon' | 'status' | 'categories'>>): Promise<void> {
  await updateDoc(doc(db, 'strategies', id), { ...patch, updatedAt: new Date().toISOString() });
}

export async function deleteStrategy(id: string): Promise<void> {
  await deleteDoc(doc(db, 'strategies', id));
}
