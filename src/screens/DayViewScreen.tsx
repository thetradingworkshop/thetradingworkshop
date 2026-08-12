import React, { useEffect, useMemo, useState } from 'react';
import { format, startOfWeek, endOfWeek, endOfDay, isWithinInterval, startOfDay } from 'date-fns';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Badge } from '../components/Shared';
import { ChevronDown, CalendarDays, NotebookPen, Clapperboard, Sparkles } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { useAuth } from '../context/AuthContext';
import { SessionBuilder } from '../services/SessionBuilder';
import { DayEquitySparkline } from '../components/DayEquitySparkline';
import { DayViewCalendarRail } from '../components/DayViewCalendarRail';
import { DayReplayModal } from '../components/DayReplayModal';
import { DayReviewModal } from '../components/DayReviewModal';
import { subscribeDayReviews } from '../lib/dayReview';
import { subscribeStrategies } from '../lib/strategies';
import { stripHtml } from '../components/RichTextEditor';
import { Trade, Session, DayReview, Strategy } from '../types';

// Phase 1 of the Day View build (see the "Day View Teardown" reference) —
// a scrollable feed of collapsible per-day cards, plus a Day/Week toggle.
// Phase 2 adds the calendar rail (independent month navigation, reusing
// analyticsService's buildCalendarDays) and the per-day "Add/View note"
// button, which reuses JournalScreen's own note find-or-create logic via
// TradeContext's selectedSessionForJournal — no note-authoring logic is
// duplicated here. Phase 3 adds "Replay" (Day mode only — a week's worth of
// trades sequenced together doesn't map to TradeZella's per-day replay
// concept), opening DayReplayModal to step through that day's trades in
// order. Phase 4 adds "Review with AI" — a real LLM call (server-side, see
// /api/day-review/generate) over that day's trades, its journal note, and
// strategy-rule adherence, cached in session_reviews.

// Same outcome convention used everywhere else a StrategyRule's showWhen is
// evaluated (StrategiesScreen, TradePerformanceLog's Strategy tab).
function outcomeOf(t: Trade): 'winner' | 'loser' | 'breakeven' {
  return t.pnlCurrency > 0 ? 'winner' : t.pnlCurrency < 0 ? 'loser' : 'breakeven';
}

// One line per strategy-tagged trade summarizing rule adherence, for the AI
// review prompt — "reads... the trader's saved rules/strategies" per the
// Day View Teardown's spec for this feature. Trades with no strategy
// assigned, or whose strategy has since been deleted, are silently skipped.
function buildStrategyNotes(trades: Trade[], strategies: Strategy[]): string[] {
  const byId = new Map(strategies.map(s => [s.id, s]));
  const notes: string[] = [];
  for (const t of trades) {
    if (!t.strategyId) continue;
    const strategy = byId.get(t.strategyId);
    if (!strategy) continue;
    const outcome = outcomeOf(t);
    const applicable = strategy.categories.flatMap(c =>
      c.rules.filter(r => !r.showWhen || r.showWhen === 'always' || r.showWhen === outcome)
    );
    if (applicable.length === 0) continue;
    const followed = applicable.filter(r => t.strategyChecklist?.[r.id]);
    const broken = applicable.filter(r => !t.strategyChecklist?.[r.id]);
    notes.push(
      `${t.symbol} (${strategy.name}): followed ${followed.length}/${applicable.length} rules` +
      (broken.length > 0 ? ` — broke: ${broken.map(r => r.text).join('; ')}` : '')
    );
  }
  return notes;
}

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

interface DayViewScreenProps {
  setActivePage: (id: string) => void;
}

