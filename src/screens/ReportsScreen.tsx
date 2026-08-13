import React, { useEffect, useMemo, useState } from 'react';
import { format, isWithinInterval } from 'date-fns';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { cn } from '@/src/utils';
import { SectionHeader, Card } from '../components/Shared';
import { BarChart3 } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { ReportTemplate, SecondaryDimension } from '../components/reports/ReportTemplate';
import {
  DAY_ORDER, MONTH_ORDER, DURATION_ORDER, HOUR_ORDER, HALF_HOUR_ORDER,
  hourLabel, halfHourLabel, durationBucket,
} from '../services/reportMetrics';
import { Trade, TagCategory } from '../types';

// TradeZella-style "Reports" drill-downs: Symbol, Day & Time, Tags. All
// three render through the same ReportTemplate (see that file) — only the
// grouping function and secondary-dimension options differ per tab.
// Overview and Calendar are intentionally not rebuilt here (Dashboard
// already covers that ground); Playbook is intentionally not duplicated
// here either (StrategiesScreen already computes richer per-strategy
// stats, including Follow Rate, than a generic drill-down would show).
// The day/time grouping domain (weekday/month/hour order + label
// functions) lives in reportMetrics.ts, shared with RangeAnalysisScreen.

type ReportTab = 'symbol' | 'daytime' | 'tags';
const TABS: { id: ReportTab; label: string }[] = [
  { id: 'symbol', label: 'Symbol' },
  { id: 'daytime', label: 'Day & Time' },
  { id: 'tags', label: 'Tags' },
];

type DayTimeMode = 'days' | 'month' | 'time' | 'duration';
const DAYTIME_MODES: { id: DayTimeMode; label: string }[] = [
  { id: 'days', label: 'Days' },
  { id: 'month', label: 'Month' },
  { id: 'time', label: 'Trade Time' },
  { id: 'duration', label: 'Trade Duration' },
];

