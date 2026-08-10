import React, { useState, useMemo, useEffect } from 'react';
import { cn, gradeBadgeVariant, omitUndefined, pointsPerContract } from '@/src/utils';
import { Card, Badge, Button, Input, Toast, Modal } from './Shared';
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
  Circle,
  AlertCircle,
  Tag,
  Flag,
  Trash2,
  AlertTriangle,
  BarChart3,
  MessageSquare,
  LineChart,
  Link2
} from 'lucide-react';
import { Trade, TradeReview, TagCategory } from '../types';
import { doc, getDoc, getDocs, addDoc, setDoc, serverTimestamp, collection, query, where, onSnapshot, deleteField, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useTrades } from '../context/TradeContext';
import { TagCategoriesPicker } from './TagCategoriesPicker';
import { TradeCandleChart } from './TradeCandleChart';
import { RunningPnlChart } from './RunningPnlChart';
import { RichTextEditor, stripHtml, isContentEmpty } from './RichTextEditor';
import { TradeAttachments } from './TradeAttachments';
import { LinkTradeModal } from './LinkTradeModal';
import { useMarketBars } from '../hooks/useMarketBars';
import { getPointValue } from '../contractSpecs';

interface TradePerformanceLogProps {
  trades: Trade[];
  title?: string;
  subtitle?: string;
}

// Maximum Adverse/Favorable Excursion — the worst and best unrealized price
// move that occurred *during* the trade, before it was closed. Only
// meaningful against real intrabar price action (Yahoo market bars), since
// fill-based/synthetic chart paths aren't real price history — so this
// returns null unless real market bars covering the trade window are
// available. Bar-level (not tick-level) granularity slightly understates the
// true extremes, same caveat as the candlestick chart itself.
function computeExcursion(trade: Trade, market: ReturnType<typeof useMarketBars>['market']): { maeDollars: number; mfeDollars: number; bestExitPrice: number } | null {
  if (!market || market.bars.length === 0) return null;
  const entryEpoch = Math.floor(new Date(trade.entryTime).getTime() / 1000);
  const exitEpoch = Math.floor(new Date(trade.exitTime).getTime() / 1000);
  const windowBars = market.bars.filter(b => b.time >= entryEpoch && b.time <= exitEpoch);
  if (windowBars.length === 0) return null;

  const maxHigh = Math.max(...windowBars.map(b => b.high));
  const minLow = Math.min(...windowBars.map(b => b.low));
  const isLong = trade.direction === 'LONG';
  const adversePriceMove = isLong ? Math.max(0, trade.avgEntryPrice - minLow) : Math.max(0, maxHigh - trade.avgEntryPrice);
  const favorablePriceMove = isLong ? Math.max(0, maxHigh - trade.avgEntryPrice) : Math.max(0, trade.avgEntryPrice - minLow);
  const dollarsPerPoint = getPointValue(trade.symbol) * trade.totalQuantity;

  return {
    maeDollars: Number((adversePriceMove * dollarsPerPoint).toFixed(2)),
    mfeDollars: Number((favorablePriceMove * dollarsPerPoint).toFixed(2)),
    // The price a perfect exit would have captured — the high for a long,
    // the low for a short — i.e. the price behind the MFE figure above.
    bestExitPrice: isLong ? maxHigh : minLow,
  };
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-bold font-mono text-right">{children}</span>
    </div>
  );
}

// Uncontrolled by design (defaultValue, not value) — commits on blur rather
// than every keystroke. Pass a `key` from the caller (e.g. per trade id) to
// reset it when switching trades, same pattern as RichTextEditor.
function EditableStatRow({
  label,
  defaultValue,
  onCommit,
  type = 'text',
  placeholder = '--',
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="text-sm font-bold font-mono text-right bg-transparent w-32 outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors"
      />
    </div>
  );
}

