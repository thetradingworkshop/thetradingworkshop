import { Trade } from '../types';

// Shared metric-computation engine for the Reports section (Symbol / Day &
// Time / Tags) — one function, reused by every report tab; only the
// grouping key changes per tab. Formulas mirror what's already established
// elsewhere in the app (not reinvented) so numbers stay consistent no
// matter where a trader reads them:
//   - Profit Factor / avg winner / avg loser / expectancy: same shape as
//     computeStrategyStats in StrategiesScreen.tsx.
//   - Max consecutive win/loss streak tracking: same loop as
//     SessionBuilder.ts's per-session streak counters.
//   - largestLoss is stored as a positive magnitude (matching
//     SessionBuilder's convention), not a negative number.
export interface ReportMetricBundle {
  key: string;
  label: string;
  trades: number;
  netPnl: number;
  winRate: number; // percent, 0-100
  profitFactor: number | null; // null = no trades or no wins and no losses
  avgWinner: number;
  avgLoser: number; // negative or zero
  expectancy: number; // net P&L per trade
  avgHoldTimeSeconds: number;
  totalVolume: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number; // positive magnitude
}

const EMPTY_BUNDLE = (key: string, label: string): ReportMetricBundle => ({
  key, label, trades: 0, netPnl: 0, winRate: 0, profitFactor: null,
  avgWinner: 0, avgLoser: 0, expectancy: 0, avgHoldTimeSeconds: 0,
  totalVolume: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
  largestWin: 0, largestLoss: 0,
});

export function computeGroupMetrics(key: string, label: string, trades: Trade[]): ReportMetricBundle {
  if (trades.length === 0) return EMPTY_BUNDLE(key, label);

  // Chronological, so the streak loop below reads win/loss sequences the
  // way they actually happened, not in whatever order the caller passed.
  const sorted = [...trades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  const winners = sorted.filter(t => t.pnlCurrency > 0);
  const losers = sorted.filter(t => t.pnlCurrency < 0);
  const grossProfit = winners.reduce((s, t) => s + t.pnlCurrency, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnlCurrency, 0));
  const netPnl = sorted.reduce((s, t) => s + t.pnlCurrency, 0);
  const totalVolume = sorted.reduce((s, t) => s + (t.totalQuantity || 0), 0);
  const avgHoldTimeSeconds = sorted.reduce((s, t) => s + (t.holdTimeSeconds || 0), 0) / sorted.length;

  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let largestWin = 0;
  let largestLoss = 0;

  for (const t of sorted) {
    const pnl = t.pnlCurrency || 0;
    if (pnl > 0) {
      largestWin = Math.max(largestWin, pnl);
      currentWinStreak++;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
      currentLossStreak = 0;
    } else if (pnl < 0) {
      largestLoss = Math.max(largestLoss, Math.abs(pnl));
      currentLossStreak++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }

  return {
    key, label, trades: sorted.length, netPnl,
    winRate: (winners.length / sorted.length) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    avgWinner: winners.length ? grossProfit / winners.length : 0,
    avgLoser: losers.length ? -grossLoss / losers.length : 0,
    expectancy: netPnl / sorted.length,
    avgHoldTimeSeconds, totalVolume,
    maxConsecutiveWins, maxConsecutiveLosses, largestWin, largestLoss,
  };
}

// One trade can land in more than one bucket (e.g. a trade tagged both
// "Breakout" and "FOMO" belongs in both tag groups) — keyFn returns an
// array so callers control fan-out; a single-bucket grouping (Symbol, Day
// of week) just returns a one-element array.
// `sortOrder`, when given, is the full ordered domain a key can take (e.g.
// every weekday Monday->Sunday, every hour of the day) — bundles are
// returned in that order rather than arbitrary first-seen-trade order, so
// a chart of "performance across the day" actually reads left-to-right as
// the day unfolds instead of jumbling hours together. Keys not found in
// sortOrder sort after everything that is (defensive, shouldn't happen for
// well-formed callers).
export function groupTradesInto(
  trades: Trade[],
  keyFn: (t: Trade) => { key: string; label: string }[],
  sortOrder?: string[]
): ReportMetricBundle[] {
  const buckets = new Map<string, { label: string; trades: Trade[] }>();
  for (const t of trades) {
    for (const { key, label } of keyFn(t)) {
      if (!buckets.has(key)) buckets.set(key, { label, trades: [] });
      buckets.get(key)!.trades.push(t);
    }
  }
  const bundles = Array.from(buckets.entries()).map(([key, { label, trades }]) => computeGroupMetrics(key, label, trades));
  if (sortOrder) {
    const orderIndex = new Map(sortOrder.map((k, i) => [k, i]));
    bundles.sort((a, b) => (orderIndex.get(a.key) ?? Infinity) - (orderIndex.get(b.key) ?? Infinity));
  }
  return bundles;
}

export interface PerformanceSummary {
  best: ReportMetricBundle | null;
  worst: ReportMetricBundle | null;
  mostUsed: ReportMetricBundle | null;
  highestWinRate: ReportMetricBundle | null;
}

export function computePerformanceSummary(bundles: ReportMetricBundle[]): PerformanceSummary {
  const withTrades = bundles.filter(b => b.trades > 0);
  if (withTrades.length === 0) return { best: null, worst: null, mostUsed: null, highestWinRate: null };
  return {
    best: withTrades.reduce((a, b) => (b.netPnl > a.netPnl ? b : a)),
    worst: withTrades.reduce((a, b) => (b.netPnl < a.netPnl ? b : a)),
    mostUsed: withTrades.reduce((a, b) => (b.trades > a.trades ? b : a)),
    highestWinRate: withTrades.reduce((a, b) => (b.winRate > a.winRate ? b : a)),
  };
}

export const fmtMoney = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
export const fmtPct = (v: number) => `${v.toFixed(1)}%`;
export const fmtPF = (v: number | null) => (v === null ? 'N/A' : v === Infinity ? '∞' : v.toFixed(2));
export const fmtDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
};

