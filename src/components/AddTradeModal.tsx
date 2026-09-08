import React, { useEffect, useState } from 'react';
import { Modal, Button } from './Shared';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { reconstructTrades } from '../engine';
import { markTradeIntentMatched } from '../lib/tradeIntents';
import { Order } from '../types';

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
    // The plan's numbers, offered as a starting point for Entry/Exit Price —
    // still just plain editable fields the user overwrites with what
    // actually filled, not a locked-in value.
    plannedEntry?: number;
    plannedExit?: number;
  };
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

export function AddTradeModal({ isOpen, onClose, onSuccess, prefill }: AddTradeModalProps) {
  const { user } = useAuth();
  const { addTrades, accountOptions } = useTrades();

  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [quantity, setQuantity] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [entryTime, setEntryTime] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Runs on open (and if a different setup is prefilled while already open,
  // e.g. clicking "Log Result" on one setup right after another) rather than
  // as a useState initializer, since this component stays mounted across
  // opens/closes — a plain initializer would only ever apply to the very
  // first mount. Keyed on intentId, not the whole `prefill` object, so it
  // doesn't refire (and stomp on whatever the user is mid-typing) every time
  // Pending Setups' live subscription causes an unrelated parent re-render.
  useEffect(() => {
    if (isOpen && prefill) {
      setSymbol(prefill.symbol);
      setDirection(prefill.direction);
      if (prefill.plannedEntry != null) setEntryPrice(String(prefill.plannedEntry));
      if (prefill.plannedExit != null) setExitPrice(String(prefill.plannedExit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefill?.intentId]);

  const selectedAccount = accountOptions.find(a => `${a.connectionId}::${a.accountId}` === selectedAccountKey);

  const resetForm = () => {
    setSymbol('');
    setDirection('LONG');
    setQuantity('1');
    setEntryPrice('');
    setExitPrice('');
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
    if (accountOptions.length > 0 && !selectedAccount) {
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
      trades.forEach(t => {
        t.isManualEntry = true;
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
      resetForm();
      onSuccess();
    } catch (err) {
      console.error('Failed to add manual trade:', err);
      setError('Failed to save trade. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={prefill ? 'Log Trade Result' : 'Add Trade'} maxWidth="lg">
      <div className="space-y-5">
        {prefill && (
          <p className="text-xs text-muted-foreground -mt-2">
            Completing your logged {prefill.symbol} setup — fill in what actually happened. This links back to
            the plan you confirmed, so its Rule Followed / Rule Violated status will show on the saved trade.
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
            <label className={labelClass}>Quantity</label>
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
            {isSaving ? 'Saving...' : prefill ? 'Save Result' : 'Add Trade'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
