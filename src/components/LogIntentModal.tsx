import React, { useEffect, useState } from 'react';
import { Modal, Button } from './Shared';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { subscribeStrategies } from '../lib/strategies';
import { Strategy } from '../types';

interface LogIntentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

function parseNum(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== '' && !isNaN(n) ? n : undefined;
}

// Logs a TradeIntent *before* the trade itself exists — SessionBuilder later
// auto-matches it to whichever trade lands on the same symbol within 5
// minutes of this confirmation (see the matching logic in SessionBuilder.ts),
// which is what populates a trade's wasValidAtEntry/wasForced/isViolation
// fields and the "Rule Followed" / "Rule Violated" badges already shown in
// TradePerformanceLog and SessionDetailScreen. Without logging an intent
// first, a trade is simply left "unconfirmed" — this modal is the only
// place that gap gets closed.
//
// Deliberately carries no rule checklist of its own (an earlier version had
// a hardcoded 4-item Displacement/Reversal/Imbalance/Pullback checklist —
// arbitrary criteria that had nothing to do with any strategy the user
// actually trades). The Strategy field here only tags which playbook this
// was meant to follow; whether its rules were actually followed gets
// checked afterward, per-trade, in that trade's own Details view (the
// Strategy tab there already reads the assigned strategy's real rules —
// see Trade.strategyChecklist). This modal's job is the plan itself:
// symbol, direction, entry, stop, target — the fields every trading
// journal researched for this (TradeZella's Trade page, and the
// entry/stop/target/setup-name baseline every trade-plan template and
// journal comparison guide converges on) treats as the minimum for a
// real pre-trade plan.
export function LogIntentModal({ isOpen, onClose, onSuccess }: LogIntentModalProps) {
  const { logTradeIntent } = useTrades();
  const { user } = useAuth();

  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entry, setEntry] = useState('');
  const [plannedExit, setPlannedExit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { setStrategies([]); return; }
    return subscribeStrategies(user.uid, setStrategies);
  }, [user?.uid]);

  const activeStrategies = strategies.filter(s => s.status === 'active');

  const entryNum = parseNum(entry);
  const exitNum = parseNum(plannedExit);
  const stopNum = parseNum(stopLoss);
  const isComplete = entryNum != null && exitNum != null && stopNum != null;

  // Risk/reward preview — points, not dollars (no position size collected
  // here, and point value is symbol-specific), matching the "Trade Risk" /
  // "R-Multiple" concept TradeZella's trade page surfaces for the same
  // three inputs.
  let riskReward: { risk: number; reward: number; ratio: number } | null = null;
  let levelsWarning: string | null = null;
  if (isComplete) {
    const risk = direction === 'LONG' ? entryNum! - stopNum! : stopNum! - entryNum!;
    const reward = direction === 'LONG' ? exitNum! - entryNum! : entryNum! - exitNum!;
    if (risk > 0 && reward > 0) {
      riskReward = { risk, reward, ratio: reward / risk };
    } else {
      levelsWarning = direction === 'LONG'
        ? 'For a long, stop loss should be below entry and target above it.'
        : 'For a short, stop loss should be above entry and target below it.';
    }
  }

  const resetForm = () => {
    setSymbol(''); setDirection('LONG'); setEntry(''); setPlannedExit(''); setStopLoss(''); setStrategyId('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Submitting with a complete plan (entry, target, and stop all set) logs
  // a fully risk-defined setup. Submitting with any of those missing still
  // logs the intent (so the trade that follows still gets matched and
  // reviewed later) but marks it as an override — SessionBuilder treats
  // that the same as an invalid setup (isViolation = !wasValidAtEntry ||
  // wasForced), i.e. "I took this anyway without fully planning my risk."
  const handleSubmit = async () => {
    setError(null);
    if (!symbol.trim()) {
      setError('Symbol is required.');
      return;
    }
    setIsSaving(true);
    try {
      const strategy = activeStrategies.find(s => s.id === strategyId);
      await logTradeIntent({
        symbol: symbol.trim().toUpperCase(),
        direction,
        plannedEntry: entryNum,
        plannedExit: exitNum,
        stopLoss: stopNum,
        strategyId: strategy?.id,
        strategyName: strategy?.name,
      });
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
          Confirm your plan before you enter — this gets auto-matched to whichever trade you place on this symbol in the next 5 minutes, so it can be graded against what you actually planned going in.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-2">
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
            <label className={labelClass}>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'LONG' | 'SHORT')} className={inputClass}>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <label className={labelClass}>Entry</label>
            <input type="number" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Planned Exit</label>
            <input type="number" inputMode="decimal" value={plannedExit} onChange={(e) => setPlannedExit(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Stop Loss</label>
            <input type="number" inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
        </div>

        {riskReward && (
          <p className="text-xs text-muted-foreground">
            Risk <span className="font-bold text-foreground">{riskReward.risk.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            {' · '}Reward <span className="font-bold text-foreground">{riskReward.reward.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            {' · '}R:R <span className="font-bold text-foreground">1:{riskReward.ratio.toFixed(2)}</span>
          </p>
        )}
        {levelsWarning && <p className="text-xs text-amber-500">{levelsWarning}</p>}

        {activeStrategies.length > 0 && (
          <div className="space-y-2">
            <label className={labelClass}>Strategy</label>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={inputClass}>
              <option value="">No strategy — unplanned setup</option>
              {activeStrategies.map(s => (
                <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Just tags which playbook this was meant to follow — once the trade lands, confirm it followed that
              strategy's actual rules from the trade's own Details view.
            </p>
          </div>
        )}

        {!isComplete && (
          <p className="text-xs text-amber-500">
            Entry, target, and stop aren't all set — logging this will be recorded as an override.
          </p>
        )}

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancel</Button>
          <Button variant={isComplete ? 'primary' : 'outline'} onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Logging...' : isComplete ? 'Confirm Setup' : 'Log Anyway (Incomplete Plan)'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
