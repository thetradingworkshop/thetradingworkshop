import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap, 
  RefreshCw, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  MoreVertical, 
  Trash2, 
  Pause, 
  Play, 
  History, 
  Search,
  Copy,
  Key,
  Globe,
  X,
  Shield,
  ArrowRight,
  Loader2,
  Upload
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { BrokerConnection, IngestionEvent, IngestionError, BrokerAccount, BROKERS, Broker } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/utils';
import { Toast } from '../components/Shared';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../lib/authFetch';

export default function DataConnectionsScreen() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const [errors, setErrors] = useState<IngestionError[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewConnectionModal, setShowNewConnectionModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<BrokerConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [setupStep, setSetupStep] = useState<'select' | 'tradovate_info' | 'account_selection'>('select');
  const [newConnectionId, setNewConnectionId] = useState<string | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<BrokerAccount[]>([]);
  const [uploadingConnId, setUploadingConnId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newAccountBroker, setNewAccountBroker] = useState<Broker>(BROKERS[0]);
  const [newAccountName, setNewAccountName] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  const scrollToIngestionEvents = () => {
    document.getElementById('ingestion-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  useEffect(() => {
    // Check for new connection in URL
    const params = new URLSearchParams(window.location.search);
    const newConnId = params.get('new_connection');
    if (newConnId) {
      setNewConnectionId(newConnId);
      setSetupStep('account_selection');
      setShowNewConnectionModal(true);
      // Clean up URL
      window.history.replaceState({}, '', '/connections');
    }

    if (!user) return;
    const userId = user.uid;

    // Accounts subcollections are subscribed live (not a one-time getDocs) so
    // that adding/removing an account under an already-existing connection
    // updates the "Linked Accounts" count here immediately, instead of only
    // refreshing the next time a connection doc itself changes.
    const connectionsData = new Map<string, BrokerConnection>();
    const accountUnsubscribes = new Map<string, () => void>();

    const rebuildConnections = () => {
      setConnections(Array.from(connectionsData.values()));
    };

    const unsubscribeConnections = onSnapshot(
      query(collection(db, 'broker_connections'), where('userId', '==', userId)),
      (snapshot) => {
        const seenIds = new Set(snapshot.docs.map(d => d.id));

        // Stop listening to accounts for connections that no longer exist.
        for (const [connId, unsub] of accountUnsubscribes.entries()) {
          if (!seenIds.has(connId)) {
            unsub();
            accountUnsubscribes.delete(connId);
            connectionsData.delete(connId);
          }
        }

        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data() as BrokerConnection;
          connectionsData.set(docSnap.id, { ...data, id: docSnap.id, accounts: connectionsData.get(docSnap.id)?.accounts || [] });

          if (!accountUnsubscribes.has(docSnap.id)) {
            const unsub = onSnapshot(
              collection(db, 'broker_connections', docSnap.id, 'accounts'),
              (accountsSnap) => {
                const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BrokerAccount));
                const existing = connectionsData.get(docSnap.id);
                if (existing) connectionsData.set(docSnap.id, { ...existing, accounts });
                rebuildConnections();
              }
            );
            accountUnsubscribes.set(docSnap.id, unsub);
          }
        });

        rebuildConnections();
        setIsLoading(false);
      }
    );

    const unsubscribeEvents = onSnapshot(
      query(collection(db, 'ingestion_events'), orderBy('eventTimestamp', 'desc'), limit(10)),
      (snapshot) => {
        setEvents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IngestionEvent)));
      }
    );

    const unsubscribeErrors = onSnapshot(
      query(collection(db, 'ingestion_errors'), orderBy('createdAt', 'desc'), limit(10)),
      (snapshot) => {
        setErrors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IngestionError)));
      }
    );

    return () => {
      unsubscribeConnections();
      accountUnsubscribes.forEach(unsub => unsub());
      unsubscribeEvents();
      unsubscribeErrors();
    };
  }, []);

  // Ensure Tradovate is always represented
  const tradovateConnection = connections.find(c => c.brokerName === 'tradovate');
  const otherConnections = connections.filter(c => c.brokerName !== 'tradovate');

  const handleSetManualSyncMode = async () => {
    if (!user) return;
    try {
      const response = await authFetch('/api/connections/manual/tradovate', {
        method: 'POST',
      });
      const { connectionId } = await response.json();
      // Connection will be picked up by onSnapshot
      setShowNewConnectionModal(false);
      setToast({ message: 'Manual import mode initialized for Tradovate.', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Failed to set manual sync mode:', error);
      setToast({ message: 'Failed to initialize manual import.', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Creates a named account for organizing imports, under a connection for
  // the chosen broker (reusing an existing connection for that broker if the
  // user already has one, rather than creating a duplicate). Both writes go
  // straight to Firestore from the client — firestore.rules already permits
  // this (ownership via userId on the connection), matching how e.g. tag
  // categories are created elsewhere in the app.
  const handleCreateAccount = async () => {
    if (!user || !newAccountName.trim()) return;
    setIsCreatingAccount(true);
    try {
      let connectionId = connections.find(c => c.brokerName === newAccountBroker)?.id;
      if (!connectionId) {
        const connRef = await addDoc(collection(db, 'broker_connections'), {
          userId: user.uid,
          brokerName: newAccountBroker,
          authType: 'Manual',
          status: 'manual_sync_active',
          environment: 'live',
          syncMode: 'manual_csv',
          importCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        connectionId = connRef.id;
      }

      await addDoc(collection(db, 'broker_connections', connectionId, 'accounts'), {
        connectionId,
        externalAccountId: `manual-${Date.now()}`,
        displayName: newAccountName.trim(),
        status: 'active',
        selectedForSync: true,
        createdAt: new Date().toISOString(),
      });

      setShowNewConnectionModal(false);
      setToast({ message: `Account "${newAccountName.trim()}" created under ${newAccountBroker}.`, type: 'success' });
      setNewAccountName('');
      setNewAccountBroker(BROKERS[0]);
    } catch (error) {
      console.error('Failed to create account:', error);
      setToast({ message: 'Failed to create account.', type: 'error' });
    } finally {
      setIsCreatingAccount(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, connectionId: string) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingConnId(connectionId);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result as string;
      try {
        const response = await authFetch(`/api/connections/${connectionId}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText })
        });
        const result = await response.json();
        if (result.status === 'success') {
          alert(`Successfully imported ${result.importedCount} orders.`);
        } else {
          alert(`Import failed: ${result.error}`);
        }
      } catch (error) {
        console.error('Upload failed:', error);
        alert('Upload failed. Please try again.');
      } finally {
        setUploadingConnId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (newConnectionId && setupStep === 'account_selection') {
      const fetchAccounts = async () => {
        const accountsSnap = await getDocs(collection(db, 'broker_connections', newConnectionId, 'accounts'));
        setAvailableAccounts(accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as BrokerAccount)));
      };
      fetchAccounts();
    }
  }, [newConnectionId, setupStep]);

  const handleConnectTradovate = async () => {
    if (!user) return;
    setIsConnecting(true);
    try {
      const response = await authFetch('/api/auth/tradovate/url');
      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      console.error('Failed to get Tradovate auth URL:', error);
      setIsConnecting(false);
    }
  };

  const handleSaveAccountSelection = async () => {
    if (!newConnectionId) return;
    
    try {
      const batch = availableAccounts.map(acc => 
        updateDoc(doc(db, 'broker_connections', newConnectionId, 'accounts', acc.id), {
          selectedForSync: acc.selectedForSync
        })
      );
      await Promise.all(batch);
      
      // Trigger initial sync
      await authFetch(`/api/connections/${newConnectionId}/sync`, {
        method: 'POST',
      });
      
      setShowNewConnectionModal(false);
      setNewConnectionId(null);
      setSetupStep('select');
    } catch (error) {
      console.error('Failed to save account selection:', error);
    }
  };

  const toggleAccountSync = (accountId: string) => {
    setAvailableAccounts(prev => prev.map(acc => 
      acc.id === accountId ? { ...acc, selectedForSync: !acc.selectedForSync } : acc
    ));
  };

  const handleManualSync = async (connectionId: string) => {
    if (!user) return;
    try {
      await authFetch(`/api/connections/${connectionId}/sync`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
  };

  const toggleConnectionStatus = async (connection: BrokerConnection) => {
    const newStatus = connection.status === 'paused' ? 'connected' : 'paused';
    await updateDoc(doc(db, 'broker_connections', connection.id), {
      status: newStatus,
      updatedAt: new Date().toISOString()
    });
  };

  const handleDeleteConnection = async (connectionId: string) => {
    if (confirm('Are you sure you want to disconnect this broker? All synced data will remain, but no new data will be ingested.')) {
      await deleteDoc(doc(db, 'broker_connections', connectionId));
    }
  };

  const handleUpdateConnection = async (connectionId: string, data: Partial<BrokerConnection>) => {
    try {
      await updateDoc(doc(db, 'broker_connections', connectionId), {
        ...data,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to update connection:', error);
    }
  };

  const handleClearLogs = async (connectionId: string) => {
    if (!user) return;
    try {
      await fetch(`/api/connections/${connectionId}/logs/clear`, { 
        method: 'POST',
        headers: { 'x-user-id': user.uid }
      });
      // The update will be picked up by onSnapshot
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  };

  const handleReconnect = async (connection: BrokerConnection) => {
    if (connection.brokerName === 'tradovate') {
      handleConnectTradovate();
    } else {
      // Only Tradovate CSV import is actually wired up today — live API
      // sync for every other broker is not built, so say that honestly
      // instead of pretending the reconnect succeeded.
      setToast({ message: `${connection.brokerName} isn't supported yet — only Tradovate CSV import is currently available.`, type: 'error' });
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Data Connections</h1>
          <p className="text-muted-foreground mt-1">Manage your broker integrations and manual data imports.</p>
        </div>
        <button 
          onClick={() => {
            setSetupStep('select');
            setShowNewConnectionModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Connection
        </button>
      </div>

      {/* Connection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Tradovate Card (Staged) */}
        <TradovateConnectionCard 
          connection={tradovateConnection} 
          onSetManual={handleSetManualSyncMode}
          onUpload={(e) => tradovateConnection && handleFileUpload(e, tradovateConnection.id)}
          onDelete={() => tradovateConnection && handleDeleteConnection(tradovateConnection.id)}
          isUploading={uploadingConnId === tradovateConnection?.id}
          fileInputRef={fileInputRef}
          onHistory={scrollToIngestionEvents}
        />

        {/* Other Connections */}
        {otherConnections.map((conn) => (
          <ConnectionCard 
            key={conn.id} 
            connection={conn} 
            onManage={() => setSelectedConnection(conn)}
            onSync={() => handleManualSync(conn.id)}
            onToggleStatus={() => toggleConnectionStatus(conn)}
            onDelete={() => handleDeleteConnection(conn.id)}
          />
        ))}
        {connections.length === 0 && !isLoading && (
          <div className="col-span-full py-12 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center text-muted-foreground">
            <Zap className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-medium">No active connections</p>
            <p className="text-sm">Connect a broker to start importing your trade data.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Events */}
        <div id="ingestion-events" className="lg:col-span-2 space-y-4 scroll-mt-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <History className="w-5 h-5 text-muted-foreground" />
            Recent Ingestion Events
          </h2>
          {/* Showing the 10 most recent — there's no full-history view built
              yet, so we don't dangle a "View All" link that goes nowhere. */}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted border-bottom border-border">
                <tr>
                  <th className="px-4 py-3 font-semibold text-foreground">Time</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Event</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Symbol</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-muted transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(event.eventTimestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground capitalize">
                          {(event.eventType || event.type || 'event').replace('_', ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">ID: {event.externalEventId || event.orderId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{event.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        event.processingStatus === 'processed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {event.processingStatus === 'processed' ? 'Processed' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No recent events
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Error Log */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            Ingestion Errors
          </h2>
          <div className="space-y-3">
            {errors.map((error) => (
              <div key={error.id} className="p-4 bg-red-50 border border-red-100 rounded-xl space-y-2">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold text-red-700 uppercase tracking-wider">{error.errorType}</span>
                  <span className="text-[10px] text-red-400">{new Date(error.createdAt).toLocaleString()}</span>
                </div>
                <p className={cn("text-sm text-red-800", expandedErrorId !== error.id && "line-clamp-2")}>{error.errorMessage}</p>
                <button
                  onClick={() => setExpandedErrorId(expandedErrorId === error.id ? null : error.id)}
                  className="text-sm font-semibold text-red-600 hover:underline text-left"
                >
                  {expandedErrorId === error.id ? 'Show Less' : 'View Details'}
                </button>
              </div>
            ))}
            {errors.length === 0 && (
              <div className="p-8 border border-border rounded-xl text-center text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-20 text-emerald-500" />
                <p className="text-sm">No errors detected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Connection Modal */}
      <AnimatePresence>
        {showNewConnectionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              {setupStep === 'select' && (
                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-foreground">New Account</h2>
                    <button onClick={() => setShowNewConnectionModal(false)} className="p-2 hover:bg-muted rounded-full transition-colors">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-muted-foreground">Pick a broker and name this account, so you can keep imports from different accounts separate and filter them later.</p>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Broker</label>
                    <select
                      value={newAccountBroker}
                      onChange={(e) => setNewAccountBroker(e.target.value as Broker)}
                      className="w-full p-3 border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-card"
                    >
                      {BROKERS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Account Name</label>
                    <input
                      type="text"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      placeholder="e.g. Topstep 50k Eval #1"
                      className="w-full p-3 border border-border rounded-xl text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <button
                    onClick={handleCreateAccount}
                    disabled={!newAccountName.trim() || isCreatingAccount}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isCreatingAccount ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Account'}
                  </button>
                </div>
              )}

              {setupStep === 'tradovate_info' && (
                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-foreground">Connect Tradovate</h2>
                    <button onClick={() => setSetupStep('select')} className="p-2 hover:bg-muted rounded-full transition-colors">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  
                  <div className="bg-indigo-50 p-4 rounded-2xl space-y-3">
                    <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Data Access Permissions
                    </h4>
                    <p className="text-xs text-indigo-700 leading-relaxed">
                      By connecting your Tradovate account, THE TRADING WORKSHOP OS will have read-only access to:
                    </p>
                    <ul className="text-xs text-indigo-700 space-y-1 list-disc list-inside">
                      <li>Account list and balances</li>
                      <li>Order history and status</li>
                      <li>Execution fills and trade data</li>
                    </ul>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    You will be redirected to Tradovate to authorize this connection securely via OAuth.
                  </p>

                  <button 
                    onClick={handleConnectTradovate}
                    disabled={isConnecting}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                  >
                    {isConnecting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Connect with Tradovate
                        <ExternalLink className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}

              {setupStep === 'account_selection' && (
                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-foreground">Select Accounts</h2>
                    <button onClick={() => setShowNewConnectionModal(false)} className="p-2 hover:bg-muted rounded-full transition-colors">
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  
                  <p className="text-muted-foreground text-sm">Choose which accounts you want to sync with your workspace.</p>

                  <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                    {availableAccounts.map(acc => (
                      <label key={acc.id} className="flex items-center gap-3 p-4 border border-border rounded-xl hover:bg-muted cursor-pointer transition-colors">
                        <input 
                          type="checkbox" 
                          checked={acc.selectedForSync}
                          onChange={() => toggleAccountSync(acc.id)}
                          className="w-5 h-5 rounded border-border text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1">
                          <p className="font-bold text-foreground">{acc.displayName}</p>
                          <p className="text-xs text-muted-foreground">ID: {acc.externalAccountId}</p>
                        </div>
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-bold uppercase">
                          Live
                        </span>
                      </label>
                    ))}
                  </div>

                  <button 
                    onClick={handleSaveAccountSelection}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                  >
                    Save and Start Sync
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manage Connection Modal */}
      <AnimatePresence>
        {selectedConnection && (
          <ManageConnectionModal 
            connection={selectedConnection} 
            onClose={() => setSelectedConnection(null)} 
            onSync={() => handleManualSync(selectedConnection.id)}
            onUpdate={(data) => handleUpdateConnection(selectedConnection.id, data)}
            onClearLogs={() => handleClearLogs(selectedConnection.id)}
            onReconnect={() => handleReconnect(selectedConnection)}
          />
        )}
      </AnimatePresence>

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

function TradovateConnectionCard({ 
  connection, 
  onSetManual, 
  onUpload, 
  onDelete, 
  isUploading,
  fileInputRef,
  onHistory
}: {
  connection?: BrokerConnection,
  onSetManual: () => void,
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void,
  onDelete: () => void,
  isUploading: boolean,
  fileInputRef: React.RefObject<HTMLInputElement>,
  onHistory: () => void
}) {
  const isManual = connection?.syncMode === 'manual_csv';
  const isApi = connection?.syncMode === 'api_live';
  const isNotConfigured = !connection;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 flex-1 space-y-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isNotConfigured ? 'bg-muted text-muted-foreground' : 'bg-indigo-100 text-indigo-600'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Tradovate</h3>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  isNotConfigured ? 'bg-emerald-500' : isManual ? 'bg-emerald-500' : 'bg-emerald-500'
                }`} />
                <span className="text-xs font-medium text-muted-foreground">
                  {isNotConfigured ? 'Manual Import Ready' : isManual ? 'Manual Import Active' : 'Manual Import Active'}
                </span>
              </div>
            </div>
          </div>
          {connection && (
            <button 
              onClick={onDelete}
              className="p-2 hover:bg-red-50 rounded-lg text-muted-foreground hover:text-red-500 transition-colors"
              title="Disconnect"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {isNotConfigured 
            ? "Import your Tradovate trade history via CSV. API sync is currently disabled."
            : isManual 
              ? "Syncing via manual CSV exports. Analytics and coaching features are fully active."
              : "Syncing via manual CSV exports. Analytics and coaching features are fully active."}
        </p>

        {connection && (
          <div className="pt-2 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Last Import</span>
              <span className="font-bold text-foreground">
                {connection.lastImportAt ? new Date(connection.lastImportAt).toLocaleString() : 'Never'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Import Count</span>
              <span className="font-bold text-foreground">{connection.importCount || 0}</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-muted border-t border-border space-y-2">
        {isNotConfigured ? (
          <button 
            onClick={onSetManual}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Initialize Manual Import
          </button>
        ) : (
          <>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-card border border-border text-foreground rounded-xl text-sm font-bold hover:bg-muted transition-colors"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Tradovate File
            </button>
            <input 
              type="file" 
              className="hidden" 
              ref={fileInputRef} 
              accept=".csv" 
              onChange={onUpload} 
            />
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={onHistory}
                className="flex items-center justify-center gap-2 py-2 bg-card border border-border text-muted-foreground rounded-xl text-[11px] font-bold hover:bg-muted transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                History
              </button>
              <button 
                disabled
                className="flex items-center justify-center gap-2 py-2 bg-muted border border-border text-muted-foreground rounded-xl text-[11px] font-bold cursor-not-allowed"
              >
                <Zap className="w-3.5 h-3.5" />
                Live Sync (Soon)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConnectionCard({ connection, onManage, onSync, onToggleStatus, onDelete }: { 
  connection: BrokerConnection, 
  onManage: () => void,
  onSync: () => void,
  onToggleStatus: () => void,
  onDelete: () => void
}) {
  const isPaused = connection.status === 'paused';
  const isError = connection.status === 'error' || connection.status === 'requires_reconnect';

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 flex-1 space-y-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isPaused ? 'bg-muted text-muted-foreground' : 'bg-indigo-100 text-indigo-600'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-foreground capitalize">{connection.brokerName}</h3>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  isPaused ? 'bg-slate-300' : isError ? 'bg-red-500' : 'bg-emerald-500'
                }`} />
                <span className="text-xs font-medium text-muted-foreground capitalize">{connection.status.replace(/_/g, ' ')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={onSync}
              disabled={isPaused}
              className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-indigo-600 transition-colors disabled:opacity-30"
              title="Manual Sync"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button 
              onClick={onManage}
              className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              title="Settings"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Linked Accounts</span>
            <span className="font-bold text-foreground">{connection.accounts?.length || 0}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Last Import</span>
            <span className="font-bold text-foreground">
              {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleTimeString() : 'Never'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-bold text-foreground">Manual CSV</span>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 bg-muted border-t border-border flex gap-2">
        <button 
          onClick={onToggleStatus}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-colors ${
            isPaused 
              ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
              : 'bg-card border border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button 
          onClick={onDelete}
          className="px-3 py-2 bg-card border border-border text-red-500 rounded-lg hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ManageConnectionModal({ connection, onClose, onSync, onUpdate, onClearLogs, onReconnect }: { 
  connection: BrokerConnection, 
  onClose: () => void, 
  onSync: () => void,
  onUpdate: (data: Partial<BrokerConnection>) => Promise<void>,
  onClearLogs: () => Promise<void>,
  onReconnect: () => void
}) {
  const [activeTab, setActiveTab] = useState<'settings' | 'accounts' | 'logs'>('settings');
  const [isSaving, setIsSaving] = useState(false);
  const [localAccounts, setLocalAccounts] = useState<BrokerAccount[]>(connection.accounts || []);
  const [newAccountName, setNewAccountName] = useState('');
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  // `connection` is a snapshot passed down when the modal was opened — it
  // never updates again on its own, so adding/deleting an account here
  // wouldn't show up without subscribing directly to the subcollection.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'broker_connections', connection.id, 'accounts'),
      (snapshot) => {
        setLocalAccounts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BrokerAccount)));
      }
    );
    return () => unsubscribe();
  }, [connection.id]);

  const toggleAccountSync = (accountId: string) => {
    setLocalAccounts(prev => prev.map(acc =>
      acc.id === accountId ? { ...acc, selectedForSync: !acc.selectedForSync } : acc
    ));
  };

  const handleAddAccount = async () => {
    if (!newAccountName.trim()) return;
    setIsAddingAccount(true);
    try {
      await addDoc(collection(db, 'broker_connections', connection.id, 'accounts'), {
        connectionId: connection.id,
        externalAccountId: `manual-${Date.now()}`,
        displayName: newAccountName.trim(),
        status: 'active',
        selectedForSync: true,
        createdAt: new Date().toISOString(),
      });
      setNewAccountName('');
    } catch (error) {
      console.error('Failed to add account:', error);
      alert('Failed to add account.');
    } finally {
      setIsAddingAccount(false);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm('Delete this account? Trades already imported under it keep their account tag, but it will no longer appear as an option for new imports or filters.')) return;
    try {
      await deleteDoc(doc(db, 'broker_connections', connection.id, 'accounts', accountId));
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert('Failed to delete account.');
    }
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      // 1. Update accounts subcollection
      const batch = localAccounts.map(acc => 
        updateDoc(doc(db, 'broker_connections', connection.id, 'accounts', acc.id), {
          selectedForSync: acc.selectedForSync
        })
      );
      await Promise.all(batch);
      
      // 2. Update connection timestamp
      await onUpdate({ updatedAt: new Date().toISOString() });
      
      alert('Changes saved successfully.');
    } catch (error) {
      console.error('Failed to save changes:', error);
      alert('Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-card rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-border flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground capitalize">{connection.brokerName} Connection</h2>
              <p className="text-xs text-muted-foreground">ID: {connection.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex border-b border-border">
          {(['settings', 'accounts', 'logs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-bold capitalize transition-colors relative ${
                activeTab === tab ? 'text-indigo-600' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          ))}
        </div>

        <div className="p-8 flex-1 overflow-y-auto space-y-6">
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted rounded-2xl space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</span>
                  <p className="font-bold text-foreground capitalize">{connection.status}</p>
                </div>
                <div className="p-4 bg-muted rounded-2xl space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Environment</span>
                  <p className="font-bold text-foreground capitalize">{connection.environment}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-bold text-foreground">Connection Details</h3>
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">Auth Type</label>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-xl border border-border">
                      <Key className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{connection.authType}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-muted-foreground uppercase">External User ID</label>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-xl border border-border">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{connection.externalUserId || 'Not available'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {connection.status === 'requires_reconnect' && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-4">
                  <AlertCircle className="w-6 h-6 text-amber-500" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-amber-900">Reconnection Required</p>
                    <p className="text-xs text-amber-700">Your session has expired or been invalidated. Please reconnect to resume syncing.</p>
                  </div>
                  <button 
                    onClick={onReconnect}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors"
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="space-y-4">
              <h3 className="font-bold text-foreground">Linked Accounts</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="New account name..."
                  className="flex-1 p-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleAddAccount}
                  disabled={!newAccountName.trim() || isAddingAccount}
                  className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isAddingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </button>
              </div>
              <div className="space-y-2">
                {localAccounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between p-4 border border-border rounded-2xl hover:bg-muted transition-colors">
                    <div className="flex items-center gap-3">
                      <div
                        onClick={() => toggleAccountSync(acc.id)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                          acc.selectedForSync ? 'bg-emerald-100 text-emerald-600' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-foreground">{acc.displayName}</p>
                        <p className="text-xs text-muted-foreground">ID: {acc.externalAccountId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        acc.selectedForSync ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'
                      }`}>
                        {acc.selectedForSync ? 'Syncing' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="p-2 hover:bg-red-50 rounded-lg text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {localAccounts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground italic text-sm">
                  No accounts found for this connection.
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-foreground">Recent Sync Logs</h3>
                <button 
                  onClick={onClearLogs}
                  className="text-xs text-indigo-600 font-bold hover:underline"
                >
                  Clear Logs
                </button>
              </div>
              <div className="space-y-2">
                {connection.logs && connection.logs.length > 0 ? (
                  <div className="p-3 bg-muted rounded-xl font-mono text-[10px] text-muted-foreground space-y-1">
                    {connection.logs.map((log, i) => (
                      <p key={i} className={cn(
                        log.level === 'SUCCESS' ? 'text-emerald-500' : 
                        log.level === 'ERROR' ? 'text-rose-500' : 'text-muted-foreground'
                      )}>
                        [{new Date(log.timestamp).toLocaleString()}] {log.level}: {log.message}
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 border border-border rounded-xl text-center text-muted-foreground">
                    <p className="text-sm">No logs available for this connection</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-muted border-t border-border flex justify-between items-center gap-3">
          <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">
            Close
          </button>
          <div className="flex gap-3">
            <button 
              onClick={handleSaveChanges}
              disabled={isSaving}
              className="px-6 py-2 bg-card border border-border text-foreground rounded-xl text-sm font-bold hover:bg-muted transition-colors"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
            </button>
            <button 
              onClick={onSync}
              className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
            >
              Run Manual Sync
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