export default function ReportsScreen() {
  const { user } = useAuth();
  const { filteredTrades, accountOptions } = useTrades();
  const { getEffectiveRange } = useDateRange();
  const effectiveRange = getEffectiveRange('trade-reports');
  const [tab, setTab] = useState<ReportTab>('symbol');
  const [dayTimeMode, setDayTimeMode] = useState<DayTimeMode>('days');
  const [timeInterval, setTimeInterval] = useState<'hour' | 'halfhour'>('hour');

  const rangedTrades = useMemo(
    () => filteredTrades.filter(t => isWithinInterval(new Date(t.entryTime), { start: effectiveRange.from, end: effectiveRange.to })),
    [filteredTrades, effectiveRange]
  );

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    accountOptions.forEach(a => map.set(a.accountId, a.accountName));
    return map;
  }, [accountOptions]);

  // Secondary dimensions shared by Symbol and Day & Time — Account and Side
  // are single-valued per trade, so ReportTemplate's cross-analysis
  // combiner (which assumes exactly one secondary entry per trade) applies
  // cleanly to both.
  const dayOfWeekDim: SecondaryDimension = {
    key: 'dayofweek', label: 'Day of Week',
    keyFn: (t: Trade) => [{ key: format(new Date(t.entryTime), 'EEEE'), label: format(new Date(t.entryTime), 'EEEE') }],
  };
  const accountDim: SecondaryDimension = {
    key: 'account', label: 'Account',
    keyFn: (t: Trade) => {
      const name = t.accountId ? (accountNameById.get(t.accountId) || t.accountId) : 'Unknown';
      return [{ key: t.accountId || 'unknown', label: name }];
    },
  };
  const sideDim: SecondaryDimension = {
    key: 'side', label: 'Side',
    keyFn: (t: Trade) => [{ key: t.direction, label: t.direction }],
  };

  // Daily Journal / tag categories, scoped to this user — same source
  // TagCategoriesPicker.tsx and TradePerformanceLog.tsx already subscribe
  // to, so a report tag matches exactly what a trader sees when tagging a
  // trade.
  const [tagCategories, setTagCategories] = useState<TagCategory[]>([]);
  const [activeTagCategoryId, setActiveTagCategoryId] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'tagCategories'), where('userId', '==', user.uid)),
      (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TagCategory)).sort((a, b) => a.order - b.order);
        setTagCategories(docs);
        setActiveTagCategoryId(prev => (prev && docs.some(c => c.id === prev) ? prev : docs[0]?.id ?? null));
      }
    );
    return () => unsubscribe();
  }, [user]);
  const activeTagCategory = tagCategories.find(c => c.id === activeTagCategoryId) ?? null;

  return (
    <div className="space-y-6 pb-20">
      <SectionHeader
        title="Reports"
        subtitle="Drill into performance by symbol, day and time, or tag — one shared template, three ways to slice the same trades."
      />

      <div className="flex items-center gap-1 w-fit p-1 rounded-xl bg-accent/30 border border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-bold transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rangedTrades.length === 0 ? (
        <Card className="text-center py-16">
          <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground italic">No trades in {effectiveRange.label.toLowerCase()}.</p>
        </Card>
      ) : (
        <>
          {tab === 'symbol' && (
            <ReportTemplate
              trades={rangedTrades}
              labelHeader="Symbol"
              primaryKeyFn={(t) => [{ key: t.symbol, label: t.symbol }]}
              secondaryDimensions={[dayOfWeekDim, accountDim, sideDim]}
            />
          )}

          {tab === 'daytime' && (
            <div className="space-y-4">
              <div className="flex items-center gap-1 w-fit p-1 rounded-xl bg-accent/30 border border-border">
                {DAYTIME_MODES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setDayTimeMode(m.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                      dayTimeMode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {dayTimeMode === 'days' && (
                <ReportTemplate
                  trades={rangedTrades}
                  labelHeader="Day"
                  primaryKeyFn={(t) => {
                    const label = format(new Date(t.entryTime), 'EEEE');
                    return [{ key: label, label }];
                  }}
                  secondaryDimensions={[accountDim, sideDim]}
                  sortOrder={DAY_ORDER}
                />
              )}
              {dayTimeMode === 'month' && (
                <ReportTemplate
                  trades={rangedTrades}
                  labelHeader="Month"
                  primaryKeyFn={(t) => {
                    const label = format(new Date(t.entryTime), 'MMMM');
                    return [{ key: label, label }];
                  }}
                  secondaryDimensions={[accountDim, sideDim]}
                  sortOrder={MONTH_ORDER}
                />
              )}
              {dayTimeMode === 'time' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-1 w-fit p-1 rounded-xl bg-accent/30 border border-border">
                    {([
                      { id: 'hour' as const, label: 'Hourly' },
                      { id: 'halfhour' as const, label: '30-Minute' },
                    ]).map(o => (
                      <button
                        key={o.id}
                        onClick={() => setTimeInterval(o.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                          timeInterval === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <ReportTemplate
                    key={timeInterval}
                    trades={rangedTrades}
                    labelHeader="Time of Day"
                    primaryKeyFn={(t) => {
                      const label = timeInterval === 'hour' ? hourLabel(t.entryTime) : halfHourLabel(t.entryTime);
                      return [{ key: label, label }];
                    }}
                    secondaryDimensions={[dayOfWeekDim, accountDim]}
                    sortOrder={timeInterval === 'hour' ? HOUR_ORDER : HALF_HOUR_ORDER}
                  />
                </div>
              )}
              {dayTimeMode === 'duration' && (
                <ReportTemplate
                  trades={rangedTrades}
                  labelHeader="Trade Duration"
                  primaryKeyFn={(t) => {
                    const label = durationBucket(t.holdTimeSeconds || 0);
                    return [{ key: label, label }];
                  }}
                  secondaryDimensions={[dayOfWeekDim, accountDim]}
                  sortOrder={DURATION_ORDER}
                />
              )}
            </div>
          )}

          {tab === 'tags' && (
            tagCategories.length === 0 ? (
              <Card className="text-center py-16">
                <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground italic">No tag categories yet — add tags to a trade first.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-1 w-fit p-1 rounded-xl bg-accent/30 border border-border overflow-x-auto max-w-full">
                  {tagCategories.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveTagCategoryId(c.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors",
                        activeTagCategoryId === c.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                {activeTagCategory && (
                  <ReportTemplate
                    key={activeTagCategory.id}
                    trades={rangedTrades}
                    labelHeader="Tag"
                    primaryKeyFn={(t) => {
                      const tags = t.tags || [];
                      return tags
                        .filter(tag => activeTagCategory.tags.includes(tag))
                        .map(tag => ({ key: tag, label: tag }));
                    }}
                    secondaryDimensions={[dayOfWeekDim, accountDim, sideDim]}
                  />
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
