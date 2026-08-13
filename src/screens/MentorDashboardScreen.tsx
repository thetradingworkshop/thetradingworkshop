import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/src/utils';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { format, subDays, isWithinInterval } from 'date-fns';
import { db } from '../firebase';
import { SectionHeader, Card, Badge, Button, Table, TableHeader, TableRow, TableHead, TableCell, Toast } from '../components/Shared';
import { Users, TrendingUp, AlertCircle, FileText, User, MessageSquare, BarChart3, CheckCircle2, Trophy, ArrowUpRight, ArrowDownRight, Target, BrainCircuit } from 'lucide-react';
import { computeDisciplineScore, computeConsistencyScore } from '../services/analyticsService';
import { Trade } from '../types';

// This screen used to genuinely query real students, then read
// `s.discipline`/`s.consistency`/`s.lastSession`/`s.trend` — fields nothing
// in the codebase ever wrote, so every real student rendered as undefined%
// and NaN. Fixed by computing each student's stats from their own real
// trades, using the exact same scoring functions Dashboard uses on the
// logged-in trader's own data (now exported from analyticsService.ts) —
// a mentor and their student see the same score for the same data.
//
// "Group Pattern Analysis" and "Weekly Coaching Report" below are left as
// explicit not-yet-available states rather than the fabricated narrative
// text ("giving back gains during the afternoon session"...) that used to
// render unconditionally — a real version of either needs an actual
// cross-student LLM analysis pass, not invented here.

interface StudentRow {
  id: string;
  name: string;
  email?: string;
  status?: string;
  discipline: number;
  consistency: number;
  lastSession: string;
  trend: 'up' | 'down' | 'flat';
  improvementPts: number;
  totalTrades: number;
}

function buildStudentRow(base: { id: string; name?: string; email?: string; status?: string }, trades: Trade[]): StudentRow {
  if (trades.length === 0) {
    return { id: base.id, name: base.name || base.email || 'Student', email: base.email, status: base.status, discipline: 0, consistency: 0, lastSession: 'No trades yet', trend: 'flat', improvementPts: 0, totalTrades: 0 };
  }
  const sorted = [...trades].sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
  const lastSession = format(new Date(sorted[0].entryTime), 'MMM d, yyyy');

  const now = new Date();
  const last7 = trades.filter(t => isWithinInterval(new Date(t.entryTime), { start: subDays(now, 7), end: now }));
  const prev7 = trades.filter(t => isWithinInterval(new Date(t.entryTime), { start: subDays(now, 14), end: subDays(now, 7) }));

  const discipline = Math.round(computeDisciplineScore(trades));
  const consistency = Math.round(computeConsistencyScore(trades));

  // Week-over-week movement, only when there's enough recent history to
  // compare against — with fewer than a handful of trades in either window
  // the score swings too much to call it a real trend.
  let trend: StudentRow['trend'] = 'flat';
  let improvementPts = 0;
  if (last7.length >= 3 && prev7.length >= 3) {
    const diff = Math.round(computeDisciplineScore(last7) - computeDisciplineScore(prev7));
    improvementPts = diff;
    trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  }

  return { id: base.id, name: base.name || base.email || 'Student', email: base.email, status: base.status, discipline, consistency, lastSession, trend, improvementPts, totalTrades: trades.length };
}

