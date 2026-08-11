import React, { useState } from 'react';
import { Modal, Button } from './Shared';
import { useTrades } from '../context/TradeContext';
import { TradeIntent } from '../types';

interface LogIntentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

// Mirrors TradeIntent['checklist'] — the four criteria SessionBuilder later
// matches this intent against a real trade to grade (see wasValidAtEntry/
// isViolation in SessionBuilder.ts). Order/labels here are just this
// screen's presentation; the underlying field names are the actual schema.
const CHECKLIST_ITEMS: { key: keyof TradeIntent['checklist']; label: string }[] = [
  { key: 'displacement', label: 'Displacement' },
  { key: 'reversal', label: 'Reversal' },
  { key: 'imbalance', label: 'Imbalance' },
  { key: 'pullback', label: 'Pullback' },
];

const EMPTY_CHECKLIST: TradeIntent['checklist'] = {
  displacement: false,
  reversal: false,
  imbalance: false,
  pullback: false,
};

// Logs a TradeIntent *before* the trade itself exists — SessionBuilder later
// auto-matches it to whichever trade lands on the same symbol within 5
// minutes of this confirmation (see the matching logic in
// SessionBuilder.ts), which is what actually populates a trade's
// wasValidAtEntry/wasForced/isViolation fields and the "Rule Followed" /
// "Rule Violated" badges already shown in TradePerformanceLog and
// SessionDetailScreen. Without logging an intent first, a trade is simply
// left "unconfirmed" — this modal is the only place that gap gets closed.
export function LogIntentModal({ isOpen, onClose, onSuccess }: LogIntentModalProps) {
  const { logTradeIntent } = useTrades();

  const [symbol, setSymbol] = useState('');
  const [checklist, setChecklist] = useState<TradeIntent['checklist']>(EMPTY_CHECKLIST);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = Object.values(checklist).every(v => v === true);
  const anyChecked = Object.values(checklist).some(v => v === true);

  const resetForm = () => {
    setSymbol('');
    setChecklist(EMPTY_CHECKLIST);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const toggleItem = (key: keyof TradeIntent['checklist']) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Submitting with every box checked logs a clean, valid setup. Submitting
  // with anything unchecked still logs the intent (so the trade that
  // follows still gets matched and reviewed later) but marks it as an
  // override — SessionBuilder treats that the same as an invalid setup
  // (isViolation = !wasValidAtEntry || wasForced), i.e. "I took this anyway
  // knowing my own checklist wasn't fully met."
  const handleSubmit = async () => {
    setError(null);
    if (!symbol.trim()) {
      setError('Symbol is required.');
      return;
    }
    setIsSaving(true);
    try {
      await logTradeIntent(symbol.trim().toUpperCase(), checklist, !allChecked);
      resetForm();
      onSuccess();
    } catch (err) {
      console.error('Failed to log trade intent:', err);
      setError('Failed to log intent. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Log Trade Setup" maxWidth="sm">
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground -mt-2">
          Confirm your setup before you enter — this gets auto-matched to whichever trade you place on this symbol in the next 5 minutes, so it can be graded against what you actually saw going in.
        </p>

        <div className="space-y-2">
          <label className={labelClass}>Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            autoFocus
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className={labelClass}>Checklist</label>
          <div className="space-y-1.5">
            {CHECKLIST_ITEMS.map(item => (
              <label
                key={item.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-accent/20 cursor-pointer hover:bg-accent/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checklist[item.key]}
                  onChange={() => toggleItem(item.key)}
                  className="rounded border-border"
                />
                <span className="text-sm font-medium">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {!allChecked && anyChecked && (
          <p className="text-xs text-amber-500">
            Not every criterion is checked — logging this will be recorded as an override.
          </p>
        )}

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancel</Button>
          <Button variant={allChecked ? 'primary' : 'outline'} onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Logging...' : allChecked ? 'Confirm Setup' : 'Log Anyway (Override)'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
