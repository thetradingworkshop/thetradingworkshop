import React from 'react';
import { cn } from '@/src/utils';
import { Card, Badge, Button } from './Shared';
import { Target, ShieldAlert, Flame, Settings as SettingsIcon } from 'lucide-react';
import { Trade, RiskSettings } from '../types';
import { computeGoalStatuses, computeDllCleanStreak, GoalStatus } from '../services/goalMetrics';

// The Dashboard's daily/weekly/monthly goal-tracking card. Structure is
// deliberately narrow (loss-limit avoidance + 3 profit targets, each
// either configured or skipped, evaluated against real closed-trade P&L)
// rather than a generic goals engine — matches how existing trading
// journals do this (TradesViz's prop-firm drawdown/DLL gauges, TradeZella's
// Challenge widget: real-time progress against a small fixed rule set, not
// freeform user-authored goals). See Settings → Risk Parameters → Profit
// Targets for where these are set, and src/services/goalMetrics.ts for the
// math.
export function GoalsCard({
  trades, riskSettings, onConfigure,
}: {
  trades: Trade[];
  riskSettings: RiskSettings;
  onConfigure?: () => void;
}) {
  const goals = computeGoalStatuses(trades, riskSettings);
  const configured = goals.filter(g => g.status !== 'unconfigured');
  const streak = computeDllCleanStreak(trades, riskSettings);

  if (configured.length === 0) {
    return (
      <Card className="p-6 border-2 border-dashed border-border/60 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-muted rounded-xl shrink-0">
            <Target className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">No goals set yet</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set a daily loss limit and profit targets to see your progress here every day.
            </p>
          </div>
        </div>
        {onConfigure && (
          <Button variant="outline" size="sm" icon={SettingsIcon} onClick={onConfigure}>Set Goals</Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold">Goals</h3>
        </div>
        <div className="flex items-center gap-3">
          {streak > 0 && (
            <div className="flex items-center gap-1.5 text-amber-500" title="Consecutive trading days without breaching your daily loss limit">
              <Flame className="w-4 h-4" />
              <span className="text-xs font-bold tabular-nums">{streak}-day clean streak</span>
            </div>
          )}
          {onConfigure && (
            <button onClick={onConfigure} className="text-muted-foreground hover:text-foreground transition-colors" title="Edit goals">
              <SettingsIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {configured.map(goal => <GoalTile key={goal.id} goal={goal} />)}
      </div>
    </Card>
  );
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function GoalTile({ goal }: { goal: GoalStatus }) {
  const isLossLimit = goal.id === 'dailyLossLimit';

  const badge = goal.status === 'breached'
    ? <Badge variant="negative">Breached</Badge>
    : goal.status === 'hit'
    ? <Badge variant="positive">Hit</Badge>
    : <Badge variant="info">On Track</Badge>;

  const barColor = goal.status === 'breached'
    ? 'bg-rose-500'
    : goal.status === 'hit'
    ? 'bg-emerald-500'
    : isLossLimit
      ? (goal.progressPct >= 75 ? 'bg-amber-500' : 'bg-indigo-500')
      : 'bg-indigo-500';

  return (
    <div className={cn(
      "p-4 rounded-2xl border",
      goal.status === 'breached' ? "border-rose-500/30 bg-rose-500/5"
      : goal.status === 'hit' ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-border/60 bg-accent/10"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {isLossLimit && <ShieldAlert className="w-3.5 h-3.5" />}
          <span className="text-[10px] font-bold uppercase tracking-widest">{goal.label}</span>
        </div>
      </div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-lg font-black tabular-nums">
          {isLossLimit ? fmtUsd(Math.min(0, goal.current)) : fmtUsd(goal.current)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {isLossLimit ? `limit ${fmtUsd(-(goal.target ?? 0))}` : `of ${fmtUsd(goal.target ?? 0)}`}
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${goal.progressPct}%` }} />
      </div>
      {badge}
    </div>
  );
}
