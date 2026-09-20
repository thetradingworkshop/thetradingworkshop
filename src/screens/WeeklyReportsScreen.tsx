import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Button, Toast } from '../components/Shared';
import { FileText, Download, Eye, Share2, Link as LinkIcon, User } from 'lucide-react';

import { useDateRange } from '../context/DateContext';
import { useTrades } from '../context/TradeContext';
import { isWithinInterval, startOfWeek, endOfWeek } from 'date-fns';
import { TradePerformanceLog } from '../components/TradePerformanceLog';
import { useAuth } from '../context/AuthContext';
import { subscribeReports, downloadReportAsText, WeeklyReport } from '../lib/weeklyReports';
import { subscribeShareLink, createShareLink, revokeShareLink, shareUrl } from '../lib/shareLinks';
import { ShareLink } from '../types';
import { WeeklyReportViewer } from '../components/WeeklyReportViewer';
import { WeekPicker } from '../components/DateRangePicker';

// Per-report share state/actions — a small local component (not inlined in
// the row map) since each report needs its own subscribeShareLink, and
// hooks can't be called inside a loop. Same create/copy/revoke pattern
// SessionDetailScreen.tsx already uses for journal sharing, just pointed at
// 'report' instead of 'journal'.
function ReportShareButton({ userId, reportId }: { userId: string; reportId: string }) {
  const [activeLink, setActiveLink] = useState<ShareLink | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => subscribeShareLink(userId, 'report', reportId, setActiveLink), [userId, reportId]);

  const flashToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  // Copying to the clipboard can fail on its own (permissions, insecure
  // context, an automated browser) even when the share itself succeeded —
  // that's a real state, not a failure of sharing, so it gets its own
  // catch instead of one try/catch around both steps claiming the whole
  // thing failed when only the copy did.
  const handleShare = async () => {
    setIsBusy(true);
    try {
      const token = await createShareLink(userId, 'report', reportId);
      try {
        await navigator.clipboard.writeText(shareUrl(token));
        flashToast('Report shared — link copied');
      } catch {
        flashToast('Report shared — copy the link from the share menu');
      }
    } catch (error) {
      console.error('Failed to share report:', error);
      flashToast('Failed to share report', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!activeLink) return;
    try {
      await navigator.clipboard.writeText(shareUrl(activeLink.id));
      flashToast('Link copied');
    } catch {
      flashToast("Couldn't copy — your browser blocked clipboard access", 'error');
    }
  };

  const handleRevoke = async () => {
    setIsBusy(true);
    try {
      await revokeShareLink(activeLink!);
      flashToast('Link revoked — report is private again');
    } catch (error) {
      console.error('Failed to revoke share link:', error);
      flashToast('Failed to revoke link', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      {activeLink ? (
        <div className="flex items-center">
          <Button variant="ghost" icon={LinkIcon} className="p-2 h-auto" onClick={handleCopy} title="Copy share link" />
          <Button variant="ghost" icon={Share2} className="p-2 h-auto text-rose-500" onClick={handleRevoke} disabled={isBusy} title="Revoke share link" />
        </div>
      ) : (
        <Button variant="ghost" icon={Share2} className="p-2 h-auto" onClick={handleShare} disabled={isBusy} title="Share this report" />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default function WeeklyReportsScreen() {
  const { user } = useAuth();
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  // Tracks the id, not the report object — so an edit made from inside the
  // viewer (e.g. the mentor comment) shows up immediately once the
  // subscription below refreshes `reports`, instead of the modal holding
  // onto whatever snapshot of the report it was opened with.
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);
  const viewingReport = useMemo(
    () => (viewingReportId ? reports.find(r => r.id === viewingReportId) ?? null : null),
    [viewingReportId, reports]
  );
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
                  <Button variant="ghost" icon={Eye} className="p-2 h-auto" onClick={() => setViewingReportId(report.id)} title="View report" />
                  <Button variant="ghost" icon={Download} className="p-2 h-auto" onClick={() => downloadReportAsText(report)} title="Download report" />
                  {user && <ReportShareButton userId={user.uid} reportId={report.id} />}
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

      <WeeklyReportViewer report={viewingReport} onClose={() => setViewingReportId(null)} />
    </div>
  );
}
