// Firestore access for Weekly Coaching Reports (Mentor Dashboard → "Weekly
// Coaching Report" → Generate, read on the student's own Weekly Reports
// page). v1 is mentor-triggered only, per the chosen scope — no scheduled
// job generates these automatically.
import { collection, doc, setDoc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';
import { db } from '../firebase';
import { Trade } from '../types';
import { StructuredInsight, MentorService } from '../services/mentorService';
import { AnthropicProvider } from '../services/aiProviders';
import { buildTradeStats } from '../services/analyticsService';
import { computeDisciplineScore, computeConsistencyScore } from '../services/analyticsService';

export interface WeeklyReport {
  id: string;
  userId: string; // the student this report is about
  mentorId: string; // who generated it
  weekStart: string; // yyyy-MM-dd (Monday) — the real sort/filter key
  weekEnd: string; // yyyy-MM-dd (Sunday)
  week: string; // display label, e.g. "Aug 10 - Aug 16, 2026"
  student: string; // denormalized display name, for the report-list row
  pnl: number;
  winRate: number;
  totalTrades: number;
  disciplineScore: number;
  consistencyScore: number;
  // Reuses the exact same AI-mentor-feedback shape already used for a
  // trader's own session/day feedback elsewhere in the app (SessionDetailScreen,
  // DashboardScreen) — same deterministic-stats-first, optionally-Claude-
  // enhanced pipeline, just pointed at a student's week instead of the
  // signed-in user's own.
  insight: StructuredInsight;
  createdAt: string;
}

export function subscribeReports(userId: string, onChange: (reports: WeeklyReport[]) => void): () => void {
  const q = query(collection(db, 'reports'), where('userId', '==', userId), orderBy('weekStart', 'desc'));
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WeeklyReport, 'id'>) })));
  });
}

export async function generateWeeklyReport(params: {
  mentorId: string;
  studentId: string;
  studentName: string;
  weekStart: Date;
  weekEnd: Date;
  weekTrades: Trade[];
}): Promise<WeeklyReport> {
  const { mentorId, studentId, studentName, weekStart, weekEnd, weekTrades } = params;

  const stats = buildTradeStats(weekTrades);
  const weekLabel = `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;

  // Same real-stats-first, Claude-enhanced-second pipeline as every other
  // mentor-feedback surface in the app — never a purely fabricated
  // narrative. Falls back to the deterministic insight (still real,
  // computed from these actual numbers) if the AI call fails or is
  // cooling down after a rate limit.
  const mentorService = new MentorService(new AnthropicProvider());
  const insight = await mentorService.getMentorFeedback(weekTrades, stats, weekLabel);

  // .toISOString().slice(0,10) round-trips a *local* Date through UTC — safe
  // for weekStart (local midnight Monday), but confirmed by hand to push
  // weekEnd a day late in any timezone behind UTC: local 23:59:59.999 Sunday
  // converts to Monday morning UTC, so the stored date read back a day past
  // the real week. Same root cause as the trade_intents session-window bug
  // fixed earlier this session — format() in local time instead avoids ever
  // routing a local-anchored date through UTC.
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const report: Omit<WeeklyReport, 'id'> = {
    userId: studentId,
    mentorId,
    weekStart: weekStartStr,
    weekEnd: format(weekEnd, 'yyyy-MM-dd'),
    week: weekLabel,
    student: studentName,
    pnl: stats?.netPnlDollars ?? 0,
    winRate: stats?.winRate ?? 0,
    totalTrades: weekTrades.length,
    disciplineScore: Math.round(computeDisciplineScore(weekTrades)),
    consistencyScore: Math.round(computeConsistencyScore(weekTrades)),
    insight,
    createdAt: new Date().toISOString(),
  };

  // Deterministic per student+week id — regenerating the same week
  // overwrites in place instead of piling up duplicates the mentor would
  // have to clean up by hand.
  const id = `${studentId}_${weekStartStr}`;
  await setDoc(doc(db, 'reports', id), report);
  return { id, ...report };
}

// Real download — a plain-text file via Blob, not the PDF/branded export a
// "Download" button might imply eventually, but genuinely produces a file
// with the report's real content rather than leaving the button disabled.
export function downloadReportAsText(report: WeeklyReport): void {
  const { insight } = report;
  const lines = [
    `Weekly Coaching Report — ${report.student}`,
    report.week,
    '',
    `Net P&L: ${report.pnl >= 0 ? '+' : ''}$${report.pnl.toFixed(2)}`,
    `Win Rate: ${report.winRate.toFixed(1)}%`,
    `Discipline: ${report.disciplineScore}%`,
    `Consistency: ${report.consistencyScore}%`,
    `Trades: ${report.totalTrades}`,
    '',
    'SUMMARY',
    insight.sessionSummary,
  ];
  if (!insight.isInsufficientData) {
    if (insight.whatWorked.length > 0) lines.push('', 'WHAT WORKED', ...insight.whatWorked.map(w => `- ${w}`));
    if (insight.whatHurt.length > 0) lines.push('', 'WHAT HURT', ...insight.whatHurt.map(w => `- ${w}`));
    lines.push('', 'CORE PROBLEM', insight.coreProblem);
    lines.push('', 'EXECUTION VS. STRATEGY', insight.executionVsStrategy);
    if (insight.actionPlan.length > 0) lines.push('', 'ACTION PLAN', ...insight.actionPlan.map((a, i) => `${i + 1}. ${a}`));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weekly-report-${report.student.replace(/\s+/g, '-').toLowerCase()}-${report.weekStart}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
