import React, { useMemo, useState } from 'react';
import { Modal, Button } from './Shared';
import { Trade } from '../types';
import { cn } from '@/src/utils';

interface LinkTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTrade: Trade;
  candidates: Trade[];
  onConfirm: (targetTradeId: string) => Promise<void>;
}

export function LinkTradeModal({ isOpen, onClose, sourceTrade, candidates, onConfirm }: LinkTradeModalProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = candidates.filter(t =>
      !q || t.symbol.toLowerCase().includes(q) || t.sessionDate.includes(q)
    );
    return [...list].sort((a, b) => {
      const score = (t: Trade) =>
        (t.sessionDate === sourceTrade.sessionDate ? 2 : 0) + (t.symbol === sourceTrade.symbol ? 1 : 0);
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime();
    });
  }, [candidates, search, sourceTrade.sessionDate, sourceTrade.symbol]);

  const handleClose = () => {
    setSearch('');
    setSelectedId(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setIsMerging(true);
    try {
      await onConfirm(selectedId);
      handleClose();
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Link to Imported Trade" maxWidth="lg">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Moves this manual trade's notes, tags, and rating onto the imported trade you pick below, then removes this manual entry so it isn't double-counted in your stats.
        </p>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by symbol or date..."
          className="w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="max-h-72 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground italic p-3 text-center">No imported trades to link to.</p>
          )}
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs font-medium transition-colors",
                selectedId === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
            >
              <span className="font-bold">{t.symbol}</span>
              <span className={cn(selectedId === t.id ? "opacity-90" : "text-muted-foreground")}>
                {t.sessionDate} {new Date(t.entryTime).toLocaleTimeString()}
              </span>
              <span className={selectedId === t.id ? "" : t.isWinner ? "text-emerald-500" : "text-rose-500"}>
                {t.realizedPnL >= 0 ? '+' : ''}${t.realizedPnL.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end space-x-3">
          <Button variant="outline" onClick={handleClose} disabled={isMerging}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!selectedId || isMerging}>
            {isMerging ? 'Linking...' : 'Link & Merge Notes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
