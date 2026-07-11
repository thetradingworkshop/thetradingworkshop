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

export default function TradesScreen({ setActivePage }: { setActivePage: (page: string) => void }) {
  const { trades, setSelectedTradeForJournal } = useTrades();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAddJournal = (trade: any) => {
    setSelectedTradeForJournal(trade);
    setActivePage('journal');
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <SectionHeader 
        title="Trade Performance Log" 
        subtitle="Detailed audit trail of all reconstructed trades and executions"
      />

      <TradePerformanceLog 
        trades={trades} 
        onAddJournal={handleAddJournal}
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
