import React, { useState } from 'react';
import { Modal, Button } from './Shared';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { reconstructTrades } from '../engine';
import { Order } from '../types';

interface AddTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

export function AddTradeModal({ isOpen, onClose, onSuccess }: AddTradeModalProps) {
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
    if (!entryTime || !exitTime) {
      setError('Entry and exit time are required.');
      return;
    }
    const entryIso = new Date(entryTime).toISOString();
    const exitIso = new Date(exitTime).toISOString();
    if (new Date(exitIso) <= new Date(entryIso)) {
      setError('Exit time must be after entry time.');
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

      await addTrades(trades);
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
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Trade" maxWidth="lg">
      <div className="space-y-5">
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
            <label className={labelClass}>Entry Time</label>
            <input type="datetime-local" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Exit Time</label>
            <input type="datetime-local" value={exitTime} onChange={(e) => setExitTime(e.target.value)} className={inputClass} />
          </div>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Add Trade'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
