import React from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '../Shared';
import { Trade } from '../../types';

// Replicates the broker-style "P&L History" chart (Tradovate's Account
// Reports -> Performance tab): every trade in range as a bar, green/red by
// sign, with a hover tooltip showing the exact $ amount and when the trade
// closed — not just the bucketed/truncated "last 10 trades" view
// PnlByTradeChart (components/Charts.tsx) uses elsewhere.

interface PnlHistoryPoint {
  index: number;
  pnl: number;
  exitTime: string;
  symbol: string;
}

function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: PnlHistoryPoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const d = new Date(point.exitTime);
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
      <p className={point.pnl >= 0 ? "text-sm font-bold text-emerald-500" : "text-sm font-bold text-rose-500"}>
        {fmtMoney(point.pnl)}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{point.symbol}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {isNaN(d.getTime()) ? point.exitTime : format(d, 'MM/dd/yyyy HH:mm:ss')}
      </p>
    </div>
  );
}

export function PnlHistoryChart({ trades }: { trades: Trade[] }) {
  const data: PnlHistoryPoint[] = [...trades]
    .sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
    .map((t, i) => ({
      index: i,
      pnl: Number((t.grossPnlCurrency ?? t.pnlCurrency).toFixed(2)),
      exitTime: t.exitTime,
      symbol: t.symbol,
    }));

  return (
    <Card className="p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">P&L History</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-16 text-center">No trades in this range.</p>
      ) : (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
              <XAxis dataKey="index" tick={false} axisLine={false} tickLine={false} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                className="text-muted-foreground"
                tickFormatter={(v: number) => `$${v.toLocaleString()}`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'currentColor', opacity: 0.05 }} />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                {data.map((point, i) => (
                  <Cell key={i} fill={point.pnl >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
