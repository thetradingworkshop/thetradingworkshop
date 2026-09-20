// Firestore access for Admin-curated strategy templates (`strategy_templates`
// — a separate top-level collection from `strategies`, since this is global
// catalog content with no per-user owner, not user-owned data). Any
// authenticated user can read; only an Admin can write (firestore.rules).
// "Use this template" (StrategiesScreen.tsx) clones a template into the
// signed-in user's own strategies via strategies.ts's createStrategy().
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { StrategyCategory, StrategyTemplate } from '../types';

export function subscribeStrategyTemplates(onChange: (templates: StrategyTemplate[]) => void): () => void {
  return onSnapshot(collection(db, 'strategy_templates'), snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StrategyTemplate, 'id'>) })));
  });
}

export async function createStrategyTemplate(name: string, icon: string | undefined, description: string | undefined, categories: StrategyCategory[]): Promise<string> {
  const docRef = await addDoc(collection(db, 'strategy_templates'), {
    name,
    ...(icon ? { icon } : {}),
    ...(description ? { description } : {}),
    categories,
    createdAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateStrategyTemplate(id: string, patch: Partial<Pick<StrategyTemplate, 'name' | 'icon' | 'description' | 'categories'>>): Promise<void> {
  await updateDoc(doc(db, 'strategy_templates', id), patch);
}

export async function deleteStrategyTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, 'strategy_templates', id));
}
