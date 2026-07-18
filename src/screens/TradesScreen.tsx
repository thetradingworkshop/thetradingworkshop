import React, { useState, useMemo } from 'react';
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
  Zap
} from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { AccountFilterDropdown } from '../components/AccountFilterDropdown';

export default function TradesScreen({ setActivePage }: { setActivePage: (page: string) => void }) {
  const { accountFilteredTrades, setSelectedTradeForJournal, setSelectedSessionForJournal, accountOptions, accountFilter, setAccountFilter } = useTrades();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAddJournal = (trade: any) => {
    setSelectedTradeForJournal(trade);
    setActivePage('journal');
  };

  const handleAddDailyJournal = (trade: any) => {
    setSelectedSessionForJournal({ sessionId: trade.sessionId, sessionDate: trade.sessionDate });
    setActivePage('journal');
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <SectionHeader
        title="Trade Performance Log"
        subtitle="Detailed audit trail of all reconstructed trades and executions"
        rightElement={
          <AccountFilterDropdown accountOptions={accountOptions} accountFilter={accountFilter} setAccountFilter={setAccountFilter} />
        }
      />

      <TradePerformanceLog
        trades={accountFilteredTrades}
        onAddJournal={handleAddJournal}
        onAddDailyJournal={handleAddDailyJournal}
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
