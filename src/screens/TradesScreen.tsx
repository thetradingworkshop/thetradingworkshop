import React, { useState, useMemo, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Badge, Button, Input, Toast } from '../components/Shared';
import {
  Search,
  Filter,
  ArrowUpDown,
  ChevronRight,
  Calendar,
  Clock,
  Target,
  TrendingUp,
  TrendingDown,
  X,
  Plus,
  BookOpen,
  Zap,
  ClipboardCheck,
} from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { AddTradeModal } from '../components/AddTradeModal';
import { subscribePendingTradeIntents, dismissTradeIntent } from '../lib/tradeIntents';
import { TradeIntent } from '../types';

// Setups logged via "Log Setup" (LogIntentModal) live in their own
// trade_intents collection, not `trades` — nothing ever created a Trade for
// one automatically. Previously that meant a logged setup was invisible
// everywhere after the initial toast, unreachable unless a broker-synced
// trade happened to land on the same symbol within 5 minutes (see
// SessionBuilder's in-memory-only matching) — impossible for manual/demo
// trading, and even then nothing was ever persisted back to the trade
// itself. This list surfaces every still-open setup so it can be completed
// into a real, journal-able trade (or dismissed) whenever the user actually
// gets to it.
function PendingSetups({ intents, onLogResult, onDismiss }: {
  intents: TradeIntent[];
  onLogResult: (intent: TradeIntent) => void;
  onDismiss: (intent: TradeIntent) => void;
}) {
  if (intents.length === 0) return null;

  return (
    <Card className="p-5 space-y-4 border-indigo-500/20 bg-indigo-500/[0.03]">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-indigo-500" />
        <h3 className="text-sm font-black tracking-tight text-foreground">Pending Setups</h3>
        <Badge variant="info">{intents.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Setups logged before entry, waiting on a result. Log what actually happened once you've taken one — it'll
        link back to this plan so you can add trade notes and see whether you followed it.
      </p>
      <div className="space-y-2">
        {intents.map(intent => (
          <div
            key={intent.id}
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant={intent.direction === 'LONG' ? 'positive' : 'negative'}>
                {intent.direction === 'LONG' ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                {intent.direction}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{intent.symbol}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {intent.isValidSetup
                    ? `Entry ${intent.plannedEntry} · Target ${intent.plannedExit} · Stop ${intent.stopLoss}`
                    : 'Incomplete plan (logged as override)'}
                  {' · '}{formatDistanceToNow(new Date(intent.confirmedAt), { addSuffix: true })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => onDismiss(intent)}>Dismiss</Button>
              <Button variant="primary" size="sm" onClick={() => onLogResult(intent)}>Log Result</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function TradesScreen() {
  const { filteredTrades } = useTrades();
  const { user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isAddTradeOpen, setIsAddTradeOpen] = useState(false);
  const [pendingIntents, setPendingIntents] = useState<TradeIntent[]>([]);
  const [activeIntent, setActiveIntent] = useState<TradeIntent | null>(null);

  useEffect(() => {
    if (!user) { setPendingIntents([]); return; }
    return subscribePendingTradeIntents(user.uid, setPendingIntents);
  }, [user?.uid]);

  const openLogResult = (intent: TradeIntent) => {
    setActiveIntent(intent);
    setIsAddTradeOpen(true);
  };

  const closeAddTrade = () => {
    setIsAddTradeOpen(false);
    setActiveIntent(null);
  };

  const handleDismiss = async (intent: TradeIntent) => {
    try {
      await dismissTradeIntent(intent.id);
    } catch (err) {
      console.error('Failed to dismiss setup:', err);
      setToast({ message: 'Failed to dismiss setup', type: 'error' });
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <SectionHeader
        title="Trade Performance Log"
        subtitle="Detailed audit trail of all reconstructed trades and executions"
        rightElement={
          <Button variant="primary" icon={Plus} onClick={() => setIsAddTradeOpen(true)}>Add Trade</Button>
        }
      />

      <PendingSetups intents={pendingIntents} onLogResult={openLogResult} onDismiss={handleDismiss} />

      <TradePerformanceLog trades={filteredTrades} />

      <AddTradeModal
        isOpen={isAddTradeOpen}
        onClose={closeAddTrade}
        prefill={activeIntent ? {
          intentId: activeIntent.id,
          symbol: activeIntent.symbol,
          direction: activeIntent.direction,
          isValidSetup: activeIntent.isValidSetup,
          overrideUsed: activeIntent.overrideUsed,
          plannedEntry: activeIntent.plannedEntry,
          plannedExit: activeIntent.plannedExit,
        } : undefined}
        onSuccess={() => {
          closeAddTrade();
          setToast({ message: 'Trade added successfully', type: 'success' });
        }}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
