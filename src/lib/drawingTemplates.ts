// Firestore access for chart-drawing style templates. Templates are global
// to the user's account (`drawing_templates`, keyed by `userId`, mirroring
// the `tagCategories` collection's shape/rules) so a template saved from one
// trade's chart is available on every other trade's chart too.
//
// Separately, `users/{uid}.drawingDefaults[type]` tracks "what a brand-new
// drawing of this type should start with" — the last template applied (or
// saved) for that type, so new drawings pick up your preferred look without
// having to reopen the properties panel every time.
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ChartDrawing, DrawingTemplate, DrawingTemplateStyle } from '../types';

export function subscribeDrawingTemplates(userId: string, onChange: (templates: DrawingTemplate[]) => void): () => void {
  const q = query(collection(db, 'drawing_templates'), where('userId', '==', userId));
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DrawingTemplate, 'id'>) })));
  });
}

export async function saveDrawingTemplate(userId: string, type: ChartDrawing['type'], name: string, style: DrawingTemplateStyle): Promise<void> {
  await addDoc(collection(db, 'drawing_templates'), { userId, type, name, style, createdAt: serverTimestamp() });
}

export async function deleteDrawingTemplate(templateId: string): Promise<void> {
  await deleteDoc(doc(db, 'drawing_templates', templateId));
}

export function subscribeDrawingDefaults(userId: string, onChange: (defaults: Partial<Record<ChartDrawing['type'], DrawingTemplateStyle>>) => void): () => void {
  return onSnapshot(doc(db, 'users', userId), snap => {
    onChange((snap.data()?.drawingDefaults as Partial<Record<ChartDrawing['type'], DrawingTemplateStyle>> | undefined) ?? {});
  });
}

// Pass `style: null` to clear the override for this type (new drawings of
// that type go back to the app's hardcoded default).
export async function setDrawingDefault(userId: string, type: ChartDrawing['type'], style: DrawingTemplateStyle | null): Promise<void> {
  if (style) {
    await setDoc(doc(db, 'users', userId), { drawingDefaults: { [type]: style } }, { merge: true });
  } else {
    await updateDoc(doc(db, 'users', userId), { [`drawingDefaults.${type}`]: deleteField() });
  }
}
