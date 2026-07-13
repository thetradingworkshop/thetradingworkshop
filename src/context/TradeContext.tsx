import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { Trade, ReconstructionStep } from '../types';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, addDoc, serverTimestamp, writeBatch, doc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { useAuth } from './AuthContext';

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
