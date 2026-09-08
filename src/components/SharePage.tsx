// The public, unauthenticated page a /share/{token} URL renders — see
// src/lib/shareLinks.ts and the share_links rules block for the security
// model. Rendered by App.tsx *instead of* the normal signed-in app (no
// AuthProvider/TradeProvider — this has to work for a viewer with no
// account), so everything it needs is fetched directly here with plain
// Firestore calls, gated entirely by the resource's own `status: 'shared'`
// field rather than any auth check.
import React, { useEffect, useState } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { getShareLinkByToken } from '../lib/shareLinks';
import { JournalEntry, Trade, ShareLink } from '../types';
import { Card, Badge } from './Shared';
import { cn } from '@/src/utils';
import { Loader2, Zap, Calendar, TrendingUp, TrendingDown, Ban } from 'lucide-react';

type LoadState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'journal'; journal: JournalEntry }
  | { status: 'trade'; trade: Trade; note: JournalEntry | null };

async function loadJournal(resourceId: string): Promise<JournalEntry | null> {
  const snap = await getDoc(doc(db, 'journals', resourceId));
  if (!snap.exists() || snap.data().status !== 'shared') return null;
  return { id: snap.id, ...(snap.data() as Omit<JournalEntry, 'id'>) };
}

async function loadTrade(resourceId: string): Promise<{ trade: Trade; note: JournalEntry | null } | null> {
  const snap = await getDoc(doc(db, 'trades', resourceId));
  if (!snap.exists() || snap.data().status !== 'shared') return null;
  const trade = { id: snap.id, ...(snap.data() as Omit<Trade, 'id'>) };

  // Only a note that's *also* explicitly shared comes along — createShareLink
  // shares a trade's linked note automatically, but a note that was unlinked
  // or unshared separately since then shouldn't reappear here.
  const noteSnap = await getDocs(query(
    collection(db, 'journals'),
    where('tradeId', '==', resourceId),
    where('status', '==', 'shared')
  ));
  const note = noteSnap.docs[0] ? { id: noteSnap.docs[0].id, ...(noteSnap.docs[0].data() as Omit<JournalEntry, 'id'>) } : null;
  return { trade, note };
}

function BrandHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
        <Zap className="w-5 h-5 text-white" />
      </div>
      <span className="text-lg font-black tracking-tighter text-foreground uppercase">Trading Workshop OS</span>
    </div>
  );
}

function NoteView({ journal }: { journal: JournalEntry }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl md:text-4xl font-black tracking-tight text-foreground leading-tight text-balance">{journal.title}</h1>
      <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
        <Calendar className="w-3.5 h-3.5" />
        {journal.date}
      </div>
      {journal.tags && journal.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {journal.tags.map(t => <Badge key={t} variant="neutral">{t}</Badge>)}
        </div>
      )}
      <Card className="p-8 md:p-10">
        {journal.content ? (
          <div className="rich-content text-base leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: journal.content }} />
        ) : (
          <p className="text-sm text-muted-foreground italic">No content.</p>
        )}
      </Card>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="p-4 rounded-2xl bg-card border border-border">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
      <p className={cn(
        'text-xl font-black',
        tone === 'positive' && 'text-emerald-500',
        tone === 'negative' && 'text-rose-500',
        !tone && 'text-foreground'
      )}>
        {value}
      </p>
    </div>
  );
}

function TradeView({ trade, note }: { trade: Trade; note: JournalEntry | null }) {
  const pnl = trade.realizedPnL ?? trade.pnlCurrency ?? 0;
  const isWinner = pnl >= 0;
  const hold = trade.holdTimeSeconds < 60
    ? `${trade.holdTimeSeconds.toFixed(0)}s`
    : `${(trade.holdTimeSeconds / 60).toFixed(1)}m`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">{trade.symbol}</h1>
        <Badge variant={trade.direction === 'LONG' ? 'positive' : 'negative'}>
          {trade.direction === 'LONG' ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
          {trade.direction}
        </Badge>
        {trade.tradeGrade && <Badge variant="info" className="font-mono">{trade.tradeGrade}</Badge>}
      </div>
      <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
        <Calendar className="w-3.5 h-3.5" />
        {new Date(trade.entryTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Net P&L" value={`${isWinner ? '+' : ''}$${pnl.toFixed(2)}`} tone={isWinner ? 'positive' : 'negative'} />
        <StatTile label="Entry" value={trade.avgEntryPrice.toFixed(2)} />
        <StatTile label="Exit" value={trade.avgExitPrice.toFixed(2)} />
        <StatTile label="Hold Time" value={hold} />
      </div>

      {note && (
        <Card className="p-8 md:p-10 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{note.title}</h2>
          {note.content ? (
            <div className="rich-content text-base leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: note.content }} />
          ) : (
            <p className="text-sm text-muted-foreground italic">No content.</p>
          )}
        </Card>
      )}
    </div>
  );
}

export function SharePage({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const link: ShareLink | null = await getShareLinkByToken(token);
        if (!link || link.revoked) {
          if (!cancelled) setState({ status: 'invalid' });
          return;
        }
        if (link.resourceType === 'journal') {
          const journal = await loadJournal(link.resourceId);
          if (!cancelled) setState(journal ? { status: 'journal', journal } : { status: 'invalid' });
        } else {
          const result = await loadTrade(link.resourceId);
          if (!cancelled) setState(result ? { status: 'trade', ...result } : { status: 'invalid' });
        }
      } catch (err) {
        console.error('Failed to load shared link:', err);
        if (!cancelled) setState({ status: 'invalid' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10 md:py-16 space-y-10">
        <BrandHeader />

        {state.status === 'loading' && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          </div>
        )}

        {state.status === 'invalid' && (
          <Card className="p-10 text-center space-y-3">
            <Ban className="w-8 h-8 text-muted-foreground mx-auto" />
            <h1 className="text-lg font-bold text-foreground">This link isn't available</h1>
            <p className="text-sm text-muted-foreground">It may have been revoked, or the person who shared it has made it private again.</p>
          </Card>
        )}

        {state.status === 'journal' && <NoteView journal={state.journal} />}
        {state.status === 'trade' && <TradeView trade={state.trade} note={state.note} />}
      </div>
    </div>
  );
}
