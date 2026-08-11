import React, { useMemo, useState } from 'react';
import { format, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Badge } from '../components/Shared';
import { ChevronDown, CalendarDays } from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { SessionBuilder } from '../services/SessionBuilder';
import { DayEquitySparkline } from '../components/DayEquitySparkline';
import { Trade, Session } from '../types';

// Phase 1 of the Day View build (see the "Day View Teardown" reference) —
// a scrollable feed of collapsible per-day cards, plus a Day/Week toggle.
// Deliberately not yet wired up: the note button, the calendar rail,
// session replay, and "Review with Zella AI" — later phases, each with
// their own real backend/data work, not stubbed here.

type Mode = 'day' | 'week';

interface FeedGroup {
  key: string;
  label: string;
  dateForSort: number; // epoch ms of the group's start, for descending sort
  trades: Trade[];
  session: Session;
}

// `new Date(iso)` + local getters (not the UTC-parsing `.toISOString().slice`
// pattern) — the same fix applied earlier to SessionDetailScreen's intent
// matching, for the same reason: in any timezone behind UTC, slicing the
// ISO string groups an evening trade into the *next* UTC day instead of the
// local trading day it actually happened on.
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildGroup(key: string, label: string, dateForSort: number, trades: Trade[]): FeedGroup {
  const sorted = [...trades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
  const userId = sorted[0].userId;
  // Empty intents array — Discipline Score / rule-violation fields aren't
  // shown on this compact card, only the plain trade-derived stats are, so
  // there's no need to pull trade_intents here (that's what SessionBuilder
  // uses them for).
  const session = SessionBuilder.buildSession(userId, key, sorted, []);
  return { key, label, dateForSort, trades: sorted, session };
}

function buildDayGroups(trades: Trade[]): FeedGroup[] {
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = localDayKey(t.entryTime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(t);
  }
  return Array.from(byDay.entries())
    .map(([key, dayTrades]) => {
      // Derived straight from the first trade's own (already-local) Date
      // object, never round-tripped through the "yyyy-MM-dd" string — that
      // round-trip is exactly the bug fixed earlier in SessionDetailScreen's
      // intent matching: `new Date("2026-08-10")` parses as *UTC* midnight,
      // which in any timezone behind UTC lands on the *previous* local day.
      const firstEntry = new Date(dayTrades[0].entryTime);
      const dayStart = new Date(firstEntry.getFullYear(), firstEntry.getMonth(), firstEntry.getDate());
      return buildGroup(key, format(firstEntry, 'EEE, MMM d, yyyy'), dayStart.getTime(), dayTrades);
    })
    .sort((a, b) => b.dateForSort - a.dateForSort);
}

function buildWeekGroups(trades: Trade[]): FeedGroup[] {
  const byWeek = new Map<string, Trade[]>();
  for (const t of trades) {
    const weekStart = startOfWeek(new Date(t.entryTime), { weekStartsOn: 1 });
    const key = format(weekStart, 'yyyy-MM-dd');
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(t);
  }
  return Array.from(byWeek.entries())
    .map(([key, weekTrades]) => {
      // Same fix as buildDayGroups: recompute from a trade's real Date
      // rather than re-parsing the "yyyy-MM-dd" key string.
      const weekStart = startOfWeek(new Date(weekTrades[0].entryTime), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const label = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
      return buildGroup(key, label, weekStart.getTime(), weekTrades);
    })
    .sort((a, b) => b.dateForSort - a.dateForSort);
}

const fmtMoney = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toFixed(2)}`;

export default function DayViewScreen() {
  const { filteredTrades } = useTrades();
  const { getEffectiveRange } = useDateRange();
  const effectiveRange = getEffectiveRange('dayview');
  const [mode, setMode] = useState<Mode>('day');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rangedTrades = useMemo(
    () => filteredTrades.filter(t => isWithinInterval(new Date(t.entryTime), { start: effectiveRange.from, end: effectiveRange.to })),
    [filteredTrades, effectiveRange]
  );

  const groups = useMemo(
    () => (mode === 'day' ? buildDayGroups(rangedTrades) : buildWeekGroups(rangedTrades)),
    [rangedTrades, mode]
  );

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6 pb-20">
      <SectionHeader
        title="Day View"
        subtitle="Every trading day (or week) as its own card — equity curve, stats, and the trades behind them, without opening one session at a time."
      />

      <div className="flex items-center gap-1 w-fit p-1 rounded-xl bg-accent/30 border border-border">
        {(['day', 'week'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors",
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card className="text-center py-16">
          <CalendarDays className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground italic">No trades in {effectiveRange.label.toLowerCase()}.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <DayCard key={g.key} group={g} expanded={!collapsed.has(g.key)} onToggle={() => toggle(g.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayCard({ group, expanded, onToggle }: { group: FeedGroup; expanded: boolean; onToggle: () => void }) {
  const { session, trades } = group;
  const isUp = session.netPnl >= 0;

  const sparkPoints = useMemo(() => {
    let cum = 0;
    return trades.map(t => {
      cum += t.pnlCurrency;
      return { time: Math.floor(new Date(t.exitTime).getTime() / 1000), cumPnl: cum };
    });
  }, [trades]);

  const grossPnl = useMemo(() => trades.reduce((s, t) => s + (t.grossPnlCurrency ?? t.pnlCurrency), 0), [trades]);
  const commissions = useMemo(() => trades.reduce((s, t) => s + (t.totalCommission ?? 0), 0), [trades]);

  return (
    <Card noPadding>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-accent/20 transition-colors"
      >
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", !expanded && "-rotate-90")} />
        <span className="font-bold text-foreground">{group.label}</span>
        <Badge variant={isUp ? 'positive' : 'negative'} className="ml-1">
          Net P&L {fmtMoney(session.netPnl)}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">{session.totalTrades} trade{session.totalTrades === 1 ? '' : 's'}</span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 pt-2 border-t border-border/60 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
            <DayEquitySparkline points={sparkPoints} className="h-[90px] w-full" />
            <div className="grid grid-cols-3 gap-x-4 gap-y-3 content-start">
              <Stat label="Total Trades" value={String(session.totalTrades)} />
              <Stat label="Win Rate" value={`${session.winRate.toFixed(2)}%`} />
              <Stat label="Gross P&L" value={fmtMoney(grossPnl)} />
              <Stat label="Volume" value={String(session.totalVolume)} />
              <Stat label="Winners / Losers" value={`${session.winCount} / ${session.lossCount}`} />
              <Stat label="Profit Factor" value={session.profitFactor.toFixed(2)} />
              <Stat label="Commissions" value={`$${commissions.toFixed(2)}`} />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-accent/20">
                <tr>
                  <th className="text-left font-bold uppercase tracking-wider text-muted-foreground px-4 py-2">Time</th>
                  <th className="text-left font-bold uppercase tracking-wider text-muted-foreground px-4 py-2">Symbol</th>
                  <th className="text-left font-bold uppercase tracking-wider text-muted-foreground px-4 py-2">Side</th>
                  <th className="text-right font-bold uppercase tracking-wider text-muted-foreground px-4 py-2">Qty</th>
                  <th className="text-right font-bold uppercase tracking-wider text-muted-foreground px-4 py-2">Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="px-4 py-2 text-muted-foreground">{format(new Date(t.entryTime), 'h:mm a')}</td>
                    <td className="px-4 py-2 font-bold">{t.symbol}</td>
                    <td className="px-4 py-2">
                      <span className={cn("font-bold", t.direction === 'LONG' ? "text-emerald-500" : "text-rose-500")}>{t.direction}</span>
                    </td>
                    <td className="px-4 py-2 text-right">{t.totalQuantity}</td>
                    <td className={cn("px-4 py-2 text-right font-bold", t.pnlCurrency >= 0 ? "text-emerald-500" : "text-rose-500")}>
                      {fmtMoney(t.pnlCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold text-foreground mt-0.5">{value}</div>
    </div>
  );
}
