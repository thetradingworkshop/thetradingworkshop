import React, { useEffect, useState } from 'react';
import { deleteField } from 'firebase/firestore';
import { Modal, Button } from './Shared';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { reconstructTrades } from '../engine';
import { markTradeIntentMatched } from '../lib/tradeIntents';
import { Order, Trade } from '../types';

interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // Set when opened from a logged setup's "Log Result" button (Trades
  // screen's Pending Setups list) rather than the plain "Add Trade" button —
  // seeds Symbol/Direction from the plan and, on save, stamps the resulting
  // trade with this setup's planned-risk fields (instead of leaving them
  // unset the way a trade added from scratch has no way to know them) and
  // marks the setup itself 'matched' so it drops off that list.
  prefill?: {
    intentId: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    isValidSetup: boolean;
    overrideUsed: boolean;
    // The plan's numbers, offered as a starting point for Entry/Exit/Stop —
    // still just plain editable fields the user overwrites with what
    // actually happened, not a locked-in value.
    plannedEntry?: number;
    plannedExit?: number;
    plannedStopLoss?: number;
  };
  // Set to correct a trade already on file (wrong price/qty from a broker
  // import, or a manual entry mistake) instead of creating a new one — see
  // handleSubmit's editingTrade branch and TradeContext.updateTrade's own
  // comment for why this can't just reuse addTrades().
  editingTrade?: Trade;
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