export function TradePerformanceLog({ trades, title, subtitle }: TradePerformanceLogProps) {
  const { user } = useAuth();
  const { deleteTrades, tradeIdToOpen, setTradeIdToOpen } = useTrades();
  const [searchQuery, setSearchQuery] = useState('');
  // Holds only the id, not a snapshot of the trade object — deriving
  // selectedTrade from the live `trades` prop below means it automatically
  // reflects Firestore updates (e.g. right after saveReview writes new
  // fields), instead of showing stale data until the drawer is reopened.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTrade = useMemo(() => trades.find(t => t.id === selectedId) ?? null, [trades, selectedId]);

  // Cross-screen open request (e.g. "View Trade Details" from a Journal
  // Trade Note) — open the drawer once the requested trade is actually
  // present in this instance's trades, then clear the request so it doesn't
  // reopen on a later remount.
  useEffect(() => {
    if (tradeIdToOpen && trades.some(t => t.id === tradeIdToOpen)) {
      setSelectedId(tradeIdToOpen);
      setTradeIdToOpen(null);
    }
  }, [tradeIdToOpen, trades]);
  // undefined = the default narrow window tightly bracketing the trade;
  // an explicit interval fetches a longer lookback for top-down context.
  const [chartTimeframe, setChartTimeframe] = useState<string | undefined>(undefined);
  const { market, isLoading: isLoadingMarket } = useMarketBars(selectedTrade, chartTimeframe);
  const excursion = useMemo(
    () => (selectedTrade ? computeExcursion(selectedTrade, market) : null),
    [selectedTrade, market]
  );
  const [showFilters, setShowFilters] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [tagCategories, setTagCategories] = useState<TagCategory[]>([]);
  const [leftTab, setLeftTab] = useState<'stats' | 'executions' | 'attachments'>('stats');
  const [rightTab, setRightTab] = useState<'chart' | 'notes' | 'pnl'>('chart');

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'tagCategories'), where('userId', '==', user.uid)),
      (snapshot) => {
        const docs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as TagCategory))
          .sort((a, b) => a.order - b.order);
        setTagCategories(docs);
      }
    );
    return () => unsubscribe();
  }, [user]);

  // Review State
  const [review, setReview] = useState<Partial<TradeReview>>({
    executionQuality: 50,
    strategyQuality: 50,
    entryQuality: 50,
    exitQuality: 50,
    timingScore: 50,
    behaviorFlags: [],
    tags: [],
    verdict: '',
    lessonLearned: '',
    diagnostics: undefined,
    strategy: '',
    starRating: undefined,
    initialTarget: undefined,
    tradeRisk: undefined,
    plannedRMultiple: undefined,
    bestExitTime: ''
  });
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [isUpdatingRating, setIsUpdatingRating] = useState(false);

  const filteredTrades = useMemo(() => {
    return trades.filter(t =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.id.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
  }, [trades, searchQuery]);

  // Clear any selections that no longer exist (e.g. after a delete or filter change)
  useEffect(() => {
    const visibleIds = new Set(filteredTrades.map(t => t.id));
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredTrades]);

  const isAllSelected = filteredTrades.length > 0 && filteredTrades.every(t => selectedIds.has(t.id));
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (isAllSelected) return new Set();
      return new Set(filteredTrades.map(t => t.id));
    });
  };

  const toggleSelectOne = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const requestDeleteOne = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setPendingDeleteIds([id]);
  };

  const requestDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setPendingDeleteIds(Array.from(selectedIds));
  };

  const confirmDelete = async () => {
    if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
    setIsDeleting(true);
    try {
      await deleteTrades(pendingDeleteIds);
      setToast({
        message: pendingDeleteIds.length === 1 ? 'Trade deleted' : `${pendingDeleteIds.length} trades deleted`,
        type: 'success'
      });
      if (selectedTrade && pendingDeleteIds.includes(selectedTrade.id)) {
        setSelectedId(null);
      }
      setSelectedIds(prev => {
        const next = new Set(prev);
        pendingDeleteIds.forEach(id => next.delete(id));
        return next;
      });
    } catch (error) {
      console.error('Error deleting trades:', error);
      setToast({ message: 'Failed to delete trade(s)', type: 'error' });
    } finally {
      setIsDeleting(false);
      setPendingDeleteIds(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

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
            executionQuality: selectedTrade.executionQuality || 50,
            strategyQuality: selectedTrade.strategyQuality || 50,
            entryQuality: selectedTrade.entryQuality || 50,
            exitQuality: selectedTrade.exitQuality || 50,
            timingScore: selectedTrade.timingScore || 50,
            behaviorFlags: selectedTrade.behaviorFlags || [],
            tags: selectedTrade.tags || [],
            verdict: selectedTrade.verdict || '',
            lessonLearned: selectedTrade.lessonLearned || '',
            diagnostics: selectedTrade.diagnostics,
            strategy: selectedTrade.strategy || '',
            starRating: selectedTrade.starRating,
            initialTarget: selectedTrade.initialTarget,
            tradeRisk: selectedTrade.tradeRisk,
            plannedRMultiple: selectedTrade.plannedRMultiple,
            bestExitTime: selectedTrade.bestExitTime || ''
          });
        }
      } catch (error) {
        console.error('Error loading trade review:', error);
      } finally {
        setIsLoadingReview(false);
      }
    };

    loadReview();
    // selectedTrade is re-derived (new object reference) on every trades
    // update from the live Firestore listener — including the one this
    // component's own autosave triggers by writing to the trade doc. Keying
    // this off selectedTrade.id instead of the object itself means it only
    // reloads when the user actually switches trades, not on every autosave
    // round-trip — which previously reset review state (and remounted the
    // notes editors mid-typing) every ~1-2s while the user was writing notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrade?.id, user]);

  // Reset drawer tabs whenever a different trade is opened
  useEffect(() => {
    if (selectedTrade) {
      setLeftTab('stats');
      setRightTab('chart');
    }
  }, [selectedTrade?.id]);

  // Keeps this trade's Verdict/Summary and Lesson Learned in sync with a
  // tradeId-linked entry in the `journals` collection, so they show up as a
  // "Trade Note" in the Notebook instead of being invisible outside this
  // drawer. Looks the entry up by tradeId (rather than a deterministic doc
  // id) since a Trade Note for this trade may already exist from before this
  // syncing existed.
  const syncTradeNote = async (verdict: string, lessonLearned: string) => {
    if (!selectedTrade || !user) return;
    const sections: string[] = [];
    if (!isContentEmpty(verdict)) sections.push(`<p><strong>Verdict / Summary</strong></p>${verdict}`);
    if (!isContentEmpty(lessonLearned)) sections.push(`<p><strong>Lesson Learned</strong></p>${lessonLearned}`);
    if (sections.length === 0) return;

    const content = sections.join('');
    const now = new Date().toISOString();
    const q = query(collection(db, 'journals'), where('userId', '==', user.uid), where('tradeId', '==', selectedTrade.id));
    const existing = await getDocs(q);
    if (!existing.empty) {
      await setDoc(existing.docs[0].ref, { content, updatedAt: now }, { merge: true });
    } else {
      await addDoc(collection(db, 'journals'), {
        userId: user.uid,
        tradeId: selectedTrade.id,
        sessionId: selectedTrade.sessionId,
        title: `Trade Note — ${selectedTrade.symbol} ${selectedTrade.direction}`,
        date: selectedTrade.sessionDate,
        content,
        tags: [],
        status: 'private',
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  const saveReview = async (silent: boolean = false) => {
    if (!selectedTrade || !user) return;
    setIsSavingReview(true);
    try {
      const reviewRef = doc(db, 'trade_reviews', selectedTrade.id);
      const reviewData = omitUndefined({
        ...review,
        tradeId: selectedTrade.id,
        sessionId: selectedTrade.sessionId,
        userId: user.uid,
        updatedAt: new Date().toISOString()
      });
      await setDoc(reviewRef, reviewData, { merge: true });
      await syncTradeNote(review.verdict || '', review.lessonLearned || '');

      // Also merge the reviewable fields back onto the trade itself — otherwise a
      // manual score change here never shows up in the Trades table or anywhere
      // else that reads `trades`, since those all read from the `trades`
      // collection, not `trade_reviews`. tradeGrade is deliberately excluded —
      // it's auto-computed by applyBatchDerivedGrading() at reconstruction time,
      // not user-editable, so it must never be overwritten here.
      const tradeRef = doc(db, 'trades', selectedTrade.id);
      await setDoc(tradeRef, omitUndefined({
        executionQuality: review.executionQuality,
        strategyQuality: review.strategyQuality,
        entryQuality: review.entryQuality,
        exitQuality: review.exitQuality,
        timingScore: review.timingScore,
        behaviorFlags: review.behaviorFlags,
        tags: review.tags,
        verdict: review.verdict,
        lessonLearned: review.lessonLearned,
        strategy: review.strategy,
        starRating: review.starRating,
        initialTarget: review.initialTarget,
        tradeRisk: review.tradeRisk,
        plannedRMultiple: review.plannedRMultiple,
        bestExitTime: review.bestExitTime,
        updatedAt: serverTimestamp()
      }), { merge: true });

      if (!silent) setToast({ message: 'Trade review saved successfully', type: 'success' });
    } catch (error) {
      console.error('Error saving trade review:', error);
      setToast({ message: 'Failed to save trade review', type: 'error' });
    } finally {
      setIsSavingReview(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Auto-saves the review a moment after the trader stops typing/adjusting a
  // field, so nothing is lost if they navigate away without hitting the
  // (still-available) manual Save Review button. Skips the very first
  // `review` change after switching trades, since that's loadReview()
  // populating state from Firestore, not a real edit.
  const skipNextAutoSaveRef = React.useRef(true);
  useEffect(() => {
    skipNextAutoSaveRef.current = true;
  }, [selectedTrade?.id]);

  useEffect(() => {
    if (isLoadingReview) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    const timeoutId = setTimeout(() => {
      saveReview(true);
    }, 1200);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, isLoadingReview]);

  // Moves a manually-entered trade's journal notes onto a later CSV-imported
  // trade of the same real-world position, then removes the manual trade so
  // it isn't double-counted in P&L/stats. Mirrors saveReview()'s own
  // trades/trade_reviews write shape so the merged fields behave identically
  // to a normal save on the target trade.
  const handleLinkTrade = async (targetTradeId: string) => {
    if (!selectedTrade || !user) return;
    const sourceTrade = selectedTrade;
    try {
      const sourceReviewSnap = await getDoc(doc(db, 'trade_reviews', sourceTrade.id));
      const sourceReview = sourceReviewSnap.exists() ? (sourceReviewSnap.data() as TradeReview) : review;

      const targetReviewRef = doc(db, 'trade_reviews', targetTradeId);
      const targetReviewSnap = await getDoc(targetReviewRef);
      const targetHasNotes = targetReviewSnap.exists() &&
        !!(stripHtml((targetReviewSnap.data() as TradeReview).verdict || '').trim() ||
           stripHtml((targetReviewSnap.data() as TradeReview).lessonLearned || '').trim());
      if (targetHasNotes && !window.confirm("The trade you picked already has notes. Linking will overwrite them with this manual trade's notes. Continue?")) {
        return;
      }

      const targetTrade = trades.find(t => t.id === targetTradeId);
      const mergedReview = omitUndefined({
        ...sourceReview,
        tradeId: targetTradeId,
        sessionId: targetTrade?.sessionId,
        userId: user.uid,
        updatedAt: new Date().toISOString()
      });
      await setDoc(targetReviewRef, mergedReview, { merge: true });

      await setDoc(doc(db, 'trades', targetTradeId), omitUndefined({
        executionQuality: sourceReview.executionQuality,
        strategyQuality: sourceReview.strategyQuality,
        entryQuality: sourceReview.entryQuality,
        exitQuality: sourceReview.exitQuality,
        timingScore: sourceReview.timingScore,
        behaviorFlags: sourceReview.behaviorFlags,
        tags: sourceReview.tags,
        verdict: sourceReview.verdict,
        lessonLearned: sourceReview.lessonLearned,
        strategy: sourceReview.strategy,
        starRating: sourceReview.starRating,
        initialTarget: sourceReview.initialTarget,
        tradeRisk: sourceReview.tradeRisk,
        plannedRMultiple: sourceReview.plannedRMultiple,
        bestExitTime: sourceReview.bestExitTime,
        updatedAt: serverTimestamp()
      }), { merge: true });

      await deleteDoc(doc(db, 'trade_reviews', sourceTrade.id));
      await deleteTrades([sourceTrade.id]);

      setSelectedId(targetTradeId);
      setToast({ message: 'Linked — manual trade merged and removed', type: 'success' });
    } catch (error) {
      console.error('Error linking trade:', error);
      setToast({ message: 'Failed to link trade', type: 'error' });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Plan/rating fields are editable directly from the Stats tab (not just the
  // Strategy tab's form) — writes immediately rather than waiting for "Save
  // Review", to both `trades` (what Stats/Strategy both read) and
  // `trade_reviews` (so the Strategy tab's form doesn't load a stale value
  // and clobber this back on its next Save Review). A value of undefined/''
  // deletes the field rather than leaving a stale one behind.
  const updateTradeFields = async (fields: Record<string, any>) => {
    if (!selectedTrade || !user) return;
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      cleaned[key] = (value === undefined || value === '') ? deleteField() : value;
    }
    try {
      const tradeRef = doc(db, 'trades', selectedTrade.id);
      await setDoc(tradeRef, { ...cleaned, updatedAt: serverTimestamp() }, { merge: true });

      const reviewRef = doc(db, 'trade_reviews', selectedTrade.id);
      await setDoc(reviewRef, {
        ...cleaned,
        tradeId: selectedTrade.id,
        sessionId: selectedTrade.sessionId,
        userId: user.uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setReview(prev => ({ ...prev, ...fields }));
    } catch (error) {
      console.error('Error saving field:', error);
      setToast({ message: 'Failed to save', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const updateStarRating = async (rating: number) => {
    setIsUpdatingRating(true);
    await updateTradeFields({ starRating: rating });
    setIsUpdatingRating(false);
  };

  // Same write as updateTradeFields's reviewed toggle, but for a row in the
  // table list rather than the (possibly not even open) detail drawer — lets
  // "Reviewed" be flipped straight from the list without opening a trade.
  // Mirrors both `trades` and `trade_reviews` for the same staleness reason
  // documented on updateTradeFields, and patches `review` too when this
  // happens to be the currently-open trade so the drawer doesn't show a
  // stale state underneath.
  const toggleRowReviewed = async (trade: Trade, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const reviewed = !trade.reviewed;
    try {
      const tradeRef = doc(db, 'trades', trade.id);
      await setDoc(tradeRef, { reviewed, updatedAt: serverTimestamp() }, { merge: true });
      const reviewRef = doc(db, 'trade_reviews', trade.id);
      await setDoc(reviewRef, { reviewed, tradeId: trade.id, sessionId: trade.sessionId, userId: user.uid, updatedAt: new Date().toISOString() }, { merge: true });
      if (selectedTrade?.id === trade.id) setReview(prev => ({ ...prev, reviewed }));
    } catch (error) {
      console.error('Error saving field:', error);
      setToast({ message: 'Failed to save', type: 'error' });
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

  // Shared between the Chart tab (notes shown under the chart) and the
  // dedicated Notes tab (notes shown on their own) — same `review` state
  // either way, so there's only ever one mounted RichTextEditor pair at a
  // time since the two tabs are mutually exclusive.
  const renderNotesEditors = () => {
    if (!selectedTrade) return null;
    if (isLoadingReview) return <p className="text-xs text-muted-foreground italic">Loading notes...</p>;
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Verdict / Summary</label>
          <RichTextEditor
            key={`verdict-${selectedTrade.id}`}
            initialValue={review.verdict || ''}
            onChange={(html) => setReview(prev => ({ ...prev, verdict: html }))}
            placeholder="What happened in this trade?"
            minHeightClass="min-h-[96px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lesson Learned</label>
          <RichTextEditor
            key={`lesson-${selectedTrade.id}`}
            initialValue={review.lessonLearned || ''}
            onChange={(html) => setReview(prev => ({ ...prev, lessonLearned: html }))}
            placeholder="What is the key takeaway?"
            minHeightClass="min-h-[96px]"
          />
        </div>
      </>
    );
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

      {selectedIds.size > 0 && (
        <Card className="p-4 animate-in fade-in slide-in-from-top-2 duration-200 border-rose-500/20 bg-rose-500/5 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs font-bold text-foreground">
            {selectedIds.size} trade{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedIds(new Set())}>
              Clear Selection
            </Button>
            <Button variant="destructive" size="sm" icon={Trash2} className="text-xs" onClick={requestDeleteSelected}>
              Delete Selected
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-accent/5 border-b border-border">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isSomeSelected; }}
                    onChange={toggleSelectAll}
                    aria-label="Select all trades"
                  />
                </th>
                <th className="text-left px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">
                  <div className="flex items-center space-x-2">
                    <span>Date / Time</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Symbol</th>
                <th className="text-left px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Side</th>
                <th className="text-right px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Net P&amp;L</th>
                <th className="text-right px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Qty</th>
                <th className="text-right px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Entry</th>
                <th className="text-right px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Exit</th>
                <th className="text-right px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">PnL (Pts)</th>
                <th className="text-center px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Grade</th>
                <th className="text-center px-4 py-3 font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Reviewed</th>
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredTrades.length > 0 ? filteredTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className={cn(
                    "group hover:bg-accent/10 transition-colors cursor-pointer",
                    selectedIds.has(trade.id) && "bg-primary/5"
                  )}
                  onClick={() => setSelectedId(trade.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                      checked={selectedIds.has(trade.id)}
                      onChange={() => toggleSelectOne(trade.id)}
                      aria-label={`Select trade ${trade.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-bold text-xs">{new Date(trade.entryTime).toLocaleDateString()}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(trade.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    <Badge variant={trade.direction === 'LONG' ? 'positive' : 'negative'}>
                      {trade.direction}
                    </Badge>
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right font-bold",
                    trade.realizedPnL >= 0 ? "text-emerald-500" : "text-rose-500"
                  )}>
                    {trade.realizedPnL >= 0 ? '+' : '-'}${Math.abs(trade.realizedPnL).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{trade.totalQuantity}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{trade.avgEntryPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{trade.avgExitPrice.toFixed(2)}</td>
                  <td className={cn(
                    "px-4 py-3 text-right font-bold",
                    trade.isWinner ? "text-emerald-500" : "text-rose-500"
                  )}>
                    {trade.isWinner ? '+' : ''}{pointsPerContract(trade.pnlPoints, trade.totalQuantity).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={gradeBadgeVariant(trade.tradeGrade)}>
                      {trade.tradeGrade}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => toggleRowReviewed(trade, e)}
                      className="mx-auto flex items-center justify-center rounded-full p-1 -m-1 transition-colors hover:bg-accent"
                      aria-label={trade.reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
                      title={trade.reviewed ? "Reviewed — click to unmark" : "Mark as reviewed"}
                    >
                      {trade.reviewed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground/30 hover:text-muted-foreground/60" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => requestDeleteOne(trade.id, e)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                      aria-label="Delete trade"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors ml-auto" />
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={13} className="px-6 py-12 text-center text-muted-foreground">
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
            onClick={() => setSelectedId(null)}
          />
          <Card className="relative w-full max-w-[1600px] h-full rounded-none border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-8 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-1">
                  <h2 className="text-2xl font-bold tracking-tight">Trade Details</h2>
                  <Badge variant="neutral" className="font-mono text-[10px]">{selectedTrade.id}</Badge>
                  {selectedTrade.isManualEntry && <Badge variant="warning" className="text-[10px]">Manually entered</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">Reconstructed from {selectedTrade.fills.length} execution fills</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateTradeFields({ reviewed: !selectedTrade.reviewed })}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold transition-colors",
                    selectedTrade.reviewed
                      ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  aria-label={selectedTrade.reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
                  title={selectedTrade.reviewed ? "Reviewed" : "Mark as Reviewed"}
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{selectedTrade.reviewed ? "Reviewed" : "Mark as Reviewed"}</span>
                </button>
                {selectedTrade.isManualEntry && (
                  <button
                    onClick={() => setIsLinkModalOpen(true)}
                    className="p-2 hover:bg-primary/10 text-muted-foreground hover:text-primary rounded-full transition-colors"
                    aria-label="Link to imported trade"
                    title="Link to imported trade"
                  >
                    <Link2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={(e) => requestDeleteOne(selectedTrade.id, e)}
                  className="p-2 hover:bg-rose-500/10 text-muted-foreground hover:text-rose-600 rounded-full transition-colors"
                  aria-label="Delete trade"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-2 hover:bg-accent rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Left Pane: Stats / Executions / Attachments */}
              <div className="w-[420px] shrink-0 border-r border-border flex flex-col overflow-hidden">
                <div className="flex items-center gap-1 p-4 border-b border-border shrink-0">
                  {([
                    { id: 'stats', label: 'Stats' },
                    { id: 'executions', label: 'Executions' },
                    { id: 'attachments', label: 'Attachments' },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setLeftTab(tab.id)}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-xs font-bold transition-all",
                        leftTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/40"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                  {leftTab === 'stats' && (
                    <>
                      {/* Trade Verdict — the auto-computed insight from diagnostics,
                          not the user's own Verdict/Summary note below (those used to
                          be the same field, which just echoed the note back). Hidden
                          when there's no genuine computed insight to show. */}
                      {selectedTrade.diagnostics?.dataInsight && (
                        <div className="p-6 rounded-3xl bg-indigo-500/5 border border-indigo-500/20 relative overflow-hidden">
                          <div className="absolute top-0 right-0 p-4 opacity-5">
                            <Zap className="w-12 h-12 text-indigo-500" />
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-2">Data Insight</p>
                          <p className="text-sm font-medium text-slate-900 leading-relaxed italic">
                            "{stripHtml(selectedTrade.diagnostics.dataInsight)}"
                          </p>
                        </div>
                      )}

                      {/* Trade Details */}
                      <section className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold flex items-center space-x-2">
                            <Zap className="w-4 h-4 text-indigo-500" />
                            <span>Trade Details</span>
                          </h3>
                          <Badge variant={selectedTrade.isWinner ? 'positive' : 'negative'} className="font-mono">
                            {selectedTrade.isWinner ? 'WINNER' : 'LOSER'}
                          </Badge>
                        </div>

                        <div className="p-5 rounded-2xl bg-accent/10 border border-border/50">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Net P&amp;L</p>
                          <p className={cn("text-3xl font-black", selectedTrade.realizedPnL >= 0 ? "text-emerald-500" : "text-rose-500")}>
                            {selectedTrade.realizedPnL >= 0 ? '+' : ''}${selectedTrade.realizedPnL.toFixed(2)}
                          </p>
                        </div>

                        <div className="px-4 rounded-2xl bg-accent/10 border border-border/50">
                          <StatRow label="Side">
                            <span className={selectedTrade.direction === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}>
                              {selectedTrade.direction}
                            </span>
                          </StatRow>
                          <StatRow label="Grade"><span className="text-indigo-600">{selectedTrade.tradeGrade || '—'}</span></StatRow>
                          <StatRow label="Hold Time">
                            {selectedTrade.holdTimeSeconds < 60
                              ? `${selectedTrade.holdTimeSeconds.toFixed(0)}s`
                              : `${(selectedTrade.holdTimeSeconds / 60).toFixed(1)}m`}
                          </StatRow>
                          <StatRow label="Contracts Traded">{selectedTrade.totalQuantity}</StatRow>
                          <StatRow label="Contracts Bought / Sold">
                            <span className="text-emerald-500">{selectedTrade.fills.filter(f => f.side === 'BUY').reduce((sum, f) => sum + f.quantity, 0)}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-rose-500">{selectedTrade.fills.filter(f => f.side === 'SELL').reduce((sum, f) => sum + f.quantity, 0)}</span>
                          </StatRow>
                          <StatRow label="Points">
                            <span className={selectedTrade.pnlPoints >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                              {selectedTrade.pnlPoints >= 0 ? '+' : ''}{pointsPerContract(selectedTrade.pnlPoints, selectedTrade.totalQuantity).toFixed(2)}
                            </span>
                          </StatRow>
                          {typeof selectedTrade.ticksPerContract === 'number' && (
                            <StatRow label="Ticks">{selectedTrade.ticksPerContract}</StatRow>
                          )}
                          <StatRow label="Gross P&amp;L">
                            <span className={(selectedTrade.grossPnlCurrency ?? selectedTrade.realizedPnL) >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                              {(selectedTrade.grossPnlCurrency ?? selectedTrade.realizedPnL) >= 0 ? '+' : ''}
                              ${(selectedTrade.grossPnlCurrency ?? selectedTrade.realizedPnL).toFixed(2)}
                            </span>
                          </StatRow>
                          <StatRow label="Commissions &amp; Fees">
                            <span className="text-rose-500">-${(selectedTrade.totalCommission ?? 0).toFixed(2)}</span>
                          </StatRow>
                          {typeof selectedTrade.netRoi === 'number' && (
                            <StatRow label="Return on Notional">
                              <span className={selectedTrade.netRoi >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                {selectedTrade.netRoi >= 0 ? '+' : ''}{selectedTrade.netRoi}%
                              </span>
                            </StatRow>
                          )}
                          <EditableStatRow
                            key={`strategy-${selectedTrade.id}`}
                            label="Strategy"
                            defaultValue={selectedTrade.strategy || ''}
                            placeholder="e.g. ORB Breakout"
                            onCommit={(value) => updateTradeFields({ strategy: value })}
                          />
                        </div>

                        {typeof selectedTrade.executionQuality === 'number' && (() => {
                          const scores = [
                            selectedTrade.executionQuality,
                            selectedTrade.strategyQuality,
                            selectedTrade.entryQuality,
                            selectedTrade.exitQuality,
                            selectedTrade.timingScore,
                          ].filter((n): n is number => typeof n === 'number');
                          const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                          return (
                            <div className="p-4 rounded-2xl bg-accent/10 border border-border/50 space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trade Quality Score</p>
                                <span className="text-xs font-bold font-mono">{avg.toFixed(0)}/100</span>
                              </div>
                              <div className="h-2 rounded-full bg-border/50 overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", avg >= 70 ? "bg-emerald-500" : avg >= 40 ? "bg-amber-500" : "bg-rose-500")}
                                  style={{ width: `${Math.min(100, Math.max(0, avg))}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}

                        <div className="p-4 rounded-2xl bg-accent/10 border border-border/50 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Price MAE / MFE</p>
                          {isLoadingMarket ? (
                            <p className="text-xs text-muted-foreground">Loading market data...</p>
                          ) : excursion ? (
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-500 text-xs font-bold font-mono">
                                -${excursion.maeDollars.toLocaleString()}
                              </span>
                              <span className="text-muted-foreground text-xs">/</span>
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs font-bold font-mono">
                                +${excursion.mfeDollars.toLocaleString()}
                              </span>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">Not available — no real market data for this trade's window.</p>
                          )}
                          <p className="text-[10px] text-muted-foreground">Worst / best unrealized move during the trade, from real market bars.</p>
                        </div>

                        <div className="px-4 rounded-2xl bg-accent/10 border border-border/50">
                          <StatRow label="Trade Rating">
                            <div className="flex items-center gap-1.5">
                              {[1, 2, 3, 4, 5].map(n => (
                                <button
                                  key={n}
                                  type="button"
                                  disabled={isUpdatingRating}
                                  onClick={() => updateStarRating(n)}
                                  className={cn(
                                    "text-4xl leading-none transition-colors disabled:opacity-50",
                                    (selectedTrade.starRating ?? 0) >= n ? "text-amber-400" : "text-border hover:text-amber-400/50"
                                  )}
                                >
                                  ★
                                </button>
                              ))}
                            </div>
                          </StatRow>
                          <EditableStatRow
                            key={`target-${selectedTrade.id}`}
                            label="Initial Target" type="number"
                            defaultValue={selectedTrade.initialTarget?.toString() ?? ''}
                            onCommit={(value) => updateTradeFields({ initialTarget: value === '' ? undefined : parseFloat(value) })}
                          />
                          <EditableStatRow
                            key={`risk-${selectedTrade.id}`}
                            label="Trade Risk" type="number"
                            defaultValue={selectedTrade.tradeRisk?.toString() ?? ''}
                            onCommit={(value) => updateTradeFields({ tradeRisk: value === '' ? undefined : parseFloat(value) })}
                          />
                          <EditableStatRow
                            key={`plannedR-${selectedTrade.id}`}
                            label="Planned R Multiple" type="number"
                            defaultValue={selectedTrade.plannedRMultiple?.toString() ?? ''}
                            onCommit={(value) => updateTradeFields({ plannedRMultiple: value === '' ? undefined : parseFloat(value) })}
                          />
                          <StatRow label="Realized R Multiple">
                            {(() => {
                              if (typeof selectedTrade.tradeRisk !== 'number') return '--';
                              const riskPerContract = Math.abs(selectedTrade.avgEntryPrice - selectedTrade.tradeRisk);
                              if (riskPerContract === 0) return '--';
                              const realizedR = pointsPerContract(selectedTrade.pnlPoints, selectedTrade.totalQuantity) / riskPerContract;
                              return (
                                <span className={realizedR >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                  {realizedR >= 0 ? '+' : ''}{realizedR.toFixed(2)}R
                                </span>
                              );
                            })()}
                          </StatRow>
                          <StatRow label="Best Exit Price">
                            {excursion ? excursion.bestExitPrice.toFixed(2) : 'Not available'}
                          </StatRow>
                          <EditableStatRow
                            key={`bestExitTime-${selectedTrade.id}`}
                            label="Best Exit Time"
                            defaultValue={selectedTrade.bestExitTime || ''}
                            placeholder="e.g. 14:20:00"
                            onCommit={(value) => updateTradeFields({ bestExitTime: value })}
                          />
                          <StatRow label="Entry Price">{selectedTrade.avgEntryPrice.toFixed(2)}</StatRow>
                          <StatRow label="Exit Price">{selectedTrade.avgExitPrice.toFixed(2)}</StatRow>
                        </div>

                        <div className="p-4 rounded-2xl bg-accent/10 border border-border/50 space-y-5">
                          <h3 className="text-sm font-bold flex items-center space-x-2">
                            <BookOpen className="w-4 h-4 text-indigo-500" />
                            <span>Manual Review</span>
                          </h3>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trade Grade</label>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-accent/30 border border-border">
                              <Badge variant={gradeBadgeVariant(selectedTrade.tradeGrade)} className="text-sm px-3 py-1 font-mono">
                                {selectedTrade.tradeGrade || '—'}
                              </Badge>
                              <p className="text-[10px] text-muted-foreground">
                                Auto-computed from P&amp;L, execution pattern, and re-entry timing — not manually set.
                              </p>
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

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags</label>
                            {user && (
                              <TagCategoriesPicker
                                categories={tagCategories}
                                selectedTags={review.tags || []}
                                onChange={(tags) => setReview(prev => ({ ...prev, tags }))}
                                userId={user.uid}
                              />
                            )}
                          </div>
                        </div>
                      </section>
                    </>
                  )}

                  {leftTab === 'executions' && (
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
                  )}

                  {leftTab === 'attachments' && (
                    <TradeAttachments
                      attachments={review.attachments || []}
                      onChange={(attachments) => setReview(prev => ({ ...prev, attachments }))}
                    />
                  )}
                </div>

                {/* Persistent across tabs — Verdict/Lesson (Stats), Manual Review
                    fields (Strategy), and Attachments all live in the same
                    `review` object and are only committed to Firestore here. */}
                <div className="p-4 border-t border-border shrink-0">
                  <Button
                    variant="primary"
                    className="w-full"
                    icon={isSavingReview ? Loader2 : Save}
                    onClick={() => saveReview()}
                    disabled={isSavingReview}
                  >
                    {isSavingReview ? 'Saving...' : 'Save Review'}
                  </Button>
                </div>
              </div>

              {/* Right Pane: Chart / Notes / Running P&L */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-1 p-4 border-b border-border shrink-0">
                  {([
                    { id: 'chart', label: 'Chart', icon: BarChart3 },
                    { id: 'notes', label: 'Notes', icon: MessageSquare },
                    { id: 'pnl', label: 'Running P&L', icon: LineChart },
                  ] as const).map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setRightTab(tab.id)}
                        className={cn(
                          "flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                          rightTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/40"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 overflow-hidden p-6">
                  {rightTab === 'chart' && (
                    <div className="h-full overflow-y-auto space-y-6 pr-1">
                      <div className="h-[420px] shrink-0">
                        <TradeCandleChart
                          trade={selectedTrade}
                          market={market}
                          isLoadingMarket={isLoadingMarket}
                          timeframe={chartTimeframe}
                          onTimeframeChange={setChartTimeframe}
                          drawings={selectedTrade.drawings || []}
                          onDrawingsChange={(drawings) => updateTradeFields({ drawings })}
                        />
                      </div>
                      <div className="p-4 rounded-2xl bg-accent/10 border border-border/50 space-y-5">
                        {renderNotesEditors()}
                      </div>
                    </div>
                  )}
                  {rightTab === 'notes' && (
                    <div className="h-full overflow-y-auto space-y-5 pr-1">
                      {renderNotesEditors()}
                    </div>
                  )}
                  {rightTab === 'pnl' && <RunningPnlChart trade={selectedTrade} />}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={pendingDeleteIds !== null}
        onClose={() => !isDeleting && setPendingDeleteIds(null)}
        title={pendingDeleteIds && pendingDeleteIds.length > 1 ? `Delete ${pendingDeleteIds.length} Trades?` : "Delete Trade?"}
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteIds(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              icon={isDeleting ? Loader2 : Trash2}
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {pendingDeleteIds && pendingDeleteIds.length > 1
              ? `This will permanently remove ${pendingDeleteIds.length} trades from your history, including any associated fills. This cannot be undone.`
              : "This will permanently remove this trade from your history, including its associated fills. This cannot be undone."}
          </p>
        </div>
      </Modal>

      {/* Link Manual Trade to Imported Trade Modal */}
      {selectedTrade && selectedTrade.isManualEntry && (
        <LinkTradeModal
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          sourceTrade={selectedTrade}
          candidates={trades.filter(t => !t.isManualEntry && t.id !== selectedTrade.id)}
          onConfirm={handleLinkTrade}
        />
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
