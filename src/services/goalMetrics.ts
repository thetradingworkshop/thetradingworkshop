import { isToday, isSameWeek, isSameMonth, startOfDay, isBefore } from 'date-fns';
import { Trade, RiskSettings } from '../types';

// Goal structure researched against how existing trading-journal products
// present this (TradesViz's prop-firm drawdown/DLL gauges, TradeZella's
// Challenge widget, and the daily/weekly/monthly-target pattern common to
// consumer trading-goal apps): a small fixed set of goal types, each
// scoped to a period, each either "configured or not" (blank = skipped
// entirely, not a $0 target), evaluated against real trade P&L, not
// self-reported. See Dashboard's GoalsCard and Settings → Risk Parameters
// → Profit Targets, the only places these are read/written.

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';
export type GoalStatusKind = 'on-track' | 'hit' | 'breached' | 'unconfigured';

export interface GoalStatus {
  id: 'dailyLossLimit' | 'dailyProfitTarget' | 'weeklyProfitTarget' | 'monthlyProfitTarget';
  label: string;
  period: GoalPeriod;
  /** The configured $ limit/target, or null if the user hasn't set one. */
  target: number | null;
  /** Realized P&L for the current period so far. */
  current: number;
  /** 0-100+, how far along the goal is — for a loss limit, how much of the budget is used. */
  progressPct: number;
  status: GoalStatusKind;
}

function pnlSum(trades: Trade[]): number {
  return trades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
}

function tradeDate(t: Trade): Date {
  return new Date(t.entryTime);
}

export function computeGoalStatuses(trades: Trade[], risk: RiskSettings): GoalStatus[] {
  const now = new Date();
  const validTrades = trades.filter(t => !isNaN(tradeDate(t).getTime()));

  const todayTrades = validTrades.filter(t => isToday(tradeDate(t)));
  const weekTrades = validTrades.filter(t => isSameWeek(tradeDate(t), now, { weekStartsOn: 1 }));
  const monthTrades = validTrades.filter(t => isSameMonth(tradeDate(t), now));

  const todayPnl = pnlSum(todayTrades);
  const weekPnl = pnlSum(weekTrades);
  const monthPnl = pnlSum(monthTrades);

  const dllLimit = risk.maxDailyLossUsd ?? null;
  const dailyLossLimit: GoalStatus = {
    id: 'dailyLossLimit',
    label: "Don't Hit Your DLL",
    period: 'daily',
    target: dllLimit,
    current: todayPnl,
    progressPct: dllLimit && dllLimit > 0 ? Math.min(100, Math.max(0, (-todayPnl / dllLimit) * 100)) : 0,
    status: dllLimit == null
      ? 'unconfigured'
      : todayPnl <= -dllLimit ? 'breached' : 'on-track',
  };

  const makeTarget = (
    id: GoalStatus['id'], label: string, period: GoalPeriod, target: number | null | undefined, current: number
  ): GoalStatus => ({
    id, label, period,
    target: target ?? null,
    current,
    progressPct: target && target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0,
    status: target == null ? 'unconfigured' : current >= target ? 'hit' : 'on-track',
  });

  return [
    dailyLossLimit,
    makeTarget('dailyProfitTarget', 'Daily Profit Target', 'daily', risk.dailyProfitTarget, todayPnl),
    makeTarget('weeklyProfitTarget', 'Weekly Profit Target', 'weekly', risk.weeklyProfitTarget, weekPnl),
    makeTarget('monthlyProfitTarget', 'Monthly Profit Target', 'monthly', risk.monthlyProfitTarget, monthPnl),
  ];
}

// Consecutive most-recent TRADING days (days with at least one trade) that
// did not breach the configured daily loss limit — days with no trades at
// all don't count for or against it, only trading days do. Walks backward
// from the most recent trading day; stops at the first breach. Returns 0
// if no DLL is configured or there's no trade history yet.
export function computeDllCleanStreak(trades: Trade[], risk: RiskSettings): number {
  const limit = risk.maxDailyLossUsd;
  if (!limit || limit <= 0) return 0;

  const byDay = new Map<string, number>();
  for (const t of trades) {
    const d = tradeDate(t);
    if (isNaN(d.getTime())) continue;
    const key = startOfDay(d).toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + (t.realizedPnL || 0));
  }

  const days = Array.from(byDay.entries())
    .map(([key, pnl]) => ({ date: new Date(key), pnl }))
    .filter(d => !isBefore(new Date(), d.date)) // never count a future-dated stray trade
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  let streak = 0;
  for (const day of days) {
    if (day.pnl <= -limit) break;
    streak++;
  }
  return streak;
}
