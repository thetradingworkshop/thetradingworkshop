import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Badge, Button, Input, Modal, Table, TableHeader, TableRow, TableHead, TableCell, Toast } from '../components/Shared';
import { DictationTextarea } from '../components/DictationTextarea';
import { Rocket, Plus, TrendingUp, TrendingDown, Activity, Award, MoreVertical, Trash2, Archive, ArchiveRestore, Pencil, X, FlaskConical, Percent, Share2, Users, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTrades } from '../context/TradeContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { subscribeStrategies, subscribeSharedStrategies, createStrategy, updateStrategy, deleteStrategy } from '../lib/strategies';
import { subscribeStrategyTemplates, createStrategyTemplate, updateStrategyTemplate, deleteStrategyTemplate } from '../lib/strategyTemplates';
import { subscribeBacktestScenarios, createBacktestScenario, updateBacktestScenario, deleteBacktestScenario } from '../lib/backtestScenarios';
import { Strategy, StrategyCategory, StrategyTemplate, BacktestScenario } from '../types';

type SubTab = 'mine' | 'shared' | 'templates' | 'backtest';
const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'mine', label: 'My Strategies' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'templates', label: 'Templates' },
  { id: 'backtest', label: 'Backtest Scenarios' },
];

interface StrategyStats {
  trades: number;
  avgWinner: number;
  avgLoser: number;
  totalNetPnl: number;
  profitFactor: number | null; // null = N/A (no trades yet)
  winRate: number;
  followRate: number | null; // null = N/A — average % of *applicable* rules checked, across trades tagged to this strategy
  expectancy: number | null; // null = N/A — average P&L per trade
}

// A rule only counts toward a given trade's follow-rate denominator if it
// actually applies to that trade's outcome — matches TradeZella's "show
// rule only when" behavior (see StrategyRule.showWhen) so a winner-only
// rule doesn't drag down the score of every losing trade it was never
// relevant to.
function visibleRules(strategy: Strategy, outcome: 'winner' | 'loser' | 'breakeven'): { id: string }[] {
  return strategy.categories.flatMap(c => c.rules.filter(r => !r.showWhen || r.showWhen === 'always' || r.showWhen === outcome));
}

function computeStrategyStats(
  strategy: Strategy,
  trades: { strategyId?: string; pnlCurrency: number; strategyChecklist?: Record<string, boolean> }[]
): StrategyStats {
  const matching = trades.filter(t => t.strategyId === strategy.id);
  if (matching.length === 0) {
    return { trades: 0, avgWinner: 0, avgLoser: 0, totalNetPnl: 0, profitFactor: null, winRate: 0, followRate: null, expectancy: null };
  }
  const winners = matching.filter(t => t.pnlCurrency > 0);
  const losers = matching.filter(t => t.pnlCurrency < 0);
  const grossProfit = winners.reduce((s, t) => s + t.pnlCurrency, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnlCurrency, 0));
  const totalNetPnl = matching.reduce((s, t) => s + t.pnlCurrency, 0);

  const followRates = matching.map(t => {
    const outcome = t.pnlCurrency > 0 ? 'winner' : t.pnlCurrency < 0 ? 'loser' : 'breakeven';
    const applicable = visibleRules(strategy, outcome);
    if (applicable.length === 0) return null;
    const checked = applicable.filter(r => t.strategyChecklist?.[r.id]).length;
    return (checked / applicable.length) * 100;
  }).filter((v): v is number => v !== null);

  return {
    trades: matching.length,
    avgWinner: winners.length ? grossProfit / winners.length : 0,
    avgLoser: losers.length ? -grossLoss / losers.length : 0,
    totalNetPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    winRate: (winners.length / matching.length) * 100,
    followRate: followRates.length ? followRates.reduce((s, v) => s + v, 0) / followRates.length : null,
    expectancy: totalNetPnl / matching.length,
  };
}

