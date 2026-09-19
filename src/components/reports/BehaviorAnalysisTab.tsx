import React, { useMemo } from 'react';
import { Card } from '../Shared';
import { AlertCircle, Clock, BrainCircuit } from 'lucide-react';
import { Trade } from '../../types';
import { buildDashboardModel } from '../../services/analyticsService';
import { TradeGradeBreakdown, BiasVsOutcome, HourlyPerformanceChart } from '../Charts';

// Moved here from Dashboard — quality/timing-pattern charts plus a small,
// dollar-denominated set of insight cards. Originally 4 insight cards
// (Loss Patterns, Peak Window, Re-entry Impact, Key Patterns); Peak Window
// and Re-entry Impact each carried a real bug (Peak Window's "% of total
// profit" divided by *net* P&L, which can wildly exceed 100% near
// breakeven; Re-entry Impact was a raw trade count with a literal "%"
// glued onto it in the UI) and, split apart, didn't say whether
// re-entering actually helps or hurts — collapsed into one
// computeTimingInsight() (see analyticsService.ts) covering both.

export function BehaviorAnalysisTab({ trades }: { trades: Trade[] }) {
  const { stats, behaviorMetrics } = useMemo(
    () => buildDashboardModel(trades, trades, new Date(), true),
    [trades]
  );

  if (trades.length === 0) {
    return (
      <Card className="text-center py-16">
        <BrainCircuit className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground italic">No trades in this range.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TradeGradeBreakdown data={stats?.gradeData} />
        <BiasVsOutcome data={stats?.biasVsOutcomeData} />
      </div>

      <HourlyPerformanceChart data={stats?.hourlyData} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 border-rose-500/20 bg-rose-500/[0.02]">
          <div className="flex items-center space-x-3 mb-4">
            <AlertCircle className="w-5 h-5 text-rose-500" />
            <h4 className="text-sm font-bold uppercase tracking-wider text-rose-600">Loss Patterns</h4>
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-black text-foreground">{behaviorMetrics.lossPatterns.percentage}%</p>
            <ul className="space-y-2">
              {behaviorMetrics.lossPatterns.details.map((detail, idx) => (
                <li key={idx} className="text-sm text-muted-foreground flex items-start">
                  <div className="w-1 h-1 rounded-full bg-rose-500 mt-2 mr-2 flex-shrink-0" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-6 border-indigo-500/20 bg-indigo-500/[0.02]">
          <div className="flex items-center space-x-3 mb-4">
            <Clock className="w-5 h-5 text-indigo-500" />
            <h4 className="text-sm font-bold uppercase tracking-wider text-indigo-600">Timing &amp; Re-Entries</h4>
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-black text-foreground">{behaviorMetrics.timingInsight.time}</p>
            <ul className="space-y-2">
              {behaviorMetrics.timingInsight.details.map((detail, idx) => (
                <li key={idx} className="text-sm text-muted-foreground flex items-start">
                  <div className="w-1 h-1 rounded-full bg-indigo-500 mt-2 mr-2 flex-shrink-0" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-6 border-emerald-500/20 bg-emerald-500/[0.02]">
          <div className="flex items-center space-x-3 mb-4">
            <BrainCircuit className="w-5 h-5 text-emerald-500" />
            <h4 className="text-sm font-bold uppercase tracking-wider text-emerald-600">Key Patterns</h4>
          </div>
          <div className="space-y-3">
            <p className="text-2xl font-black text-foreground">{behaviorMetrics.keyPatterns.title}</p>
            <ul className="space-y-2">
              {behaviorMetrics.keyPatterns.details.map((detail, idx) => (
                <li key={idx} className="text-sm text-muted-foreground flex items-start">
                  <div className="w-1 h-1 rounded-full bg-emerald-500 mt-2 mr-2 flex-shrink-0" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