export type MetricCategory = 'profitability' | 'risk' | 'activity' | 'consistency';

export interface MetricDef {
  key: string;
  label: string;
  category: MetricCategory;
  format: (b: ReportMetricBundle) => string;
  // Finite-number projection for charting/sorting — profitFactor's
  // null/Infinity can't be plotted directly, so null charts as 0 and
  // Infinity (no losses at all) is capped rather than breaking the axis.
  value: (b: ReportMetricBundle) => number;
}

export const METRIC_DEFS: MetricDef[] = [
  { key: 'netPnl', label: 'Net P&L', category: 'profitability', format: b => fmtMoney(b.netPnl), value: b => b.netPnl },
  { key: 'winRate', label: 'Win Rate', category: 'profitability', format: b => fmtPct(b.winRate), value: b => b.winRate },
  { key: 'profitFactor', label: 'Profit Factor', category: 'profitability', format: b => fmtPF(b.profitFactor), value: b => (b.profitFactor === null ? 0 : b.profitFactor === Infinity ? 999 : b.profitFactor) },
  { key: 'avgWinner', label: 'Avg Winner', category: 'profitability', format: b => fmtMoney(b.avgWinner), value: b => b.avgWinner },
  { key: 'avgLoser', label: 'Avg Loser', category: 'profitability', format: b => fmtMoney(b.avgLoser), value: b => b.avgLoser },
  { key: 'expectancy', label: 'Expectancy', category: 'profitability', format: b => fmtMoney(b.expectancy), value: b => b.expectancy },
  { key: 'largestWin', label: 'Largest Win', category: 'risk', format: b => fmtMoney(b.largestWin), value: b => b.largestWin },
  { key: 'largestLoss', label: 'Largest Loss', category: 'risk', format: b => fmtMoney(-b.largestLoss), value: b => -b.largestLoss },
  { key: 'trades', label: 'Trades', category: 'activity', format: b => String(b.trades), value: b => b.trades },
  { key: 'totalVolume', label: 'Volume', category: 'activity', format: b => String(b.totalVolume), value: b => b.totalVolume },
  { key: 'avgHoldTimeSeconds', label: 'Avg Hold Time', category: 'activity', format: b => fmtDuration(b.avgHoldTimeSeconds), value: b => b.avgHoldTimeSeconds },
  { key: 'maxConsecutiveWins', label: 'Max Consecutive Wins', category: 'consistency', format: b => String(b.maxConsecutiveWins), value: b => b.maxConsecutiveWins },
  { key: 'maxConsecutiveLosses', label: 'Max Consecutive Losses', category: 'consistency', format: b => String(b.maxConsecutiveLosses), value: b => b.maxConsecutiveLosses },
];

export const METRIC_CATEGORY_LABELS: Record<MetricCategory, string> = {
  profitability: 'Profitability',
  risk: 'Risk',
  activity: 'Activity',
  consistency: 'Consistency',
};