// datetime-local inputs want "yyyy-MM-ddTHH:mm" in *local* wall-clock time,
// with no timezone marker — building it from a Date's local getters (not
// toISOString(), which is UTC) is what keeps an edited trade's displayed
// time from silently shifting by however many hours the browser's timezone
// is offset from UTC.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddTradeModal({ isOpen, onClose, onSuccess, prefill, editingTrade }: AddTradeModalProps) {
  const { user } = useAuth();
  const { addTrades, updateTrade, accountOptions } = useTrades();

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [quantity, setQuantity] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [entryTime, setEntryTime] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Runs on open (and if a different setup/trade is targeted while already
  // open) rather than as a useState initializer, since this component stays
  // mounted across opens/closes — a plain initializer would only ever apply
  // to the very first mount. Keyed on the specific id, not the whole object,
  // so it doesn't refire (and stomp on whatever the user is mid-typing)
  // every time a live subscription upstream causes an unrelated re-render.
  useEffect(() => {
    if (!isOpen) return;
    if (editingTrade) {
      setSelectedAccountKey(editingTrade.connectionId && editingTrade.accountId ? `${editingTrade.connectionId}::${editingTrade.accountId}` : '');
      setSymbol(editingTrade.symbol);
      setDirection(editingTrade.direction);
      setQuantity(String(editingTrade.totalQuantity));
      setEntryPrice(String(editingTrade.avgEntryPrice));
      setExitPrice(String(editingTrade.avgExitPrice));
      setStopLoss(editingTrade.tradeRisk != null ? String(editingTrade.tradeRisk) : '');
      setEntryTime(toDatetimeLocalValue(editingTrade.entryTime));
      setExitTime(toDatetimeLocalValue(editingTrade.exitTime));
    } else if (prefill) {
      setSymbol(prefill.symbol);
      setDirection(prefill.direction);
      if (prefill.plannedEntry != null) setEntryPrice(String(prefill.plannedEntry));
      if (prefill.plannedExit != null) setExitPrice(String(prefill.plannedExit));
      if (prefill.plannedStopLoss != null) setStopLoss(String(prefill.plannedStopLoss));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingTrade?.id, prefill?.intentId]);

  const selectedAccount = accountOptions.find(a => `${a.connectionId}::${a.accountId}` === selectedAccountKey);

  const entryNum = Number(entryPrice);
  const stopLossNum = stopLoss.trim() !== '' ? Number(stopLoss) : undefined;
  const hasValidRisk = stopLossNum != null && !isNaN(stopLossNum) && !isNaN(entryNum) && entryPrice !== '';
  const riskPerContract = hasValidRisk ? Math.abs(entryNum - stopLossNum!) : null;
  // Same "stop on the wrong side" sanity check LogIntentModal already shows
  // when planning a setup — surfaced here too since this is the only other
  // place a stop-loss price gets entered.
  const stopOnWrongSide = hasValidRisk && (
    direction === 'LONG' ? stopLossNum! >= entryNum : stopLossNum! <= entryNum
  );

  const resetForm = () => {
    setSelectedAccountKey('');
    setSymbol('');
    setDirection('LONG');
    setQuantity('1');
    setEntryPrice('');
    setExitPrice('');
    setStopLoss('');
    setEntryTime('');
    setExitTime('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    if (!user) return;
    if (accountOptions.length > 0 && !selectedAccount && !editingTrade) {
      setError('Select an account.');
      return;
    }
    if (!symbol.trim()) {
      setError('Symbol is required.');
      return;
    }
    const qty = Number(quantity);
    const entry = Number(entryPrice);
    const exit = Number(exitPrice);
    if (!qty || qty <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    if (!entryPrice || !exitPrice || isNaN(entry) || isNaN(exit)) {
      setError('Entry and exit price are required.');
      return;
    }
    if (stopLoss.trim() !== '' && isNaN(Number(stopLoss))) {
      setError('Stop loss must be a number.');
      return;
    }
    // Time is optional — default entry to now, and exit to entry (an
    // instant/zero-duration trade) when left blank, rather than blocking
    // submission on it.
    const entryIso = entryTime ? new Date(entryTime).toISOString() : new Date().toISOString();
    const exitIso = exitTime ? new Date(exitTime).toISOString() : entryIso;
    if (new Date(exitIso) < new Date(entryIso)) {
      setError('Exit time must be at or after entry time.');
      return;
    }

    setIsSaving(true);
    try {
      const symbolTrimmed = symbol.trim().toUpperCase();
      const uid = crypto.randomUUID();
      const entrySide = direction === 'LONG' ? 'BUY' : 'SELL';
      const exitSide = direction === 'LONG' ? 'SELL' : 'BUY';

      const orders: Order[] = [
        {
          id: `manual-${uid}-entry`,
          userId: user.uid,
          symbol: symbolTrimmed,
          side: entrySide,
          quantity: qty,
          price: entry,
          timestamp: entryIso,
          orderType: 'manual',
          status: 'filled',
          source: 'manual',
        },
        {
          id: `manual-${uid}-exit`,
          userId: user.uid,
          symbol: symbolTrimmed,
          side: exitSide,
          quantity: qty,
          price: exit,
          timestamp: exitIso,
          orderType: 'manual',
          status: 'filled',
          source: 'manual',
        },
      ];

      const accountContext = selectedAccount ? {
        connectionId: selectedAccount.connectionId,
        accountId: selectedAccount.accountId,
        brokerName: selectedAccount.brokerName,
      } : undefined;

      const { trades } = reconstructTrades(orders, accountContext);
      if (trades.length === 0) {
        setError('Could not reconstruct a trade from these values.');
        return;
      }
      const [reconstructed] = trades;
      const stopLossValue = stopLoss.trim() !== '' ? Number(stopLoss) : undefined;

      if (editingTrade) {
        // Keep the doc's own identity and everything reconstructTrades()
        // doesn't know about (review fields, tags, strategy, share status,
        // the intent link, etc.) — only the core+derived fields it just
        // recomputed actually get overwritten. dedupeHash is pinned to the
        // original too, deliberately NOT recomputed from the edited values:
        // addTrades()'s own duplicate check works by comparing dedupeHash
        // against every trade already loaded, so if an edit here let it
        // drift, the *original* unedited import (e.g. the same broker CSV
        // row, re-uploaded later) would no longer be recognized as a
        // duplicate of this now-corrected trade and would slip back in
        // alongside it.
        const updatedFields: Record<string, any> = {
          ...editingTrade,
          ...reconstructed,
          id: editingTrade.id,
          dedupeHash: editingTrade.dedupeHash,
        };
        if (stopLossValue != null) updatedFields.tradeRisk = stopLossValue;
        else if (editingTrade.tradeRisk != null) updatedFields.tradeRisk = deleteField();
        await updateTrade(editingTrade.id, updatedFields);
      } else {
        trades.forEach(t => {
          t.isManualEntry = true;
          if (stopLossValue != null) t.tradeRisk = stopLossValue;
          // Stamp the planned-risk fields directly rather than relying on
          // SessionBuilder's fragile in-memory 5-minute auto-match (which
          // also never persists them) — a deliberate "this is the trade I
          // planned" link is more reliable than a timing heuristic, and lets
          // the Rule Followed/Violated badge (TradePerformanceLog,
          // SessionDetailScreen) actually show up wherever this trade is
          // viewed, not just in that one session's detail page.
          if (prefill) {
            t.intentId = prefill.intentId;
            t.wasValidAtEntry = prefill.isValidSetup;
            t.wasForced = prefill.overrideUsed;
            t.isViolation = !prefill.isValidSetup || prefill.overrideUsed;
          }
        });

        await addTrades(trades);
        if (prefill) {
          // addTrades() persists each trade under its own dedupeHash (not the
          // temp uuid `id` reconstructTrades assigned) — that's the real id
          // to link the setup back to.
          await markTradeIntentMatched(prefill.intentId, trades[0].dedupeHash);
        }
      }
      resetForm();
      onSuccess();
    } catch (err) {
      console.error('Failed to save trade:', err);
      setError('Failed to save trade. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const title = editingTrade ? 'Edit Trade' : prefill ? 'Log Trade Result' : 'Add Trade';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} maxWidth="lg">
      <div className="space-y-5">
        {prefill && !editingTrade && (
          <p className="text-xs text-muted-foreground -mt-2">
            Completing your logged {prefill.symbol} setup — fill in what actually happened. This links back to
            the plan you confirmed, so its Rule Followed / Rule Violated status will show on the saved trade.
          </p>
        )}
        {editingTrade && (
          <p className="text-xs text-muted-foreground -mt-2">
            Corrects the trade itself — P&amp;L, grade, and everything else derived from these values gets
            recomputed from what you save here.
          </p>
        )}
        {accountOptions.length > 0 && (
          <div className="space-y-2">
            <label className={labelClass}>Account</label>
            <select
              value={selectedAccountKey}
              onChange={(e) => setSelectedAccountKey(e.target.value)}
              className={inputClass}
            >
              <option value="">Select an account...</option>
              {accountOptions.map(a => (
                <option key={`${a.connectionId}::${a.accountId}`} value={`${a.connectionId}::${a.accountId}`}>
                  {a.brokerName} — {a.accountName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className={labelClass}>Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. MNQU6"
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Side</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'LONG' | 'SHORT')} className={inputClass}>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className={labelClass}>Position Size <span className="normal-case text-muted-foreground/70">(contracts/shares)</span></label>
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Entry Price</label>
            <input type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Exit Price</label>
            <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
        </div>

        <div className="space-y-2">
          <label className={labelClass}>Stop Loss <span className="normal-case text-muted-foreground/70">(optional — the price you were actually risking to)</span></label>
          <input type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="0.00" className={inputClass} />
          {riskPerContract != null && (
            <p className="text-xs text-muted-foreground">
              Risk <span className="font-bold text-foreground">{riskPerContract.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span> per contract
              {exitPrice !== '' && !isNaN(Number(exitPrice)) && (() => {
                const reward = Math.abs(Number(exitPrice) - entryNum);
                return riskPerContract > 0 ? (
                  <> {' · '}R:R <span className="font-bold text-foreground">1:{(reward / riskPerContract).toFixed(2)}</span></>
                ) : null;
              })()}
            </p>
          )}
          {stopOnWrongSide && (
            <p className="text-xs text-amber-500">
              {direction === 'LONG' ? 'For a long, stop loss is usually below entry.' : 'For a short, stop loss is usually above entry.'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className={labelClass}>Entry Time <span className="normal-case text-muted-foreground/70">(optional — defaults to now)</span></label>
            <input type="datetime-local" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Exit Time <span className="normal-case text-muted-foreground/70">(optional — defaults to entry time)</span></label>
            <input type="datetime-local" value={exitTime} onChange={(e) => setExitTime(e.target.value)} className={inputClass} />
          </div>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : editingTrade ? 'Save Changes' : prefill ? 'Save Result' : 'Add Trade'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
