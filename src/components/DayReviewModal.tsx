import React, { useEffect, useState } from 'react';
import { X, Sparkles, Loader2, RefreshCw, NotebookPen, Check, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react';
import { cn } from '@/src/utils';
import { DayReview } from '../types';
import { generateDayReview, appendReviewToJournal, DayReviewTradeSummary } from '../lib/dayReview';

// Phase 4 of the Day View build (see the "Day View Teardown" reference) —
// TradeZella's "Review with Zella AI" equivalent. Generation itself is a
// real LLM call (server-side, see /api/day-review/generate in server.ts),
// not a template — this component is the trigger + display + the one
// client-side action ("Add to Daily Journal") that reuses this session's
// own note find-or-create convention.

interface DayReviewModalProps {
  userId: string;
  sessionId: string;
  sessionDate: string;
  dayLabel: string;
  trades: DayReviewTradeSummary[];
  journalNote?: string;
  strategyNotes: string[];
  existingReview: DayReview | null;
  onClose: () => void;
}

export function DayReviewModal({
  userId,
  sessionId,
  sessionDate,
  dayLabel,
  trades,
  journalNote,
  strategyNotes,
  existingReview,
  onClose,
}: DayReviewModalProps) {
  const [review, setReview] = useState<DayReview | null>(existingReview);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSavingToJournal, setIsSavingToJournal] = useState(false);
  const [savedToJournal, setSavedToJournal] = useState(false);

  const runGenerate = async (forceRegenerate: boolean) => {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generateDayReview({
        userId,
        sessionDate,
        dayLabel,
        trades,
        journalNote,
        strategyNotes,
        forceRegenerate,
      });
      setReview(result);
      setSavedToJournal(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate review.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generate on first open only if nothing's cached yet — a cached
  // review renders immediately, no network call, matching the plan's
  // caching requirement (never regenerated just from opening the modal).
  useEffect(() => {
    if (!existingReview) runGenerate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddToJournal = async () => {
    if (!review) return;
    setIsSavingToJournal(true);
    try {
      await appendReviewToJournal(userId, sessionId, sessionDate, review);
      setSavedToJournal(true);
    } catch (err) {
      console.error('Failed to add review to journal:', err);
    } finally {
      setIsSavingToJournal(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border/60 shrink-0">
          <Sparkles className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">Review with AI</div>
            <div className="text-xs text-muted-foreground truncate">{dayLabel}</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm italic">Reading the day's trades and writing your review…</p>
            </div>
          )}

          {!isGenerating && error && (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-rose-500">{error}</p>
              <button
                onClick={() => runGenerate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border hover:bg-accent transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {!isGenerating && !error && review && (
            <>
              <p className="text-sm text-foreground leading-relaxed">{review.narrative}</p>

              {review.wins.length > 0 && (
                <ReviewSection icon={TrendingUp} iconClass="text-emerald-500" title="Wins" items={review.wins} />
              )}
              {review.mistakes.length > 0 && (
                <ReviewSection icon={TrendingDown} iconClass="text-rose-500" title="Mistakes" items={review.mistakes} />
              )}
              {review.themes.length > 0 && (
                <ReviewSection icon={Lightbulb} iconClass="text-amber-500" title="Themes" items={review.themes} />
              )}
            </>
          )}
        </div>

        {!isGenerating && !error && review && (
          <div className="flex items-center gap-2 px-6 py-4 border-t border-border/60 shrink-0">
            <button
              onClick={() => runGenerate(true)}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-border hover:bg-accent transition-colors disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
            <button
              onClick={handleAddToJournal}
              disabled={isSavingToJournal || savedToJournal}
              className={cn(
                "ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-70",
                savedToJournal
                  ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/5"
                  : "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
              )}
            >
              {isSavingToJournal ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : savedToJournal ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <NotebookPen className="w-3.5 h-3.5" />
              )}
              {savedToJournal ? 'Added to journal' : 'Add to Daily Journal'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewSection({
  icon: Icon,
  iconClass,
  title,
  items,
}: {
  icon: typeof TrendingUp;
  iconClass: string;
  title: string;
  items: string[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("w-3.5 h-3.5", iconClass)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-foreground pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