export default function DayViewScreen({ setActivePage }: DayViewScreenProps) {
  const { trades, filteredTrades, setSelectedSessionForJournal } = useTrades();
  const { user } = useAuth();
  const { getEffectiveRange, setPageOverride } = useDateRange();
  const effectiveRange = getEffectiveRange('dayview');
  const [mode, setMode] = useState<Mode>('day');
  // Cards start collapsed — the equity curve and stat grid are always
  // visible regardless of this state (see DayCard), so "expanding" a card
  // only ever reveals its per-trade table. Tracking *expanded* keys (not
  // collapsed ones) means a freshly-loaded day defaults to compact.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [replayGroup, setReplayGroup] = useState<FeedGroup | null>(null);
  const [reviewGroup, setReviewGroup] = useState<FeedGroup | null>(null);

  // Daily Journal entries, scoped to this user only (matching JournalScreen's
  // own subscription) — keyed by sessionId so both "does this day have a
  // note" (calendar dot, card button label) and "what does that note say"
  // (fed into the AI review prompt below) are the same single lookup, no
  // re-querying per day and no separate fetch when opening Review with AI.
  const [journalsBySessionId, setJournalsBySessionId] = useState<Map<string, { id: string; content: string }>>(new Map());
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'journals'), where('userId', '==', user.uid)),
      (snapshot) => {
        const map = new Map<string, { id: string; content: string }>();
        snapshot.docs.forEach(d => {
          const data: any = d.data();
          // Same "Daily Journal" bucket JournalScreen's categoryOf() uses:
          // not a trade note, not a multi-day session recap.
          if (!data.tradeId && data.noteType !== 'session_recap' && data.sessionId) {
            map.set(data.sessionId, { id: d.id, content: data.content || '' });
          }
        });
        setJournalsBySessionId(map);
      }
    );
    return () => unsubscribe();
  }, [user]);
  const noteSessionIds = useMemo(() => new Set(journalsBySessionId.keys()), [journalsBySessionId]);

  // For the AI review's "reads... the trader's saved rules/strategies" —
  // same subscription StrategiesScreen and the trade drawer's Strategy tab
  // already use.
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  useEffect(() => {
    if (!user) return;
    return subscribeStrategies(user.uid, setStrategies);
  }, [user]);

  // Cached AI reviews, one live subscription for the whole page (mirrors the
  // journals subscription above) — a Map keyed by sessionDate so each card's
  // "Review with AI" vs "View AI Review" label, and the modal's initial
  // cached content, are both plain lookups.
  const [dayReviews, setDayReviews] = useState<Map<string, DayReview>>(new Map());
  useEffect(() => {
    if (!user) return;
    return subscribeDayReviews(user.uid, setDayReviews);
  }, [user]);

  const rangedTrades = useMemo(
    () => filteredTrades.filter(t => isWithinInterval(new Date(t.entryTime), { start: effectiveRange.from, end: effectiveRange.to })),
    [filteredTrades, effectiveRange]
  );

  const groups = useMemo(
    () => (mode === 'day' ? buildDayGroups(rangedTrades) : buildWeekGroups(rangedTrades)),
    [rangedTrades, mode]
  );

  const toggle = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSelectCalendarDay = (date: Date) => {
    const key = format(date, 'yyyy-MM-dd');
    setSelectedDateKey(key);
    setPageOverride('dayview', { from: startOfDay(date), to: endOfDay(date), label: format(date, 'MMM d, yyyy') });
    setMode('day');
  };
  const clearCalendarSelection = () => {
    setSelectedDateKey(null);
    setPageOverride('dayview', null);
  };

  const openNote = (group: FeedGroup) => {
    setSelectedSessionForJournal({ sessionId: group.session.id, sessionDate: group.session.sessionDate });
    setActivePage('journal');
  };

  return (
    <div className="space-y-6 pb-20">
      <SectionHeader
        title="Day View"
        subtitle="Every trading day (or week) as its own card — equity curve, stats, and the trades behind them, without opening one session at a time."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="space-y-4">
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
                <DayCard
                  key={g.key}
                  group={g}
                  expanded={expandedKeys.has(g.key)}
                  onToggle={() => toggle(g.key)}
                  showNoteButton={mode === 'day'}
                  hasNote={noteSessionIds.has(g.session.id)}
                  onNote={() => openNote(g)}
                  showReplayButton={mode === 'day'}
                  onReplay={() => setReplayGroup(g)}
                  showReviewButton={mode === 'day'}
                  hasReview={dayReviews.has(g.key)}
                  onReview={() => setReviewGroup(g)}
                />
              ))}
            </div>
          )}
        </div>

        <DayViewCalendarRail
          trades={trades}
          userId={user?.uid ?? ''}
          noteSessionIds={noteSessionIds}
          selectedDateKey={selectedDateKey}
          onSelectDay={handleSelectCalendarDay}
          onClearSelection={clearCalendarSelection}
        />
      </div>

      {replayGroup && (
        <DayReplayModal
          trades={replayGroup.trades}
          dayLabel={replayGroup.label}
          onClose={() => setReplayGroup(null)}
        />
      )}

      {reviewGroup && user && (
        <DayReviewModal
          userId={user.uid}
          sessionId={reviewGroup.session.id}
          sessionDate={reviewGroup.session.sessionDate}
          dayLabel={reviewGroup.label}
          trades={reviewGroup.trades.map(t => ({
            symbol: t.symbol,
            direction: t.direction,
            isWinner: t.isWinner,
            pnlCurrency: t.pnlCurrency,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
          }))}
          journalNote={stripHtml(journalsBySessionId.get(reviewGroup.session.id)?.content) || undefined}
          strategyNotes={buildStrategyNotes(reviewGroup.trades, strategies)}
          existingReview={dayReviews.get(reviewGroup.key) ?? null}
          onClose={() => setReviewGroup(null)}
        />
      )}
    </div>
  );
}

function DayCard({
  group,
  expanded,
  onToggle,
  showNoteButton,
  hasNote,
  onNote,
  showReplayButton,
  onReplay,
  showReviewButton,
  hasReview,
  onReview,
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
  showNoteButton: boolean;
  hasNote: boolean;
  onNote: () => void;
  showReplayButton: boolean;
  onReplay: () => void;
  showReviewButton: boolean;
  hasReview: boolean;
  onReview: () => void;
}) {
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
      <div className="w-full flex items-center gap-3 px-6 py-4 hover:bg-accent/20 transition-colors">
        <button onClick={onToggle} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", !expanded && "-rotate-90")} />
          <span className="font-bold text-foreground">{group.label}</span>
          <Badge variant={isUp ? 'positive' : 'negative'} className="ml-1">
            Net P&L {fmtMoney(session.netPnl)}
          </Badge>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          {showReviewButton && (
            <button
              onClick={(e) => { e.stopPropagation(); onReview(); }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors",
                hasReview
                  ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {hasReview ? 'View AI Review' : 'Review with AI'}
            </button>
          )}
          {showReplayButton && (
            <button
              onClick={(e) => { e.stopPropagation(); onReplay(); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              <Clapperboard className="w-3.5 h-3.5" />
              Replay
            </button>
          )}
          {showNoteButton && (
            <button
              onClick={(e) => { e.stopPropagation(); onNote(); }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors",
                hasNote
                  ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              <NotebookPen className="w-3.5 h-3.5" />
              {hasNote ? 'View note' : 'Add note'}
            </button>
          )}
          <span className="text-xs text-muted-foreground">{session.totalTrades} trade{session.totalTrades === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Equity curve + stat grid are the day's headline numbers — always
          visible, no click required. The chevron/expand toggle only ever
          reveals or hides the per-trade table below, for a trader who wants
          to inspect the individual fills that made up the day. */}
      <div className="px-6 pb-5 pt-2 border-t border-border/60">
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
      </div>

      {expanded && (
        <div className="px-6 pb-6">
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