export default function MentorDashboardScreen() {
  const [students, setStudents] = useState<any[]>([]);
  const [studentTrades, setStudentTrades] = useState<Record<string, Trade[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // In a real app, we'd filter by mentorId
    // AuthContext.tsx writes role as 'Student' (capitalized) — this query
    // used to look for lowercase 'student' and so never matched a single
    // real signed-up user, regardless of how many students actually
    // existed. Confirmed by reading AuthContext.tsx directly.
    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'Student')),
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setStudents(docs);
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // One trades subscription per assigned student, so their table row and
  // the leaderboard reflect real, live data instead of a snapshot field
  // that was never populated. Keyed off the joined id list (not `students`
  // itself) so a re-render with the same set of students doesn't tear down
  // and re-subscribe every listener.
  const studentIds = useMemo(() => students.map(s => s.id).sort().join(','), [students]);
  useEffect(() => {
    if (!studentIds) { setStudentTrades({}); return; }
    const ids = studentIds.split(',');
    const unsubscribes = ids.map(id =>
      onSnapshot(query(collection(db, 'trades'), where('userId', '==', id)), (snap) => {
        const trades = snap.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
        setStudentTrades(prev => ({ ...prev, [id]: trades }));
      })
    );
    return () => unsubscribes.forEach(fn => fn());
  }, [studentIds]);

  const studentRows: StudentRow[] = useMemo(
    () => students.map(s => buildStudentRow(s, studentTrades[s.id] || [])),
    [students, studentTrades]
  );

  const activeStudents = studentRows.filter(s => s.totalTrades > 0);
  const avgDiscipline = activeStudents.length ? Math.round(activeStudents.reduce((s, r) => s + r.discipline, 0) / activeStudents.length) : 0;
  const avgConsistency = activeStudents.length ? Math.round(activeStudents.reduce((s, r) => s + r.consistency, 0) / activeStudents.length) : 0;
  const improvingCount = activeStudents.filter(s => s.trend === 'up').length;
  const strugglingStudents = activeStudents.filter(s => s.discipline < 50);
  const decliningCount = activeStudents.filter(s => s.trend === 'down').length;
  // Distinguishes "nobody has a week-over-week trend yet" (Stable — not a
  // problem, just not enough history) from students actually declining
  // (Needs Attention) — the first version of this conflated the two,
  // so a brand-new active student would read as "needs attention" purely
  // for lacking two weeks of data.
  const groupProgress = activeStudents.length === 0
    ? 'Neutral'
    : (improvingCount === 0 && decliningCount === 0)
      ? 'Stable'
      : improvingCount > decliningCount ? 'Improving' : improvingCount < decliningCount ? 'Needs Attention' : 'Mixed';

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-emerald-500";
    if (score >= 75) return "text-amber-500";
    return "text-rose-500";
  };

  const getScoreBg = (score: number) => {
    if (score >= 90) return "bg-emerald-500/10 border-emerald-500/20";
    if (score >= 75) return "bg-amber-500/10 border-amber-500/20";
    return "bg-rose-500/10 border-rose-500/20";
  };

  return (
    <div className="space-y-8 pb-20">
      <SectionHeader
        title="Mentor Dashboard"
        subtitle="Coaching overview for Group Alpha & Beta"
        rightElement={
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => handleAction('Filter Group')}>Filter Group</Button>
            <Button variant="primary" size="sm" onClick={() => handleAction('Weekly Report')}>Weekly Report</Button>
          </div>
        }
      />

      {/* Row 1: Group Insights Summary — real averages across assigned students with real trades */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">{activeStudents.length} active</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Avg Discipline</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">{avgDiscipline.toFixed(1)}%</p>
        </Card>

        <Card className="border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500 shadow-lg shadow-indigo-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <Target className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">{improvingCount} improving</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Avg Consistency</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">{avgConsistency.toFixed(1)}%</p>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 shadow-lg shadow-amber-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">{strugglingStudents.length} flagged</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Common Issue</p>
          <p className="text-xl font-bold mt-1 truncate text-foreground tracking-tight">
            {strugglingStudents.length === 0 ? 'No issues detected' : `${strugglingStudents.length} below 50% discipline`}
          </p>
        </Card>

        <Card className="border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary shadow-lg shadow-primary/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">{improvingCount} Improving</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Group Progress</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">{groupProgress}</p>
        </Card>
      </div>

      {/* Row 2: Student Performance Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <Card className="h-full" noPadding>
            <div className="p-6 border-b border-border/60 flex items-center justify-between bg-muted/10">
              <div>
                <h3 className="text-lg font-bold tracking-tight">Student Performance</h3>
                <p className="text-xs text-muted-foreground mt-1">Real-time tracking of assigned traders</p>
              </div>
              <Button variant="outline" size="sm" className="font-bold" onClick={() => handleAction('Export CSV')}>Export CSV</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-center">Discipline</TableHead>
                  <TableHead className="text-center">Consistency</TableHead>
                  <TableHead className="text-right">7-Day Trend</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {studentRows.length > 0 ? studentRows.map((s) => (
                  <TableRow
                    key={s.id}
                    className="group cursor-pointer"
                    onClick={() => handleAction(`View Details for ${s.name}`)}
                  >
                    <TableCell>
                      <div className="flex items-center space-x-4">
                        <div className="relative">
                          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center overflow-hidden border border-border/40 transition-transform group-hover:scale-105">
                            <User className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div className={cn(
                            "absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-card",
                            s.status === 'active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                          )} />
                        </div>
                        <div>
                          <div className="font-bold text-sm text-foreground">{s.name}</div>
                          <div className="text-[11px] text-muted-foreground">Last session: {s.lastSession}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {s.totalTrades > 0 ? (
                        <div className={cn("inline-flex items-center px-3 py-1 rounded-lg border text-[11px] font-bold", getScoreBg(s.discipline), getScoreColor(s.discipline))}>
                          {s.discipline}%
                        </div>
                      ) : <span className="text-xs text-muted-foreground italic">No trades</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.totalTrades > 0 ? (
                        <div className={cn("inline-flex items-center px-3 py-1 rounded-lg border text-[11px] font-bold", getScoreBg(s.consistency), getScoreColor(s.consistency))}>
                          {s.consistency}%
                        </div>
                      ) : <span className="text-xs text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.trend === 'flat' ? (
                        <span className="text-xs text-muted-foreground italic">Not enough data</span>
                      ) : (
                        <div className="flex items-center justify-end space-x-2">
                          {s.trend === 'up' ? (
                            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <ArrowDownRight className="w-4 h-4 text-rose-500" />
                          )}
                          <span className={cn("font-bold text-sm", s.trend === 'up' ? "text-emerald-500" : "text-rose-500")}>
                            {s.improvementPts > 0 ? '+' : ''}{s.improvementPts} pts
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-primary/10 text-primary"
                          onClick={(e) => { e.stopPropagation(); handleAction(`View Stats for ${s.name}`); }}
                        >
                          <BarChart3 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-primary/10 text-primary"
                          onClick={(e) => { e.stopPropagation(); handleAction(`Message ${s.name}`); }}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic">
                      No students assigned to your groups.
                    </TableCell>
                  </TableRow>
                )}
              </tbody>
            </Table>
          </Card>
        </div>

        {/* Leaderboard Section — ranked by real avg(discipline, consistency), students with no trades excluded rather than ranked as 0 */}
        <div className="lg:col-span-4">
          <Card className="h-full border-primary/20 bg-primary/5 shadow-inner">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-3">
                <Trophy className="w-6 h-6 text-amber-500" />
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Leaderboard</h3>
              </div>
              <Badge variant="neutral" className="text-[10px] px-2">This Week</Badge>
            </div>

            <div className="space-y-4">
              {activeStudents.length > 0 ? [...activeStudents].sort((a, b) => (b.discipline + b.consistency) - (a.discipline + a.consistency)).slice(0, 3).map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => handleAction(`View Profile for ${s.name}`)}
                  className={cn(
                    "p-5 rounded-2xl border transition-all duration-300 hover:translate-x-1 cursor-pointer",
                    i === 0 ? "bg-amber-500/10 border-amber-500/30 shadow-lg shadow-amber-500/5" : "bg-card border-border/60 hover:border-primary/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm transition-transform",
                        i === 0 ? "bg-amber-500 text-white scale-110" : i === 1 ? "bg-slate-300 text-slate-700" : "bg-orange-300 text-orange-800"
                      )}>
                        {i + 1}
                      </div>
                      <span className="text-sm font-bold text-foreground">{s.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-primary">{Math.round((s.discipline + s.consistency) / 2)}%</div>
                      <div className="text-[9px] uppercase font-bold text-muted-foreground/60 tracking-wider">Avg Score</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-2.5 bg-muted/30 rounded-xl text-center border border-border/20">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground/60 mb-0.5 tracking-wider">Discipline</div>
                      <div className="text-xs font-bold text-foreground">{s.discipline}%</div>
                    </div>
                    <div className="p-2.5 bg-muted/30 rounded-xl text-center border border-border/20">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground/60 mb-0.5 tracking-wider">Consistency</div>
                      <div className="text-xs font-bold text-foreground">{s.consistency}%</div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-muted-foreground italic text-xs">
                  No data for leaderboard.
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-8 border-primary/20 hover:bg-primary/10 font-bold text-xs"
              onClick={() => handleAction('View Full Rankings')}
            >
              View Full Rankings
            </Button>
          </Card>
        </div>
      </div>

      {/* Row 3: Discipline by Student + Common Issues + Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="font-bold text-foreground text-sm">Discipline by Student</h3>
            </div>
          </div>
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {activeStudents.length > 0 ? `Current discipline score for ${activeStudents.length} student${activeStudents.length === 1 ? '' : 's'} with logged trades.` : "No progress data available yet."}
            </p>
            <div className="h-28 bg-muted/20 rounded-2xl flex items-end justify-between p-4 space-x-1.5 border border-border/20">
              {activeStudents.length > 0 ? activeStudents.slice(0, 8).map((s) => (
                <div key={s.id} title={`${s.name}: ${s.discipline}%`} className="flex-1 bg-emerald-500/40 rounded-t-md transition-all duration-300 hover:bg-emerald-500 hover:scale-y-105" style={{ height: `${Math.max(4, s.discipline)}%` }} />
              )) : (
                <div className="w-full text-center text-[10px] text-muted-foreground/40">No data</div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-rose-500/10 rounded-lg">
                <AlertCircle className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="font-bold text-foreground text-sm">Common Issues</h3>
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">{strugglingStudents.length} Alerts</Badge>
          </div>
          <div className="space-y-4">
            {strugglingStudents.length > 0 ? (
              <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl transition-all hover:bg-rose-500/10 hover:border-rose-500/20 cursor-default">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-rose-600">Discipline below 50%</p>
                  <span className="text-[10px] font-bold text-rose-500/70">{strugglingStudents.length} student{strugglingStudents.length === 1 ? '' : 's'}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {strugglingStudents.map(s => s.name).join(', ')} — review individual logs for the specific rule violations driving this.
                </p>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground italic text-xs">
                No common issues identified.
              </div>
            )}
          </div>
        </Card>

        <Card className="bg-primary text-white border-none shadow-xl shadow-primary/20 flex flex-col justify-between group overflow-hidden relative">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-3xl transition-transform group-hover:scale-150" />
          <div className="relative z-10">
            <div className="flex items-center space-x-3 mb-8">
              <div className="p-2 bg-white/10 rounded-lg">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-sm">Weekly Coaching Report</h3>
            </div>
            <p className="text-xs text-white/80 mb-8 leading-relaxed">
              Automated per-student report generation isn't built yet — this button doesn't send anything.
            </p>
          </div>
          <Button
            className="w-full bg-white/40 text-white/70 border-none font-bold py-6 relative z-10 cursor-not-allowed"
            disabled
          >
            Coming Soon
          </Button>
        </Card>
      </div>

      {/* Row 4: Group Pattern Analysis — honestly unavailable rather than fabricated narrative */}
      <Card className="bg-indigo-500/5 border-indigo-500/20 relative overflow-hidden group" noPadding>
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none transition-transform group-hover:scale-110 group-hover:rotate-6 duration-700">
          <BrainCircuit className="w-64 h-64 text-indigo-500" />
        </div>
        <div className="p-8 relative z-10">
          <div className="flex items-center space-x-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground tracking-tight">Group Pattern Analysis</h3>
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium">AI-driven insights across all groups</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-8">
              <p className="text-sm leading-relaxed text-muted-foreground/90 italic">
                Cross-student AI pattern analysis isn't built yet — this section doesn't reflect real group behavior. Individual student discipline/consistency scores above are real.
              </p>
            </div>
            <div className="lg:col-span-4 p-8 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 flex flex-col justify-between shadow-sm">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-3">Coaching Focus</h4>
                <p className="text-sm font-medium leading-tight text-muted-foreground italic">
                  Not available yet
                </p>
              </div>
              <Button
                variant="outline"
                size="md"
                className="w-full mt-8 border-indigo-500/30 text-indigo-600/50 font-bold text-xs cursor-not-allowed"
                disabled
              >
                Coming Soon
              </Button>
            </div>
          </div>
        </div>
      </Card>

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
