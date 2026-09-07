// Firestore access for reusable journal-entry layouts (the Journal
// screen's Templates tab). Global to the user's account — `journal_templates`
// keyed by `userId`, mirroring drawing_templates.ts's shape/rules — so a
// template saved once is available from every note's "Insert Template"
// button, not just the one it was created from.
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { JournalTemplate } from '../types';

export function subscribeJournalTemplates(userId: string, onChange: (templates: JournalTemplate[]) => void): () => void {
  const q = query(collection(db, 'journal_templates'), where('userId', '==', userId));
  return onSnapshot(q, snap => {
    const templates = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<JournalTemplate, 'id'>) }));
    // Firestore doesn't sort this for us without a composite index (see
    // firestore.indexes.json's own field-override exemption for `content`
    // — adding an orderBy here would need one), so sort client-side; a
    // handful of templates per user makes that cheap.
    templates.sort((a, b) => a.name.localeCompare(b.name));
    onChange(templates);
  });
}

export async function createJournalTemplate(userId: string, name: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  await addDoc(collection(db, 'journal_templates'), { userId, name, content, createdAt: now, updatedAt: now });
}

export async function updateJournalTemplate(templateId: string, updates: { name?: string; content?: string }): Promise<void> {
  await updateDoc(doc(db, 'journal_templates', templateId), { ...updates, updatedAt: new Date().toISOString() });
}

export async function deleteJournalTemplate(templateId: string): Promise<void> {
  await deleteDoc(doc(db, 'journal_templates', templateId));
}
