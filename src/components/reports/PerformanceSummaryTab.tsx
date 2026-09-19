import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/src/utils';
import { Card } from '../Shared';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { PerformanceSummaryReport } from '../../services/performanceSummary';

// Replicates the broker-style "Performance" report (Tradovate's Account
// Reports -> Performance tab): an All/Profit/Losing Trades breakdown side
// by side, including max run-up/drawdown with when they happened. See
// performanceSummary.ts for the math.

function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDuration(totalSeconds: number): string {
  const sec = Math.round(totalSeconds);
  if (sec < 60) return `${sec}sec`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}min`);
  if (s || parts.length === 0) parts.push(`${s}sec`);
  return parts.join(' ');
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return format(d, 'MM/dd/yyyy HH:mm:ss');
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", valueClass)}>{value}</span>
    </div>
  );
}

function ColumnCard({ title, icon: Icon, iconClass, children }: {
  title: string;
  icon: typeof TrendingUp;
  iconClass: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
        <Icon className={cn("w-4 h-4", iconClass)} />
        <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">{title}</h3>
      </div>
      <div>{children}</div>
    </Card>
  );
}

export function PerformanceSummaryTab({ report }: { report: PerformanceSummaryReport | null }) {
  if (!report) {
    return (
      <Card className="text-center py-16">
        <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground italic">No trades in this range.</p>
      </Card>
    );
  }

  const { all, winners, losers } = report;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <ColumnCard title="All Trades" icon={BarChart3} iconClass="text-indigo-500">
        <StatRow label="Gross P/L" value={fmtMoney(all.grossPnl)} valueClass={all.grossPnl >= 0 ? "text-emerald-500" : "text-rose-500"} />
        <StatRow label="# of Trades" value={String(all.trades)} />
        <StatRow label="# of Contracts" value={String(all.contracts)} />
        <StatRow label="Avg. Trade Time" value={fmtDuration(all.avgTimeSeconds)} />
        <StatRow label="Longest Trade Time" value={fmtDuration(all.longestTimeSeconds)} />
        <StatRow label="% Profitable Trades" value={`${all.pctProfitable.toFixed(2)}%`} />
        <StatRow label="Expectancy" value={fmtMoney(all.expectancy)} />
        <StatRow label="Trade Fees & Comm." value={fmtMoney(-all.fees)} valueClass="text-rose-500" />
        <StatRow label="Total P/L" value={fmtMoney(all.totalPnl)} valueClass={all.totalPnl >= 0 ? "text-emerald-500" : "text-rose-500"} />
      </ColumnCard>

      <ColumnCard title="Profit Trades" icon={TrendingUp} iconClass="text-emerald-500">
        <StatRow label="Total Profit" value={fmtMoney(winners.totalPnl)} valueClass="text-emerald-500" />
        <StatRow label="# of Winning Trades" value={String(winners.count)} />
        <StatRow label="# of Winning Contracts" value={String(winners.contracts)} />
        <StatRow label="Largest Winning Trade" value={fmtMoney(winners.largest)} valueClass="text-emerald-500" />
        <StatRow label="Avg. Winning Trade" value={fmtMoney(winners.avg)} valueClass="text-emerald-500" />
        <StatRow label="Std. Dev. Winning Trade" value={fmtMoney(winners.stdDev)} />
        <StatRow label="Avg. Winning Trade Time" value={fmtDuration(winners.avgTimeSeconds)} />
        <StatRow label="Longest Winning Trade Time" value={fmtDuration(winners.longestTimeSeconds)} />
        <StatRow label="Max Run-up" value={fmtMoney(winners.maxRunUp.amount)} valueClass="text-emerald-500" />
        <StatRow label="Max Run-up, from" value={fmtDateTime(winners.maxRunUp.fromTime)} />
        <StatRow label="Max Run-up, to" value={fmtDateTime(winners.maxRunUp.toTime)} />
      </ColumnCard>

      <ColumnCard title="Losing Trades" icon={TrendingDown} iconClass="text-rose-500">
        <StatRow label="Total Loss" value={fmtMoney(losers.totalPnl)} valueClass="text-rose-500" />
        <StatRow label="# of Losing Trades" value={String(losers.count)} />
        <StatRow label="# of Losing Contracts" value={String(losers.contracts)} />
        <StatRow label="Largest Losing Trade" value={fmtMoney(losers.largest)} valueClass="text-rose-500" />
        <StatRow label="Avg. Losing Trade" value={fmtMoney(losers.avg)} valueClass="text-rose-500" />
        <StatRow label="Std. Dev. Losing Trade" value={fmtMoney(losers.stdDev)} />
        <StatRow label="Avg. Losing Trade Time" value={fmtDuration(losers.avgTimeSeconds)} />
        <StatRow label="Longest Losing Trade Time" value={fmtDuration(losers.longestTimeSeconds)} />
        <StatRow label="Max Drawdown" value={fmtMoney(-losers.maxDrawdown.amount)} valueClass="text-rose-500" />
        <StatRow label="Max Drawdown, from" value={fmtDateTime(losers.maxDrawdown.fromTime)} />
        <StatRow label="Max Drawdown, to" value={fmtDateTime(losers.maxDrawdown.toTime)} />
      </ColumnCard>
    </div>
  );
}
