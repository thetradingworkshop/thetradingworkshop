// Firestore access for manual backtest scenarios (`backtest_scenarios`,
// global to the user's account — same shape/rules as `strategies`). A
// scenario's strategyChecklist mirrors Trade.strategyChecklist so rule
// adherence can be scored the same way for hypothetical trades as for real
// ones; which strategy it's tagged with is stored on the scenario itself
// (strategyId), not on the strategy document.
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
import { BacktestScenario } from '../types';

export function subscribeBacktestScenarios(userId: string, onChange: (scenarios: BacktestScenario[]) => void): () => void {
  const q = query(collection(db, 'backtest_scenarios'), where('userId', '==', userId));
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<BacktestScenario, 'id'>) })));
  });
}

export async function createBacktestScenario(
  userId: string,
  fields: {
    symbol: string;
    direction: 'long' | 'short';
    setupDate: string;
    pnl: number;
    strategyId?: string;
    notes?: string;
    strategyChecklist?: Record<string, boolean>;
  }
): Promise<string> {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, 'backtest_scenarios'), {
    userId,
    symbol: fields.symbol,
    direction: fields.direction,
    setupDate: fields.setupDate,
    pnl: fields.pnl,
    ...(fields.strategyId ? { strategyId: fields.strategyId } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.strategyChecklist ? { strategyChecklist: fields.strategyChecklist } : {}),
    createdAt: now,
    updatedAt: now,
    createdAtServer: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateBacktestScenario(
  id: string,
  patch: Partial<Pick<BacktestScenario, 'symbol' | 'direction' | 'setupDate' | 'pnl' | 'strategyId' | 'notes' | 'strategyChecklist'>>
): Promise<void> {
  await updateDoc(doc(db, 'backtest_scenarios', id), { ...patch, updatedAt: new Date().toISOString() });
}

export async function deleteBacktestScenario(id: string): Promise<void> {
  await deleteDoc(doc(db, 'backtest_scenarios', id));
}
