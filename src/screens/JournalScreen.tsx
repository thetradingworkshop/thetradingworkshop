import React, { useState, useEffect } from 'react';
import { cn, omitUndefined } from '@/src/utils';
import { SectionHeader, Card, Button, Badge, Toast, Modal, Input } from '../components/Shared';
import { Search, Plus, Calendar, Share2, MessageSquare, ExternalLink, RotateCcw, Trash2, BookOpen, Edit3, Link as LinkIcon, Zap, X, TrendingUp, TrendingDown, BrainCircuit, Save, Loader2 } from 'lucide-react';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { JournalEntry } from '../types';
import { RichTextEditor, isContentEmpty, stripHtml } from '../components/RichTextEditor';

type JournalDraft = Partial<JournalEntry>;

function emptyDraft(overrides: Partial<JournalEntry> = {}): JournalDraft {
  return {
    title: '',
    date: new Date().toISOString().slice(0, 10),
    content: '',
    tags: [],
    entryReason: '',
    followedPlan: undefined,
    improvements: '',
    status: 'private',
    sessionId: '',
    ...overrides,
  };
}

export default function JournalScreen() {
  const { user } = useAuth();
  const {
    selectedTradeForJournal, setSelectedTradeForJournal,
    selectedSessionForJournal, setSelectedSessionForJournal,
  } = useTrades();
  const [selectedJournal, setSelectedJournal] = useState<any>(null);
  const [journals, setJournals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [draft, setDraft] = useState<JournalDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isPublicPreview, setIsPublicPreview] = useState(false);

  useEffect(() => {
    if (!user) return;
    const userId = user.uid;
    const unsubscribe = onSnapshot(
      query(collection(db, 'journals'), where('userId', '==', userId), orderBy('date', 'desc')),
      (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setJournals(docs);
        setIsLoading(false);
        setSelectedJournal((prev: any) => {
          if (prev) {
            const stillExists = docs.find(d => d.id === prev.id);
            if (stillExists) return stillExists;
          }
          return docs.length > 0 ? docs[0] : null;
        });
      }
    );
    return () => unsubscribe();
  }, [user]);

  // Trade note: open the existing note for this trade, or start a new one pre-filled from it.
  useEffect(() => {
    if (!selectedTradeForJournal) return;
    const trade: any = selectedTradeForJournal;
    const existing = journals.find(j => j.tradeId === trade.id);
    if (existing) {
      setSelectedJournal(existing);
      setDraft(null);
    } else {
      setDraft(emptyDraft({
        title: `Trade Note — ${trade.symbol} ${trade.direction}`,
        date: trade.sessionDate || (trade.entryTime ? trade.entryTime.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        sessionId: trade.sessionId,
        tradeId: trade.id,
      }));
    }
    setSelectedTradeForJournal(null);
  }, [selectedTradeForJournal]);

  // Daily journal: open the existing entry for this session/day, or start a new one.
  useEffect(() => {
    if (!selectedSessionForJournal) return;
    const { sessionId, sessionDate } = selectedSessionForJournal;
    const existing = journals.find(j => j.sessionId === sessionId && !j.tradeId);
    if (existing) {
      setSelectedJournal(existing);
      setDraft(null);
    } else {
      setDraft(emptyDraft({
        title: `Daily Journal — ${sessionDate}`,
        date: sessionDate,
        sessionId,
      }));
    }
    setSelectedSessionForJournal(null);
  }, [selectedSessionForJournal]);

  const openNew = () => setDraft(emptyDraft());
  const openEdit = () => selectedJournal && setDraft({ ...selectedJournal });
  const closeDraft = () => setDraft(null);

  const saveDraft = async () => {
    if (!draft || !user) return;
    if (!draft.title?.trim() || isContentEmpty(draft.content)) {
      setToast({ message: 'Title and content are required', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      if (draft.id) {
        const { id, ...rest } = draft;
        await updateDoc(doc(db, 'journals', id), omitUndefined({ ...rest, updatedAt: now }) as any);
        setToast({ message: 'Journal updated', type: 'success' });
      } else {
        const docRef = await addDoc(collection(db, 'journals'), omitUndefined({
          ...draft,
          userId: user.uid,
          sessionId: draft.sessionId || '',
          tags: draft.tags || [],
          status: draft.status || 'private',
          createdAt: now,
          updatedAt: now,
        }));
        setSelectedJournal({ id: docRef.id, ...draft, userId: user.uid, createdAt: now, updatedAt: now });
        setToast({ message: 'Journal created', type: 'success' });
      }
      setDraft(null);
    } catch (error) {
      console.error('Error saving journal:', error);
      setToast({ message: 'Failed to save journal', type: 'error' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteDoc(doc(db, 'journals', pendingDeleteId));
      if (selectedJournal?.id === pendingDeleteId) setSelectedJournal(null);
      setToast({ message: 'Journal deleted', type: 'success' });
    } catch (error) {
      console.error('Error deleting journal:', error);
      setToast({ message: 'Failed to delete journal', type: 'error' });
    } finally {
      setPendingDeleteId(null);
      setTimeout(() => setToast(null), 3000);
    }
  };

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
              <div className="max-w-none">
                {selectedJournal.content ? (
                  <div
                    className="rich-content text-lg leading-relaxed text-slate-600 font-medium"
                    dangerouslySetInnerHTML={{ __html: selectedJournal.content }}
                  />
                ) : (
                  <p className="text-lg leading-relaxed text-slate-600 font-medium">No content provided.</p>
                )}
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
          <Button variant="primary" icon={Plus} className="px-3 py-1.5 h-auto" onClick={openNew}>New</Button>
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
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground italic text-sm">Loading...</div>
          ) : journals.length > 0 ? journals.map((j) => (
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
                  {j.status || 'private'}
                </Badge>
              </div>
              <h4 className="font-bold text-sm mb-1">{j.title}</h4>
              <p className={cn(
                "text-xs truncate",
                selectedJournal?.id === j.id ? "text-primary-foreground/70" : "text-muted-foreground"
              )}>
                {j.content ? stripHtml(j.content).slice(0, 80) : j.preview}
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
                  <Button variant="outline" icon={Trash2} className="text-rose-500 hover:text-rose-500" onClick={() => setPendingDeleteId(selectedJournal.id)} />
                  <Button variant="outline" icon={Edit3} onClick={openEdit}>Edit</Button>
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
                      {selectedJournal.followedPlan === undefined ? (
                        <span className="text-sm font-bold text-slate-400">Not specified</span>
                      ) : (
                        <>
                          <div className={cn("w-2 h-2 rounded-full", selectedJournal.followedPlan ? "bg-emerald-500" : "bg-rose-500")} />
                          <span className={cn("text-sm font-bold", selectedJournal.followedPlan ? "text-emerald-600" : "text-rose-600")}>
                            {selectedJournal.followedPlan ? "Yes, perfectly" : "No, deviated"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">What would you change?</label>
                    <p className="text-sm font-medium text-slate-900 leading-relaxed">
                      {selectedJournal.improvements || "No improvements noted."}
                    </p>
                  </div>
                </div>

                <div className="max-w-none">
                  {selectedJournal.content ? (
                    <div
                      className="rich-content text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: selectedJournal.content }}
                    />
                  ) : (
                    <p className="text-muted-foreground leading-relaxed">No detailed content provided.</p>
                  )}
                </div>

                {selectedJournal.tags && selectedJournal.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedJournal.tags.map((tag: string) => (
                      <Badge key={tag} variant="neutral">{tag}</Badge>
                    ))}
                  </div>
                )}
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
                  ) : selectedJournal.sessionId ? (
                    <div className="p-4 bg-accent/30 rounded-2xl">
                      <p className="text-sm font-bold font-mono">{selectedJournal.sessionId}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No session linked.</p>
                  )}
                </section>
                <section>
                  <h4 className="text-xs font-bold uppercase text-muted-foreground mb-4">Linked Trade</h4>
                  {selectedJournal.tradeId ? (
                    <Badge variant="neutral" className="font-mono">{selectedJournal.tradeId}</Badge>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No trade linked.</p>
                  )}
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={draft !== null}
        onClose={closeDraft}
        title={draft?.id ? 'Edit Journal' : 'New Journal'}
        maxWidth="lg"
        footer={
          <>
            <Button variant="outline" onClick={closeDraft} disabled={isSaving}>Cancel</Button>
            <Button variant="primary" icon={isSaving ? Loader2 : Save} onClick={saveDraft} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Journal'}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Title</label>
                <Input
                  value={draft.title || ''}
                  onChange={(e) => setDraft(prev => prev && ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Monday Recap"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</label>
                <Input
                  type="date"
                  value={draft.date || ''}
                  onChange={(e) => setDraft(prev => prev && ({ ...prev, date: e.target.value }))}
                />
              </div>
            </div>

            {(draft.tradeId || draft.sessionId) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {draft.tradeId && <Badge variant="neutral" className="font-mono">Trade: {draft.tradeId}</Badge>}
                {draft.sessionId && <Badge variant="neutral" className="font-mono">Session: {draft.sessionId}</Badge>}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Content</label>
              <RichTextEditor
                key={draft.id || 'new'}
                initialValue={draft.content || ''}
                onChange={(html) => setDraft(prev => prev && ({ ...prev, content: html }))}
                placeholder="Write your notes..."
                minHeightClass="min-h-[160px]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Why did you enter?</label>
              <textarea
                className="w-full h-16 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                value={draft.entryReason || ''}
                onChange={(e) => setDraft(prev => prev && ({ ...prev, entryReason: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Did you follow your plan?</label>
              <div className="flex gap-2">
                {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => setDraft(prev => prev && ({ ...prev, followedPlan: opt.value }))}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                      draft.followedPlan === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-accent/30 border-border hover:border-primary/50"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">What would you change?</label>
              <textarea
                className="w-full h-16 p-4 bg-accent/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                value={draft.improvements || ''}
                onChange={(e) => setDraft(prev => prev && ({ ...prev, improvements: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags (comma separated)</label>
              <Input
                placeholder="e.g. Discipline, Overtrading"
                value={(draft.tags || []).join(', ')}
                onChange={(e) => setDraft(prev => prev && ({ ...prev, tags: e.target.value.split(',').map(t => t.trim()).filter(t => t !== '') }))}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        title="Delete Journal"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" icon={Trash2} onClick={confirmDelete}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This journal entry will be permanently deleted. This can't be undone.</p>
      </Modal>
    </div>
  );
}
