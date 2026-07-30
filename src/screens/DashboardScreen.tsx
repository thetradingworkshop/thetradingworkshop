import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { collectionGroup, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { cn, gradeBadgeVariant, pointsPerContract } from '@/src/utils';
import { SectionHeader, Scorecard, Card, Badge, Button, Table, TableHeader, TableRow, TableHead, TableCell, Toast, Modal } from '../components/Shared';
import { 
  EquityCurveChart, 
  TradeGradeBreakdown, 
  BiasVsOutcome, 
  PnlByTradeChart, 
  HourlyPerformanceChart, 
  HoldTimeHistogram 
} from '../components/Charts';
import {
  CheckCircle2,
  AlertCircle,
  Zap,
  BrainCircuit,
  ChevronDown,
  BarChart3,
  RefreshCw,
  Clock,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Settings,
  BookOpen,
  Loader2,
  Wallet
} from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { useAuth } from '../context/AuthContext';
import { AccountTransaction } from '../types';

import { MentorService, StructuredInsight } from '../services/mentorService';
import { AnthropicProvider } from '../services/aiProviders';
import { buildDashboardModel, buildSessionMetrics } from '../services/analyticsService';
import { RuleBasedMentorService, RuleBasedInsight } from '../services/RuleBasedMentorService';
import { RuleBasedMentor } from '../components/RuleBasedMentor';

export default function DashboardScreen() {
  const { user } = useAuth();
  const { filteredTrades: trades, isLiveSyncing, isLoading, error: syncError } = useTrades();
  const { getEffectiveRange } = useDateRange();
  const dateRange = getEffectiveRange('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedFilter, setSelectedFilter] = useState<{ type: 'day' | 'week' | 'none'; value: number | string | null }>({ type: 'none', value: null });
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [calendarSettings, setCalendarSettings] = useState({
    displayMode: 'full' as 'pnl' | 'pnl-trades' | 'full',
    showTradeCount: true,
    showWinRate: true,
    showWeekends: true,
    highlightBestDay: true,
    highlightWorstDay: true,
    colorIntensity: 'medium' as 'low' | 'medium' | 'high',
    showWeeklyPnL: true,
    showTradingDays: true,
    highlightBestWeek: true,
    showWeeklyPanel: true,
    shareIncludeWeekly: true,
    shareIncludeStats: true,
    shareIncludeHighlights: true
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Real profitability — actual money spent on evals/resets/subscriptions
  // vs. actual payouts received, across every account. This is distinct
  // from (and the real answer next to) the in-platform P&L above: a trader
  // can show a green Net P&L here while still being underwater once every
  // eval attempt and subscription fee is counted, and vice versa once
  // payouts land.
  const [accountTransactions, setAccountTransactions] = useState<AccountTransaction[]>([]);
  useEffect(() => {
    if (!user) {
      setAccountTransactions([]);
      return;
    }
    const unsub = onSnapshot(
      query(collectionGroup(db, 'transactions'), where('userId', '==', user.uid)),
      (snap) => setAccountTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountTransaction))),
      () => setAccountTransactions([])
    );
    return () => unsub();
  }, [user?.uid]);
  const totalSpent = useMemo(() => accountTransactions.filter(t => t.type === 'cost').reduce((s, t) => s + t.amount, 0), [accountTransactions]);
  const totalPayouts = useMemo(() => accountTransactions.filter(t => t.type === 'payout').reduce((s, t) => s + t.amount, 0), [accountTransactions]);
  const realNetProfitability = totalPayouts - totalSpent;

  const [ruleBasedInsight, setRuleBasedInsight] = useState<RuleBasedInsight | null>(null);
  const [isMentorLoading, setIsMentorLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Memoize mentor service to avoid re-instantiation
  const mentorService = useMemo(() => new MentorService(new AnthropicProvider()), []);

  const filteredTrades = useMemo(() => {
    // First apply global/page date range filter
    const inRangeTrades = trades.filter(t => {
      const tradeDate = new Date(t.entryTime);
      return tradeDate >= dateRange.from && tradeDate <= dateRange.to;
    });

    if (selectedFilter.type === 'none') return inRangeTrades;
    
    return inRangeTrades.filter(t => {
      const tradeDate = new Date(t.entryTime);
      if (selectedFilter.type === 'day') {
        return tradeDate.getDate() === selectedFilter.value && 
               tradeDate.getMonth() === currentDate.getMonth() &&
               tradeDate.getFullYear() === currentDate.getFullYear();
      }
      if (selectedFilter.type === 'week') {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const dayOfMonth = tradeDate.getDate();
        
        if (tradeDate.getMonth() !== month || tradeDate.getFullYear() !== year) return false;
        
        const dayIndex = dayOfMonth + firstDayOfMonth - 1;
        const weekIndex = Math.floor(dayIndex / 7);
        return `Week ${weekIndex + 1}` === selectedFilter.value;
      }
      return true;
    });
  }, [trades, selectedFilter, currentDate, dateRange]);

  const dashboardModel = useMemo(() => {
    return buildDashboardModel(
      trades,
      filteredTrades,
      currentDate,
      calendarSettings.showWeekends
    );
  }, [trades, filteredTrades, currentDate, calendarSettings.showWeekends]);

  const { stats, calendarDays, weeklySummaries, behaviorMetrics } = dashboardModel;

  const daysPerRow = calendarSettings.showWeekends ? 7 : 5;
  const calendarRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < calendarDays.length; i += daysPerRow) {
      rows.push(calendarDays.slice(i, i + daysPerRow));
    }
    return rows;
  }, [calendarDays, daysPerRow]);

  const { bestDayIdx, worstDayIdx, maxAbsPnl } = useMemo(() => {
    const activeDays = calendarDays.filter(d => !d.isEmpty);
    if (activeDays.length === 0) return { bestDayIdx: -1, worstDayIdx: -1, maxAbsPnl: 0 };
    
    let best = activeDays[0];
    let worst = activeDays[0];
    let maxAbs = 0;
    
    activeDays.forEach(d => {
      if (d.pnl > best.pnl) best = d;
      if (d.pnl < worst.pnl) worst = d;
      const absPnl = Math.abs(d.pnl);
      if (absPnl > maxAbs) maxAbs = absPnl;
    });
    
    return { 
      bestDayIdx: calendarDays.findIndex(d => d.day === best.day), 
      worstDayIdx: calendarDays.findIndex(d => d.day === worst.day),
      maxAbsPnl: maxAbs
    };
  }, [calendarDays]);

  const { bestWeekIdx, worstWeekIdx } = useMemo(() => {
    if (weeklySummaries.length === 0) return { bestWeekIdx: -1, worstWeekIdx: -1 };
    
    let best = weeklySummaries[0];
    let worst = weeklySummaries[0];
    
    weeklySummaries.forEach(w => {
      if (w.pnl > best.pnl) best = w;
      if (w.pnl < worst.pnl) worst = w;
    });
    
    return { 
      bestWeekIdx: weeklySummaries.findIndex(w => w.pnl === best.pnl), 
      worstWeekIdx: weeklySummaries.findIndex(w => w.pnl === worst.pnl) 
    };
  }, [weeklySummaries]);

  const monthYearLabel = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const fetchMentorFeedback = useCallback(async () => {
    if (filteredTrades.length === 0) {
      setRuleBasedInsight(null);
      return;
    }

    setIsMentorLoading(true);
    try {
      const sessionMetrics = buildSessionMetrics(filteredTrades);
      const insight = RuleBasedMentorService.generateInsights(sessionMetrics);
      setRuleBasedInsight(insight);
    } catch (error: any) {
      console.error('Failed to generate mentor feedback:', error);
      setToast({ message: 'Failed to generate insights', type: 'error' });
    } finally {
      setIsMentorLoading(false);
    }
  }, [filteredTrades]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMentorFeedback();
    }, 1000); // 1 second debounce

    return () => clearTimeout(timer);
  }, [fetchMentorFeedback]);

  // Update cooldown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const interval = setInterval(() => {
      setCooldownRemaining(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownRemaining]);

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const resetMonth = () => setCurrentDate(new Date());

  const rangeStats = useMemo(() => {
    const activeDays = calendarDays.filter(d => !d.isEmpty);
    const totalPnL = activeDays.reduce((sum, d) => sum + d.pnl, 0);
    return {
      totalPnL,
      tradingDays: activeDays.length
    };
  }, [calendarDays]);

  const resetCalendarSettings = () => {
    setCalendarSettings({
      displayMode: 'full',
      showTradeCount: true,
      showWinRate: true,
      showWeekends: true,
      highlightBestDay: true,
      highlightWorstDay: true,
      colorIntensity: 'medium',
      showWeeklyPnL: true,
      showTradingDays: true,
      highlightBestWeek: true,
      showWeeklyPanel: true,
      shareIncludeWeekly: true,
      shareIncludeStats: true,
      shareIncludeHighlights: true
    });
    setSelectedFilter({ type: 'none', value: null });
    setIsAdvancedSettingsOpen(false);
    setToast({ message: 'Settings reset to default', type: 'success' });
  };

  useEffect(() => {
    if (!isSettingsOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSettingsOpen(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (syncError) {
      setToast({ message: `Sync Error: ${syncError}`, type: 'error' });
    }
  }, [syncError]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="text-muted-foreground font-medium animate-pulse">Syncing your trading data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 pb-12">
      {/* 1. SESSION SUMMARY STRIP (TOP) */}
      <div className="bg-white border border-border rounded-3xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-8 px-4">
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Net PnL</p>
            <p className={cn("text-sm font-black", (stats?.netPnlDollars || 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {(stats?.netPnlDollars || 0) >= 0 ? '+' : ''}${(stats?.netPnlDollars || 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Win Rate</p>
            <p className="text-sm font-black text-slate-900">{(stats?.winRate !== undefined && !isNaN(stats.winRate)) ? stats.winRate.toFixed(1) : '0.0'}%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Trades</p>
            <p className="text-sm font-black text-slate-900">{stats?.totalTrades || '0'}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Discipline</p>
            <p className="text-sm font-black text-indigo-600">{behaviorMetrics.disciplineScore}/100</p>
          </div>
        </div>
        
        <div className="flex-1 flex items-center justify-center md:justify-end px-4 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0">
          <div className="flex items-center space-x-2">
            <Badge variant="neutral" className="bg-indigo-50 text-indigo-600 border-indigo-100 font-bold text-[10px]">SESSION VERDICT</Badge>
            <p className="text-xs font-medium text-slate-600 italic">
              "{behaviorMetrics.sessionVerdict}"
            </p>
          </div>
        </div>
      </div>

      {/* Row 1: Header */}
      <SectionHeader 
        title="Performance Dashboard" 
        subtitle={trades.length > 0 ? `Analyzing ${trades.length} reconstructed trades` : "Comprehensive analysis of your trading performance and behavioral patterns"}
        rightElement={
          isLiveSyncing ? (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <RefreshCw className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Live Sync Active</span>
            </div>
          ) : undefined
        }
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Real Profitability — actual cash spent (evals/resets/subscriptions)
          vs. actual payouts received, across every account. This is the
          number that answers whether the trader is actually profitable,
          separate from in-platform P&L above. */}
      <Card className={cn(
        "p-6 border-2",
        accountTransactions.length === 0
          ? "border-border/50"
          : realNetProfitability >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"
      )}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-bold">Real Profitability</h3>
          </div>
          <span className="text-[10px] text-muted-foreground">Actual money spent vs. actual payouts received — across all accounts</span>
        </div>
        {accountTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No costs or payouts logged yet. Add them under <span className="font-bold">Settings → Accounts</span> (the $ icon on each account) to see your real, out-of-pocket profitability here.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Spent</p>
              <p className="text-2xl font-bold text-rose-500">${totalSpent.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Total Payouts</p>
              <p className="text-2xl font-bold text-emerald-500">${totalPayouts.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Net Profitability</p>
              <p className={cn("text-2xl font-bold", realNetProfitability >= 0 ? "text-emerald-500" : "text-rose-500")}>
                {realNetProfitability >= 0 ? '+' : '-'}${Math.abs(realNetProfitability).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Section 1: Key Metrics & Equity */}
      <section className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Scorecard
            label="Net P&L"
            value={stats && !isNaN(stats.netPnlDollars) ? `${stats.netPnlDollars >= 0 ? '+' : ''}$${stats.netPnlDollars.toLocaleString()}` : "$0.00"}
            trend={undefined}
            className="border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
          />
          <Scorecard 
            label="Win Rate" 
            value={stats && !isNaN(stats.winRate) ? `${stats.winRate.toFixed(1)}%` : "0.0%"} 
            trend={undefined} 
          />
          <Scorecard 
            label="Profit Factor" 
            value={stats && !isNaN(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "0.00"} 
            trend={undefined} 
          />
          <Scorecard 
            label="Avg Winner" 
            value={stats && !isNaN(stats.avgWinner) ? stats.avgWinner.toFixed(2) : "0.00"} 
            secondary={stats && !isNaN(stats.avgLoser) ? `Avg Loser: ${stats.avgLoser.toFixed(2)}` : "Avg Loser: 0.00"} 
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <EquityCurveChart className="h-full" data={stats?.equityDataDollars} />
          </div>
          <div className="lg:col-span-4 flex flex-col gap-6">
            <Scorecard 
              label="Discipline Score" 
              value={`${behaviorMetrics.disciplineScore}/100`} 
              secondary={behaviorMetrics.disciplineTrend > 0 ? "Improving adherence" : "Decreasing adherence"} 
              trend={{ value: Math.abs(behaviorMetrics.disciplineTrend), label: 'trend', positive: behaviorMetrics.disciplineTrend >= 0 }} 
              className="bg-indigo-500/5 border-indigo-500/20" 
            />
            <Scorecard 
              label="Risk Score" 
              value={`${behaviorMetrics.riskScore}/100`} 
              secondary={behaviorMetrics.riskTrend > 0 ? "Improving risk control" : "Decreasing risk control"} 
              trend={{ value: Math.abs(behaviorMetrics.riskTrend), label: 'trend', positive: behaviorMetrics.riskTrend >= 0 }} 
            />
            <Scorecard 
              label="Bias Score" 
              value={`${behaviorMetrics.biasScore}/100`} 
              secondary={behaviorMetrics.biasTrend > 0 ? "Increasing bias" : "Decreasing bias"} 
              trend={{ value: Math.abs(behaviorMetrics.biasTrend), label: 'trend', positive: behaviorMetrics.biasTrend <= 0 }} 
              className={behaviorMetrics.biasTrend > 0 ? "bg-rose-500/5 border-rose-500/20" : "bg-emerald-500/5 border-emerald-500/20"} 
            />
          </div>
        </div>
      </section>

      {/* CALENDAR SETTINGS MODAL */}
      <Modal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        title="Calendar Settings"
        maxWidth="lg"
        footer={
          <div className="flex justify-between w-full">
            <Button variant="outline" onClick={resetCalendarSettings}>Reset Defaults</Button>
            <Button variant="primary" onClick={() => setIsSettingsOpen(false)}>Save Changes</Button>
          </div>
        }
      >
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Display Options</h4>
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <span className="text-sm font-bold text-slate-700">Show Weekends</span>
                  <input 
                    type="checkbox" 
                    checked={calendarSettings.showWeekends} 
                    onChange={(e) => setCalendarSettings({...calendarSettings, showWeekends: e.target.checked})}
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <span className="text-sm font-bold text-slate-700">Show Weekly Panel</span>
                  <input 
                    type="checkbox" 
                    checked={calendarSettings.showWeeklyPanel} 
                    onChange={(e) => setCalendarSettings({...calendarSettings, showWeeklyPanel: e.target.checked})}
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex items-center justify-between p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                  <span className="text-sm font-bold text-slate-700">Highlight Best Day</span>
                  <input 
                    type="checkbox" 
                    checked={calendarSettings.highlightBestDay} 
                    onChange={(e) => setCalendarSettings({...calendarSettings, highlightBestDay: e.target.checked})}
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Heatmap Intensity</h4>
              <div className="flex bg-slate-100 p-1 rounded-2xl">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setCalendarSettings({...calendarSettings, colorIntensity: level})}
                    className={cn(
                      "flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                      calendarSettings.colorIntensity === level 
                        ? "bg-white text-indigo-600 shadow-sm" 
                        : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                Adjust the sensitivity of the PnL heatmap colors. Higher intensity makes small PnL values more visible.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Share & Export Config</h4>
            <div className="grid grid-cols-3 gap-4">
              <label className="flex flex-col items-center gap-2 p-4 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all">
                <input 
                  type="checkbox" 
                  checked={calendarSettings.shareIncludeWeekly} 
                  onChange={(e) => setCalendarSettings({...calendarSettings, shareIncludeWeekly: e.target.checked})}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Weekly Panel</span>
              </label>
              <label className="flex flex-col items-center gap-2 p-4 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all">
                <input 
                  type="checkbox" 
                  checked={calendarSettings.shareIncludeStats} 
                  onChange={(e) => setCalendarSettings({...calendarSettings, shareIncludeStats: e.target.checked})}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Monthly Stats</span>
              </label>
              <label className="flex flex-col items-center gap-2 p-4 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-all">
                <input 
                  type="checkbox" 
                  checked={calendarSettings.shareIncludeHighlights} 
                  onChange={(e) => setCalendarSettings({...calendarSettings, shareIncludeHighlights: e.target.checked})}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600"
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Highlights</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* CALENDAR PERFORMANCE MODULE */}
      <Card className="p-0 overflow-hidden border-border/50 shadow-xl bg-white">
        {/* HEADER BAR */}
        <div className="p-4 border-b border-border/50 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" onClick={prevMonth} className="h-8 w-8 p-0 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></Button>
              <h3 className="text-lg font-bold text-slate-900 min-w-[120px] text-center">{monthYearLabel}</h3>
              <Button variant="ghost" size="sm" onClick={nextMonth} className="h-8 w-8 p-0 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={resetMonth} 
              className="px-4 h-9 text-xs font-medium rounded-xl border-slate-200 hover:bg-slate-50"
            >
              This month
            </Button>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold text-slate-900">Monthly stats:</span>
              <div className="flex items-center gap-2">
                <Badge variant="neutral" className={cn(
                  "bg-emerald-50 text-emerald-600 border-none text-xs font-bold h-7 px-3",
                  rangeStats.totalPnL < 0 && "bg-rose-50 text-rose-600"
                )}>
                  {rangeStats.totalPnL >= 0 ? '+' : '-'}${Math.abs(rangeStats.totalPnL).toLocaleString()}
                </Badge>
                <Badge variant="neutral" className="bg-slate-100 text-slate-600 border-none text-xs font-bold h-7 px-3">
                  {rangeStats.tradingDays} days
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-1 border-l border-slate-200 pl-4">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-slate-400 hover:text-indigo-600"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-border rounded-3xl overflow-hidden shadow-sm">
          <div className={cn(
            "grid gap-3 p-6",
            calendarSettings.showWeeklyPanel 
              ? (calendarSettings.showWeekends ? "grid-cols-[repeat(7,1fr)_160px]" : "grid-cols-[repeat(5,1fr)_160px]")
              : (calendarSettings.showWeekends ? "grid-cols-7" : "grid-cols-5")
          )}>
            {/* Headers */}
            {(calendarSettings.showWeekends ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).map(day => (
              <div key={day} className="bg-slate-50/50 border border-slate-100 rounded-lg py-2 text-center">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{day}</span>
              </div>
            ))}
            {calendarSettings.showWeeklyPanel && (
              <div className="flex items-center justify-between px-2">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Weekly</h4>
                <Badge variant="neutral" className="bg-slate-200/50 text-slate-500 border-none text-[8px]">
                  {weeklySummaries.length}
                </Badge>
              </div>
            )}

            {/* Rows */}
            {calendarRows.map((row, rowIdx) => (
              <React.Fragment key={rowIdx}>
                {/* Day Cells */}
                {row.map((d, i) => {
                  const absoluteIdx = rowIdx * daysPerRow + i;
                  const isSelected = selectedFilter.type === 'day' && selectedFilter.value === d.day;
                  const isBestDay = calendarSettings.highlightBestDay && absoluteIdx === bestDayIdx;
                  const isWorstDay = calendarSettings.highlightWorstDay && absoluteIdx === worstDayIdx;

                  // Calculate intensity for heatmap
                  const intensityScale = maxAbsPnl > 0 ? Math.abs(d.pnl) / maxAbsPnl : 0;
                  const baseOpacity = calendarSettings.colorIntensity === 'high' ? 0.8 : calendarSettings.colorIntensity === 'medium' ? 0.5 : 0.2;
                  const finalOpacity = Math.max(0.05, intensityScale * baseOpacity);

                  return (
                    <div 
                      key={i}
                      onClick={() => {
                        if (d.isEmpty) return;
                        setSelectedFilter(prev =>
                          prev.type === 'day' && prev.value === d.day
                            ? { type: 'none', value: null }
                            : { type: 'day', value: d.day }
                        );
                      }}
                      className={cn(
                        "group relative aspect-square rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden",
                        d.isEmpty ? "bg-slate-50/30 border-slate-100" : "bg-white border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-0.5",
                        isSelected && "border-indigo-500 ring-2 ring-indigo-500/20 z-10",
                        isBestDay && "ring-1 ring-emerald-500 ring-offset-1",
                        isWorstDay && "ring-1 ring-rose-500 ring-offset-1"
                      )}
                      style={!d.isEmpty ? {
                        backgroundColor: d.pnl > 0 
                          ? `rgba(16, 185, 129, ${finalOpacity})` 
                          : d.pnl < 0 
                            ? `rgba(244, 63, 94, ${finalOpacity})` 
                            : undefined
                      } : {}}
                    >
                      {!d.isEmpty && (
                        <div className="p-2 h-full flex flex-col relative z-10">
                          <div className="flex justify-between items-start">
                            <span className={cn(
                              "text-[10px] font-black tracking-tighter",
                              d.pnl !== 0 ? "text-slate-900/40" : "text-slate-400"
                            )}>
                              {d.day}
                            </span>
                            <div className="flex gap-0.5">
                              {isBestDay && (
                                <div className="bg-emerald-500 text-white p-0.5 rounded shadow-sm">
                                  <Zap className="w-2.5 h-2.5" />
                                </div>
                              )}
                              {isWorstDay && (
                                <div className="bg-rose-500 text-white p-0.5 rounded shadow-sm">
                                  <AlertCircle className="w-2.5 h-2.5" />
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex-1 flex flex-col items-center justify-center">
                            <p className={cn(
                              "text-sm font-black tracking-tight",
                              d.pnl > 0 ? "text-emerald-700" : d.pnl < 0 ? "text-rose-700" : "text-slate-400"
                            )}>
                              {d.pnl > 0 ? '+' : d.pnl < 0 ? '-' : ''}${Math.abs(d.pnl).toLocaleString()}
                            </p>
                          </div>

                          <div className="flex items-center justify-between mt-auto pt-1 border-t border-black/5">
                            <div className="flex items-center gap-1">
                              <BookOpen className="w-2 h-2 text-slate-500/60" />
                              <span className="text-[8px] font-bold text-slate-600/70">{d.trades}</span>
                            </div>
                            <span className={cn(
                              "text-[8px] font-black",
                              d.winRate >= 70 ? "text-emerald-600" : d.winRate >= 40 ? "text-amber-600" : "text-rose-600"
                            )}>
                              {Math.round(d.winRate)}%
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/[0.03] transition-colors pointer-events-none" />
                    </div>
                  );
                })}

                {/* Weekly Summary Cell */}
                {calendarSettings.showWeeklyPanel && (
                  <div className="h-full">
                    {weeklySummaries[rowIdx] ? (
                      (() => {
                        const week = weeklySummaries[rowIdx];
                        const isSelected = selectedFilter.type === 'week' && selectedFilter.value === week.label;
                        const isBestWeek = calendarSettings.highlightBestWeek && rowIdx === bestWeekIdx;
                        
                        return (
                          <div 
                            onClick={() => {
                              setSelectedFilter(prev => 
                                prev.type === 'week' && prev.value === week.label 
                                  ? { type: 'none', value: null } 
                                  : { type: 'week', value: week.label }
                              );
                            }}
                            className={cn(
                              "group h-full p-3 bg-slate-50/50 border border-slate-200 rounded-xl transition-all duration-300 cursor-pointer hover:border-indigo-400 hover:shadow-lg relative overflow-hidden flex flex-col justify-between",
                              isSelected && "bg-white border-indigo-500 ring-2 ring-indigo-500/10 shadow-xl z-10",
                              isBestWeek && "border-emerald-200 bg-emerald-50/20"
                            )}
                          >
                            {isBestWeek && (
                              <div className="absolute top-0 right-0">
                                <div className="bg-emerald-500 text-white text-[6px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-bl-lg shadow-sm">
                                  Best
                                </div>
                              </div>
                            )}

                            <div className="flex justify-between items-start">
                              <p className="text-[8px] font-black text-indigo-500 uppercase tracking-widest">{week.label}</p>
                              <p className={cn(
                                "text-sm font-black tracking-tighter",
                                week.pnl >= 0 ? "text-emerald-600" : "text-rose-600"
                              )}>
                                {week.pnl >= 0 ? '+' : '-'}${Math.abs(week.pnl).toLocaleString()}
                              </p>
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[8px] font-bold text-slate-400">
                                <span>Win Rate</span>
                                <span className={cn(
                                  week.winRate >= 60 ? "text-emerald-500" : "text-amber-500"
                                )}>{week.winRate}%</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <div className="w-1 h-1 rounded-full bg-indigo-400" />
                                  <span className="text-[8px] font-bold text-slate-500">{week.activeDays} Days</span>
                                </div>
                                <ChevronRight className="w-2.5 h-2.5 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="h-full border border-dashed border-slate-100 rounded-xl" />
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* AI Insight Footer - Full Width if panel is open */}
          {calendarSettings.showWeeklyPanel && (
            <div className="border-t border-border/50 bg-slate-50/30 p-4">
              <div className="max-w-md mx-auto p-3 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/20 relative overflow-hidden group">
                <div className="absolute -right-2 -bottom-2 opacity-10 group-hover:scale-110 transition-transform duration-500">
                  <BrainCircuit className="w-12 h-12" />
                </div>
                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2 rounded-lg">
                      <Zap className="w-4 h-4 text-indigo-100" />
                    </div>
                    <div>
                      <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-100">AI Weekly Insight</h5>
                      <p className="text-[11px] text-indigo-50 font-medium leading-tight mt-0.5">
                        {ruleBasedInsight?.nextAction || "No insights available."}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20 text-[10px] h-8 px-3">
                    Details
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 2: Selected Filter Trades (Contextual) */}
      {selectedFilter.type !== 'none' && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-indigo-500/10 rounded-2xl">
                <Calendar className="w-6 h-6 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight text-foreground">
                  {selectedFilter.type === 'day' ? `Trades for Day ${selectedFilter.value}` : `Trades for ${selectedFilter.value}`}
                </h3>
                <p className="text-sm text-muted-foreground font-medium">
                  Showing {filteredTrades.length} trades for the selected {selectedFilter.type}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" icon={RotateCcw} onClick={() => setSelectedFilter({ type: 'none', value: null })}>
              Clear Filter
            </Button>
          </div>

          <Card className="p-0 overflow-hidden border-border/50 shadow-xl">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50">
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead>PnL (Pts)</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filteredTrades.map((trade) => (
                  <TableRow key={trade.id} className="hover:bg-slate-50/80 transition-colors">
                    <TableCell className="font-bold text-slate-600">
                      {new Date(trade.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral" className="bg-slate-100 text-slate-900 border-slate-200">
                        {trade.symbol}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md",
                        trade.direction === 'LONG' ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
                      )}>
                        {trade.direction}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-bold text-slate-500">{trade.avgEntryPrice.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-xs font-bold text-slate-500">{trade.avgExitPrice.toFixed(2)}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "font-black",
                        trade.pnlPoints >= 0 ? "text-emerald-600" : "text-rose-600"
                      )}>
                        {trade.pnlPoints >= 0 ? '+' : ''}{pointsPerContract(trade.pnlPoints, trade.totalQuantity).toFixed(2)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={gradeBadgeVariant(trade.tradeGrade)}>
                        {trade.tradeGrade}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-indigo-600">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </Card>
        </section>
      )}

      <hr className="border-border/30" />

      {/* Section 2: Behavioral & Distribution Analysis */}
      <section className="space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground">Behavioral Analysis</h3>
            <p className="text-sm text-muted-foreground">Deep dive into trade quality and timing patterns</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
          <TradeGradeBreakdown className="lg:col-span-2" data={stats?.gradeData} />
          <BiasVsOutcome className="lg:col-span-2" />
          <PnlByTradeChart className="lg:col-span-2" data={stats?.pnlByTrade} />
          <HourlyPerformanceChart className="lg:col-span-3" data={stats?.hourlyData} />
          <HoldTimeHistogram className="lg:col-span-3" data={stats?.holdData} />
        </div>
      </section>

      <hr className="border-border/30" />

      {/* Section 3: Behavioral Insights & AI Mentor */}
      <section className="space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground">Behavioral Insights</h3>
            <p className="text-sm text-muted-foreground">Pattern recognition and performance optimization</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="p-6 border-rose-500/20 bg-rose-500/[0.02]">
            <div className="flex items-center space-x-3 mb-4">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <h4 className="text-sm font-bold uppercase tracking-wider text-rose-600">Loss Patterns</h4>
            </div>
            <div className="space-y-3">
              <p className="text-2xl font-black text-slate-900">{behaviorMetrics.lossPatterns.percentage}%</p>
              <ul className="space-y-2">
                {behaviorMetrics.lossPatterns.details.map((detail, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start">
                    <div className="w-1 h-1 rounded-full bg-rose-500 mt-1.5 mr-2 flex-shrink-0" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card className="p-6 border-emerald-500/20 bg-emerald-500/[0.02]">
            <div className="flex items-center space-x-3 mb-4">
              <Zap className="w-5 h-5 text-emerald-500" />
              <h4 className="text-sm font-bold uppercase tracking-wider text-emerald-600">Peak Window</h4>
            </div>
            <div className="space-y-3">
              <p className="text-2xl font-black text-slate-900">{behaviorMetrics.peakWindow.time}</p>
              <ul className="space-y-2">
                {behaviorMetrics.peakWindow.details.map((detail, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start">
                    <div className="w-1 h-1 rounded-full bg-emerald-500 mt-1.5 mr-2 flex-shrink-0" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card className="p-6 border-amber-500/20 bg-amber-500/[0.02]">
            <div className="flex items-center space-x-3 mb-4">
              <RotateCcw className="w-5 h-5 text-amber-500" />
              <h4 className="text-sm font-bold uppercase tracking-wider text-amber-600">Re-entry Impact</h4>
            </div>
            <div className="space-y-3">
              <p className="text-2xl font-black text-slate-900">{behaviorMetrics.reEntryImpact.value}%</p>
              <ul className="space-y-2">
                {behaviorMetrics.reEntryImpact.details.map((detail, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start">
                    <div className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 mr-2 flex-shrink-0" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card className="p-6 border-indigo-500/20 bg-indigo-500/[0.02]">
            <div className="flex items-center space-x-3 mb-4">
              <BrainCircuit className="w-5 h-5 text-indigo-500" />
              <h4 className="text-sm font-bold uppercase tracking-wider text-indigo-600">Key Patterns</h4>
            </div>
            <div className="space-y-3">
              <p className="text-2xl font-black text-slate-900">{behaviorMetrics.keyPatterns.title}</p>
              <ul className="space-y-2">
                {behaviorMetrics.keyPatterns.details.map((detail, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start">
                    <div className="w-1 h-1 rounded-full bg-indigo-500 mt-1.5 mr-2 flex-shrink-0" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>

        <div className="mb-12">
          <SectionHeader 
            icon={BrainCircuit}
            title="Hard-Rule AI Analysis"
            subtitle="Metric-driven performance evaluation"
          />
        </div>

        {isMentorLoading ? (
          <Card className="py-20 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-12 h-12 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Generating Insights...</p>
          </Card>
        ) : ruleBasedInsight ? (
          <RuleBasedMentor insight={ruleBasedInsight} />
        ) : (
          <Card className="py-20 flex flex-col items-center justify-center text-center">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest italic">
              Insufficient data for analysis.
            </p>
          </Card>
        )}
      </section>

    </div>
  );
}
