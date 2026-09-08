// Firestore access for logged pre-trade setups (trade_intents), created by
// LogIntentModal. subscribePendingTradeIntents feeds the Trades screen's
// "Pending Setups" list — the only place a logged setup is actually visible
// again after being confirmed — and markTradeIntentMatched/dismissTradeIntent
// are the two ways a setup leaves that list: turned into a real trade (see
// AddTradeModal's `prefill` prop, which calls markTradeIntentMatched once
// the trade is saved) or dismissed as never taken.
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { TradeIntent } from '../types';

export function subscribePendingTradeIntents(userId: string, onChange: (intents: TradeIntent[]) => void): () => void {
  // Both filters are equality (==), which Firestore can satisfy from its
  // automatic single-field indexes alone — no composite index needed, the
  // way an orderBy or a range filter here would require one.
  const q = query(collection(db, 'trade_intents'), where('userId', '==', userId), where('status', '==', 'pending'));
  return onSnapshot(q, snap => {
    const intents = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<TradeIntent, 'id'>) }));
    // Most-recently-logged setup first — sorted client-side rather than via
    // orderBy, since a handful of pending setups makes that cheap and it
    // sidesteps needing a composite index just for the sort.
    intents.sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime());
    onChange(intents);
  });
}

export async function markTradeIntentMatched(intentId: string, tradeId: string): Promise<void> {
  await updateDoc(doc(db, 'trade_intents', intentId), { status: 'matched', tradeId });
}

export async function dismissTradeIntent(intentId: string): Promise<void> {
  await updateDoc(doc(db, 'trade_intents', intentId), { status: 'dismissed' });
}
