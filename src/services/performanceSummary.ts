import { Trade } from '../types';

// Replicates the broker-style "Performance" report (Tradovate's Account
// Reports -> Performance tab): a three-column All/Profit/Losing Trades
// breakdown, including max run-up/drawdown with their from/to timestamps.
// Classification and Gross P/L use grossPnlCurrency (pre-commission) —
// matches the broker report's own methodology, where Total Profit + Total
// Loss sums exactly to Gross P/L.

export interface ExcursionStat {
  amount: number;
  fromTime: string | null; // ISO
  toTime: string | null; // ISO
}

export interface TradeBucketStats {
  totalPnl: number;
  count: number;
  contracts: number;
  largest: number;
  avg: number;
  stdDev: number;
  avgTimeSeconds: number;
  longestTimeSeconds: number;
}

export interface PerformanceSummaryReport {
  all: {
    grossPnl: number;
    trades: number;
    contracts: number;
    avgTimeSeconds: number;
    longestTimeSeconds: number;
    pctProfitable: number;
    expectancy: number;
    fees: number;
    totalPnl: number;
  };
  winners: TradeBucketStats & { maxRunUp: ExcursionStat };
  losers: TradeBucketStats & { maxDrawdown: ExcursionStat };
}

function grossOf(t: Trade): number {
  return t.grossPnlCurrency ?? t.pnlCurrency;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bucketStats(trades: Trade[]): TradeBucketStats {
  const pnls = trades.map(grossOf);
  const times = trades.map(t => t.holdTimeSeconds || 0);
  const totalPnl = pnls.reduce((s, v) => s + v, 0);
  return {
    totalPnl,
    count: trades.length,
    contracts: trades.reduce((s, t) => s + (t.totalQuantity || 0), 0),
    // Largest by magnitude, sign preserved — every value in `pnls` already
    // shares one sign (winners are all > 0, losers all < 0), so this is
    // just the most extreme one, not an artificial sign flip.
    largest: pnls.length ? pnls.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), pnls[0]) : 0,
    avg: trades.length ? totalPnl / trades.length : 0,
    stdDev: stdDev(pnls),
    avgTimeSeconds: times.length ? times.reduce((s, v) => s + v, 0) / times.length : 0,
    longestTimeSeconds: times.length ? Math.max(...times) : 0,
  };
}

// Standard single-pass max-runup / max-drawdown over a chronological
// cumulative equity curve — runUp tracks the largest rise from a running
// trough to a later peak; drawdown tracks the largest fall from a running
// peak to a later trough. Both computed over the same curve (every trade,
// not just winners/losers), matching where the broker report displays
// them: run-up under Profit Trades, drawdown under Losing Trades.
function computeExcursion(points: { time: string; value: number }[], direction: 'up' | 'down'): ExcursionStat {
  if (points.length === 0) return { amount: 0, fromTime: null, toTime: null };
  let extreme = points[0].value;
  let extremeTime = points[0].time;
  let best = 0;
  let bestFrom: string | null = null;
  let bestTo: string | null = null;

  for (const p of points) {
    if (direction === 'up') {
      const runUp = p.value - extreme;
      if (runUp > best) { best = runUp; bestFrom = extremeTime; bestTo = p.time; }
      if (p.value < extreme) { extreme = p.value; extremeTime = p.time; }
    } else {
      const dd = extreme - p.value;
      if (dd > best) { best = dd; bestFrom = extremeTime; bestTo = p.time; }
      if (p.value > extreme) { extreme = p.value; extremeTime = p.time; }
    }
  }
  return { amount: best, fromTime: bestFrom, toTime: bestTo };
}

export function computePerformanceSummaryReport(trades: Trade[]): PerformanceSummaryReport | null {
  if (trades.length === 0) return null;

  const sorted = [...trades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());
  const winners = sorted.filter(t => grossOf(t) > 0);
  const losers = sorted.filter(t => grossOf(t) < 0);

  const grossPnl = sorted.reduce((s, t) => s + grossOf(t), 0);
  const fees = sorted.reduce((s, t) => s + (t.totalCommission || 0), 0);
  const totalPnl = sorted.reduce((s, t) => s + t.pnlCurrency, 0);
  const times = sorted.map(t => t.holdTimeSeconds || 0);

  let cumulative = 0;
  const equityCurve = sorted.map(t => {
    cumulative += grossOf(t);
    return { time: t.exitTime, value: cumulative };
  });

  return {
    all: {
      grossPnl,
      trades: sorted.length,
      contracts: sorted.reduce((s, t) => s + (t.totalQuantity || 0), 0),
      avgTimeSeconds: times.length ? times.reduce((s, v) => s + v, 0) / times.length : 0,
      longestTimeSeconds: times.length ? Math.max(...times) : 0,
      pctProfitable: (winners.length / sorted.length) * 100,
      expectancy: grossPnl / sorted.length,
      fees,
      totalPnl,
    },
    winners: { ...bucketStats(winners), maxRunUp: computeExcursion(equityCurve, 'up') },
    losers: { ...bucketStats(losers), maxDrawdown: computeExcursion(equityCurve, 'down') },
  };
}
