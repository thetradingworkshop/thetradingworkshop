import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Button } from '../components/Shared';
import { FileText, Download, Eye, Share2, User } from 'lucide-react';

import { useDateRange } from '../context/DateContext';
import { useTrades } from '../context/TradeContext';
import { isWithinInterval, startOfWeek, endOfWeek } from 'date-fns';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { useAuth } from '../context/AuthContext';
import { subscribeReports, downloadReportAsText, WeeklyReport } from '../lib/weeklyReports';
import { WeeklyReportViewer } from '../components/WeeklyReportViewer';
import { WeekPicker } from '../components/DateRangePicker';

export default function WeeklyReportsScreen() {
  const { user } = useAuth();
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [viewingReport, setViewingReport] = useState<WeeklyReport | null>(null);
  const { getEffectiveRange, setPageOverride } = useDateRange();
  // filteredTrades (not the raw, all-accounts/all-symbols `trades`) so the
  // weekly log respects the header's Filters/Account selection, same as
  // Dashboard/Trades/Range Analysis — this page used to ignore it.
  const { filteredTrades: trades } = useTrades();
  const effectiveRange = getEffectiveRange('weekly-reports');

  const weekStart = startOfWeek(effectiveRange.from, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(effectiveRange.from, { weekStartsOn: 1 });

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const entryDate = new Date(t.entryTime);
      return isWithinInterval(entryDate, { start: weekStart, end: weekEnd });
    });
  }, [trades, weekStart, weekEnd]);

  const handleWeekChange = (newDate: Date) => {
    setPageOverride('weekly-reports', {
      from: newDate,
      to: newDate, // The WeekPicker handles the range internally for display, but we store a point in time
      label: 'Selected Week'
    });
  };

  useEffect(() => {
    if (!user) { setReports([]); return; }
    return subscribeReports(user.uid, setReports);
  }, [user?.uid]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Weekly Reports"
        subtitle="Performance summaries and behavioral analysis reports"
        rightElement={
          <div className="flex flex-wrap items-center gap-4">
            <WeekPicker selectedDate={effectiveRange.from} onChange={handleWeekChange} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        {reports.length > 0 ? reports.map((report) => (
          <Card key={report.id} className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-accent rounded-2xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-bold">{report.week}</h3>
                  <div className="flex items-center mt-1 space-x-3 text-xs text-muted-foreground">
                    <span className="flex items-center"><User className="w-3 h-3 mr-1" /> {report.student}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-8">
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Net P&L</p>
                  <p className={cn("text-sm font-bold", report.pnl > 0 ? "text-emerald-500" : "text-rose-500")}>
                    {report.pnl > 0 ? '+' : ''}${Math.abs(report.pnl).toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Win Rate</p>
                  <p className="text-sm font-bold">{report.winRate.toFixed(1)}%</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Button variant="ghost" icon={Eye} className="p-2 h-auto" onClick={() => setViewingReport(report)} title="View report" />
                  <Button variant="ghost" icon={Download} className="p-2 h-auto" onClick={() => downloadReportAsText(report)} title="Download report" />
                  <Button variant="ghost" icon={Share2} className="p-2 h-auto" disabled title="A shareable link for reports isn't built yet — notes and trades already have one" />
                </div>
              </div>
            </div>
          </Card>
        )) : (
          <Card className="p-12 text-center text-muted-foreground italic">
            No reports yet — your mentor generates these from your Mentor Dashboard.
          </Card>
        )}
      </div>

      <TradePerformanceLog
        trades={filteredTrades}
        title="Weekly Performance Logs"
        subtitle="Detailed trade audit for the selected week"
      />

      <WeeklyReportViewer report={viewingReport} onClose={() => setViewingReport(null)} />
    </div>
  );
}
