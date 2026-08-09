// Firestore access for the trade chart's own appearance settings — candle
// colors, canvas background/grid, volume visibility. Global to the user's
// account (users/{uid}.chartSettings), mirroring drawingDefaults in
// drawingTemplates.ts, so every trade's chart looks the same.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ChartSettings } from '../types';

export function subscribeChartSettings(userId: string, onChange: (settings: Partial<ChartSettings> | null) => void): () => void {
  return onSnapshot(doc(db, 'users', userId), snap => {
    onChange((snap.data()?.chartSettings as Partial<ChartSettings> | undefined) ?? null);
  });
}

export async function setChartSettings(userId: string, settings: ChartSettings): Promise<void> {
  await setDoc(doc(db, 'users', userId), { chartSettings: settings }, { merge: true });
}