const fmtMoney = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
const fmtPF = (pf: number | null) => (pf === null ? 'N/A' : pf === Infinity ? '∞' : pf.toFixed(2));
const fmtPct = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(0)}%`);

// Rule/category ids are generated client-side and never reused — Trade.
// strategyChecklist keys off these, not array position, specifically so
// reordering or editing a strategy's rules later doesn't retroactively
// corrupt what was already recorded as checked on past trades.
const newId = () => crypto.randomUUID();

type RuleShowWhen = 'always' | 'winner' | 'loser' | 'breakeven';
type DraftCategory = { id: string; name: string; rules: { id: string; text: string; showWhen: RuleShowWhen }[] };

const SHOW_WHEN_OPTIONS: { value: RuleShowWhen; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'winner', label: 'On winners' },
  { value: 'loser', label: 'On losers' },
  { value: 'breakeven', label: 'On breakeven' },
];

function emptyDraftCategories(): DraftCategory[] {
  return [{ id: newId(), name: '', rules: [{ id: newId(), text: '', showWhen: 'always' }] }];
}

// Reconstructs editable draft state from an existing strategy's saved
// categories/rules — reusing the exact same ids so editing rule text
// doesn't orphan any past trade's already-recorded strategyChecklist
// (which keys off these ids, not array position).
function draftFromStrategy(s: { categories: StrategyCategory[] }): DraftCategory[] {
  if (s.categories.length === 0) return emptyDraftCategories();
  return s.categories.map(c => ({
    id: c.id,
    name: c.name,
    rules: c.rules.length ? c.rules.map(r => ({ id: r.id, text: r.text, showWhen: r.showWhen ?? 'always' })) : [{ id: newId(), text: '', showWhen: 'always' as RuleShowWhen }],
  }));
}

export default function StrategiesScreen() {
  const { user, role } = useAuth();
  // filteredTrades (not the raw, all-accounts/all-symbols `trades`) so a
  // strategy's stats respect the header's Filters/Account selection —
  // this page used to silently ignore both, mixing every account and
  // symbol into one number regardless of what the user had selected.
  const { filteredTrades: trades } = useTrades();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [scenarios, setScenarios] = useState<BacktestScenario[]>([]);
  const [subTab, setSubTab] = useState<SubTab>('mine');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  // null = closed, 'new' = Create Strategy modal, a Strategy = editing that
  // one (the form modal is shared between both — see StrategyFormModal).
  const [formTarget, setFormTarget] = useState<'new' | Strategy | null>(null);
  // Same null/'new'/target convention as formTarget above, for the Backtest
  // Scenario form.
  const [scenarioFormTarget, setScenarioFormTarget] = useState<'new' | BacktestScenario | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteScenarioId, setPendingDeleteScenarioId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // "Shared with me" — strategies the signed-in user's own mentor has opted
  // into sharing. AuthContext doesn't expose mentorId, so look it up once
  // here (same pattern SettingsScreen uses for riskSettings).
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [sharedStrategies, setSharedStrategies] = useState<Strategy[]>([]);
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [templateFormTarget, setTemplateFormTarget] = useState<'new' | StrategyTemplate | null>(null);
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeStrategies(user.uid, setStrategies);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeBacktestScenarios(user.uid, setScenarios);
  }, [user]);

  useEffect(() => {
    if (!user) { setMentorId(null); return; }
    getDoc(doc(db, 'users', user.uid)).then(snap => setMentorId(snap.data()?.mentorId ?? null));
  }, [user]);

  useEffect(() => {
    if (!mentorId) { setSharedStrategies([]); return; }
    return subscribeSharedStrategies(mentorId, setSharedStrategies);
  }, [mentorId]);

  useEffect(() => subscribeStrategyTemplates(setTemplates), []);

  const statsById = useMemo(() => {
    const map = new Map<string, StrategyStats>();
    for (const s of strategies) map.set(s.id, computeStrategyStats(s, trades));
    return map;
  }, [strategies, trades]);

  const visibleStrategies = strategies.filter(s => s.status === statusFilter);

  const withTrades = strategies.filter(s => (statsById.get(s.id)?.trades ?? 0) > 0);
  const bestPerforming = withTrades.length
    ? withTrades.reduce((a, b) => ((statsById.get(b.id)?.totalNetPnl ?? 0) > (statsById.get(a.id)?.totalNetPnl ?? 0) ? b : a))
    : null;
  const leastPerforming = withTrades.length
    ? withTrades.reduce((a, b) => ((statsById.get(b.id)?.totalNetPnl ?? 0) < (statsById.get(a.id)?.totalNetPnl ?? 0) ? b : a))
    : null;
  const mostActive = strategies.length
    ? strategies.reduce((a, b) => ((statsById.get(b.id)?.trades ?? 0) > (statsById.get(a.id)?.trades ?? 0) ? b : a))
    : null;
  const bestWinRate = withTrades.length
    ? withTrades.reduce((a, b) => ((statsById.get(b.id)?.winRate ?? 0) > (statsById.get(a.id)?.winRate ?? 0) ? b : a))
    : null;

  const handleSubmitForm = async (name: string, icon: string, description: string, categories: DraftCategory[]) => {
    if (!user || !formTarget) return;
    const cleanCategories: StrategyCategory[] = categories
      .filter(c => c.name.trim())
      .map(c => ({
        id: c.id,
        name: c.name.trim(),
        rules: c.rules.filter(r => r.text.trim()).map(r => ({ id: r.id, text: r.text.trim(), ...(r.showWhen !== 'always' ? { showWhen: r.showWhen } : {}) })),
      }));
    try {
      if (formTarget === 'new') {
        await createStrategy(user.uid, name.trim(), icon.trim() || undefined, description.trim() || undefined, cleanCategories);
        setToast({ message: 'Strategy created', type: 'success' });
      } else {
        await updateStrategy(formTarget.id, { name: name.trim(), icon: icon.trim(), description: description.trim(), categories: cleanCategories });
        setToast({ message: 'Strategy updated', type: 'success' });
      }
      setFormTarget(null);
    } catch (err) {
      console.error('Failed to save strategy:', err);
      setToast({ message: formTarget === 'new' ? 'Failed to create strategy' : 'Failed to update strategy', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const toggleArchive = async (s: Strategy) => {
    setOpenMenuId(null);
    try {
      await updateStrategy(s.id, { status: s.status === 'active' ? 'archived' : 'active' });
    } catch (err) {
      console.error('Failed to update strategy:', err);
      setToast({ message: 'Failed to update strategy', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const toggleShare = async (s: Strategy) => {
    setOpenMenuId(null);
    try {
      await updateStrategy(s.id, { sharedWithStudents: !s.sharedWithStudents });
      setToast({ message: s.sharedWithStudents ? 'Unshared from students' : 'Shared with your students', type: 'success' });
    } catch (err) {
      console.error('Failed to update strategy:', err);
      setToast({ message: 'Failed to update strategy', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleUseTemplate = async (t: StrategyTemplate) => {
    if (!user) return;
    try {
      await createStrategy(user.uid, t.name, t.icon, t.description, t.categories);
      setToast({ message: `"${t.name}" added to My Strategies`, type: 'success' });
    } catch (err) {
      console.error('Failed to use template:', err);
      setToast({ message: 'Failed to add strategy from template', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleSubmitTemplate = async (name: string, icon: string, description: string, categories: DraftCategory[]) => {
    if (!templateFormTarget) return;
    const cleanCategories: StrategyCategory[] = categories
      .filter(c => c.name.trim())
      .map(c => ({
        id: c.id,
        name: c.name.trim(),
        rules: c.rules.filter(r => r.text.trim()).map(r => ({ id: r.id, text: r.text.trim(), ...(r.showWhen !== 'always' ? { showWhen: r.showWhen } : {}) })),
      }));
    try {
      if (templateFormTarget === 'new') {
        await createStrategyTemplate(name.trim(), icon.trim() || undefined, description.trim() || undefined, cleanCategories);
        setToast({ message: 'Template created', type: 'success' });
      } else {
        await updateStrategyTemplate(templateFormTarget.id, { name: name.trim(), icon: icon.trim(), description: description.trim(), categories: cleanCategories });
        setToast({ message: 'Template updated', type: 'success' });
      }
      setTemplateFormTarget(null);
    } catch (err) {
      console.error('Failed to save template:', err);
      setToast({ message: templateFormTarget === 'new' ? 'Failed to create template' : 'Failed to update template', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDeleteTemplate = async () => {
    if (!pendingDeleteTemplateId) return;
    try {
      await deleteStrategyTemplate(pendingDeleteTemplateId);
      setToast({ message: 'Template deleted', type: 'success' });
    } catch (err) {
      console.error('Failed to delete template:', err);
      setToast({ message: 'Failed to delete template', type: 'error' });
    } finally {
      setPendingDeleteTemplateId(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteStrategy(pendingDeleteId);
      setToast({ message: 'Strategy deleted', type: 'success' });
    } catch (err) {
      console.error('Failed to delete strategy:', err);
      setToast({ message: 'Failed to delete strategy', type: 'error' });
    } finally {
      setPendingDeleteId(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleSubmitScenario = async (fields: {
    symbol: string; direction: 'long' | 'short'; setupDate: string; pnl: number;
    strategyId?: string; notes?: string; strategyChecklist?: Record<string, boolean>;
  }) => {
    if (!user || !scenarioFormTarget) return;
    try {
      if (scenarioFormTarget === 'new') {
        await createBacktestScenario(user.uid, fields);
        setToast({ message: 'Backtest scenario logged', type: 'success' });
      } else {
        await updateBacktestScenario(scenarioFormTarget.id, fields);
        setToast({ message: 'Backtest scenario updated', type: 'success' });
      }
      setScenarioFormTarget(null);
    } catch (err) {
      console.error('Failed to save backtest scenario:', err);
      setToast({ message: 'Failed to save backtest scenario', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDeleteScenario = async () => {
    if (!pendingDeleteScenarioId) return;
    try {
      await deleteBacktestScenario(pendingDeleteScenarioId);
      setToast({ message: 'Scenario deleted', type: 'success' });
    } catch (err) {
      console.error('Failed to delete scenario:', err);
      setToast({ message: 'Failed to delete scenario', type: 'error' });
    } finally {
      setPendingDeleteScenarioId(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const scenarioStats = useMemo(() => {
    const winners = scenarios.filter(s => s.pnl > 0);
    const totalPnl = scenarios.reduce((sum, s) => sum + s.pnl, 0);
    return {
      count: scenarios.length,
      winRate: scenarios.length ? (winners.length / scenarios.length) * 100 : 0,
      totalPnl,
      avgPnl: scenarios.length ? totalPnl / scenarios.length : 0,
    };
  }, [scenarios]);

  const strategyNameById = useMemo(() => new Map(strategies.map(s => [s.id, s])), [strategies]);

  return (
    <div className="space-y-6 pb-20">
      <SectionHeader
        title="Strategies"
        subtitle="Reusable playbooks — define your entry/exit criteria once, then check off how much of it you actually followed on each trade."
        rightElement={
          subTab === 'mine' ? <Button variant="primary" icon={Plus} onClick={() => setFormTarget('new')}>Create Strategy</Button>
          : subTab === 'backtest' ? <Button variant="primary" icon={Plus} onClick={() => setScenarioFormTarget('new')}>Log Scenario</Button>
          : subTab === 'templates' && role === 'Admin' ? <Button variant="primary" icon={Plus} onClick={() => setTemplateFormTarget('new')}>New Template</Button>
          : undefined
        }
      />

      <div className="flex items-center gap-1 border-b border-border/60 -mt-2">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={cn(
              "px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors",
              subTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}{t.id === 'mine' ? ` (${strategies.length})` : ''}
          </button>
        ))}
      </div>

      {subTab === 'backtest' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SummaryCard icon={FlaskConical} iconClass="text-indigo-500 bg-indigo-500/10" label="Scenarios logged" strategy={null} stat={`${scenarioStats.count}`} detail={scenarioStats.count ? 'hypothetical trades' : 'Log your first one'} />
            <SummaryCard icon={Percent} iconClass="text-amber-500 bg-amber-500/10" label="Hypothetical win rate" strategy={null} stat={scenarioStats.count ? `${scenarioStats.winRate.toFixed(0)}%` : '—'} detail="across all scenarios" />
            <SummaryCard icon={TrendingUp} iconClass="text-emerald-500 bg-emerald-500/10" label="Total hypothetical P&L" strategy={null} stat={scenarioStats.count ? fmtMoney(scenarioStats.totalPnl) : '—'} detail="" />
            <SummaryCard icon={Activity} iconClass="text-rose-500 bg-rose-500/10" label="Avg P&L per scenario" strategy={null} stat={scenarioStats.count ? fmtMoney(scenarioStats.avgPnl) : '—'} detail="" />
          </div>

          <Card noPadding>
            <div className="p-4 border-b border-border/60">
              <p className="text-xs text-muted-foreground">
                Replay a setup you remember — or one from a chart screenshot or the Day View replay — and log what would have happened. No live market data is pulled in; this is for validating a strategy's edge before risking capital, the same way you'd backtest on paper.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Strategy tested</TableHead>
                  <TableHead className="text-right">Follow rate</TableHead>
                  <TableHead className="text-right">Hypothetical P&L</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <tbody>
                {scenarios.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground italic">
                      No backtest scenarios yet — log your first hypothetical trade.
                    </TableCell>
                  </TableRow>
                )}
                {[...scenarios].sort((a, b) => b.setupDate.localeCompare(a.setupDate)).map(s => {
                  const strategy = s.strategyId ? strategyNameById.get(s.strategyId) : undefined;
                  const applicable = strategy ? strategy.categories.flatMap(c => c.rules) : [];
                  const checked = applicable.filter(r => s.strategyChecklist?.[r.id]).length;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-nowrap">{s.setupDate}</TableCell>
                      <TableCell className="font-bold">{s.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={s.direction === 'long' ? 'positive' : 'negative'}>{s.direction === 'long' ? 'Long' : 'Short'}</Badge>
                      </TableCell>
                      <TableCell>
                        {strategy ? (
                          <span className="flex items-center gap-1.5">{strategy.icon || '📈'} {strategy.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{applicable.length ? `${checked}/${applicable.length}` : 'N/A'}</TableCell>
                      <TableCell className={cn("text-right font-bold", s.pnl > 0 ? "text-emerald-500" : s.pnl < 0 ? "text-rose-500" : "text-muted-foreground")}>
                        {fmtMoney(s.pnl)}
                      </TableCell>
                      <TableCell className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === s.id ? null : `scenario:${s.id}`); }}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenuId === `scenario:${s.id}` && (
                          <div className="absolute right-4 top-10 z-20 w-36 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                            <button
                              onClick={() => { setOpenMenuId(null); setScenarioFormTarget(s); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left hover:bg-accent transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => { setOpenMenuId(null); setPendingDeleteScenarioId(s.id); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </>
      ) : subTab === 'shared' ? (
        sharedStrategies.length === 0 ? (
          <Card className="text-center py-16">
            <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground italic">
              {mentorId ? "Your mentor hasn't shared any strategies yet." : 'Nothing shared yet — this fills in once your mentor shares a strategy with you.'}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sharedStrategies.map(s => (
              <Card key={s.id}>
                <div className="flex items-center gap-2 font-bold text-foreground mb-1">
                  <span>{s.icon || '📈'}</span>
                  {s.name}
                  <Badge variant="neutral" className="text-[10px]">From your mentor</Badge>
                </div>
                {s.description && <p className="text-xs text-muted-foreground mb-3">{s.description}</p>}
                <div className="space-y-3">
                  {s.categories.map(c => (
                    <div key={c.id}>
                      <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1">{c.name}</p>
                      <ul className="space-y-1">
                        {c.rules.map(r => (
                          <li key={r.id} className="text-sm text-foreground/90 flex items-start gap-1.5">
                            <span className="text-muted-foreground mt-0.5">&bull;</span>{r.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : subTab === 'templates' ? (
        templates.length === 0 ? (
          <Card className="text-center py-16">
            <Sparkles className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground italic">
              {role === 'Admin' ? 'No templates yet — create one for everyone to use.' : 'No templates published yet.'}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map(t => (
              <Card key={t.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 font-bold text-foreground">
                    <span>{t.icon || '📈'}</span>
                    {t.name}
                  </div>
                  {role === 'Admin' && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setTemplateFormTarget(t)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" aria-label="Edit template">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setPendingDeleteTemplateId(t.id)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500" aria-label="Delete template">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {t.description && <p className="text-xs text-muted-foreground mb-3">{t.description}</p>}
                <p className="text-[11px] text-muted-foreground mb-3">{t.categories.length} categories · {t.categories.reduce((n, c) => n + c.rules.length, 0)} rules</p>
                <Button variant="outline" size="sm" onClick={() => handleUseTemplate(t)}>Use this template</Button>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SummaryCard icon={TrendingUp} iconClass="text-emerald-500 bg-emerald-500/10" label="Best performing strategy" strategy={bestPerforming} stat={bestPerforming ? fmtMoney(statsById.get(bestPerforming.id)!.totalNetPnl) : '—'} detail={bestPerforming ? `${statsById.get(bestPerforming.id)!.trades} trades` : 'No trades yet'} />
            <SummaryCard icon={TrendingDown} iconClass="text-rose-500 bg-rose-500/10" label="Least performing strategy" strategy={leastPerforming} stat={leastPerforming ? fmtMoney(statsById.get(leastPerforming.id)!.totalNetPnl) : '—'} detail={leastPerforming ? `${statsById.get(leastPerforming.id)!.trades} trades` : 'No trades yet'} />
            <SummaryCard icon={Activity} iconClass="text-indigo-500 bg-indigo-500/10" label="Most active strategy" strategy={mostActive} stat={mostActive ? `${statsById.get(mostActive.id)!.trades} trades` : '—'} detail={mostActive ? '' : 'No strategies yet'} />
            <SummaryCard icon={Award} iconClass="text-amber-500 bg-amber-500/10" label="Best win rate" strategy={bestWinRate} stat={bestWinRate ? `${statsById.get(bestWinRate.id)!.winRate.toFixed(2)}%` : '—'} detail={bestWinRate ? `${statsById.get(bestWinRate.id)!.trades} trades` : 'No trades yet'} />
          </div>

          <Card noPadding>
            <div className="flex items-center gap-2 p-4 border-b border-border/60">
              {(['active', 'archived'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-colors",
                    statusFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Average loser</TableHead>
                  <TableHead className="text-right">Average winner</TableHead>
                  <TableHead className="text-right">Total net P&L</TableHead>
                  <TableHead className="text-right">Profit factor</TableHead>
                  <TableHead className="text-right">Expectancy</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                  <TableHead className="text-right">Follow rate</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <tbody>
                {visibleStrategies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground italic">
                      {statusFilter === 'active' ? 'No strategies yet — create your first one.' : 'No archived strategies.'}
                    </TableCell>
                  </TableRow>
                )}
                {visibleStrategies.map(s => {
                  const stats = statsById.get(s.id)!;
                  const ruleCount = s.categories.reduce((n, c) => n + c.rules.length, 0);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-bold text-foreground">
                          <span>{s.icon || '📈'}</span>
                          {s.name}
                          {role === 'Mentor' && s.sharedWithStudents && (
                            <Badge variant="positive" className="text-[10px]">Shared</Badge>
                          )}
                        </div>
                        {s.description && <div className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">{s.description}</div>}
                        <div className="text-[11px] text-muted-foreground mt-0.5">{s.categories.length} categories · {ruleCount} rules</div>
                      </TableCell>
                      <TableCell className="text-right text-rose-500 font-medium">{stats.trades ? fmtMoney(stats.avgLoser) : '$0'}</TableCell>
                      <TableCell className="text-right text-emerald-500 font-medium">{stats.trades ? fmtMoney(stats.avgWinner) : '$0'}</TableCell>
                      <TableCell className={cn("text-right font-bold", stats.totalNetPnl > 0 ? "text-emerald-500" : stats.totalNetPnl < 0 ? "text-rose-500" : "text-muted-foreground")}>
                        {stats.trades ? fmtMoney(stats.totalNetPnl) : '$0'}
                      </TableCell>
                      <TableCell className="text-right">{fmtPF(stats.profitFactor)}</TableCell>
                      <TableCell className={cn("text-right", stats.expectancy !== null && stats.expectancy < 0 && "text-rose-500")}>
                        {stats.expectancy === null ? 'N/A' : fmtMoney(stats.expectancy)}
                      </TableCell>
                      <TableCell className="text-right">{stats.trades}</TableCell>
                      <TableCell className="text-right">{stats.trades ? `${stats.winRate.toFixed(0)}%` : '0%'}</TableCell>
                      <TableCell className="text-right">{fmtPct(stats.followRate)}</TableCell>
                      <TableCell className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === s.id ? null : s.id); }}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenuId === s.id && (
                          <div className="absolute right-4 top-10 z-20 w-44 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                            <button
                              onClick={() => { setOpenMenuId(null); setFormTarget(s); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left hover:bg-accent transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            {role === 'Mentor' && (
                              <button
                                onClick={() => toggleShare(s)}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left hover:bg-accent transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                {s.sharedWithStudents ? 'Unshare from students' : 'Share with students'}
                              </button>
                            )}
                            <button
                              onClick={() => toggleArchive(s)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left hover:bg-accent transition-colors"
                            >
                              {s.status === 'active' ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                              {s.status === 'active' ? 'Archive' : 'Unarchive'}
                            </button>
                            <button
                              onClick={() => { setOpenMenuId(null); setPendingDeleteId(s.id); }}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <StrategyFormModal target={formTarget} onClose={() => setFormTarget(null)} onSubmit={handleSubmitForm} />

      <StrategyTemplateFormModal target={templateFormTarget} onClose={() => setTemplateFormTarget(null)} onSubmit={handleSubmitTemplate} />

      <BacktestScenarioFormModal
        target={scenarioFormTarget}
        strategies={strategies.filter(s => s.status === 'active')}
        onClose={() => setScenarioFormTarget(null)}
        onSubmit={handleSubmitScenario}
      />

      <Modal
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        title="Delete strategy?"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" icon={Trash2} onClick={confirmDelete}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          This removes the strategy itself. Trades already tagged with it keep their recorded checklist, but the rule text and category names won't be viewable anymore since they only ever lived on the strategy.
        </p>
      </Modal>

      <Modal
        isOpen={pendingDeleteScenarioId !== null}
        onClose={() => setPendingDeleteScenarioId(null)}
        title="Delete backtest scenario?"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteScenarioId(null)}>Cancel</Button>
            <Button variant="destructive" icon={Trash2} onClick={confirmDeleteScenario}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This permanently removes this logged scenario.</p>
      </Modal>

      <Modal
        isOpen={pendingDeleteTemplateId !== null}
        onClose={() => setPendingDeleteTemplateId(null)}
        title="Delete template?"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteTemplateId(null)}>Cancel</Button>
            <Button variant="destructive" icon={Trash2} onClick={confirmDeleteTemplate}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This removes the template from the catalog. Anyone who already used it to create their own strategy keeps that copy.</p>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function SummaryCard({ icon: Icon, iconClass, label, strategy, stat, detail }: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  strategy: Strategy | null;
  stat: string;
  detail: string;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", iconClass)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</p>
      <p className="text-lg font-bold mt-1 text-foreground flex items-center gap-1.5 truncate">
        {strategy ? (strategy.icon || '📈') : null} {strategy ? strategy.name : 'No strategies yet'}
      </p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-sm font-bold text-foreground">{stat}</span>
        <span className="text-[11px] text-muted-foreground">{detail}</span>
      </div>
    </Card>
  );
}

function StrategyFormModal({ target, onClose, onSubmit }: {
  target: 'new' | Strategy | null;
  onClose: () => void;
  onSubmit: (name: string, icon: string, description: string, categories: DraftCategory[]) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<DraftCategory[]>(emptyDraftCategories());
  const [error, setError] = useState<string | null>(null);
  const isEditing = target !== null && target !== 'new';

  // Re-seed whenever what's being edited changes — covers both "just
  // opened" (target flips from null) and switching straight from editing
  // one strategy to another without the modal fully closing in between.
  useEffect(() => {
    if (target === 'new') {
      setName('');
      setIcon('');
      setDescription('');
      setCategories(emptyDraftCategories());
    } else if (target) {
      setName(target.name);
      setIcon(target.icon ?? '');
      setDescription(target.description ?? '');
      setCategories(draftFromStrategy(target));
    }
    setError(null);
  }, [target]);

  const addCategory = () => setCategories(prev => [...prev, { id: newId(), name: '', rules: [{ id: newId(), text: '', showWhen: 'always' as RuleShowWhen }] }]);
  const removeCategory = (id: string) => setCategories(prev => prev.filter(c => c.id !== id));
  const renameCategory = (id: string, value: string) => setCategories(prev => prev.map(c => (c.id === id ? { ...c, name: value } : c)));
  const addRule = (categoryId: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: [...c.rules, { id: newId(), text: '', showWhen: 'always' as RuleShowWhen }] } : c)));
  const removeRule = (categoryId: string, ruleId: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.filter(r => r.id !== ruleId) } : c)));
  const editRule = (categoryId: string, ruleId: string, value: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.map(r => (r.id === ruleId ? { ...r, text: value } : r)) } : c)));
  const editRuleShowWhen = (categoryId: string, ruleId: string, value: RuleShowWhen) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.map(r => (r.id === ruleId ? { ...r, showWhen: value } : r)) } : c)));

  const handleSubmit = () => {
    if (!name.trim()) { setError('Give this strategy a name.'); return; }
    const hasAnyRule = categories.some(c => c.name.trim() && c.rules.some(r => r.text.trim()));
    if (!hasAnyRule) { setError('Add at least one category with one rule.'); return; }
    onSubmit(name, icon, description, categories);
  };

  return (
    <Modal isOpen={target !== null} onClose={onClose} title={isEditing ? 'Edit Strategy' : 'Create Strategy'} maxWidth="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_100px] gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raw - Price in Action" autoFocus />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Icon</label>
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📈" maxLength={2} />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">
            Description <span className="normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <DictationTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this strategy, and when do you use it?"
            className="w-full h-20 p-3 bg-accent/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
          {categories.map(cat => (
            <div key={cat.id} className="p-4 rounded-2xl border border-border bg-accent/20 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  placeholder="Category name — e.g. Entry Criteria"
                  className="font-bold"
                />
                {categories.length > 1 && (
                  <button onClick={() => removeCategory(cat.id)} className="p-2 text-muted-foreground hover:text-rose-500 shrink-0" aria-label="Remove category">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2 pl-2">
                {cat.rules.map(rule => (
                  <div key={rule.id} className="flex items-center gap-2">
                    <Input
                      value={rule.text}
                      onChange={(e) => editRule(cat.id, rule.id, e.target.value)}
                      placeholder="Rule text — e.g. Clear shift (Displacement) in pre-determined area"
                      className="text-sm flex-1"
                    />
                    <select
                      value={rule.showWhen}
                      onChange={(e) => editRuleShowWhen(cat.id, rule.id, e.target.value as RuleShowWhen)}
                      title="Only show/count this rule when the trade matches this outcome"
                      className="h-9 shrink-0 rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {SHOW_WHEN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    {cat.rules.length > 1 && (
                      <button onClick={() => removeRule(cat.id, rule.id)} className="p-1.5 text-muted-foreground hover:text-rose-500 shrink-0" aria-label="Remove rule">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => addRule(cat.id)} className="text-xs font-bold text-primary hover:underline">+ Add rule</button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addCategory} className="text-xs font-bold text-primary hover:underline">+ Add category</button>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Rocket} onClick={handleSubmit}>{isEditing ? 'Save Changes' : 'Create Strategy'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Admin-only — creates/edits a catalog entry in strategy_templates, not a
// personal Strategy. Same category/rule editing UI as StrategyFormModal
// (reuses DraftCategory/draftFromStrategy/emptyDraftCategories), just
// without status/ownership since templates have neither.
function StrategyTemplateFormModal({ target, onClose, onSubmit }: {
  target: 'new' | StrategyTemplate | null;
  onClose: () => void;
  onSubmit: (name: string, icon: string, description: string, categories: DraftCategory[]) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<DraftCategory[]>(emptyDraftCategories());
  const [error, setError] = useState<string | null>(null);
  const isEditing = target !== null && target !== 'new';

  useEffect(() => {
    if (target === 'new') {
      setName('');
      setIcon('');
      setDescription('');
      setCategories(emptyDraftCategories());
    } else if (target) {
      setName(target.name);
      setIcon(target.icon ?? '');
      setDescription(target.description ?? '');
      setCategories(draftFromStrategy(target));
    }
    setError(null);
  }, [target]);

  const addCategory = () => setCategories(prev => [...prev, { id: newId(), name: '', rules: [{ id: newId(), text: '', showWhen: 'always' as RuleShowWhen }] }]);
  const removeCategory = (id: string) => setCategories(prev => prev.filter(c => c.id !== id));
  const renameCategory = (id: string, value: string) => setCategories(prev => prev.map(c => (c.id === id ? { ...c, name: value } : c)));
  const addRule = (categoryId: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: [...c.rules, { id: newId(), text: '', showWhen: 'always' as RuleShowWhen }] } : c)));
  const removeRule = (categoryId: string, ruleId: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.filter(r => r.id !== ruleId) } : c)));
  const editRule = (categoryId: string, ruleId: string, value: string) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.map(r => (r.id === ruleId ? { ...r, text: value } : r)) } : c)));
  const editRuleShowWhen = (categoryId: string, ruleId: string, value: RuleShowWhen) => setCategories(prev => prev.map(c => (c.id === categoryId ? { ...c, rules: c.rules.map(r => (r.id === ruleId ? { ...r, showWhen: value } : r)) } : c)));

  const handleSubmit = () => {
    if (!name.trim()) { setError('Give this template a name.'); return; }
    const hasAnyRule = categories.some(c => c.name.trim() && c.rules.some(r => r.text.trim()));
    if (!hasAnyRule) { setError('Add at least one category with one rule.'); return; }
    onSubmit(name, icon, description, categories);
  };

  return (
    <Modal isOpen={target !== null} onClose={onClose} title={isEditing ? 'Edit Template' : 'New Template'} maxWidth="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_100px] gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opening Range Breakout" autoFocus />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Icon</label>
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="📈" maxLength={2} />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">
            Description <span className="normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <DictationTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this strategy, and when do you use it?"
            className="w-full h-20 p-3 bg-accent/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
          {categories.map(cat => (
            <div key={cat.id} className="p-4 rounded-2xl border border-border bg-accent/20 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  placeholder="Category name — e.g. Entry Criteria"
                  className="font-bold"
                />
                {categories.length > 1 && (
                  <button onClick={() => removeCategory(cat.id)} className="p-2 text-muted-foreground hover:text-rose-500 shrink-0" aria-label="Remove category">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2 pl-2">
                {cat.rules.map(rule => (
                  <div key={rule.id} className="flex items-center gap-2">
                    <Input
                      value={rule.text}
                      onChange={(e) => editRule(cat.id, rule.id, e.target.value)}
                      placeholder="Rule text — e.g. Clear shift (Displacement) in pre-determined area"
                      className="text-sm flex-1"
                    />
                    <select
                      value={rule.showWhen}
                      onChange={(e) => editRuleShowWhen(cat.id, rule.id, e.target.value as RuleShowWhen)}
                      title="Only show/count this rule when the trade matches this outcome"
                      className="h-9 shrink-0 rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {SHOW_WHEN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    {cat.rules.length > 1 && (
                      <button onClick={() => removeRule(cat.id, rule.id)} className="p-1.5 text-muted-foreground hover:text-rose-500 shrink-0" aria-label="Remove rule">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => addRule(cat.id)} className="text-xs font-bold text-primary hover:underline">+ Add rule</button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addCategory} className="text-xs font-bold text-primary hover:underline">+ Add category</button>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Rocket} onClick={handleSubmit}>{isEditing ? 'Save Changes' : 'Create Template'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function BacktestScenarioFormModal({ target, strategies, onClose, onSubmit }: {
  target: 'new' | BacktestScenario | null;
  strategies: Strategy[];
  onClose: () => void;
  onSubmit: (fields: {
    symbol: string; direction: 'long' | 'short'; setupDate: string; pnl: number;
    strategyId?: string; notes?: string; strategyChecklist?: Record<string, boolean>;
  }) => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [setupDate, setSetupDate] = useState(new Date().toISOString().slice(0, 10));
  const [pnl, setPnl] = useState('');
  const [strategyId, setStrategyId] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const isEditing = target !== null && target !== 'new';

  useEffect(() => {
    if (target === 'new') {
      setSymbol('');
      setDirection('long');
      setSetupDate(new Date().toISOString().slice(0, 10));
      setPnl('');
      setStrategyId('');
      setNotes('');
      setChecklist({});
    } else if (target) {
      setSymbol(target.symbol);
      setDirection(target.direction);
      setSetupDate(target.setupDate);
      setPnl(String(target.pnl));
      setStrategyId(target.strategyId ?? '');
      setNotes(target.notes ?? '');
      setChecklist(target.strategyChecklist ?? {});
    }
    setError(null);
  }, [target]);

  const selectedStrategy = strategies.find(s => s.id === strategyId) ?? null;
  const rules = selectedStrategy ? selectedStrategy.categories.flatMap(c => c.rules.map(r => ({ ...r, category: c.name }))) : [];

  const handleSubmit = () => {
    if (!symbol.trim()) { setError('Give this scenario a symbol.'); return; }
    if (!setupDate) { setError('Pick the date this setup is based on.'); return; }
    const pnlNum = Number(pnl);
    if (pnl.trim() === '' || Number.isNaN(pnlNum)) { setError('Enter a hypothetical P&L (can be negative).'); return; }
    onSubmit({
      symbol: symbol.trim().toUpperCase(),
      direction,
      setupDate,
      pnl: pnlNum,
      ...(strategyId ? { strategyId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(strategyId && Object.keys(checklist).length ? { strategyChecklist: checklist } : {}),
    });
  };

  return (
    <Modal isOpen={target !== null} onClose={onClose} title={isEditing ? 'Edit Backtest Scenario' : 'Log Backtest Scenario'} maxWidth="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_120px_140px] gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Symbol</label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. MNQ" autoFocus />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'long' | 'short')}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Setup date</label>
            <Input type="date" value={setupDate} onChange={(e) => setSetupDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-[140px_1fr] gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Hypothetical P&L</label>
            <Input type="number" step="0.01" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="e.g. 240 or -85" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Strategy tested <span className="normal-case text-muted-foreground/70">(optional)</span></label>
            <select
              value={strategyId}
              onChange={(e) => { setStrategyId(e.target.value); setChecklist({}); }}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {strategies.map(s => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
            </select>
          </div>
        </div>

        {rules.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Rules followed in this scenario</label>
            <div className="max-h-48 overflow-y-auto space-y-1.5 p-3 rounded-xl border border-border bg-accent/20">
              {rules.map(r => (
                <label key={r.id} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!checklist[r.id]}
                    onChange={(e) => setChecklist(prev => ({ ...prev, [r.id]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-muted-foreground">{r.category}:</span> {r.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Notes <span className="normal-case text-muted-foreground/70">(optional)</span></label>
          <DictationTextarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What setup is this? What would you have done differently?"
            className="w-full h-20 p-3 bg-accent/30 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="flex justify-end space-x-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={FlaskConical} onClick={handleSubmit}>{isEditing ? 'Save Changes' : 'Log Scenario'}</Button>
        </div>
      </div>
    </Modal>
  );
}
