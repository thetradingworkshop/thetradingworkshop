import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Repeat, Target } from 'lucide-react';
import { cn } from '@/src/utils';
import { Card } from '../Shared';
import { Trade } from '../../types';
import { groupTradesInto, computePerformanceSummary, fmtMoney, fmtPct } from '../../services/reportMetrics';
import { MetricPicker } from './MetricPicker';
import { MetricChart } from './MetricChart';
import { ReportTable } from './ReportTable';

// The shared four-band shell every drill-down report tab renders through:
// Performance Summary -> Customizable Chart -> Summary Table -> Cross
// Analysis (one secondary "group by" dropdown, re-bucketing rows into
// primary x secondary pairs). Only the grouping key + secondary-dimension
// options differ between Symbol / Day & Time / Tags — everything else in
// this file is identical for all three.

export interface SecondaryDimension {
  key: string;
  label: string;
  // Single-valued by construction (Day of week / Account / Side never fan
  // a trade out to more than one bucket) — combined() below relies on that.
  keyFn: (t: Trade) => { key: string; label: string }[];
}

interface ReportTemplateProps {
  trades: Trade[]; // already date-range + tab-scoped by the caller
  primaryKeyFn: (t: Trade) => { key: string; label: string }[];
  labelHeader: string;
  secondaryDimensions?: SecondaryDimension[];
}

export function ReportTemplate({ trades, primaryKeyFn, labelHeader, secondaryDimensions = [] }: ReportTemplateProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['netPnl']);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [secondaryKey, setSecondaryKey] = useState<string>('none');

  const secondaryDim = secondaryDimensions.find(d => d.key === secondaryKey) ?? null;

  const effectiveKeyFn = useMemo(() => {
    if (!secondaryDim) return primaryKeyFn;
    return (t: Trade) => {
      const primaryEntries = primaryKeyFn(t);
      const sec = secondaryDim.keyFn(t)[0];
      if (!sec) return [];
      return primaryEntries.map(p => ({ key: `${p.key}::${sec.key}`, label: `${p.label} — ${sec.label}` }));
    };
  }, [primaryKeyFn, secondaryDim]);

  const bundles = useMemo(() => groupTradesInto(trades, effectiveKeyFn), [trades, effectiveKeyFn]);
  const primaryBundles = useMemo(() => groupTradesInto(trades, primaryKeyFn), [trades, primaryKeyFn]);
  const summary = useMemo(() => computePerformanceSummary(primaryBundles), [primaryBundles]);

  return (
    <div className="space-y-5">
      {/* 1. Performance Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCallout icon={TrendingUp} iconClass="text-emerald-500" label="Best" bundle={summary.best} stat={b => fmtMoney(b.netPnl)} />
        <SummaryCallout icon={TrendingDown} iconClass="text-rose-500" label="Worst" bundle={summary.worst} stat={b => fmtMoney(b.netPnl)} />
        <SummaryCallout icon={Repeat} iconClass="text-indigo-500" label="Most Used" bundle={summary.mostUsed} stat={b => `${b.trades} trade${b.trades === 1 ? '' : 's'}`} />
        <SummaryCallout icon={Target} iconClass="text-amber-500" label="Highest Win Rate" bundle={summary.highestWinRate} stat={b => fmtPct(b.winRate)} />
      </div>

      {/* 2. Customizable chart */}
      <div className="flex items-center gap-2 flex-wrap">
        <MetricPicker selected={selectedMetrics} onChange={setSelectedMetrics} />
        <div className="flex items-center gap-1 p-1 rounded-xl bg-accent/30 border border-border">
          {(['bar', 'line'] as const).map(t => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors",
                chartType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {secondaryDimensions.length > 0 && (
          <select
            value={secondaryKey}
            onChange={e => setSecondaryKey(e.target.value)}
            className="px-3 py-2 bg-card border border-border/60 rounded-xl text-sm font-medium shadow-sm"
          >
            <option value="none">Cross Analysis: none</option>
            {secondaryDimensions.map(d => (
              <option key={d.key} value={d.key}>Cross Analysis: by {d.label}</option>
            ))}
          </select>
        )}
      </div>

      <MetricChart bundles={bundles} metricKeys={selectedMetrics} chartType={chartType} />

      {/* 3. Summary table (4. Cross Analysis re-buckets the same table via secondaryKey above) */}
      <ReportTable bundles={bundles} labelHeader={secondaryDim ? `${labelHeader} — ${secondaryDim.label}` : labelHeader} />
    </div>
  );
}

function SummaryCallout({ icon: Icon, iconClass, label, bundle, stat }: {
  icon: typeof TrendingUp;
  iconClass: string;
  label: string;
  bundle: { label: string } & Record<string, any> | null;
  stat: (b: any) => string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("w-3.5 h-3.5", iconClass)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {bundle ? (
        <>
          <div className="font-bold text-sm text-foreground truncate">{bundle.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{stat(bundle)}</div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground italic">No data</div>
      )}
    </Card>
  );
}
