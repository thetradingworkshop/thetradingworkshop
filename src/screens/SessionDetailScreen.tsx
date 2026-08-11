import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { SectionHeader, Scorecard, Card, Badge, Button, Table, TableHeader, TableRow, TableHead, TableCell, Toast, Input } from '../components/Shared';
import { EquityCurveChart, PnlByTradeChart, HourlyPerformanceChart, BiasVsOutcome } from '../components/Charts';
import { BrainCircuit, MessageSquare, BookOpen, ChevronDown, TrendingUp, ShieldCheck, Target, AlertCircle, Zap, Clock, BarChart3, Lightbulb, CheckCircle2, ChevronRight, Loader2, Save, ShieldAlert, AlertTriangle, Info } from 'lucide-react';

import { useDateRange } from '../context/DateContext';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { format, isWithinInterval } from 'date-fns';
import { buildDashboardModel, buildSessionMetrics } from '../services/analyticsService';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { MentorService, StructuredInsight } from '../services/mentorService';
import { RuleBasedMentorService, RuleBasedInsight } from '../services/RuleBasedMentorService';
import { RuleBasedMentor } from '../components/RuleBasedMentor';
import { DictationTextarea } from '../components/DictationTextarea';
import { AnthropicProvider } from '../services/aiProviders';
import { Session, TradeIntent } from '../types';
import { doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export default function SessionDetailScreen() {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { getEffectiveRange } = useDateRange();
  const { filteredTrades: trades } = useTrades();
  const effectiveRange = getEffectiveRange('sessions');
  const [mentorFeedback, setMentorFeedback] = useState<StructuredInsight | null>(null);
  const [ruleBasedInsight, setRuleBasedInsight] = useState<RuleBasedInsight | null>(null);
  const [isMentorLoading, setIsMentorLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const [sessionJournal, setSessionJournal] = useState<{
    premarketPlan: string;
    sessionNotes: string;
    whatWentWell: string;
    whatHurt: string;
    correctiveAction: string;
    sessionCategory: NonNullable<Session['sessionCategory']> | '';
  }>({
    premarketPlan: '',
    sessionNotes: '',
    whatWentWell: '',
    whatHurt: '',
    correctiveAction: '',
    sessionCategory: ''
  });
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [intents, setIntents] = useState<TradeIntent[]>([]);
  const [sessionMeta, setSessionMeta] = useState<{ createdAt?: string; updatedAt?: string }>({});
  // Tracks whether a `sessions` doc already exists for the currently-loaded
  // date, so saveSessionJournal knows whether to stamp createdAt (first
  // write) or leave it alone (later edits should only touch updatedAt).
  const sessionExistsRef = React.useRef(false);

  // Memoize mentor service to avoid re-instantiation
  const mentorService = useMemo(() => new MentorService(new AnthropicProvider()), []);

  const sessionDateStr = format(effectiveRange.from, 'yyyy-MM-dd');

  // Load session journal
  useEffect(() => {
    if (!user) return;
    const loadSession = async () => {
      const sessionId = `${user.uid}_${sessionDateStr}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        const data = sessionSnap.data() as Session;
        sessionExistsRef.current = true;
        setSessionJournal({
          premarketPlan: data.premarketPlan || '',
          sessionNotes: data.sessionNotes || '',
          whatWentWell: data.whatWentWell || '',
          whatHurt: data.whatHurt || '',
          correctiveAction: data.correctiveAction || '',
          sessionCategory: data.sessionCategory || ''
        });
        setSessionMeta({ createdAt: data.createdAt, updatedAt: data.updatedAt });
      } else {
        sessionExistsRef.current = false;
        setSessionJournal({
          premarketPlan: '',
          sessionNotes: '',
          whatWentWell: '',
          whatHurt: '',
          correctiveAction: '',
          sessionCategory: ''
        });
        setSessionMeta({});
      }
    };
    loadSession();
  }, [user, sessionDateStr]);

  // Load intents for the session
  useEffect(() => {
    if (!user) return;
    const loadIntents = async () => {
      try {
        // `new Date(sessionDateStr)` parses the plain "yyyy-MM-dd" string as
        // UTC midnight, but `.setHours()` then mutates it using *local* time
        // components — in any timezone behind UTC, that silently shifts the
        // whole window a day early (e.g. in EDT, "2026-08-10" ends up
        // covering 2026-08-09T04:00Z..2026-08-10T03:59Z instead of the
        // intended 2026-08-10 local day), so an intent logged in the
        // evening — already the next UTC day — would fall outside this
        // query and never get matched to its trade. Building the boundary
        // Dates from local y/m/d components directly avoids the UTC-parse
        // step entirely, so there's no timezone to get out of sync.
        const [sessionYear, sessionMonth, sessionDay] = sessionDateStr.split('-').map(Number);
        const startOfDay = new Date(sessionYear, sessionMonth - 1, sessionDay, 0, 0, 0, 0);
        const endOfDay = new Date(sessionYear, sessionMonth - 1, sessionDay, 23, 59, 59, 999);

        const q = query(
          collection(db, 'trade_intents'),
          where('userId', '==', user.uid),
          where('confirmedAt', '>=', startOfDay.toISOString()),
          where('confirmedAt', '<=', endOfDay.toISOString())
        );
        const snap = await getDocs(q);
        const loadedIntents = snap.docs.map(d => ({ id: d.id, ...d.data() } as TradeIntent));
        setIntents(loadedIntents);
      } catch (error) {
        console.error('Error loading intents:', error);
      }
    };
    loadIntents();
  }, [user, sessionDateStr]);

  const saveSessionJournal = async () => {
    if (!user) return;
    setIsSavingJournal(true);
    try {
      const sessionId = `${user.uid}_${sessionDateStr}`;
      const sessionRef = doc(db, 'sessions', sessionId);
      const now = new Date().toISOString();
      const isFirstWrite = !sessionExistsRef.current;
      await setDoc(sessionRef, {
        ...sessionJournal,
        userId: user.uid,
        date: sessionDateStr,
        ...(isFirstWrite && { createdAt: now }),
        updatedAt: now
      }, { merge: true });
      sessionExistsRef.current = true;
      setSessionMeta(prev => ({ createdAt: isFirstWrite ? now : prev.createdAt, updatedAt: now }));
      setToast({ message: 'Session journal saved successfully', type: 'success' });
    } catch (error) {
      console.error('Error saving session journal:', error);
      setToast({ message: 'Failed to save session journal', type: 'error' });
    } finally {
      setIsSavingJournal(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const entryDate = new Date(t.entryTime);
      return isWithinInterval(entryDate, { start: effectiveRange.from, end: effectiveRange.to });
    });
  }, [trades, effectiveRange]);

  const dashboardModel = useMemo(() => {
    return buildDashboardModel(trades, filteredTrades, effectiveRange.from, true);
  }, [trades, filteredTrades, effectiveRange.from]);

  const sessionMetrics = useMemo(() => {
    return buildSessionMetrics(filteredTrades, intents);
  }, [filteredTrades, intents]);

  const { stats, behaviorMetrics } = dashboardModel;

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const hasData = filteredTrades.length > 0;

  const fetchMentorFeedback = useCallback(async (isManual = false) => {
    // Rule-based insight
    const rbInsight = RuleBasedMentorService.generateInsights(sessionMetrics);
    setRuleBasedInsight(rbInsight);

    if (filteredTrades.length === 0) {
      setMentorFeedback({
        sessionSummary: "No trading activity recorded for this session.",
        whatWorked: [],
        whatHurt: [],
        coreProblem: "Insufficient Data",
        executionVsStrategy: "Not enough data to analyze execution vs strategy.",
        actionPlan: ["Wait for high-quality setups", "Document market conditions"],
        isInsufficientData: true
      });
      return;
    }

    const remaining = AnthropicProvider.getCooldownRemaining();
    if (remaining > 0 && !isManual) {
      setCooldownRemaining(remaining);
      return;
    }

    setIsMentorLoading(true);
    try {
      const contextLabel = format(effectiveRange.from, 'MMM d, yyyy');
      const modelContext = `Model Follow Rate: ${sessionMetrics.modelFollowRate?.toFixed(1)}%, Rule Violations: ${sessionMetrics.totalViolations}, Violation Rate: ${sessionMetrics.violationRate?.toFixed(1)}%, PnL from Violations: $${sessionMetrics.pnlFromViolations?.toFixed(2)}, PnL from Valid Trades: $${sessionMetrics.pnlFromValidTrades?.toFixed(2)}`;
      const feedback = await mentorService.getMentorFeedback(filteredTrades, stats, `${contextLabel} (${modelContext})`);
      setMentorFeedback(feedback);
    } catch (error) {
      console.error('Failed to fetch mentor feedback:', error);
    } finally {
      setIsMentorLoading(false);
    }
  }, [filteredTrades, stats, effectiveRange.from, mentorService, sessionMetrics]);

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

  return (
    <div className="space-y-8 pb-20">
      <SectionHeader
        title="Session Detail"
        subtitle={
          `Detailed analysis for ${format(effectiveRange.from, 'MMM d, yyyy')} - ${format(effectiveRange.to, 'MMM d, yyyy')}` +
          (sessionMeta.createdAt ? ` • Created: ${format(new Date(sessionMeta.createdAt), 'MMM d, yyyy h:mma')}` : '') +
          (sessionMeta.updatedAt ? ` • Last updated: ${format(new Date(sessionMeta.updatedAt), 'MMM d, yyyy h:mma')}` : '')
        }
        rightElement={
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => handleAction('Export PDF')}>Export PDF</Button>
            <Button variant="primary" onClick={() => handleAction('Share Session')}>Share Session</Button>
          </div>
        }
      />

      {/* Row 1: Key Performance Scorecards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Scorecard 
          label="Net P&L" 
          value={sessionMetrics.netPnl !== undefined && !isNaN(sessionMetrics.netPnl) ? `${sessionMetrics.netPnl >= 0 ? '+' : ''}$${sessionMetrics.netPnl.toFixed(2)}` : "$0.00"} 
          secondary="Session Total"
          trend={undefined}
          className="border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
        />
        <Scorecard 
          label="Discipline Score" 
          value={`${sessionMetrics.disciplineScore || 0}%`} 
          secondary="Rule adherence"
          trend={undefined}
          className="border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors"
        />
        <Scorecard 
          label="Win Rate" 
          value={sessionMetrics.winRate !== undefined && !isNaN(sessionMetrics.winRate) ? `${sessionMetrics.winRate.toFixed(1)}%` : "0.0%"} 
          secondary={sessionMetrics.totalTrades ? `${sessionMetrics.winCount || 0}/${sessionMetrics.totalTrades} trades` : "0/0 trades"}
          trend={undefined}
        />
        <Scorecard 
          label="Profit Factor" 
          value={sessionMetrics.profitFactor !== undefined && !isNaN(sessionMetrics.profitFactor) ? sessionMetrics.profitFactor.toFixed(2) : "0.00"} 
          secondary="Risk/Reward efficiency"
          trend={undefined}
        />
      </div>

      {/* Row 2: Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Total Volume</p>
          <p className="text-2xl font-bold mt-2 text-foreground">{sessionMetrics.totalVolume || 0}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Avg Winner</p>
          <p className="text-2xl font-bold mt-2 text-emerald-600">${sessionMetrics.avgWinner !== undefined && !isNaN(sessionMetrics.avgWinner) ? sessionMetrics.avgWinner.toFixed(2) : "0.00"}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Avg Loser</p>
          <p className="text-2xl font-bold mt-2 text-rose-600">${sessionMetrics.avgLoser !== undefined && !isNaN(sessionMetrics.avgLoser) ? sessionMetrics.avgLoser.toFixed(2) : "0.00"}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Max Losing Streak</p>
          <p className="text-2xl font-bold mt-2 text-rose-600">{sessionMetrics.maxConsecutiveLosses || 0}</p>
        </Card>
      </div>

      {/* Row 2.5: Advanced Session Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Largest Winner</p>
          <p className="text-2xl font-bold mt-2 text-emerald-600">${sessionMetrics.largestWin !== undefined && !isNaN(sessionMetrics.largestWin) ? sessionMetrics.largestWin.toFixed(2) : "0.00"}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Largest Loser</p>
          <p className="text-2xl font-bold mt-2 text-rose-600">${sessionMetrics.largestLoss !== undefined && !isNaN(sessionMetrics.largestLoss) ? sessionMetrics.largestLoss.toFixed(2) : "0.00"}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Fast Losers</p>
          <p className="text-2xl font-bold mt-2 text-rose-600">{sessionMetrics.fastLosersCount || 0}</p>
        </Card>
        <Card className="flex flex-col justify-between hover:bg-muted/5 transition-colors">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Scaling Pattern</p>
          <p className="text-2xl font-bold mt-2 text-amber-600">{sessionMetrics.scalingPatternCount || 0}</p>
        </Card>
      </div>

      {/* Row 3: Equity Curve + Bias/Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <EquityCurveChart className="h-full" data={stats?.equityDataDollars} />
        </div>
        <div className="lg:col-span-4 space-y-6">
          <div className="relative group">
            <BiasVsOutcome data={stats?.biasVsOutcomeData} />
            <div className="absolute top-4 right-4">
              <Badge variant={hasData ? "positive" : "neutral"} className="shadow-lg backdrop-blur-md bg-emerald-500/20">
                {hasData ? (behaviorMetrics.biasScore > 70 ? "High Alignment" : "Partial Alignment") : "No Data"}
              </Badge>
            </div>
          </div>
          <Card className="flex flex-col justify-between bg-muted/5 border-border/40">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">Session Quality</h3>
              <Badge variant={hasData ? (sessionMetrics.consistencyScore! > 70 ? "positive" : "neutral") : "neutral"}>
                {hasData ? (sessionMetrics.consistencyScore! > 70 ? "Excellent" : "Average") : "N/A"}
              </Badge>
            </div>
            <div className="flex items-baseline space-x-2 mb-8">
              <div className="text-5xl font-bold tracking-tighter text-foreground">{sessionMetrics.consistencyScore}</div>
              <div className="text-base text-muted-foreground font-medium">/ 100</div>
            </div>
            <div className="space-y-5">
              <div className="space-y-2.5">
                <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                  <span className="text-muted-foreground/70">Discipline</span>
                  <span className="text-emerald-600">{sessionMetrics.disciplineScore}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden border border-border/20">
                  <div className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] transition-all duration-1000 ease-out" style={{ width: `${sessionMetrics.disciplineScore}%` }} />
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                  <span className="text-muted-foreground/70">Consistency</span>
                  <span className="text-indigo-600">{sessionMetrics.consistencyScore}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden border border-border/20">
                  <div className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)] transition-all duration-1000 ease-out" style={{ width: `${sessionMetrics.consistencyScore}%` }} />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Row 4: PnL by Trade + Hourly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PnlByTradeChart data={stats?.pnlByTrade} />
        <HourlyPerformanceChart data={stats?.hourlyData} />
      </div>

      {/* Row 5: Pattern Detection & Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Key Patterns</h3>
            </div>
            <div className="space-y-4">
              {!hasData ? (
                <div className="p-4 bg-card border border-border/20 rounded-2xl text-center text-xs text-muted-foreground italic">
                  No patterns detected.
                </div>
              ) : (
                <>
                  <div className="p-4 bg-card border border-amber-500/20 rounded-2xl shadow-sm transition-all hover:shadow-md">
                    <p className="text-xs font-bold text-amber-600 flex items-center mb-2">
                      <Zap className="w-3.5 h-3.5 mr-2" /> {behaviorMetrics.lossPatterns.details[0].split(':')[0]}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{behaviorMetrics.lossPatterns.details[0]}</p>
                  </div>
                  <div className="p-4 bg-card border border-indigo-500/20 rounded-2xl shadow-sm transition-all hover:shadow-md">
                    <p className="text-xs font-bold text-indigo-600 flex items-center mb-2">
                      <Clock className="w-3.5 h-3.5 mr-2" /> Peak Performance Window
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{behaviorMetrics.peakWindow.time}: {behaviorMetrics.peakWindow.details[0]}</p>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Row 5: Session Analysis Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          <Card className="h-full bg-primary/5 border-primary/20">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BrainCircuit className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Session Breakdown</h3>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Primary Issue</p>
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${sessionMetrics.primaryIssue === 'None detected' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                  {sessionMetrics.primaryIssue || 'None detected'}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Secondary Issue</p>
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${sessionMetrics.secondaryIssue === 'None detected' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                  {sessionMetrics.secondaryIssue || 'None detected'}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Primary Strength</p>
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold">
                  {sessionMetrics.primaryStrength || 'None detected'}
                </div>
              </div>

              <div className="p-4 bg-background/50 rounded-xl border border-border/40">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Key Insight</p>
                <p className="text-sm text-foreground leading-relaxed font-medium italic">
                  "{sessionMetrics.keyInsight || 'Maintain discipline and follow the plan.'}"
                </p>
              </div>
            </div>
          </Card>
        </div>
        
        <div className="lg:col-span-8">
          <Card className="h-full">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-primary/5 rounded-lg">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Behavior Impact Analysis</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sessionMetrics.behaviorImpacts?.map((impact, idx) => (
                <div key={idx} className="p-4 bg-muted/30 rounded-xl border border-border/40 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-foreground">{impact.behavior}</span>
                      <span className="text-[10px] text-muted-foreground">{impact.tradeCount || 0} trades</span>
                    </div>
                    <span className={`text-xs font-bold ${impact.impact >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {impact.impact >= 0 ? '+' : ''}${Number(impact.impact || 0).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{impact.description}</p>
                </div>
              ))}
              {(!sessionMetrics.behaviorImpacts || sessionMetrics.behaviorImpacts.length === 0) && (
                <div className="col-span-2 py-8 text-center text-muted-foreground italic text-sm">
                  Insufficient data for impact analysis
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Row 5.5: Discipline Report */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-12">
          <Card className="bg-indigo-500/5 border-indigo-500/20">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Discipline Report</h3>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Violation Rate</span>
                  <span className={`text-lg font-bold ${sessionMetrics.violationRate! > 30 ? 'text-rose-600' : 'text-indigo-600'}`}>
                    {sessionMetrics.violationRate?.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Violations</p>
                <p className={`text-2xl font-bold ${sessionMetrics.totalViolations! > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {sessionMetrics.totalViolations}
                </p>
                <p className="text-[11px] text-muted-foreground">Trades flagged</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Violation PnL</p>
                <p className={`text-2xl font-bold ${sessionMetrics.pnlFromViolations! < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  ${sessionMetrics.pnlFromViolations?.toFixed(2) || '0.00'}
                </p>
                <p className="text-[11px] text-muted-foreground">Impact of bad trades</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valid Trade PnL</p>
                <p className={`text-2xl font-bold ${sessionMetrics.pnlFromValidTrades! >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  ${sessionMetrics.pnlFromValidTrades?.toFixed(2) || '0.00'}
                </p>
                <p className="text-[11px] text-muted-foreground">Performance on rules</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Model Follow Rate</p>
                <p className="text-2xl font-bold text-blue-600">{sessionMetrics.modelFollowRate?.toFixed(1)}%</p>
                <p className="text-[11px] text-muted-foreground">Overall adherence</p>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-indigo-500/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-4 bg-background/50 rounded-xl border border-border/40 flex items-center space-x-4">
                  <div className="p-2 bg-indigo-500/10 rounded-full">
                    <Lightbulb className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Discipline Insight</p>
                    <div className="space-y-1">
                      <p className="text-sm text-slate-700 font-medium italic">
                        "{sessionMetrics.disciplineVerdict || "No verdict available for this session."}"
                      </p>
                      {sessionMetrics.disciplineScore! < 60 && (
                        <p className="text-[10px] text-rose-500 font-semibold uppercase tracking-tight">
                          Action Required: Review strategy adherence
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Removed redundant Critical Warning block */}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Row 6: Top Winners + Fast Losers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-emerald-500/20" noPadding>
          <div className="p-6 border-b border-border/60 bg-emerald-500/5 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-600">Top Winners</h3>
            <Badge variant="positive">Alpha Trades</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Hold Time</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">PnL</TableHead>
              </TableRow>
            </TableHeader>
            <tbody>
              {filteredTrades.filter(t => t.isWinner).sort((a, b) => b.realizedPnL - a.realizedPnL).slice(0, 5).map((t, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="font-bold text-foreground">{t.symbol}</div>
                    <div className="text-[11px] text-muted-foreground">Entry: {format(new Date(t.entryTime), 'h:mm a')}</div>
                  </TableCell>
                  <TableCell className="text-sm font-medium text-muted-foreground">{(t.holdTimeSeconds / 60).toFixed(1)}m</TableCell>
                  <TableCell className="text-right text-sm font-medium text-muted-foreground">{t.fills.length} Fills</TableCell>
                  <TableCell className="text-right">
                    <div className="font-bold text-emerald-600">+${t.realizedPnL.toFixed(2)}</div>
                    <div className="flex flex-col items-end gap-1 mt-1.5">
                      <Badge variant="positive" className="text-[9px] px-1.5 py-0">{t.tradeGrade} Entry</Badge>
                      {t.intentId && (
                        <Badge variant={t.isViolation ? "negative" : "positive"} className="text-[9px] px-1.5 py-0">
                          {t.isViolation ? "Rule Violated" : "Rule Followed"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredTrades.filter(t => t.isWinner).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground italic">No winning trades recorded</TableCell>
                </TableRow>
              )}
            </tbody>
          </Table>
        </Card>
        <Card className="border-rose-500/20" noPadding>
          <div className="p-6 border-b border-border/60 bg-rose-500/5 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-rose-600">Fastest Losers</h3>
            <Badge variant="negative">Fast Losses</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Hold Time</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">PnL</TableHead>
              </TableRow>
            </TableHeader>
            <tbody>
              {filteredTrades.filter(t => !t.isWinner).sort((a, b) => a.holdTimeSeconds - b.holdTimeSeconds).slice(0, 5).map((t, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="font-bold text-foreground">{t.symbol}</div>
                    <div className="text-[11px] text-muted-foreground">Entry: {format(new Date(t.entryTime), 'h:mm a')}</div>
                  </TableCell>
                  <TableCell className="text-sm font-medium text-rose-600">{t.holdTimeSeconds.toFixed(0)}s</TableCell>
                  <TableCell className="text-right text-sm font-medium text-muted-foreground">{t.fills.length} Fills</TableCell>
                  <TableCell className="text-right">
                    <div className="font-bold text-rose-600">-${Math.abs(t.realizedPnL).toFixed(2)}</div>
                    <div className="flex flex-col items-end gap-1 mt-1.5">
                      <Badge variant="negative" className="text-[9px] px-1.5 py-0">{t.tradeGrade} Quality</Badge>
                      {t.intentId && (
                        <Badge variant={t.isViolation ? "negative" : "positive"} className="text-[9px] px-1.5 py-0">
                          {t.isViolation ? "Rule Violated" : "Rule Followed"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredTrades.filter(t => !t.isWinner).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground italic">No losing trades recorded</TableCell>
                </TableRow>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      {/* Row 7: Re-entry + Scaling */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
            </div>
            <h3 className="font-bold text-foreground">Re-entry Trades</h3>
          </div>
          <div className="text-sm text-muted-foreground italic bg-muted/20 p-4 rounded-xl border border-dashed border-border/60 text-center">
            {filteredTrades.some(t => t.isReentry) ? (
              <div className="space-y-2">
                {filteredTrades.filter(t => t.isReentry).map(t => (
                  <div key={t.id} className="flex justify-between text-xs text-foreground font-bold">
                    <span>{t.id} ({t.symbol})</span>
                    <Badge variant="warning">Re-entry</Badge>
                  </div>
                ))}
              </div>
            ) : "No re-entry trades detected in this session."}
          </div>
        </Card>
        <Card>
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Target className="w-5 h-5 text-emerald-500" />
            </div>
            <h3 className="font-bold text-foreground">Scaled Trades</h3>
          </div>
          <div className="space-y-3">
            {filteredTrades.some(t => t.fills.length > 2) ? (
              filteredTrades.filter(t => t.fills.length > 2).map(t => (
                <div 
                  key={t.id}
                  onClick={() => handleAction('View Scaled Trade Details')}
                  className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/40 transition-colors hover:bg-muted/50 cursor-pointer"
                >
                  <span className="text-sm font-bold text-foreground">{t.id} ({t.symbol})</span>
                  <Badge variant="positive">{t.fills.length} Fills</Badge>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground italic bg-muted/20 p-4 rounded-xl border border-dashed border-border/60 text-center">
                No scaled trades detected in this session.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Row 7.5: Rule-Based AI Mentor */}
      <div className="mb-6">
        {ruleBasedInsight && (
          <RuleBasedMentor insight={ruleBasedInsight} />
        )}
      </div>

      {/* Row 9: Mentor + Journals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary/5 rounded-lg">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-bold text-foreground">Session Journal</h3>
            </div>
            <Button 
              variant="primary" 
              size="sm" 
              icon={isSavingJournal ? Loader2 : Save}
              onClick={saveSessionJournal}
              disabled={isSavingJournal}
            >
              {isSavingJournal ? 'Saving...' : 'Save Journal'}
            </Button>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session Category</label>
              <select
                className="w-full p-3 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={sessionJournal.sessionCategory}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, sessionCategory: e.target.value as typeof prev.sessionCategory }))}
              >
                <option value="">No category</option>
                <option value="NY_AM">NY AM</option>
                <option value="NY_PM">NY PM</option>
                <option value="ASIA">Asia</option>
                <option value="LONDON">London</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Premarket Plan</label>
              <DictationTextarea
                className="w-full h-24 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="What was your plan for today?"
                value={sessionJournal.premarketPlan}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, premarketPlan: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session Notes</label>
              <DictationTextarea
                className="w-full h-32 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="General notes about the session..."
                value={sessionJournal.sessionNotes}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, sessionNotes: e.target.value }))}
              />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center space-x-3 mb-8">
            <div className="p-2 bg-primary/5 rounded-lg">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-bold text-foreground">Self Review</h3>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">What went well?</label>
              <DictationTextarea
                className="w-full h-20 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
                placeholder="List your wins and good habits..."
                value={sessionJournal.whatWentWell}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, whatWentWell: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-rose-600">What hurt?</label>
              <DictationTextarea
                className="w-full h-20 p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none"
                placeholder="What mistakes did you make?"
                value={sessionJournal.whatHurt}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, whatHurt: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Corrective Action</label>
              <DictationTextarea
                className="w-full h-20 p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                placeholder="What will you do differently tomorrow?"
                value={sessionJournal.correctiveAction}
                onChange={(e) => setSessionJournal(prev => ({ ...prev, correctiveAction: e.target.value }))}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Row 10: Raw Reconstruction */}
      <Card noPadding className="border-border/60">
        <button 
          onClick={() => handleAction('View Raw Reconstruction')}
          className="w-full p-6 flex items-center justify-between hover:bg-muted/20 transition-all duration-200 group"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-muted/50 rounded-lg group-hover:bg-primary/10 transition-colors">
              <BarChart3 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-sm font-bold text-foreground">Raw Order Reconstruction</span>
          </div>
          <ChevronDown className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-all" />
        </button>
      </Card>

      <TradePerformanceLog 
        trades={filteredTrades} 
        title="Session Trade Logs"
        subtitle="Performance audit for this specific session"
      />

      {/* Toast Notification */}
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}
