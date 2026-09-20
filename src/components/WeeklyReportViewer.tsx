// Full read-only view of one Weekly Coaching Report — replaces
// WeeklyReportsScreen's previously-disabled "Eye" button. Same StructuredInsight
// shape rendered elsewhere for mentor feedback (SessionDetailScreen), just
// laid out as a standalone report rather than inline in a session page.
import React, { useState } from 'react';
import { Modal, Badge, Button } from './Shared';
import { RichTextEditor } from './RichTextEditor';
import { cn } from '@/src/utils';
import { CheckCircle2, XCircle, Target, Zap, Pencil, Save, Loader2, MessageSquare } from 'lucide-react';
import { WeeklyReport, updateMentorComment } from '../lib/weeklyReports';
import { useAuth } from '../context/AuthContext';

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="p-3 rounded-xl bg-accent/30 border border-border">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className={cn(
        'text-lg font-black',
        tone === 'positive' && 'text-emerald-500',
        tone === 'negative' && 'text-rose-500',
        !tone && 'text-foreground'
      )}>
        {value}
      </p>
    </div>
  );
}

export function WeeklyReportViewer({ report, onClose }: { report: WeeklyReport | null; onClose: () => void }) {
  const { user, role } = useAuth();
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  if (!report) return null;
  const { insight } = report;
  // Only the mentor who generated this report (or an Admin, who can act as
  // any mentor — same blanket-oversight pattern as everywhere else in this
  // app) can add or change their own comment; a student reading their
  // report never gets an edit control for it.
  const canEditComment = !!user && (user.uid === report.mentorId || role === 'Admin');

  const startEditingComment = () => {
    setDraftComment(report.mentorComment || '');
    setIsEditingComment(true);
  };

  const saveComment = async () => {
    setIsSavingComment(true);
    try {
      await updateMentorComment(report.id, draftComment);
      setIsEditingComment(false);
    } catch (err) {
      console.error('Failed to save mentor comment:', err);
    } finally {
      setIsSavingComment(false);
    }
  };

  return (
    <Modal isOpen={!!report} onClose={onClose} title={`Weekly Report — ${report.week}`} maxWidth="lg">
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Net P&L" value={`${report.pnl >= 0 ? '+' : ''}$${report.pnl.toFixed(2)}`} tone={report.pnl >= 0 ? 'positive' : 'negative'} />
          <StatTile label="Win Rate" value={`${report.winRate.toFixed(1)}%`} />
          <StatTile label="Discipline" value={`${report.disciplineScore}%`} />
          <StatTile label="Consistency" value={`${report.consistencyScore}%`} />
        </div>

        {insight.isInsufficientData ? (
          <p className="text-sm text-muted-foreground italic">{insight.sessionSummary}</p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Summary</p>
              <p className="text-sm text-foreground leading-relaxed">{insight.sessionSummary}</p>
            </div>

            {(insight.whatWorked.length > 0 || insight.whatHurt.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> What Worked
                  </p>
                  {insight.whatWorked.length > 0 ? (
                    <ul className="space-y-1.5">
                      {insight.whatWorked.map((w, i) => <li key={i} className="text-xs text-foreground leading-relaxed">{w}</li>)}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground italic">Nothing notable.</p>}
                </div>
                <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600 flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" /> What Hurt
                  </p>
                  {insight.whatHurt.length > 0 ? (
                    <ul className="space-y-1.5">
                      {insight.whatHurt.map((w, i) => <li key={i} className="text-xs text-foreground leading-relaxed">{w}</li>)}
                    </ul>
                  ) : <p className="text-xs text-muted-foreground italic">Nothing notable.</p>}
                </div>
              </div>
            )}

            <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" /> Core Problem
              </p>
              <p className="text-sm text-foreground leading-relaxed">{insight.coreProblem}</p>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Execution vs. Strategy</p>
              <p className="text-sm text-foreground leading-relaxed">{insight.executionVsStrategy}</p>
            </div>

            {insight.actionPlan.length > 0 && (
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> Action Plan
                </p>
                <ul className="space-y-1.5">
                  {insight.actionPlan.map((a, i) => <li key={i} className="text-xs text-foreground leading-relaxed">{i + 1}. {a}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Mentor's own note — separate from `insight` above (the
            deterministic/AI-generated analysis). Only the mentor who
            generated this report (or an Admin) can add or edit it; a
            student sees it read-only, or not at all if none was left. */}
        {(report.mentorComment || canEditComment) && (
          <div className="p-4 rounded-2xl bg-accent/30 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Mentor Comment
              </p>
              {canEditComment && !isEditingComment && (
                <Button variant="ghost" size="sm" icon={Pencil} className="h-auto py-1 px-2 text-xs" onClick={startEditingComment}>
                  Edit
                </Button>
              )}
            </div>
            {isEditingComment ? (
              <div className="space-y-2">
                <RichTextEditor
                  initialValue={draftComment}
                  onChange={setDraftComment}
                  placeholder="A personal note for this student about their week..."
                  minHeightClass="min-h-[96px]"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setIsEditingComment(false)} disabled={isSavingComment}>Cancel</Button>
                  <Button variant="primary" size="sm" icon={isSavingComment ? Loader2 : Save} onClick={saveComment} disabled={isSavingComment}>
                    {isSavingComment ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : report.mentorComment ? (
              <div
                className="text-sm text-foreground leading-relaxed prose-sm max-w-none [&_img]:rounded-lg [&_img]:my-2 [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: report.mentorComment }}
              />
            ) : (
              <p className="text-xs text-muted-foreground italic">No comment yet.</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-2 border-t border-border">
          <span>{report.totalTrades} trade{report.totalTrades === 1 ? '' : 's'} this week</span>
          <Badge variant="neutral" className="font-mono">{new Date(report.createdAt).toLocaleDateString()}</Badge>
        </div>
      </div>
    </Modal>
  );
}
