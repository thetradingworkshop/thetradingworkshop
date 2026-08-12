import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { X, ChevronLeft, ChevronRight, Play, Pause, Clapperboard } from 'lucide-react';
import { cn } from '@/src/utils';
import { Trade } from '../types';
import { useMarketBars } from '../hooks/useMarketBars';
import { TradeCandleChart } from './TradeCandleChart';

// Phase 3 of the Day View build (see the "Day View Teardown" reference) —
// sequences a day's trades one after another, in chronological order,
// rather than opening one trade's chart in isolation. This is trade-to-trade
// sequencing only: each trade's own bar-by-bar replay is still driven by
// TradeCandleChart's existing "Bar replay" control, untouched here — the
// two are deliberately decoupled rather than one engine reaching into the
// other's internal replay state machine.

interface DayReplayModalProps {
  trades: Trade[]; // already chronological — callers pass a DayCard's own sorted list
  dayLabel: string;
  onClose: () => void;
}

const fmtMoney = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`;

// How long each trade stays on screen during auto-play before advancing to
// the next one. Deliberately generous — this is meant to be watched, not
// blinked through — a trader can always click Next to move faster.
const AUTO_ADVANCE_MS = 8000;

const controlBtn = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-border transition-colors hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent";

export function DayReplayModal({ trades, dayLabel, onClose }: DayReplayModalProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [chartTimeframe, setChartTimeframe] = useState<string | undefined>(undefined);

  const activeTrade = trades[activeIndex] ?? null;
  const { market, isLoading: isLoadingMarket } = useMarketBars(activeTrade, chartTimeframe);

  // Reset the chart's own timeframe/zoom choice whenever the active trade
  // changes — carrying over e.g. a "1d" top-down window chosen for the
  // previous trade onto the next, unrelated trade's chart is confusing
  // rather than useful.
  useEffect(() => {
    setChartTimeframe(undefined);
  }, [activeTrade?.id]);

  const cumulativePnl = useMemo(
    () => trades.slice(0, activeIndex + 1).reduce((s, t) => s + t.pnlCurrency, 0),
    [trades, activeIndex]
  );

  const goNext = () => setActiveIndex(i => Math.min(trades.length - 1, i + 1));
  const goPrev = () => setActiveIndex(i => Math.max(0, i - 1));

  // Auto-play steps trade-to-trade on a timer so a trader can sit back and
  // watch the day's sequence unfold — "how one trade affected the next" —
  // instead of clicking Next repeatedly. Stops itself at the last trade
  // rather than looping back to the start.
  useEffect(() => {
    if (!isPlaying) return;
    if (activeIndex >= trades.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = setTimeout(() => setActiveIndex(i => Math.min(trades.length - 1, i + 1)), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, activeIndex, trades.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setActiveIndex(i => Math.min(trades.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setActiveIndex(i => Math.max(0, i - 1));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trades.length, onClose]);

  if (!activeTrade) return null;

  const isUp = activeTrade.pnlCurrency >= 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border/60 shrink-0">
        <Clapperboard className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-foreground truncate">Day Replay — {dayLabel}</div>
          <div className="text-xs text-muted-foreground">Trade {activeIndex + 1} of {trades.length}</div>
        </div>

        <div className="flex items-center gap-2 ml-6 shrink-0">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Day P&amp;L so far</span>
          <span className={cn("text-sm font-bold", cumulativePnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
            {fmtMoney(cumulativePnl)}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button onClick={goPrev} disabled={activeIndex === 0} className={controlBtn}>
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <button
            onClick={() => setIsPlaying(p => !p)}
            className={cn(controlBtn, isPlaying && "bg-primary text-primary-foreground border-primary hover:bg-primary")}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={goNext} disabled={activeIndex === trades.length - 1} className={controlBtn}>
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            title="Exit replay"
            aria-label="Exit replay"
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress strip — one tile per trade, chronological, click to jump */}
      <div className="flex items-center gap-1.5 px-6 py-3 border-b border-border/40 overflow-x-auto shrink-0">
        {trades.map((t, i) => {
          const up = t.pnlCurrency >= 0;
          return (
            <button
              key={t.id}
              onClick={() => setActiveIndex(i)}
              title={`${t.symbol} ${t.direction} · ${fmtMoney(t.pnlCurrency)}`}
              className={cn(
                "h-9 min-w-[68px] px-2 rounded-lg border text-[10px] font-bold flex flex-col items-center justify-center shrink-0 transition-colors",
                i === activeIndex ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-accent/40"
              )}
            >
              <span className="truncate max-w-[64px]">{t.symbol}</span>
              <span className={up ? "text-emerald-500" : "text-rose-500"}>{fmtMoney(t.pnlCurrency)}</span>
            </button>
          );
        })}
      </div>

      {/* Active trade summary strip */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border/40 shrink-0 text-xs overflow-x-auto">
        <div className="shrink-0"><span className="text-muted-foreground">Symbol </span><span className="font-bold">{activeTrade.symbol}</span></div>
        <div className="shrink-0">
          <span className="text-muted-foreground">Side </span>
          <span className={cn("font-bold", activeTrade.direction === 'LONG' ? "text-emerald-500" : "text-rose-500")}>{activeTrade.direction}</span>
        </div>
        <div className="shrink-0"><span className="text-muted-foreground">Entry </span><span className="font-bold">{format(new Date(activeTrade.entryTime), 'h:mm:ss a')}</span></div>
        <div className="shrink-0"><span className="text-muted-foreground">Exit </span><span className="font-bold">{format(new Date(activeTrade.exitTime), 'h:mm:ss a')}</span></div>
        <div className="shrink-0">
          <span className="text-muted-foreground">Net P&amp;L </span>
          <span className={cn("font-bold", isUp ? "text-emerald-500" : "text-rose-500")}>{fmtMoney(activeTrade.pnlCurrency)}</span>
        </div>
      </div>

      {/* Chart — same single-trade view used everywhere else in the app,
          including its own bar-replay control, unmodified. Drawing edits are
          intentionally not persisted here: this is a watch-the-day-unfold
          view, not the place to build or edit chart annotations — those
          still belong to the regular trade drawer. */}
      <div className="flex-1 min-h-0 p-6">
        <div className="h-full rounded-2xl overflow-hidden border border-border/60">
          <TradeCandleChart
            key={activeTrade.id}
            trade={activeTrade}
            market={market}
            isLoadingMarket={isLoadingMarket}
            timeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
            drawings={activeTrade.drawings || []}
            onDrawingsChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
