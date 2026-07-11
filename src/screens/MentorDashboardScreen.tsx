import React, { useState, useEffect } from 'react';
import { cn } from '@/src/utils';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SectionHeader, Scorecard, Card, Badge, Button, Table, TableHeader, TableRow, TableHead, TableCell, Toast } from '../components/Shared';
import { Users, TrendingUp, TrendingDown, AlertCircle, FileText, ChevronRight, User, MessageSquare, BarChart3, CheckCircle2, Trophy, ArrowUpRight, ArrowDownRight, Target, BrainCircuit, Clock } from 'lucide-react';

export default function MentorDashboardScreen() {
  const [students, setStudents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // In a real app, we'd filter by mentorId
    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'student')),
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setStudents(docs);
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

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
          <div className="flex items-center space-x-3">
            <Button variant="outline" size="sm" onClick={() => handleAction('Filter Group')}>Filter Group</Button>
            <Button variant="primary" size="sm" onClick={() => handleAction('Weekly Report')}>Weekly Report</Button>
          </div>
        }
      />

      {/* Row 1: Group Insights Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">--% vs LW</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Avg Discipline</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">0.0%</p>
        </Card>

        <Card className="border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500 shadow-lg shadow-indigo-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <Target className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">Stable</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Avg Consistency</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">0.0%</p>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 shadow-lg shadow-amber-500/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">N/A</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Common Issue</p>
          <p className="text-xl font-bold mt-1 truncate text-foreground tracking-tight">No issues detected</p>
        </Card>

        <Card className="border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary shadow-lg shadow-primary/20 flex items-center justify-center transition-transform group-hover:scale-110">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <Badge variant="neutral" className="text-[10px] px-2">0 Improving</Badge>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Group Progress</p>
          <p className="text-3xl font-bold mt-1 text-foreground tracking-tight">Neutral</p>
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
                  <TableHead className="text-right">Improvement</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {students.length > 0 ? students.map((s) => (
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
                      <div className={cn("inline-flex items-center px-3 py-1 rounded-lg border text-[11px] font-bold", getScoreBg(s.discipline), getScoreColor(s.discipline))}>
                        {s.discipline}%
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className={cn("inline-flex items-center px-3 py-1 rounded-lg border text-[11px] font-bold", getScoreBg(s.consistency), getScoreColor(s.consistency))}>
                        {s.consistency}%
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {s.trend === 'up' ? (
                          <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-rose-500" />
                        )}
                        <span className={cn(
                          "font-bold text-sm",
                          s.trend === 'up' ? "text-emerald-500" : "text-rose-500"
                        )}>
                          {s.improvement}
                        </span>
                      </div>
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

        {/* Leaderboard Section */}
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
              {students.length > 0 ? students.sort((a, b) => (b.discipline + b.consistency) - (a.discipline + a.consistency)).slice(0, 3).map((s, i) => (
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
                      <div className="text-sm font-bold text-primary">{(s.discipline + s.consistency) / 2}%</div>
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

      {/* Row 3: Progress Trends + Issues + Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="font-bold text-foreground text-sm">Progress Trends</h3>
            </div>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {students.length > 0 ? `Analyzing performance trends for ${students.length} students over the last 14 days.` : "No progress data available yet."}
            </p>
            <div className="h-28 bg-muted/20 rounded-2xl flex items-end justify-between p-4 space-x-1.5 border border-border/20">
              {students.length > 0 ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex-1 bg-emerald-500/40 rounded-t-md transition-all duration-300 hover:bg-emerald-500 hover:scale-y-105" style={{ height: `${20 + Math.random() * 60}%` }} />
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
            <Badge variant="neutral" className="text-[10px] px-2">0 Alerts</Badge>
          </div>
          <div className="space-y-4">
            {students.length > 0 ? (
              <>
                <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl transition-all hover:bg-rose-500/10 hover:border-rose-500/20 cursor-default">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-rose-600">Behavioral Alert</p>
                    <span className="text-[10px] font-bold text-rose-500/70">Active Monitoring</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">Review individual student logs for specific behavioral patterns and discipline scores.</p>
                </div>
              </>
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
              Automated analysis of all student sessions will be ready once data is available.
            </p>
          </div>
          <Button 
            className="w-full bg-white text-primary hover:bg-white/90 active:scale-[0.98] border-none font-bold py-6 relative z-10"
            onClick={() => handleAction('Generate & Send Report')}
            disabled={students.length === 0}
          >
            Generate & Send
          </Button>
        </Card>
      </div>

      {/* Row 4: AI Mentor Overview */}
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
              {students.length > 0 ? (
                <p className="text-sm leading-relaxed text-muted-foreground/90">
                  The overall group sentiment is positive. Most students are successfully navigating the morning volatility, but there is a clear pattern of <span className="text-foreground font-bold">"giving back gains"</span> during the afternoon session. 
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground/90 italic">
                  AI analysis will be available once students are active and sessions are recorded.
                </p>
              )}
            </div>
            <div className="lg:col-span-4 p-8 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 flex flex-col justify-between shadow-sm">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-3">Coaching Focus</h4>
                <p className="text-lg font-bold leading-tight text-foreground tracking-tight">
                  {students.length > 0 ? "\"The Art of Walking Away: Preserving Morning Alpha\"" : "No active coaching focus"}
                </p>
              </div>
              <Button 
                variant="outline" 
                size="md" 
                className="w-full mt-8 border-indigo-500/30 text-indigo-600 hover:bg-indigo-500/20 font-bold text-xs"
                onClick={() => handleAction('Schedule Coaching Session')}
                disabled={students.length === 0}
              >
                Schedule Session
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
