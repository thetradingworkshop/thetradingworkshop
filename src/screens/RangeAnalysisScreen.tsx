import React, { useMemo } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Scorecard, Card } from '../components/Shared';
import { EquityCurveChart, HourlyPerformanceChart } from '../components/Charts';
import { TrendingUp, TrendingDown, Repeat, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { isWithinInterval } from 'date-fns';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { buildTradeStats } from '../services/analyticsService';
import { computeConsistencyScore } from '../services/analyticsService';
import { groupTradesInto, computePerformanceSummary, localDayKey, DAY_ORDER, fmtMoney, fmtPct } from '../services/reportMetrics';
import { Trade } from '../types';

// Every number on this page used to be a hardcoded literal (22 sessions,
// +$842.50, "Morning Breakout 82% win rate"...) rendered unconditionally —
// confirmed live on a zero-trade account still showing all of it as if
// real. This rebuild computes everything from `filteredTrades`, reusing
// the same engines already trusted elsewhere in the app (buildTradeStats
// for the account-level stats, reportMetrics' groupTradesInto for the
// weekday/best-day breakdown that used to be faked as "Pattern Summary")
// rather than inventing a second set of formulas.

const dayOfWeekKeyFn = (t: Trade) => {
  const label = new Date(t.entryTime).toLocaleDateString('en-US', { weekday: 'long' });
  return [{ key: label, label }];
};

export default function RangeAnalysisScreen() {
  const { filteredTrades } = useTrades();
  const { getEffectiveRange } = useDateRange();
  const effectiveRange = getEffectiveRange('range');

  const rangedTrades = useMemo(
    () => filteredTrades.filter(t => isWithinInterval(new Date(t.entryTime), { start: effectiveRange.from, end: effectiveRange.to })),
    [filteredTrades, effectiveRange]
  );

  // Previous equal-length window, for the Avg Daily P&L trend badge — a
  // real comparison instead of the hardcoded "+15% vs prev" that used to
  // sit there regardless of any actual trend.
  const prevRangeTrades = useMemo(() => {
    const durationMs = effectiveRange.to.getTime() - effectiveRange.from.getTime();
    const prevTo = effectiveRange.from;
    const prevFrom = new Date(effectiveRange.from.getTime() - durationMs);
    return filteredTrades.filter(t => isWithinInterval(new Date(t.entryTime), { start: prevFrom, end: prevTo }));
  }, [filteredTrades, effectiveRange]);

  const stats = useMemo(() => buildTradeStats(rangedTrades), [rangedTrades]);

  const dayBundles = useMemo(
    () => groupTradesInto(rangedTrades, t => [{ key: localDayKey(t.entryTime), label: localDayKey(t.entryTime) }]),
    [rangedTrades]
  );
  const prevDayBundles = useMemo(
    () => groupTradesInto(prevRangeTrades, t => [{ key: localDayKey(t.entryTime), label: localDayKey(t.entryTime) }]),
    [prevRangeTrades]
  );

  const totalSessions = dayBundles.length;
  const greenDays = dayBundles.filter(d => d.netPnl > 0).length;
  const redDays = dayBundles.filter(d => d.netPnl < 0).length;
  const avgDailyPnl = totalSessions ? dayBundles.reduce((s, d) => s + d.netPnl, 0) / totalSessions : 0;
  const avgTradesPerDay = totalSessions ? rangedTrades.length / totalSessions : 0;
  const consistencyScore = useMemo(() => computeConsistencyScore(rangedTrades), [rangedTrades]);

  const prevAvgDailyPnl = prevDayBundles.length ? prevDayBundles.reduce((s, d) => s + d.netPnl, 0) / prevDayBundles.length : 0;
  const dailyPnlTrend = prevDayBundles.length
    ? {
        value: Math.round(prevAvgDailyPnl !== 0 ? Math.abs((avgDailyPnl - prevAvgDailyPnl) / prevAvgDailyPnl) * 100 : (avgDailyPnl !== 0 ? 100 : 0)),
        label: 'vs prev',
        positive: avgDailyPnl >= prevAvgDailyPnl,
      }
    : undefined;

  // Real replacement for the old fake "Pattern Summary" card (Morning
  // Breakout 82%, Lunch Fades 24%...) — best/worst/most-traded/highest-win
  // weekday, computed from this trader's own trades.
  const weekdayBundles = useMemo(() => groupTradesInto(rangedTrades, dayOfWeekKeyFn, DAY_ORDER), [rangedTrades]);
  const weekdaySummary = useMemo(() => computePerformanceSummary(weekdayBundles), [weekdayBundles]);

  const bestHour = stats && stats.hourlyData.length > 0 ? stats.hourlyData.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worstHour = stats && stats.hourlyData.length > 0 ? stats.hourlyData.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Range Analysis"
        subtitle="Performance metrics across multiple sessions"
      />

      {rangedTrades.length === 0 ? (
        <Card className="text-center py-16">
          <TrendingUp className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground italic">No trades in {effectiveRange.label.toLowerCase()}.</p>
        </Card>
      ) : (
        <>
          {/* Row 1: Scorecards — all real, all derived from rangedTrades */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Scorecard label="Total Sessions" value={String(totalSessions)} secondary={`${greenDays} Green / ${redDays} Red`} />
            <Scorecard label="Avg Daily P&L" value={fmtMoney(avgDailyPnl)} trend={dailyPnlTrend} />
            <Scorecard label="Consistency Score" value={`${consistencyScore}/100`} secondary={consistencyScore >= 70 ? 'High stability' : consistencyScore >= 40 ? 'Moderate stability' : 'Low stability'} />
            <Scorecard label="Avg Trades/Day" value={avgTradesPerDay.toFixed(1)} secondary={`${rangedTrades.length} total trades`} />
          </div>

          {/* Row 2: Cumulative Equity + real weekday Performance Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              <EquityCurveChart className="h-full" data={stats?.equityDataDollars} />
            </div>
            <div className="lg:col-span-4">
              <Card className="h-full p-6">
                <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Best &amp; Worst Days</h3>
                <div className="space-y-5">
                  <WeekdayRow icon={TrendingUp} iconClass="text-emerald-500 bg-emerald-500/10" label="Best Day" bundle={weekdaySummary.best} stat={b => fmtMoney(b.netPnl)} />
                  <WeekdayRow icon={TrendingDown} iconClass="text-rose-500 bg-rose-500/10" label="Worst Day" bundle={weekdaySummary.worst} stat={b => fmtMoney(b.netPnl)} />
                  <WeekdayRow icon={Repeat} iconClass="text-indigo-500 bg-indigo-500/10" label="Most Traded" bundle={weekdaySummary.mostUsed} stat={b => `${b.trades} trades`} />
                  <WeekdayRow icon={Target} iconClass="text-amber-500 bg-amber-500/10" label="Highest Win Rate" bundle={weekdaySummary.highestWinRate} stat={b => fmtPct(b.winRate)} />
                </div>
              </Card>
            </div>
          </div>

          {/* Row 3: Net P&L by weekday, Win Rate by weekday, Hourly (now fed real data) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6 h-[320px]">
              <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Net P&amp;L by Weekday</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayBundles.map(b => ({ day: b.label.slice(0, 3), pnl: b.netPnl }))}>
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                    <Bar dataKey="pnl">
                      {weekdayBundles.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.netPnl >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-6 h-[320px]">
              <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Win Rate by Weekday</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayBundles.map(b => ({ day: b.label.slice(0, 3), winRate: b.winRate }))}>
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} domain={[0, 100]} />
                    <Bar dataKey="winRate" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <HourlyPerformanceChart data={stats?.hourlyData} />
          </div>

          {/* Row 4: Insights — real best/worst hour instead of fabricated copy */}
          <Card className="p-6">
            <h3 className="font-bold mb-4">Range Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                </div>
                {bestHour ? (
                  <div>
                    <p className="text-sm font-bold">Strongest Hour: {bestHour.hour}</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmtMoney(bestHour.pnl)} net P&amp;L generated in this hour across the selected range.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Not enough data yet.</p>
                )}
              </div>
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                  <TrendingDown className="w-4 h-4 text-rose-500" />
                </div>
                {worstHour ? (
                  <div>
                    <p className="text-sm font-bold">Weakest Hour: {worstHour.hour}</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmtMoney(worstHour.pnl)} net P&amp;L in this hour across the selected range.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Not enough data yet.</p>
                )}
              </div>
            </div>
          </Card>
        </>
      )}

      <TradePerformanceLog
        trades={rangedTrades}
        title="Range Performance Logs"
        subtitle="Complete trade audit for the selected range"
      />
    </div>
  );
}

function WeekdayRow({ icon: Icon, iconClass, label, bundle, stat }: {
  icon: typeof TrendingUp;
  iconClass: string;
  label: string;
  bundle: { label: string; netPnl: number; trades: number; winRate: number } | null;
  stat: (b: { netPnl: number; trades: number; winRate: number }) => string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className={cn("p-2 rounded-lg", iconClass)}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <span className="text-sm font-medium block">{label}</span>
          <span className="text-xs text-muted-foreground">{bundle ? bundle.label : 'No data'}</span>
        </div>
      </div>
      {bundle && <span className="text-sm font-bold">{stat(bundle)}</span>}
    </div>
  );
}
