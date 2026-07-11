import React, { useState, useEffect } from 'react';
import { cn } from '@/src/utils';
import { SectionHeader, Card, Button, Badge, Toast } from '../components/Shared';
import { Search, Plus, Calendar, Share2, MessageSquare, ExternalLink, RotateCcw, Trash2, BookOpen, Edit3, Link as LinkIcon, Zap, X, TrendingUp, TrendingDown, BrainCircuit } from 'lucide-react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';

export default function JournalScreen() {
  const { user } = useAuth();
  const { selectedTradeForJournal, setSelectedTradeForJournal } = useTrades();
  const [selectedJournal, setSelectedJournal] = useState<any>(null);
  const [journals, setJournals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!user) return;
    const userId = user.uid;
    const unsubscribe = onSnapshot(
      query(collection(db, 'journals'), where('userId', '==', userId), orderBy('date', 'desc')),
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setJournals(docs);
        setIsLoading(false);
        if (docs.length > 0 && !selectedJournal) {
          setSelectedJournal(docs[0]);
        }
      }
    );
    return () => unsubscribe();
  }, [selectedJournal, user]);

  useEffect(() => {
    if (selectedTradeForJournal) {
      // Pre-fill logic or show "New Journal" with trade context
      setToast({ 
        message: `Creating new journal for trade ${selectedTradeForJournal.id} (${selectedTradeForJournal.symbol})`, 
        type: 'success' 
      });
      // In a real app, we'd open a "New Journal" form here
      // For now, let's just clear it after showing the toast
      const timer = setTimeout(() => setSelectedTradeForJournal(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [selectedTradeForJournal, setSelectedTradeForJournal]);

  const [isPublicPreview, setIsPublicPreview] = useState(false);

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  if (isPublicPreview && selectedJournal) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto p-4 md:p-12">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-black tracking-tighter text-slate-900 uppercase">Trading Workshop OS</span>
            </div>
            <Button variant="outline" icon={X} onClick={() => setIsPublicPreview(false)}>Close Preview</Button>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-black tracking-tight text-slate-900 leading-tight">{selectedJournal.title}</h1>
              <div className="flex items-center space-x-4 text-sm font-bold text-slate-400 uppercase tracking-widest">
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-2" />
                  {selectedJournal.date}
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                <div className="flex items-center">
                  <BookOpen className="w-4 h-4 mr-2" />
                  Trade Analysis
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Session PnL</p>
                <p className={cn("text-2xl font-black", (selectedJournal.pnl || 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>
                  {(selectedJournal.pnl || 0) >= 0 ? '+' : ''}${Math.abs(selectedJournal.pnl || 0).toLocaleString()}
                </p>
              </div>
              <div className="p-6 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Trades Analyzed</p>
                <p className="text-2xl font-black text-slate-900">{selectedJournal.tradesCount || 0}</p>
              </div>
              <div className="p-6 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Execution Grade</p>
                <p className="text-2xl font-black text-indigo-600">{selectedJournal.grade || 'N/A'}</p>
              </div>
            </div>

            <div className="p-10 rounded-[40px] bg-white border border-slate-100 shadow-xl shadow-slate-200/50 space-y-8">
              <div className="prose prose-slate max-w-none">
                <p className="text-lg leading-relaxed text-slate-600 font-medium whitespace-pre-wrap">
                  {selectedJournal.content || "No content provided."}
                </p>
              </div>

              {selectedJournal.linkedTrades && selectedJournal.linkedTrades.length > 0 && (
                <div className="pt-10 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Key Trades from this Session</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedJournal.linkedTrades.map((t: any, idx: number) => (
                      <div key={idx} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center",
                            t.pnl >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10"
                          )}>
                            {t.pnl >= 0 ? <TrendingUp className="w-5 h-5 text-emerald-600" /> : <TrendingDown className="w-5 h-5 text-rose-600" />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{t.symbol} {t.direction} @ {t.price}</p>
                            <p className={cn("text-[10px] font-bold uppercase tracking-widest", t.pnl >= 0 ? "text-emerald-600" : "text-rose-600")}>
                              {t.pnl >= 0 ? '+' : ''}${Math.abs(t.pnl).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" icon={ExternalLink} className="h-8 w-8 p-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-8 rounded-[40px] bg-white border border-slate-100 shadow-sm space-y-4">
                <div className="flex items-center space-x-3 mb-2">
                  <BrainCircuit className="w-5 h-5 text-indigo-500" />
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Behavioral Insights</h4>
                </div>
                <ul className="space-y-3">
                  {selectedJournal.insights && selectedJournal.insights.length > 0 ? selectedJournal.insights.map((insight: string, idx: number) => (
                    <li key={idx} className="flex items-center text-sm font-bold text-slate-700">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3" />
                      {insight}
                    </li>
                  )) : (
                    <li className="text-sm text-slate-400 italic">No insights recorded</li>
                  )}
                </ul>
              </div>
              <div className="p-8 rounded-[40px] bg-white border border-slate-100 shadow-sm space-y-4">
                <div className="flex items-center space-x-3 mb-2">
                  <Zap className="w-5 h-5 text-emerald-500" />
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Action Summary</h4>
                </div>
                <ul className="space-y-3">
                  {selectedJournal.actions && selectedJournal.actions.length > 0 ? selectedJournal.actions.map((action: string, idx: number) => (
                    <li key={idx} className="flex items-center text-sm font-bold text-slate-700">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-3" />
                      {action}
                    </li>
                  )) : (
                    <li className="text-sm text-slate-400 italic">No actions recorded</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="p-10 rounded-[40px] bg-indigo-600 text-white space-y-6">
              <div className="flex items-center space-x-3">
                <MessageSquare className="w-6 h-6" />
                <h3 className="text-xl font-bold">Mentor Feedback</h3>
              </div>
              <div className="space-y-4">
                {selectedJournal.mentorComments && selectedJournal.mentorComments.length > 0 ? selectedJournal.mentorComments.map((comment: any, idx: number) => (
                  <div key={idx} className="p-6 bg-white/10 rounded-3xl backdrop-blur-sm border border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-bold">{comment.author}</span>
                      <span className="text-xs opacity-60">{comment.date}</span>
                    </div>
                    <p className="text-lg font-medium leading-relaxed">
                      {comment.text}
                    </p>
                  </div>
                )) : (
                  <div className="p-6 bg-white/10 rounded-3xl backdrop-blur-sm border border-white/10 text-center">
                    <p className="text-sm opacity-60 italic">No mentor feedback yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="text-center py-12">
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Shared via Trading Workshop OS</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] gap-6">
      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Left Column: List */}
      <div className="w-[360px] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Journals</h2>
          <Button variant="primary" icon={Plus} className="px-3 py-1.5 h-auto" onClick={() => handleAction('New Journal')}>New</Button>
        </div>

        <Card className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search journals..." 
              className="w-full pl-10 pr-4 py-2 bg-accent/50 border border-border rounded-xl text-sm focus:outline-none"
            />
          </div>
        </Card>

        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {journals.length > 0 ? journals.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJournal(j)}
              className={cn(
                "w-full text-left p-4 rounded-2xl border transition-all",
                selectedJournal?.id === j.id 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : "bg-card border-border hover:bg-accent"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase opacity-70">{j.date}</span>
                <Badge variant={j.status === 'shared' ? 'positive' : 'neutral'}>
                  {j.status}
                </Badge>
              </div>
              <h4 className="font-bold text-sm mb-1">{j.title}</h4>
              <p className={cn(
                "text-xs truncate",
                selectedJournal?.id === j.id ? "text-primary-foreground/70" : "text-muted-foreground"
              )}>
                {j.preview}
              </p>
            </button>
          )) : (
            <div className="text-center py-12 text-muted-foreground italic text-sm">
              No journals found.
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Detail */}
      <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2">
        {selectedJournal ? (
          <>
            <Card className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">{selectedJournal.title}</h1>
                  <div className="flex items-center mt-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4 mr-2" />
                    {selectedJournal.date}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button variant="outline" icon={Trash2} className="text-rose-500 hover:text-rose-500" onClick={() => handleAction('Delete Journal')} />
                  <Button variant="outline" icon={Edit3} onClick={() => handleAction('Edit Journal')}>Edit</Button>
                </div>
              </div>

              <div className="space-y-8">
                <div className="p-6 rounded-3xl bg-slate-50 border border-slate-100 space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Why did you enter?</label>
                    <p className="text-sm font-medium text-slate-900 leading-relaxed">
                      {selectedJournal.entryReason || "Not specified."}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Did you follow your plan?</label>
                    <div className="flex items-center space-x-2">
                      <div className={cn("w-2 h-2 rounded-full", selectedJournal.followedPlan ? "bg-emerald-500" : "bg-rose-500")} />
                      <span className={cn("text-sm font-bold", selectedJournal.followedPlan ? "text-emerald-600" : "text-rose-600")}>
                        {selectedJournal.followedPlan ? "Yes, perfectly" : "No, deviated"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">What would you change?</label>
                    <p className="text-sm font-medium text-slate-900 leading-relaxed">
                      {selectedJournal.improvements || "No improvements noted."}
                    </p>
                  </div>
                </div>

                <div className="prose prose-invert max-w-none">
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {selectedJournal.content || "No detailed content provided."}
                  </p>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-8">
                <section>
                  <h4 className="text-xs font-bold uppercase text-muted-foreground mb-4">Linked Session</h4>
                  {selectedJournal.linkedSession ? (
                    <div className="p-4 bg-accent/30 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold">{selectedJournal.linkedSession.date} Session</p>
                        <p className={cn("text-xs", selectedJournal.linkedSession.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                          {selectedJournal.linkedSession.pnl >= 0 ? '+' : ''}${selectedJournal.linkedSession.pnl.toLocaleString()} Net P&L
                        </p>
                      </div>
                      <Button variant="ghost" icon={ExternalLink} onClick={() => handleAction('View Linked Session')} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No session linked.</p>
                  )}
                </section>
                <section>
                  <h4 className="text-xs font-bold uppercase text-muted-foreground mb-4">Linked Trades</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedJournal.linkedTrades && selectedJournal.linkedTrades.length > 0 ? selectedJournal.linkedTrades.map((t: any, idx: number) => (
                      <Badge key={idx} variant="neutral" className="cursor-pointer hover:bg-accent transition-colors" onClick={() => handleAction(`View Trade ${t.id}`)}>{t.id}</Badge>
                    )) : (
                      <p className="text-xs text-muted-foreground italic">No trades linked.</p>
                    )}
                  </div>
                </section>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <Share2 className="w-5 h-5 text-primary" />
                    <h3 className="font-bold">Share Panel</h3>
                  </div>
                  <Badge variant={selectedJournal.status === 'shared' ? 'positive' : 'neutral'}>
                    {selectedJournal.status === 'shared' ? 'Publicly Shared' : 'Private'}
                  </Badge>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-accent/30 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Share Link</span>
                      <span className="text-emerald-500 font-bold">{selectedJournal.access || 0} views</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input 
                        readOnly 
                        value={selectedJournal.shareUrl || "No share URL generated"} 
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono"
                      />
                      <Button variant="outline" className="h-auto py-1.5 text-xs" onClick={() => handleAction('Link Copied')}>Copy</Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button variant="primary" className="w-full" icon={ExternalLink} onClick={() => setIsPublicPreview(true)}>Preview Public Page</Button>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" icon={LinkIcon} onClick={() => handleAction('New Link Created')}>New Link</Button>
                      <Button variant="outline" className="flex-1 text-rose-500 hover:text-rose-500" onClick={() => handleAction('Access Revoked')}>Revoke</Button>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center space-x-3 mb-6">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  <h3 className="font-bold">Mentor Comments</h3>
                </div>
                <div className="space-y-4">
                  {selectedJournal.mentorComments && selectedJournal.mentorComments.length > 0 ? selectedJournal.mentorComments.map((comment: any, idx: number) => (
                    <div key={idx} className="p-4 bg-accent/50 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold">{comment.author}</span>
                        <span className="text-[10px] text-muted-foreground">{comment.date}</span>
                      </div>
                      <p className="text-sm">{comment.text}</p>
                    </div>
                  )) : (
                    <div className="text-center py-4 text-muted-foreground italic text-xs">
                      No mentor comments yet.
                    </div>
                  )}
                  <Button variant="ghost" className="w-full text-xs" onClick={() => handleAction('Add Comment')}>Add Mentor Comment</Button>
                </div>
              </Card>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
            <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center mb-6">
              <BookOpen className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold">Select a journal</h2>
            <p className="text-muted-foreground mt-2 max-w-sm">
              Choose a journal from the list on the left to view its contents and analysis.
            </p>
          </div>
        )}
      </div>
    </div>

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
