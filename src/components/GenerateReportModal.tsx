// Mentor Dashboard's "Weekly Coaching Report" → Generate flow. v1 is
// mentor-triggered only (no scheduled job generates these automatically) —
// pick a student and a week, compute real stats for that window, write a
// mentor-feedback narrative from them (same pipeline as every other
// AI-mentor-feedback surface in the app), and save it where the student's
// own Weekly Reports page already expects to find it.
import React, { useMemo, useState } from 'react';
import { Modal, Button } from './Shared';
import { WeekPicker } from './DateRangePicker';
import { RichTextEditor } from './RichTextEditor';
import { startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { Loader2, FileText, CheckCircle2, Save } from 'lucide-react';
import { cn } from '@/src/utils';
import { Trade } from '../types';
import { generateWeeklyReport, updateMentorComment, WeeklyReport } from '../lib/weeklyReports';

interface GenerateReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mentorId: string;
  students: { id: string; name: string }[];
  studentTrades: Record<string, Trade[]>;
}

const inputClass = "w-full bg-accent/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "text-xs font-bold uppercase text-muted-foreground";

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

export function GenerateReportModal({ isOpen, onClose, mentorId, students, studentTrades }: GenerateReportModalProps) {
  const [studentId, setStudentId] = useState('');
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WeeklyReport | null>(null);
  const [mentorComment, setMentorComment] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentSaved, setCommentSaved] = useState(false);

  const weekStart = startOfWeek(weekAnchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });

  const weekTradeCount = useMemo(() => {
    if (!studentId) return 0;
    return (studentTrades[studentId] || []).filter(t =>
      isWithinInterval(new Date(t.entryTime), { start: weekStart, end: weekEnd })
    ).length;
  }, [studentId, studentTrades, weekStart, weekEnd]);

  const resetForm = () => {
    setStudentId('');
    setWeekAnchor(new Date());
    setError(null);
    setResult(null);
    setMentorComment('');
    setCommentSaved(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleGenerate = async () => {
    if (!studentId) { setError('Pick a student first.'); return; }
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    setError(null);
    setIsGenerating(true);
    try {
      const weekTrades = (studentTrades[studentId] || []).filter(t =>
        isWithinInterval(new Date(t.entryTime), { start: weekStart, end: weekEnd })
      );
      const report = await generateWeeklyReport({
        mentorId,
        studentId,
        studentName: student.name,
        weekStart,
        weekEnd,
        weekTrades,
      });
      setResult(report);
    } catch (err) {
      console.error('Failed to generate weekly report:', err);
      setError('Failed to generate report. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveComment = async () => {
    if (!result) return;
    setIsSavingComment(true);
    try {
      await updateMentorComment(result.id, mentorComment);
      setCommentSaved(true);
    } catch (err) {
      console.error('Failed to save mentor comment:', err);
      setError('Failed to save comment. Please try again.');
    } finally {
      setIsSavingComment(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Generate Weekly Coaching Report" maxWidth="lg">
      <div className="space-y-5">
        {!result ? (
          <>
            <p className="text-xs text-muted-foreground -mt-2">
              Computes real stats for the selected student's week — trades, P&amp;L, discipline, consistency — then
              writes a mentor-feedback narrative from them. It'll appear on that student's own Weekly Reports page.
            </p>

            <div className="space-y-2">
              <label className={labelClass}>Student</label>
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClass}>
                <option value="">Select a student...</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className={labelClass}>Week</label>
              <WeekPicker selectedDate={weekAnchor} onChange={setWeekAnchor} />
            </div>

            {studentId && (
              <p className="text-xs text-muted-foreground">
                {weekTradeCount === 0
                  ? 'No trades logged in this window — the report will note insufficient data rather than invent one.'
                  : `${weekTradeCount} trade${weekTradeCount === 1 ? '' : 's'} in this window.`}
              </p>
            )}

            {error && <p className="text-xs text-rose-500">{error}</p>}

            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="outline" onClick={handleClose} disabled={isGenerating}>Cancel</Button>
              <Button variant="primary" icon={isGenerating ? Loader2 : FileText} onClick={handleGenerate} disabled={isGenerating || !studentId}>
                {isGenerating ? 'Generating...' : 'Generate Report'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="w-5 h-5" />
              <p className="text-sm font-bold text-foreground">Report generated for {result.student} — {result.week}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Net P&L" value={`${result.pnl >= 0 ? '+' : ''}$${result.pnl.toFixed(2)}`} tone={result.pnl >= 0 ? 'positive' : 'negative'} />
              <StatTile label="Win Rate" value={`${result.winRate.toFixed(1)}%`} />
              <StatTile label="Discipline" value={`${result.disciplineScore}%`} />
              <StatTile label="Consistency" value={`${result.consistencyScore}%`} />
            </div>

            <div className="p-4 bg-accent/30 rounded-2xl space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Summary</p>
              <p className="text-sm text-foreground leading-relaxed">{result.insight.sessionSummary}</p>
            </div>

            {/* Separate from the summary above — that's the deterministic/
                AI-generated analysis, this is the mentor's own word to the
                student. Saved independently (updateMentorComment) so
                editing it later doesn't mean regenerating the whole
                report. */}
            <div className="space-y-2">
              <label className={labelClass}>Mentor Comment</label>
              <RichTextEditor
                key={result.id}
                initialValue={mentorComment}
                onChange={(html) => { setMentorComment(html); setCommentSaved(false); }}
                placeholder="A personal note for this student about their week..."
                minHeightClass="min-h-[96px]"
              />
              <div className="flex items-center justify-between">
                {commentSaved && <span className="text-xs text-emerald-500 font-medium">Saved</span>}
                <Button
                  variant="outline"
                  size="sm"
                  icon={isSavingComment ? Loader2 : Save}
                  onClick={handleSaveComment}
                  disabled={isSavingComment}
                  className="ml-auto"
                >
                  {isSavingComment ? 'Saving...' : 'Save Comment'}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Visible now on {result.student}'s own Weekly Reports page.
            </p>

            <div className="flex justify-end space-x-3 pt-2">
              <Button variant="outline" onClick={resetForm}>Generate Another</Button>
              <Button variant="primary" onClick={handleClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
