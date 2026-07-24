import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo } from 'react';
import { Trade, ReconstructionStep, BrokerAccount } from '../types';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, addDoc, serverTimestamp, writeBatch, doc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { useAuth } from './AuthContext';

export interface AccountOption {
  connectionId: string;
  accountId: string;
  brokerName: string;
  accountName: string;
}

// Filter selections for the global Filters dropdown — empty array means "no
// restriction" for that field (a trade only needs to match a field if the
// user has picked at least one value for it).
export interface TradeFilters {
  symbols: string[];
  sides: ('LONG' | 'SHORT')[];
  grades: string[];
  tags: string[];
}

export const EMPTY_TRADE_FILTERS: TradeFilters = { symbols: [], sides: [], grades: [], tags: [] };

// The set of values actually present across the account-filtered trades,
// so the Filters dropdown only ever offers choices that exist in the data.
export interface TradeFilterOptions {
  symbols: string[];
  grades: string[];
  tags: string[];
}

// Trades imported before per-account tagging existed have no accountId; the
// server-side CSV upload route also hardcoded the literal "manual-account"
// before real account selection existed, and reconstructTrades() itself
// falls back to "manual" when called with no accountContext (e.g. Add Trade
// with no account picked). All three are treated as "Unassigned".
function isUnassigned(trade: Trade): boolean {
  return !trade.accountId || trade.accountId === 'manual-account' || trade.accountId === 'manual';
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider: any) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface TradeContextType {
  trades: Trade[];
  // Trades filtered by `accountFilter` — 'all' | 'unassigned' | '{connectionId}::{accountId}'.
  // Centralized here (rather than duplicated per-screen) so the Trades,
  // Dashboard, and Sessions screens all respect the same selected account.
  accountFilteredTrades: Trade[];
  accountFilter: string;
  setAccountFilter: (filter: string) => void;
  accountOptions: AccountOption[];
  // Further filtered by `filters` (symbol/side/grade/tag) on top of the
  // account filter above — this is what screens should actually render.
  filteredTrades: Trade[];
  filters: TradeFilters;
  setFilters: (filters: TradeFilters) => void;
  filterOptions: TradeFilterOptions;
  addTrades: (trades: Trade[], steps?: ReconstructionStep[]) => Promise<void>;
  deleteTrade: (tradeId: string) => Promise<void>;
  deleteTrades: (tradeIds: string[]) => Promise<void>;
  logTradeIntent: (symbol: string, checklist: any, isOverride: boolean) => Promise<void>;
  clearTrades: () => void;
  isLiveSyncing: boolean;
  selectedTradeForJournal: Trade | null;
  setSelectedTradeForJournal: (trade: Trade | null) => void;
  selectedSessionForJournal: { sessionId: string; sessionDate: string } | null;
  setSelectedSessionForJournal: (session: { sessionId: string; sessionDate: string } | null) => void;
  // Cross-screen request to open a specific trade's detail drawer — set from
  // the Journal screen's "View Trade Details" button, consumed by whichever
  // TradePerformanceLog instance mounts next (e.g. after switching to the
  // Trades screen), then cleared.
  tradeIdToOpen: string | null;
  setTradeIdToOpen: (tradeId: string | null) => void;
  isLoading: boolean;
  error: string | null;
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

export function TradeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [trades, setTradesState] = useState<Trade[]>([]);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);
  const [selectedTradeForJournal, setSelectedTradeForJournal] = useState<Trade | null>(null);
  const [selectedSessionForJournal, setSelectedSessionForJournal] = useState<{ sessionId: string; sessionDate: string } | null>(null);
  const [tradeIdToOpenState, setTradeIdToOpenState] = useState<string | null>(null);
  const [accountFilter, setAccountFilterState] = useState('all');
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);

  // Restore the user's last-picked account filter so they don't have to
  // reselect it every session. Scoped per-user (not a shared key) since the
  // same browser/device could be used to log into more than one account.
  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem(`accountFilter_${user.uid}`);
    if (saved) setAccountFilterState(saved);
  }, [user?.uid]);

  const setAccountFilter = (filter: string) => {
    setAccountFilterState(filter);
    if (user) localStorage.setItem(`accountFilter_${user.uid}`, filter);
  };
  const [filters, setFilters] = useState<TradeFilters>(EMPTY_TRADE_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A cross-screen "open this trade" request must actually be able to find
  // the trade — but the receiving screen only ever sees the filtered trade
  // list, so a persisted account filter or an active Filters selection
  // could silently exclude the requested trade and leave the drawer never
  // opening. Clearing both here guarantees the trade is visible wherever
  // TradePerformanceLog picks up the request next.
  const tradeIdToOpen = tradeIdToOpenState;
  const setTradeIdToOpen = (tradeId: string | null) => {
    if (tradeId) {
      setAccountFilter('all');
      setFilters(EMPTY_TRADE_FILTERS);
    }
    setTradeIdToOpenState(tradeId);
  };

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      console.log("TradeContext: Testing Firestore connection...");
      try {
        const testDoc = await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("TradeContext: Firestore connection successful. Test doc exists:", testDoc.exists());
      } catch (error) {
        console.error("TradeContext: Firestore connection test failed:", error);
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("TradeContext: Please check your Firebase configuration. The client is reporting as offline.");
        }
      }
    }
    testConnection();
  }, []);

  // Live Sync Logic
  useEffect(() => {
    if (!user) {
      setTradesState([]);
      setIsLiveSyncing(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLiveSyncing(true);
    setIsLoading(true);
    setError(null);
    
    // Use a simpler query first to avoid index issues if possible, 
    // or at least handle the error better.
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', user.uid)
      // Removing orderBy temporarily to diagnose if it's an index issue
      // orderBy('entryTime', 'desc')
    );

    console.log("Starting Trade Sync for UID:", user.uid);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const liveTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trade));
      
      // Sort client-side for now to be safe
      liveTrades.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());
      
      console.log(`Synced ${liveTrades.length} trades from Firestore`);
      setTradesState(liveTrades);
      setIsLoading(false);
      setError(null);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'trades');
    });

    return () => unsubscribe();
  }, [user]);

  // Flattened list of every named account the user has created (across all
  // their broker connections), for the account filter dropdown. Subscribed
  // live at both levels so adding/removing an account under an existing
  // connection is reflected immediately, not just on the next connection change.
  useEffect(() => {
    if (!user) {
      setAccountOptions([]);
      return;
    }

    const accountsByConnection = new Map<string, AccountOption[]>();
    const accountUnsubscribes = new Map<string, () => void>();

    const rebuild = () => {
      setAccountOptions(Array.from(accountsByConnection.values()).flat());
    };

    const unsubscribeConnections = onSnapshot(
      query(collection(db, 'broker_connections'), where('userId', '==', user.uid)),
      (snapshot) => {
        const seenIds = new Set(snapshot.docs.map(d => d.id));
        for (const [connId, unsub] of accountUnsubscribes.entries()) {
          if (!seenIds.has(connId)) {
            unsub();
            accountUnsubscribes.delete(connId);
            accountsByConnection.delete(connId);
          }
        }

        snapshot.docs.forEach(connDoc => {
          const brokerName = (connDoc.data() as any).brokerName || 'Unknown';
          if (!accountUnsubscribes.has(connDoc.id)) {
            const unsub = onSnapshot(
              collection(db, 'broker_connections', connDoc.id, 'accounts'),
              (accountsSnap) => {
                accountsByConnection.set(connDoc.id, accountsSnap.docs.map(d => ({
                  connectionId: connDoc.id,
                  accountId: d.id,
                  brokerName,
                  accountName: (d.data() as BrokerAccount).displayName,
                })));
                rebuild();
              }
            );
            accountUnsubscribes.set(connDoc.id, unsub);
          }
        });

        rebuild();
      }
    );

    return () => {
      unsubscribeConnections();
      accountUnsubscribes.forEach(unsub => unsub());
    };
  }, [user]);

  const accountFilteredTrades = useMemo(() => {
    if (accountFilter === 'all') return trades;
    if (accountFilter === 'unassigned') return trades.filter(isUnassigned);
    return trades.filter(t => `${t.connectionId}::${t.accountId}` === accountFilter);
  }, [trades, accountFilter]);

  const filterOptions = useMemo<TradeFilterOptions>(() => {
    const symbols = new Set<string>();
    const grades = new Set<string>();
    const tags = new Set<string>();
    accountFilteredTrades.forEach(t => {
      if (t.symbol) symbols.add(t.symbol);
      if (t.tradeGrade) grades.add(t.tradeGrade);
      (t.tags || []).forEach(tag => tags.add(tag));
    });
    return {
      symbols: Array.from(symbols).sort(),
      grades: Array.from(grades).sort(),
      tags: Array.from(tags).sort(),
    };
  }, [accountFilteredTrades]);

  const filteredTrades = useMemo(() => {
    if (filters.symbols.length === 0 && filters.sides.length === 0 && filters.grades.length === 0 && filters.tags.length === 0) {
      return accountFilteredTrades;
    }
    return accountFilteredTrades.filter(t => {
      if (filters.symbols.length > 0 && !filters.symbols.includes(t.symbol)) return false;
      if (filters.sides.length > 0 && !filters.sides.includes(t.direction)) return false;
      if (filters.grades.length > 0 && (!t.tradeGrade || !filters.grades.includes(t.tradeGrade))) return false;
      if (filters.tags.length > 0 && !(t.tags || []).some(tag => filters.tags.includes(tag))) return false;
      return true;
    });
  }, [accountFilteredTrades, filters]);

  const addTrades = async (newTrades: Trade[], _steps: ReconstructionStep[] = []) => {
    if (!user) return;

    // Filter out trades that already exist in the state (optimistic check)
    const existingHashes = new Set(trades.map(t => t.dedupeHash));
    const uniqueNewTrades = newTrades.filter(t => !existingHashes.has(t.dedupeHash));
    
    // Also remove duplicates within the new set itself
    const trulyUnique = uniqueNewTrades.filter((trade, index, self) =>
      index === self.findIndex((t) => t.dedupeHash === trade.dedupeHash)
    );

    if (trulyUnique.length === 0) return;

    try {
      console.log(`Adding ${trulyUnique.length} unique trades to Firestore...`);
      
      // Use batches for efficiency and atomicity
      const batchSize = 500; // Firestore limit is 500 per batch
      for (let i = 0; i < trulyUnique.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = trulyUnique.slice(i, i + batchSize);
        
        chunk.forEach(trade => {
          const { id, ...tradeData } = trade; // Remove temp ID
          
          // Final check for NaN values which Firestore rejects
          const sanitizedData = JSON.parse(JSON.stringify(tradeData, (key, value) => {
            if (typeof value === 'number' && isNaN(value)) return 0;
            return value;
          }));

          const docRef = doc(db, 'trades', trade.dedupeHash);
          batch.set(docRef, {
            ...sanitizedData,
            id: trade.dedupeHash,
            userId: user.uid,
            sessionDate: trade.entryTime.split('T')[0],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'trades');
        }
      }
      
      console.log("Successfully persisted all trades.");
    } catch (error) {
      console.error("Error persisting trades:", error);
      throw error;
    }
  };

  const deleteTrades = async (tradeIds: string[]) => {
    if (!user) return;
    const uniqueIds = Array.from(new Set(tradeIds)).filter(Boolean);
    if (uniqueIds.length === 0) return;

    try {
      console.log(`Deleting ${uniqueIds.length} trade(s) from Firestore...`);

      // Optimistically remove from local state immediately for responsive UI
      setTradesState(prev => prev.filter(t => !uniqueIds.includes(t.id)));

      const batchSize = 500; // Firestore batch limit
      for (let i = 0; i < uniqueIds.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = uniqueIds.slice(i, i + batchSize);
        chunk.forEach(id => {
          batch.delete(doc(db, 'trades', id));
        });
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'trades');
        }
      }

      console.log("Successfully deleted trade(s).");
    } catch (error) {
      console.error("Error deleting trade(s):", error);
      throw error;
    }
  };

  const deleteTrade = async (tradeId: string) => {
    await deleteTrades([tradeId]);
  };

  const logTradeIntent = async (symbol: string, checklist: any, isOverride: boolean) => {
    if (!user) return;
    try {
      const isValidSetup = Object.values(checklist).every(v => v === true);
      const intentData = {
        userId: user.uid,
        symbol,
        checklist,
        isValidSetup,
        overrideUsed: isOverride,
        confirmedAt: new Date().toISOString(),
        status: 'pending',
        timestamp: serverTimestamp()
      };
      await addDoc(collection(db, 'trade_intents'), intentData);
      console.log("Trade intent logged successfully");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'trade_intents');
    }
  };

  const clearTrades = () => {
    setTradesState([]);
  };

  return (
    <TradeContext.Provider value={{
      trades,
      accountFilteredTrades,
      accountFilter,
      setAccountFilter,
      accountOptions,
      filteredTrades,
      filters,
      setFilters,
      filterOptions,
      addTrades,
      deleteTrade,
      deleteTrades,
      logTradeIntent,
      clearTrades,
      isLiveSyncing,
      selectedTradeForJournal,
      setSelectedTradeForJournal,
      selectedSessionForJournal,
      setSelectedSessionForJournal,
      tradeIdToOpen,
      setTradeIdToOpen,
      isLoading,
      error
    }}>
      {children}
    </TradeContext.Provider>
  );
}

export function useTrades() {
  const context = useContext(TradeContext);
  if (context === undefined) {
    throw new Error('useTrades must be used within a TradeProvider');
  }
  return context;
}
