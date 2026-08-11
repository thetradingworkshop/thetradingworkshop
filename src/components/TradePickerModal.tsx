import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Modal, Input } from './Shared';
import { cn } from '@/src/utils';
import { Trade } from '../types';

interface TradePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (trade: Trade) => void;
  trades: Trade[];
  title?: string;
}

// A generic "pick one of your trades" list — first used to relink a journal
// note to a different trade (e.g. a manual placeholder entry gets deleted
// once the real broker-imported trade lands, and the note that was written
// against it needs to point at the real one instead), but not tied to that
// use case specifically.
export function TradePickerModal({ isOpen, onClose, onSelect, trades, title = 'Select a trade' }: TradePickerModalProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const sorted = [...trades].sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
    const q = search.trim().toUpperCase();
    const matching = q ? sorted.filter(t => t.symbol.toUpperCase().includes(q)) : sorted;
    return matching.slice(0, 50);
  }, [trades, search]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="space-y-4">
        <Input
          autoFocus
          placeholder="Search by symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-xl border border-border">
          {filtered.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center italic">No matching trades.</p>
          )}
          {filtered.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onSelect(t); onClose(); }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold flex items-center gap-1.5">
                  {t.symbol}
                  <span className="text-xs font-normal text-muted-foreground">{t.direction}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {format(new Date(t.entryTime), 'MMM d, yyyy h:mm a')} · {t.avgEntryPrice} → {t.avgExitPrice}
                </div>
              </div>
              <div className={cn('shrink-0 text-sm font-bold', t.pnlCurrency >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                {t.pnlCurrency >= 0 ? '+' : '-'}${Math.abs(t.pnlCurrency).toFixed(2)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
