import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card } from '../Shared';
import { Trade } from '../../types';
import { halfHourLabel, HALF_HOUR_ORDER } from '../../services/reportMetrics';

// Replicates the broker-style "P/L Per Time of Day" chart: trades bucketed
// into 30-minute slots by entry time, summed, one bar per slot — reuses the
// same half-hour bucketing (halfHourLabel/HALF_HOUR_ORDER) the Day & Time
// report tab already groups by, so a "9:00am" bucket means the same thing
// in both places.

interface TimeOfDayPoint {
  label: string;
  pnl: number;
}

function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: TimeOfDayPoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
      <p className={point.pnl >= 0 ? "text-sm font-bold text-emerald-500" : "text-sm font-bold text-rose-500"}>
        {fmtMoney(point.pnl)}
      </p>
      <p className="text-[11px] text-muted-foreground">{point.label}</p>
    </div>
  );
}

export function PnlByTimeOfDayChart({ trades }: { trades: Trade[] }) {
  const byBucket = new Map<string, number>();
  for (const t of trades) {
    const label = halfHourLabel(t.entryTime);
    byBucket.set(label, (byBucket.get(label) ?? 0) + (t.grossPnlCurrency ?? t.pnlCurrency));
  }
  const data: TimeOfDayPoint[] = HALF_HOUR_ORDER
    .filter(label => byBucket.has(label))
    .map(label => ({ label, pnl: Number(byBucket.get(label)!.toFixed(2)) }));

  return (
    <Card className="p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">P/L Per Time of Day</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-16 text-center">No trades in this range.</p>
      ) : (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={3}
                angle={-45}
                textAnchor="end"
                height={40}
                tick={{ fontSize: 9, fill: 'currentColor' }}
                className="text-muted-foreground"
              />
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
