import React, { useState, useMemo, useEffect } from 'react';
import { cn } from '@/src/utils';
import { Card, Badge, Button, Input, Toast } from './Shared';
import { 
  Search, 
  Filter, 
  ArrowUpDown, 
  ChevronRight, 
  X,
  Zap,
  Clock,
  Target,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Tag,
  Flag
} from 'lucide-react';
import { Trade, TradeReview } from '../types';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

interface TradePerformanceLogProps {
  trades: Trade[];
  onAddJournal?: (trade: Trade) => void;
  title?: string;
  subtitle?: string;
}

export function TradePerformanceLog({ trades, onAddJournal, title, subtitle }: TradePerformanceLogProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Review State
  const [review, setReview] = useState<Partial<TradeReview>>({
    tradeGrade: 'B',
    executionQuality: 50,
    strategyQuality: 50,
    entryQuality: 50,
    exitQuality: 50,
    timingScore: 50,
    behaviorFlags: [],
    tags: [],
    verdict: '',
    lessonLearned: '',
    diagnostics: undefined
  });
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isLoadingReview, setIsLoadingReview] = useState(false);

  const filteredTrades = useMemo(() => {
    return trades.filter(t => 
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.id.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
  }, [trades, searchQuery]);

  // Load review when trade is selected
  useEffect(() => {
    if (!selectedTrade || !user) return;

    const loadReview = async () => {
      setIsLoadingReview(true);
      try {
        const reviewRef = doc(db, 'trade_reviews', selectedTrade.id);
        const reviewSnap = await getDoc(reviewRef);
        if (reviewSnap.exists()) {
          setReview(reviewSnap.data() as TradeReview);
        } else {
          // Initialize with trade data if available
          setReview({
            tradeGrade: selectedTrade.tradeGrade || 'B',
            executionQuality: selectedTrade.executionQuality || 50,
            strategyQuality: selectedTrade.strategyQuality || 50,
            entryQuality: selectedTrade.entryQuality || 50,
            exitQuality: selectedTrade.exitQuality || 50,
            timingScore: selectedTrade.timingScore || 50,
            behaviorFlags: selectedTrade.behaviorFlags || [],
            tags: selectedTrade.tags || [],
            verdict: selectedTrade.verdict || '',
            lessonLearned: selectedTrade.lessonLearned || '',
            diagnostics: selectedTrade.diagnostics
          });
        }
      } catch (error) {
        console.error('Error loading trade review:', error);
      } finally {
        setIsLoadingReview(false);
      }
    };

    loadReview();
  }, [selectedTrade, user]);

  const saveReview = async () => {
    if (!selectedTrade || !user) return;
    setIsSavingReview(true);
    try {
      const reviewRef = doc(db, 'trade_reviews', selectedTrade.id);
      const reviewData = {
        ...review,
        tradeId: selectedTrade.id,
        sessionId: selectedTrade.sessionId,
        userId: user.uid,
        updatedAt: new Date().toISOString()
      };
      await setDoc(reviewRef, reviewData, { merge: true });
      setToast({ message: 'Trade review saved successfully', type: 'success' });
    } catch (error) {
      console.error('Error saving trade review:', error);
      setToast({ message: 'Failed to save trade review', type: 'error' });
    } finally {
      setIsSavingReview(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleFlagToggle = (flag: string) => {
    setReview(prev => {
      const flags = prev.behaviorFlags || [];
      if (flags.includes(flag)) {
        return { ...prev, behaviorFlags: flags.filter(f => f !== flag) };
      }
      return { ...prev, behaviorFlags: [...flags, flag] };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold tracking-tight">{title || "Trade Performance Log"}</h3>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search trades..." 
              className="pl-10 w-64 h-10 text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button 
            variant={showFilters ? "primary" : "outline"} 
            className="h-10 px-4 flex items-center space-x-2 text-xs"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4 animate-in fade-in slide-in-from-top-2 duration-200 border-primary/20 bg-primary/5">
          <div className="flex flex-wrap gap-4 items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick Filters:</span>
            <Badge variant="neutral" className="cursor-pointer hover:bg-accent transition-colors">Winners Only</Badge>
            <Badge variant="neutral" className="cursor-pointer hover:bg-accent transition-colors">Losers Only</Badge>
            <Badge variant="neutral" className="cursor-pointer hover:bg-accent transition-colors">Grade A+</Badge>
            <Button variant="ghost" size="sm" className="text-[10px] h-auto py-1 font-bold text-primary" onClick={() => setShowFilters(false)}>Clear All</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-accent/5 border-b border-border">
                <th className="text-left px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">
                  <div className="flex items-center space-x-2">
                    <span>Date / Time</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="text-left px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Symbol</th>
                <th className="text-left px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Side</th>
                <th className="text-right px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Qty</th>
                <th className="text-right px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Entry</th>
                <th className="text-right px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Exit</th>
                <th className="text-right px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">PnL (Pts)</th>
                <th className="text-center px-6 py-5 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Grade</th>
                <th className="px-6 py-5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredTrades.length > 0 ? filteredTrades.map((trade) => (
                <tr 
                  key={trade.id} 
                  className="group hover:bg-accent/10 transition-colors cursor-pointer"
                  onClick={() => setSelectedTrade(trade)}
                >
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-xs">{new Date(trade.entryTime).toLocaleDateString()}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(trade.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <div className="flex items-center space-x-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        <span className="font-bold">{trade.symbol}</span>
                      </div>
                      {trade.intentId && (
                        <div className="mt-1">
                          <Badge variant={trade.isViolation ? "negative" : "positive"} className="text-[8px] px-1 py-0 uppercase tracking-tighter">
                            {trade.isViolation ? "Rule Violated" : "Rule Followed"}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <Badge variant={trade.direction === 'LONG' ? 'positive' : 'negative'}>
                      {trade.direction}
                    </Badge>
                  </td>
                  <td className="px-6 py-5 text-right font-mono text-xs">{trade.totalQuantity}</td>
                  <td className="px-6 py-5 text-right font-mono text-xs">{trade.avgEntryPrice.toFixed(2)}</td>
                  <td className="px-6 py-5 text-right font-mono text-xs">{trade.avgExitPrice.toFixed(2)}</td>
                  <td className={cn(
                    "px-6 py-5 text-right font-bold",
                    trade.isWinner ? "text-emerald-500" : "text-rose-500"
                  )}>
                    {trade.isWinner ? '+' : ''}{trade.pnlPoints.toFixed(2)}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <Badge variant={
                      trade.tradeGrade === 'A+' ? 'positive' : 
                      trade.tradeGrade === 'B' ? 'warning' : 'negative'
                    }>
                      {trade.tradeGrade}
                    </Badge>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors ml-auto" />
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                    No trades found for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Trade Detail Drawer */}
      {selectedTrade && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div 
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setSelectedTrade(null)}
          />
          <Card className="relative w-full max-w-2xl h-full rounded-none border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-8 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-1">
                  <h2 className="text-2xl font-bold tracking-tight">Trade Details</h2>
                  <Badge variant="neutral" className="font-mono text-[10px]">{selectedTrade.id}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Reconstructed from {selectedTrade.fills.length} execution fills</p>
              </div>
              <button 
                onClick={() => setSelectedTrade(null)}
                className="p-2 hover:bg-accent rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {/* Trade Verdict */}
              <div className="p-6 rounded-3xl bg-indigo-500/5 border border-indigo-500/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <Zap className="w-12 h-12 text-indigo-500" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-2">Data Insight</p>
                <p className="text-sm font-medium text-slate-900 leading-relaxed italic">
                  "{selectedTrade.verdict}"
                </p>
              </div>

              {/* Instant Summary */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center space-x-2">
                    <Zap className="w-4 h-4 text-indigo-500" />
                    <span>Instant Summary</span>
                  </h3>
                  <Badge variant={selectedTrade.isWinner ? 'positive' : 'negative'} className="font-mono">
                    {selectedTrade.isWinner ? 'WINNER' : 'LOSER'}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-accent/10 border border-border/50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">PnL</p>
                    <p className={cn(
                      "text-xl font-black",
                      selectedTrade.isWinner ? "text-emerald-500" : "text-rose-500"
                    )}>
                      {selectedTrade.isWinner ? '+' : ''}{selectedTrade.pnlPoints.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-accent/10 border border-border/50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Hold Time</p>
                    <p className="text-xl font-black text-slate-900">
                      {selectedTrade.holdTimeSeconds < 60 
                        ? `${selectedTrade.holdTimeSeconds.toFixed(0)}s` 
                        : `${(selectedTrade.holdTimeSeconds / 60).toFixed(1)}m`}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-accent/10 border border-border/50">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Grade</p>
                    <p className="text-xl font-black text-indigo-600">{selectedTrade.tradeGrade}</p>
                  </div>
                </div>
              </section>

              {/* Execution Details */}
              <section className="space-y-6">
                <h3 className="text-sm font-bold flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-indigo-500" />
                  <span>Execution Timeline</span>
                </h3>
                <div className="space-y-4">
                  {selectedTrade.fills.map((fill, idx) => (
                    <div key={fill.order_id} className="flex items-start space-x-4">
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "w-3 h-3 rounded-full border-2 border-background",
                          fill.side === 'BUY' ? "bg-emerald-500" : "bg-rose-500"
                        )} />
                        {idx < selectedTrade.fills.length - 1 && <div className="w-px h-12 bg-border" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold">{fill.side} {fill.quantity} @ {fill.avg_price.toFixed(2)}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(fill.fill_time).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Execution ID: {fill.order_id}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Manual Review Section */}
              <section className="space-y-6 pt-8 border-t border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center space-x-2">
                    <BookOpen className="w-4 h-4 text-indigo-500" />
                    <span>Manual Review</span>
                  </h3>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    icon={isSavingReview ? Loader2 : Save}
                    onClick={saveReview}
                    disabled={isSavingReview}
                  >
                    {isSavingReview ? 'Saving...' : 'Save Review'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trade Grade</label>
                    <div className="flex space-x-2">
                      {['A+', 'B', 'C'].map(grade => (
                        <button
                          key={grade}
                          onClick={() => setReview(prev => ({ ...prev, tradeGrade: grade as any }))}
                          className={cn(
                            "flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                            review.tradeGrade === grade 
                              ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20" 
                              : "bg-accent/30 border-border hover:border-primary/50"
                          )}
                        >
                          {grade}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Behavior Flags</label>
                    <div className="flex flex-wrap gap-2">
                      {['FOMO', 'Revenge', 'Early Exit', 'Late Entry', 'Over-sized'].map(flag => (
                        <button
                          key={flag}
                          onClick={() => handleFlagToggle(flag)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                            review.behaviorFlags?.includes(flag)
                              ? "bg-rose-500 text-white border-rose-500"
                              : "bg-accent/30 border-border hover:border-rose-500/30"
                          )}
                        >
                          {flag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Execution Quality ({review.executionQuality}%)</label>
                    <input 
                      type="range" min="0" max="100" step="10"
                      className="w-full accent-primary"
                      value={review.executionQuality}
                      onChange={(e) => setReview(prev => ({ ...prev, executionQuality: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Strategy Quality ({review.strategyQuality}%)</label>
                    <input 
                      type="range" min="0" max="100" step="10"
                      className="w-full accent-primary"
                      value={review.strategyQuality}
                      onChange={(e) => setReview(prev => ({ ...prev, strategyQuality: parseInt(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Entry ({review.entryQuality}%)</label>
                    <input 
                      type="range" min="0" max="100" step="10"
                      className="w-full accent-primary"
                      value={review.entryQuality}
                      onChange={(e) => setReview(prev => ({ ...prev, entryQuality: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Exit ({review.exitQuality}%)</label>
                    <input 
                      type="range" min="0" max="100" step="10"
                      className="w-full accent-primary"
                      value={review.exitQuality}
                      onChange={(e) => setReview(prev => ({ ...prev, exitQuality: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timing ({review.timingScore}%)</label>
                    <input 
                      type="range" min="0" max="100" step="10"
                      className="w-full accent-primary"
                      value={review.timingScore}
                      onChange={(e) => setReview(prev => ({ ...prev, timingScore: parseInt(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags (comma separated)</label>
                    <Input 
                      className="h-10 text-xs"
                      placeholder="e.g. Trend, Reversal, Breakout"
                      value={review.tags?.join(', ')}
                      onChange={(e) => setReview(prev => ({ ...prev, tags: e.target.value.split(',').map(t => t.trim()).filter(t => t !== '') }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Verdict / Summary</label>
                    <textarea 
                      className="w-full h-20 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      placeholder="What happened in this trade?"
                      value={review.verdict}
                      onChange={(e) => setReview(prev => ({ ...prev, verdict: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lesson Learned</label>
                    <textarea 
                      className="w-full h-20 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      placeholder="What is the key takeaway?"
                      value={review.lessonLearned}
                      onChange={(e) => setReview(prev => ({ ...prev, lessonLearned: e.target.value }))}
                    />
                  </div>
                </div>
              </section>

              {/* Actions */}
              {onAddJournal && (
                <div className="pt-8 border-t border-border">
                  <Button 
                    variant="primary" 
                    className="w-full py-4 rounded-2xl flex items-center justify-center space-x-2"
                    onClick={() => {
                      onAddJournal(selectedTrade);
                      setSelectedTrade(null);
                    }}
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Create Journal Entry for this Trade</span>
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
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
