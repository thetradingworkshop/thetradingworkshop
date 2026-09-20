import { format } from 'date-fns';
import { Trade, JournalEntry } from '../types';

// Shared between JournalScreen (the "New Sessions Recap" modal) and
// SessionDetailScreen (the Sessions page's own journal, which is really
// the same kind of entry scoped to whatever date range + account the
// Sessions page currently has selected) — extracted so both screens
// create/read the identical recap shape instead of two subtly different
// implementations drifting apart.

export function formatRecapTitle(start: string, end: string): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  return start === end ? fmt(start) : `${fmt(start)} - ${fmt(end)}`;
}

// Trade.sessionDate is derived once at import/reconstruction time from the
// raw UTC timestamp (entryTime.split('T')[0]), with no timezone
// conversion. The Dashboard calendar instead buckets trades by LOCAL
// calendar day. For a trade entered late in the evening local time —
// e.g. after 8pm ET, which is already past midnight UTC — those two dates
// disagree by one day. Matching recap trades against sessionDate directly
// silently drops those trades from the day the trader actually
// experienced them on. Deriving the same local date the calendar uses
// keeps both in sync.
export function localDateOf(trade: Trade): string {
  return format(new Date(trade.entryTime), 'yyyy-MM-dd');
}

// Volume counts both legs of each trade (entry + exit fills), so it runs
// roughly 2x contractsTraded for simple single-entry/single-exit trades —
// contractsTraded is the per-trade position size, volume is total executed size.
export function computeRecapStats(rangeTrades: Trade[]): NonNullable<JournalEntry['recapStats']> {
  const netPnl = rangeTrades.reduce((s, t) => s + (t.realizedPnL || 0), 0);
  const grossPnl = rangeTrades.reduce((s, t) => s + (t.grossPnlCurrency ?? t.pnlCurrency ?? 0), 0);
  const totalTrades = rangeTrades.length;
  const winners = rangeTrades.filter(t => t.isWinner).length;
  const losers = totalTrades - winners;
  const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
  const commissions = rangeTrades.reduce((s, t) => s + (t.totalCommission || 0), 0);
  const volume = rangeTrades.reduce((s, t) => s + t.fills.reduce((fs, f) => fs + (f.quantity || 0), 0), 0);
  const grossProfit = rangeTrades.filter(t => (t.realizedPnL || 0) > 0).reduce((s, t) => s + (t.realizedPnL || 0), 0);
  const grossLoss = rangeTrades.filter(t => (t.realizedPnL || 0) < 0).reduce((s, t) => s + (t.realizedPnL || 0), 0);
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : 0;

  const byDate = new Map<string, number>();
  rangeTrades.forEach(t => byDate.set(t.sessionDate, (byDate.get(t.sessionDate) || 0) + (t.realizedPnL || 0)));
  let running = 0;
  const equityCurve = [...byDate.keys()].sort().map(date => {
    running += byDate.get(date)!;
    return { date, cumPnl: Number(running.toFixed(2)) };
  });

  return { netPnl, grossPnl, totalTrades, winners, losers, winRate, commissions, volume, profitFactor, equityCurve };
}

// recapStats is only ever a snapshot from when the recap was created or
// last edited — trades imported or added afterward would otherwise leave
// it silently stuck showing stale numbers. Recomputing live from current
// trades on every read means the recap always reflects reality; the
// stored value is only a fallback for a note missing date fields
// entirely, or one saved under an earlier shape of `recapStats`.
export function getRecapStatsForDisplay(
  journal: Pick<JournalEntry, 'recapStartDate' | 'recapEndDate' | 'connectionId' | 'accountId' | 'recapStats'>,
  trades: Trade[]
): NonNullable<JournalEntry['recapStats']> | null {
  if (journal.recapStartDate && journal.recapEndDate) {
    const rangeTrades = trades.filter(t => {
      const d = localDateOf(t);
      if (d < journal.recapStartDate! || d > journal.recapEndDate!) return false;
      if (journal.connectionId && journal.accountId) {
        return t.connectionId === journal.connectionId && t.accountId === journal.accountId;
      }
      return true;
    });
    return computeRecapStats(rangeTrades);
  }
  const stats = journal.recapStats;
  if (stats && Array.isArray(stats.equityCurve) && typeof stats.winRate === 'number') {
    return stats;
  }
  return null;
}
