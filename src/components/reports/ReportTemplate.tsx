import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Repeat, Target, CalendarDays } from 'lucide-react';
import { cn } from '@/src/utils';
import { Card } from '../Shared';
import { Trade } from '../../types';
import { groupTradesInto, computePerformanceSummary, fmtMoney, fmtPct } from '../../services/reportMetrics';
import { MetricPicker } from './MetricPicker';
import { MetricChart } from './MetricChart';
import { ReportTable } from './ReportTable';
import { usePersistedState } from '../../hooks/usePersistedState';

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
  // The full ordered domain of primary keys (e.g. every weekday, every hour
  // of the day) — when given, the chart and table read in that natural
  // order by default instead of arbitrary first-seen-trade order. Not
  // applied once a secondary "group by" is active (compound keys don't map
  // onto a single-dimension order); Symbol/Tags reports simply omit this.
  sortOrder?: string[];
  // Keys that should always appear in the chart/table as a zero-trade row
  // even without matching trades (e.g. WEEKDAY_ORDER, so a day you didn't
  // trade still shows a $0 bar instead of vanishing). Same "not applied
  // under cross-analysis" carve-out as sortOrder, and deliberately left
  // out of the Best/Worst/Most Used/Highest Win Rate summary above, which
  // should keep ignoring empty days.
  requiredKeys?: string[];
  // Always-shown extra summary cards, one per key, in the same row as
  // Best/Worst/Most Used/Highest Win Rate — reads the day's $ P&L straight
  // off `bundles` (so it needs requiredKeys to include these same keys,
  // or a real trade, to find anything). Unlike the four built-in cards,
  // these deliberately don't disappear for a zero-trade day — that's the
  // point (e.g. showing Monday/Tuesday at $0 alongside whichever days
  // actually won Best/Worst). Not applied under cross-analysis, same as
  // requiredKeys, since a compound "Monday::AccountX" key wouldn't match.
  extraSummaryDayKeys?: string[];
}

export function ReportTemplate({ trades, primaryKeyFn, labelHeader, secondaryDimensions = [], sortOrder, requiredKeys, extraSummaryDayKeys }: ReportTemplateProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['netPnl']);
  const [chartType, setChartType] = usePersistedState<'bar' | 'line'>('reportChartType', 'bar');
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

  const bundles = useMemo(
    () => groupTradesInto(trades, effectiveKeyFn, secondaryDim ? undefined : sortOrder, secondaryDim ? undefined : requiredKeys),
    [trades, effectiveKeyFn, secondaryDim, sortOrder, requiredKeys]
  );
  const primaryBundles = useMemo(() => groupTradesInto(trades, primaryKeyFn), [trades, primaryKeyFn]);
  const summary = useMemo(() => computePerformanceSummary(primaryBundles), [primaryBundles]);

  // Only the zero-trade days among extraSummaryDayKeys get their own card —
  // a day that actually traded already has a shot at Best/Worst/Most
  // Used/Highest Win Rate above, so repeating it here would be redundant.
  // This is what makes the row grow/shrink correctly across date ranges
  // instead of hardcoding "Monday, Tuesday": pass the full weekday list
  // and only the genuinely-empty ones surface.
  const extraDayCards = !secondaryDim && extraSummaryDayKeys
    ? extraSummaryDayKeys
        .map(dayKey => bundles.find(b => b.key === dayKey))
        .filter((b): b is NonNullable<typeof b> => !!b && b.trades === 0)
    : [];

  return (
    <div className="space-y-5">
      {/* 1. Performance Summary */}
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4", extraDayCards.length > 0 ? "lg:grid-cols-6" : "lg:grid-cols-4")}>
        <SummaryCallout icon={TrendingUp} iconClass="text-emerald-500" label="Best" bundle={summary.best} stat={b => fmtMoney(b.netPnl)} />
        <SummaryCallout icon={TrendingDown} iconClass="text-rose-500" label="Worst" bundle={summary.worst} stat={b => fmtMoney(b.netPnl)} />
        <SummaryCallout icon={Repeat} iconClass="text-indigo-500" label="Most Used" bundle={summary.mostUsed} stat={b => `${b.trades} trade${b.trades === 1 ? '' : 's'}`} />
        <SummaryCallout icon={Target} iconClass="text-amber-500" label="Highest Win Rate" bundle={summary.highestWinRate} stat={b => fmtPct(b.winRate)} />
        {extraDayCards.map(b => (
          <SummaryCallout
            key={b.key}
            icon={CalendarDays}
            iconClass={b.trades === 0 ? "text-muted-foreground" : b.netPnl >= 0 ? "text-emerald-500" : "text-rose-500"}
            label={b.key}
            bundle={{ label: fmtMoney(b.netPnl), trades: b.trades }}
            stat={x => `${x.trades} trade${x.trades === 1 ? '' : 's'}`}
          />
        ))}
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
      <ReportTable
        bundles={bundles}
        labelHeader={secondaryDim ? `${labelHeader} — ${secondaryDim.label}` : labelHeader}
        naturalOrder={secondaryDim ? undefined : sortOrder}
      />
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
