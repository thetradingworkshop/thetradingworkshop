import React, { useMemo, useState } from 'react';
import { format, addMonths, subMonths, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { cn } from '@/src/utils';
import { Card } from './Shared';
import { Trade } from '../types';
import { buildCalendarDays } from '../services/analyticsService';

interface DayViewCalendarRailProps {
  // Deliberately the *full* trade list, not the page's date-range-filtered
  // one — the calendar is its own independently navigable widget (matching
  // TradeZella's behavior), so paging to a month outside the global date
  // filter should still show real data instead of going blank.
  trades: Trade[];
  userId: string;
  // Session ids (`${userId}_${yyyy-MM-dd}`) that already have a Daily
  // Journal entry — same id shape SessionBuilder uses, so a calendar day's
  // note dot is a plain membership check, no extra date parsing.
  noteSessionIds: Set<string>;
  selectedDateKey: string | null;
  onSelectDay: (date: Date) => void;
  onClearSelection: () => void;
}

const fmtMoney = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`;

export function DayViewCalendarRail({
  trades,
  userId,
  noteSessionIds,
  selectedDateKey,
  onSelectDay,
  onClearSelection,
}: DayViewCalendarRailProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const calendarDays = useMemo(
    () => buildCalendarDays(trades, currentMonth, true),
    [trades, currentMonth]
  );

  const monthSummary = useMemo(() => {
    const active = calendarDays.filter(d => !d.isEmpty);
    const pnl = active.reduce((sum, d) => sum + d.pnl, 0);
    return { pnl, daysTraded: active.length };
  }, [calendarDays]);

  const maxAbsPnl = useMemo(
    () => Math.max(1, ...calendarDays.filter(d => !d.isEmpty).map(d => Math.abs(d.pnl))),
    [calendarDays]
  );

  const today = new Date();

  return (
    <Card className="p-4 space-y-4 sticky top-[88px]">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth(m => subMonths(m, 1))}
          className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm font-bold text-foreground">{format(currentMonth, 'MMMM yyyy')}</span>
        <button
          onClick={() => setCurrentMonth(m => addMonths(m, 1))}
          className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between px-0.5">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Month Net P&L</div>
          <div className={cn("text-sm font-bold mt-0.5", monthSummary.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
            {fmtMoney(monthSummary.pnl)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Days Traded</div>
          <div className="text-sm font-bold text-foreground mt-0.5">{monthSummary.daysTraded}</div>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[9px] font-bold uppercase text-muted-foreground/70">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((d, i) => {
            if (d.isEmpty) {
              return <div key={i} className="aspect-square" />;
            }
            const dateKey = format(d.date, 'yyyy-MM-dd');
            const sessionId = `${userId}_${dateKey}`;
            const hasNote = noteSessionIds.has(sessionId);
            const hasTrades = d.trades > 0;
            const intensity = hasTrades ? Math.max(0.12, (Math.abs(d.pnl) / maxAbsPnl) * 0.6) : 0;
            const isToday = isSameDay(d.date, today);
            const isSelected = selectedDateKey === dateKey;

            return (
              <button
                key={i}
                onClick={() => (isSelected ? onClearSelection() : onSelectDay(d.date))}
                title={hasTrades ? `${dateKey} · ${fmtMoney(d.pnl)}${hasNote ? ' · has a note' : ''}` : dateKey}
                className={cn(
                  "relative aspect-square rounded-md flex items-center justify-center text-[10px] font-bold transition-all",
                  !hasTrades && "text-muted-foreground/40 hover:bg-accent/40",
                  isSelected && "ring-2 ring-primary",
                  isToday && !isSelected && "ring-1 ring-primary/40"
                )}
                style={hasTrades ? {
                  backgroundColor: d.pnl >= 0 ? `rgba(16,185,129,${intensity})` : `rgba(244,63,94,${intensity})`,
                  color: d.pnl >= 0 ? '#059669' : '#e11d48',
                } : undefined}
              >
                {d.day}
                {hasNote && (
                  <NotebookPen className="w-2 h-2 absolute bottom-0.5 right-0.5 opacity-70" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDateKey && (
        <button
          onClick={onClearSelection}
          className="w-full text-center text-[11px] font-bold text-primary hover:underline"
        >
          Clear day selection
        </button>
      )}
    </Card>
  );
}
