import React, { useMemo, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/src/utils';
import { Card, Table, TableHeader, TableRow, TableHead, TableCell } from '../Shared';
import { ReportMetricBundle, METRIC_DEFS } from '../../services/reportMetrics';

// Real click-to-sort — the codebase's only other sort affordance
// (TradePerformanceLog.tsx's ArrowUpDown next to "Date / Time") is
// decorative with no onClick handler; this one actually wires it up.
const COLUMN_KEYS = ['trades', 'netPnl', 'winRate', 'profitFactor', 'avgWinner', 'avgLoser', 'expectancy', 'avgHoldTimeSeconds'];

interface ReportTableProps {
  bundles: ReportMetricBundle[];
  labelHeader: string;
}

type SortDir = 'asc' | 'desc';

export function ReportTable({ bundles, labelHeader }: ReportTableProps) {
  const [sortKey, setSortKey] = useState<string>('netPnl');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const columns = COLUMN_KEYS.map(k => METRIC_DEFS.find(m => m.key === k)!).filter(Boolean);

  const sorted = useMemo(() => {
    const def = sortKey === 'label' ? null : columns.find(c => c.key === sortKey);
    const rows = [...bundles];
    rows.sort((a, b) => {
      const av = sortKey === 'label' ? a.label : def!.value(a);
      const bv = sortKey === 'label' ? b.label : def!.value(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [bundles, sortKey, sortDir, columns]);

  const onSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ active }: { active: boolean }) => {
    if (!active) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <Card noPadding>
      <Table>
        <TableHeader>
          <tr>
            <TableHead>
              <button onClick={() => onSort('label')} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                {labelHeader} <SortIcon active={sortKey === 'label'} />
              </button>
            </TableHead>
            {columns.map(c => (
              <TableHead key={c.key} className="text-right">
                <button onClick={() => onSort(c.key)} className="flex items-center gap-1.5 ml-auto hover:text-foreground transition-colors">
                  {c.label} <SortIcon active={sortKey === c.key} />
                </button>
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <tbody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground italic py-10">
                No trades in this range.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map(b => (
              <TableRow key={b.key}>
                <TableCell className="font-bold">{b.label}</TableCell>
                {columns.map(c => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      "text-right font-mono text-xs",
                      c.key === 'netPnl' && (b.netPnl >= 0 ? "text-emerald-500 font-bold" : "text-rose-500 font-bold")
                    )}
                  >
                    {c.format(b)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}
