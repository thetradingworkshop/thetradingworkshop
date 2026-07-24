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
import { AddTradeModal } from '../components/AddTradeModal';

export default function TradesScreen() {
  const { filteredTrades } = useTrades();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isAddTradeOpen, setIsAddTradeOpen] = useState(false);

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12">
      <SectionHeader
        title="Trade Performance Log"
        subtitle="Detailed audit trail of all reconstructed trades and executions"
        rightElement={
          <Button variant="primary" icon={Plus} onClick={() => setIsAddTradeOpen(true)}>Add Trade</Button>
        }
      />

      <TradePerformanceLog trades={filteredTrades} />

      <AddTradeModal
        isOpen={isAddTradeOpen}
        onClose={() => setIsAddTradeOpen(false)}
        onSuccess={() => {
          setIsAddTradeOpen(false);
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
