import React, { useState, useMemo } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Scorecard, Card, Badge, Button, Toast } from '../components/Shared';
import { EquityCurveChart, HourlyPerformanceChart } from '../components/Charts';
import { Calendar, TrendingUp, Target, Award, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useTrades } from '../context/TradeContext';
import { useDateRange } from '../context/DateContext';
import { isWithinInterval } from 'date-fns';
import { TradePerformanceLog } from '../components/TradePerformanceLog';

export default function RangeAnalysisScreen() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { trades } = useTrades();
  const { getEffectiveRange } = useDateRange();
  const effectiveRange = getEffectiveRange('range-analysis');

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const entryDate = new Date(t.entryTime);
      return isWithinInterval(entryDate, { start: effectiveRange.from, end: effectiveRange.to });
    });
  }, [trades, effectiveRange]);

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  const dailyData = [
    { day: 'Mon', pnl: 1200 },
    { day: 'Tue', pnl: 800 },
    { day: 'Wed', pnl: -400 },
    { day: 'Thu', pnl: 2400 },
    { day: 'Fri', pnl: 1800 },
  ];

  const weekdayData = [
    { day: 'Monday', pnl: 4500 },
    { day: 'Tuesday', pnl: 3200 },
    { day: 'Wednesday', pnl: -1200 },
    { day: 'Thursday', pnl: 5800 },
    { day: 'Friday', pnl: 4100 },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Range Analysis" 
        subtitle="Performance metrics across multiple sessions"
      />

      {/* Row 1: Scorecards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Scorecard label="Total Sessions" value="22" secondary="18 Green / 4 Red" />
        <Scorecard label="Avg Daily P&L" value="+$842.50" trend={{ value: 15, label: 'vs prev', positive: true }} />
        <Scorecard label="Consistency Score" value="84/100" secondary="High stability" />
        <Scorecard label="Avg Trades/Day" value="8.4" secondary="Within target range" />
      </div>

      {/* Row 2: Cumulative Equity + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <EquityCurveChart className="h-full" />
        </div>
        <div className="lg:col-span-4">
          <Card className="h-full p-6">
            <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Pattern Summary</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  </div>
                  <span className="text-sm font-medium">Morning Breakout</span>
                </div>
                <Badge variant="positive">82% Win Rate</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-rose-500/10 rounded-lg">
                    <Target className="w-4 h-4 text-rose-500" />
                  </div>
                  <span className="text-sm font-medium">Lunch Fades</span>
                </div>
                <Badge variant="negative">24% Win Rate</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Award className="w-4 h-4 text-indigo-500" />
                  </div>
                  <span className="text-sm font-medium">Trend Continuation</span>
                </div>
                <Badge variant="positive">74% Win Rate</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Row 3: 3 equal chart cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 h-[320px]">
          <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Daily P&L</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <Bar dataKey="pnl">
                  {dailyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl > 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 h-[320px]">
          <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Weekday Performance</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayData}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <Bar dataKey="pnl" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <HourlyPerformanceChart />
      </div>

      {/* Row 4: Heatmap Card */}
      <Card className="p-6">
        <h3 className="text-xs font-bold uppercase text-muted-foreground mb-6">Performance Heatmap</h3>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => (
            <div 
              key={i} 
              onClick={() => handleAction(`View Session for Day ${i + 1}`)}
              className={cn(
                "aspect-square rounded-lg border border-border/50 cursor-pointer transition-transform hover:scale-110",
                i % 5 === 0 ? "bg-emerald-500/40" : i % 7 === 0 ? "bg-rose-500/40" : "bg-accent/20"
              )}
            />
          ))}
        </div>
      </Card>

      {/* Row 5: Insights */}
      <Card className="p-6">
        <h3 className="font-bold mb-4">Range Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold">Strongest Window: 10:00 AM - 11:30 AM</p>
                <p className="text-xs text-muted-foreground mt-1">You generate 72% of your profits in this 90-minute window. Focus your maximum energy here.</p>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                <Target className="w-4 h-4 text-rose-500" />
              </div>
              <div>
                <p className="text-sm font-bold">Weakest Window: 12:00 PM - 1:30 PM</p>
                <p className="text-xs text-muted-foreground mt-1">You have a -12% win rate during lunch. Consider a mandatory break during this time.</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <TradePerformanceLog 
        trades={filteredTrades} 
        title="Range Performance Logs"
        subtitle="Complete trade audit for the selected range"
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
