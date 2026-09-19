import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { cn } from '@/src/utils';
import { Card } from '../Shared';
import { Trade } from '../../types';
import { groupTradesInto, fmtMoney, WEEKDAY_ORDER } from '../../services/reportMetrics';

// A small per-weekday P&L strip for the "Days" tab, sitting alongside (not
// replacing) the Best/Worst/Most Used/Highest Win Rate callouts above —
// those intentionally ignore zero-trade days (a dry Monday shouldn't win
// "Best Day"), so this is the one place Monday/Tuesday's $0 actually shows
// up when you haven't traded them yet. Always all 5 weekdays, in order,
// regardless of which days have real trades (WEEKDAY_ORDER as both the
// sort order and the required-keys zero-fill — see reportMetrics.ts).
export function WeekdayPnlRow({ trades }: { trades: Trade[] }) {
  const bundles = useMemo(
    () => groupTradesInto(
      trades,
      (t) => {
        const label = format(new Date(t.entryTime), 'EEEE');
        return [{ key: label, label }];
      },
      WEEKDAY_ORDER,
      WEEKDAY_ORDER
    ),
    [trades]
  );

  return (
    <div className="grid grid-cols-5 gap-3">
      {bundles.map(b => (
        <Card key={b.key} className="p-3 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{b.key.slice(0, 3)}</div>
          <div className={cn(
            "text-sm font-bold mt-1 tabular-nums",
            b.trades === 0 ? "text-muted-foreground" : b.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"
          )}>
            {fmtMoney(b.netPnl)}
          </div>
        </Card>
      ))}
    </div>
  );
}
