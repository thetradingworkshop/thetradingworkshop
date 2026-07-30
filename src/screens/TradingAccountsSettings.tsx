import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '@/src/utils';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, Toast, Modal } from '../components/Shared';
import { Plus, Trash2, Wallet, Pencil, DollarSign, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import {
  BrokerAccount, TradingAccountType, TRADING_ACCOUNT_TYPES, ACCOUNT_SIZE_PRESETS, BROKERS, Broker,
  AccountTransaction, AccountTransactionType, ACCOUNT_TRANSACTION_TYPES, ACCOUNT_TRANSACTION_CATEGORIES,
} from '../types';

const ACCOUNT_SIZES = [25000, 50000, 100000];

interface AccountRow extends BrokerAccount {
  connectionId: string;
  brokerName: string;
}

function drawdownApplies(accountType: TradingAccountType) {
  return accountType === 'Evaluation' || accountType === 'Funded';
}

interface FormState {
  broker: Broker;
  name: string;
  accountType: TradingAccountType;
  initialCost: string;
  activationFees: string;
  accountSize: string;
  evaluationTarget: string;
  drawdown: string;
}

const defaultForm: FormState = {
  broker: BROKERS[0],
  name: '',
  accountType: 'Evaluation',
  initialCost: '0',
  activationFees: '0',
  accountSize: '25000',
  evaluationTarget: '1500',
  drawdown: '1500',
};

export default function TradingAccountsSettings() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [connectionIdByBroker, setConnectionIdByBroker] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | TradingAccountType>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);

  // Itemized cost/payout ledger — lazy-loaded only for whichever account's
  // "Manage Transactions" modal is currently open, rather than eagerly
  // subscribing to every account's transactions up front.
  const [activeLedgerAccount, setActiveLedgerAccount] = useState<AccountRow | null>(null);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [txnForm, setTxnForm] = useState({ type: 'cost' as AccountTransactionType, category: ACCOUNT_TRANSACTION_CATEGORIES.cost[0], amount: '', date: new Date().toISOString().slice(0, 10), note: '' });
  const [isSavingTxn, setIsSavingTxn] = useState(false);
  const [pendingDeleteTxnId, setPendingDeleteTxnId] = useState<string | null>(null);

  // Same accounts Import Orders tags CSVs with, flattened across every
  // broker connection the user has, subscribed live at both levels so
  // creating an account anywhere (here or on Import Orders) shows up
  // immediately without needing to remount either screen.
  useEffect(() => {
    if (!user) {
      setAccounts([]);
      return;
    }

    const accountsByConnection = new Map<string, AccountRow[]>();
    const accountUnsubscribes = new Map<string, () => void>();

    const rebuild = () => {
      const list = Array.from(accountsByConnection.values()).flat();
      list.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? 1 : -1);
      setAccounts(list);
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

        const byBroker: Record<string, string> = {};
        snapshot.docs.forEach(d => {
          byBroker[(d.data() as any).brokerName] = d.id;
        });
        setConnectionIdByBroker(byBroker);

        snapshot.docs.forEach(connDoc => {
          const brokerName = (connDoc.data() as any).brokerName || 'Unknown';
          if (!accountUnsubscribes.has(connDoc.id)) {
            const unsub = onSnapshot(
              collection(db, 'broker_connections', connDoc.id, 'accounts'),
              (accountsSnap) => {
                accountsByConnection.set(connDoc.id, accountsSnap.docs.map(d => ({
                  ...(d.data() as BrokerAccount),
                  id: d.id,
                  connectionId: connDoc.id,
                  brokerName,
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

  const handleAccountSizeChange = (value: string) => {
    setForm(f => {
      if (value === 'custom') return { ...f, accountSize: value };
      const preset = ACCOUNT_SIZE_PRESETS[Number(value)];
      return {
        ...f,
        accountSize: value,
        evaluationTarget: preset ? String(preset.evaluationTarget) : f.evaluationTarget,
        drawdown: preset && preset.drawdown !== undefined ? String(preset.drawdown) : '',
      };
    });
  };

  const startEdit = (acc: AccountRow) => {
    setEditingKey(`${acc.connectionId}::${acc.id}`);
    setIsCreating(false);
    setForm({
      broker: (acc.brokerName as Broker) || BROKERS[0],
      name: acc.displayName,
      accountType: acc.accountType || 'Evaluation',
      initialCost: String(acc.initialCost ?? 0),
      activationFees: String(acc.activationFees ?? 0),
      accountSize: acc.accountSize ? String(acc.accountSize) : 'custom',
      evaluationTarget: String(acc.evaluationTarget ?? ''),
      drawdown: acc.drawdown !== undefined ? String(acc.drawdown) : '',
    });
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingKey(null);
    setForm(defaultForm);
  };

  const buildEconomics = () => {
    const data: Partial<BrokerAccount> = {
      accountType: form.accountType,
      initialCost: Number(form.initialCost) || 0,
      activationFees: Number(form.activationFees) || 0,
      evaluationTarget: Number(form.evaluationTarget) || 0,
    };
    if (form.accountSize !== 'custom') data.accountSize = Number(form.accountSize);
    if (drawdownApplies(form.accountType) && form.drawdown) data.drawdown = Number(form.drawdown);
    return data;
  };

  const handleCreate = async () => {
    if (!user || !form.name.trim()) return;
    setIsSaving(true);
    try {
      let connectionId = connectionIdByBroker[form.broker];
      if (!connectionId) {
        const connRef = await addDoc(collection(db, 'broker_connections'), {
          userId: user.uid,
          brokerName: form.broker,
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

      const now = new Date().toISOString();
      await addDoc(collection(db, 'broker_connections', connectionId, 'accounts'), {
        connectionId,
        externalAccountId: `manual-${Date.now()}`,
        displayName: form.name.trim(),
        status: 'active',
        selectedForSync: true,
        createdAt: now,
        updatedAt: now,
        ...buildEconomics(),
      });

      cancelForm();
    } catch (err: any) {
      setToast({ message: `Failed to create account: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (acc: AccountRow) => {
    if (!form.name.trim()) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'broker_connections', acc.connectionId, 'accounts', acc.id), {
        displayName: form.name.trim(),
        updatedAt: new Date().toISOString(),
        ...buildEconomics(),
      });
      cancelForm();
    } catch (err: any) {
      setToast({ message: `Failed to update account: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (acc: AccountRow) => {
    if (!window.confirm('Delete this trading account? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'broker_connections', acc.connectionId, 'accounts', acc.id));
    } catch (err: any) {
      setToast({ message: `Failed to delete account: ${err?.message || 'Unknown error'}`, type: 'error' });
    }
  };

  // Subscribe to the open account's transaction ledger, tearing down the
  // previous account's listener when switching or closing the modal.
  useEffect(() => {
    if (!activeLedgerAccount) {
      setTransactions([]);
      return;
    }
    setIsLoadingTransactions(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'broker_connections', activeLedgerAccount.connectionId, 'accounts', activeLedgerAccount.id, 'transactions'),
        orderBy('date', 'desc')
      ),
      (snap) => {
        setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountTransaction)));
        setIsLoadingTransactions(false);
      },
      () => setIsLoadingTransactions(false)
    );
    return () => unsub();
  }, [activeLedgerAccount?.connectionId, activeLedgerAccount?.id]);

  const openLedger = (acc: AccountRow) => {
    setActiveLedgerAccount(acc);
    setTxnForm({ type: 'cost', category: ACCOUNT_TRANSACTION_CATEGORIES.cost[0], amount: '', date: new Date().toISOString().slice(0, 10), note: '' });
  };

  const closeLedger = () => {
    setActiveLedgerAccount(null);
    setPendingDeleteTxnId(null);
  };

  const handleTxnTypeChange = (type: AccountTransactionType) => {
    setTxnForm(f => ({ ...f, type, category: ACCOUNT_TRANSACTION_CATEGORIES[type][0] }));
  };

  const handleAddTransaction = async () => {
    if (!user || !activeLedgerAccount) return;
    const amount = Number(txnForm.amount);
    if (!amount || amount <= 0) {
      setToast({ message: 'Enter an amount greater than 0', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setIsSavingTxn(true);
    try {
      const now = new Date().toISOString();
      const trimmedNote = txnForm.note.trim();
      await addDoc(collection(db, 'broker_connections', activeLedgerAccount.connectionId, 'accounts', activeLedgerAccount.id, 'transactions'), {
        userId: user.uid,
        connectionId: activeLedgerAccount.connectionId,
        accountId: activeLedgerAccount.id,
        type: txnForm.type,
        category: txnForm.category,
        amount,
        date: txnForm.date,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        createdAt: now,
        updatedAt: now,
      });
      setTxnForm(f => ({ ...f, amount: '', note: '' }));
    } catch (err: any) {
      setToast({ message: `Failed to add transaction: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSavingTxn(false);
    }
  };

  const handleDeleteTransaction = async (txnId: string) => {
    if (!activeLedgerAccount) return;
    try {
      await deleteDoc(doc(db, 'broker_connections', activeLedgerAccount.connectionId, 'accounts', activeLedgerAccount.id, 'transactions', txnId));
    } catch (err: any) {
      setToast({ message: `Failed to delete transaction: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setPendingDeleteTxnId(null);
    }
  };

  const totalSpent = transactions.filter(t => t.type === 'cost').reduce((s, t) => s + t.amount, 0);
  const totalPayouts = transactions.filter(t => t.type === 'payout').reduce((s, t) => s + t.amount, 0);
  const netProfitability = totalPayouts - totalSpent;

  const filteredAccounts = typeFilter === 'all' ? accounts : accounts.filter(a => a.accountType === typeFilter);

  const renderForm = (onSubmit: () => void, submitLabel: string) => (
    <div className="mb-8 p-6 bg-accent/30 rounded-2xl border border-border space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Broker</label>
          <select
            value={form.broker}
            onChange={(e) => setForm(f => ({ ...f, broker: e.target.value as Broker }))}
            disabled={!!editingKey}
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm disabled:opacity-60"
          >
            {BROKERS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Account Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Topstep 50k #1"
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Account Type</label>
          <select
            value={form.accountType}
            onChange={(e) => setForm(f => ({ ...f, accountType: e.target.value as TradingAccountType }))}
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          >
            {TRADING_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Initial Cost (USD)</label>
          <input
            type="number"
            value={form.initialCost}
            onChange={(e) => setForm(f => ({ ...f, initialCost: e.target.value }))}
            placeholder="0.00"
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Activation Fees (USD)</label>
          <input
            type="number"
            value={form.activationFees}
            onChange={(e) => setForm(f => ({ ...f, activationFees: e.target.value }))}
            placeholder="0.00"
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Account Size</label>
          <select
            value={form.accountSize}
            onChange={(e) => handleAccountSizeChange(e.target.value)}
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          >
            {ACCOUNT_SIZES.map(s => <option key={s} value={s}>{`${s / 1000}K`}</option>)}
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Evaluation Target (USD)</label>
          <input
            type="number"
            value={form.evaluationTarget}
            onChange={(e) => setForm(f => ({ ...f, evaluationTarget: e.target.value }))}
            placeholder="0.00"
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
          />
        </div>
        {drawdownApplies(form.accountType) && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground">Drawdown (USD)</label>
            <input
              type="number"
              value={form.drawdown}
              onChange={(e) => setForm(f => ({ ...f, drawdown: e.target.value }))}
              placeholder="0.00"
              className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-3">
        <Button variant="outline" onClick={cancelForm}>Cancel</Button>
        <Button variant="primary" disabled={isSaving || !form.name.trim()} onClick={onSubmit}>
          {isSaving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold">Trading Accounts</h3>
          <p className="text-sm text-muted-foreground mt-1">Same accounts used to tag imports — track their evaluation, funded, and live economics here.</p>
        </div>
        <div className="flex items-center space-x-3">
          {accounts.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | TradingAccountType)}
              className="h-10 pl-3 pr-8 bg-accent/30 border border-border rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
              title="Filter by account type"
            >
              <option value="all">All Types</option>
              {TRADING_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {!isCreating && !editingKey && (
            <Button variant="primary" icon={Plus} onClick={() => { setForm(defaultForm); setIsCreating(true); }}>New Account</Button>
          )}
        </div>
      </div>

      {isCreating && renderForm(handleCreate, 'Create Account')}

      {accounts.length === 0 && !isCreating ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wallet className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No trading accounts yet. Create one to start tracking its economics.</p>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wallet className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No {typeFilter} accounts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAccounts.map(acc => {
            const key = `${acc.connectionId}::${acc.id}`;
            if (editingKey === key) {
              return <div key={key}>{renderForm(() => handleSaveEdit(acc), 'Save Changes')}</div>;
            }
            return (
              <div key={key} className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm">{acc.displayName}</span>
                      <Badge variant="neutral">{acc.brokerName}</Badge>
                      {acc.accountType && <Badge variant="neutral">{acc.accountType}</Badge>}
                      {acc.accountSize && <Badge variant="neutral">{`${acc.accountSize / 1000}K`}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-x-3">
                      {acc.accountType ? (
                        <>
                          <span>Cost: ${(acc.initialCost ?? 0).toLocaleString()}</span>
                          {!!acc.activationFees && <span>Activation: ${acc.activationFees.toLocaleString()}</span>}
                          {acc.evaluationTarget !== undefined && <span>Target: ${acc.evaluationTarget.toLocaleString()}</span>}
                          {acc.drawdown !== undefined && <span>Drawdown: ${acc.drawdown.toLocaleString()}</span>}
                        </>
                      ) : (
                        <span>No economics set yet</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => openLedger(acc)}
                    className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Manage cost/payout transactions"
                  >
                    <DollarSign className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => startEdit(acc)}
                    className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit account"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc)}
                    className="p-2 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                    title="Delete account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={!!activeLedgerAccount}
        onClose={closeLedger}
        title={activeLedgerAccount ? `${activeLedgerAccount.displayName} — Transactions` : 'Transactions'}
        maxWidth="lg"
      >
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground -mt-2">
            Real money in and out of this account — eval/reset/subscription fees you paid, and payouts you actually received. This is what determines whether you're profitable, separate from the account's in-platform P&L.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-accent/30">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Total Spent</p>
              <p className="text-lg font-bold text-rose-500">${totalSpent.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-accent/30">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Total Payouts</p>
              <p className="text-lg font-bold text-emerald-500">${totalPayouts.toLocaleString()}</p>
            </div>
            <div className={cn("p-4 rounded-2xl", netProfitability >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10")}>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Net</p>
              <p className={cn("text-lg font-bold", netProfitability >= 0 ? "text-emerald-500" : "text-rose-500")}>
                {netProfitability >= 0 ? '+' : '-'}${Math.abs(netProfitability).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="p-4 bg-accent/20 rounded-2xl space-y-3">
            <div className="flex gap-2">
              {ACCOUNT_TRANSACTION_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => handleTxnTypeChange(t)}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-colors",
                    txnForm.type === t
                      ? (t === 'cost' ? "bg-rose-500 text-white" : "bg-emerald-500 text-white")
                      : "bg-background border border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={txnForm.category}
                onChange={(e) => setTxnForm(f => ({ ...f, category: e.target.value }))}
                className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
              >
                {ACCOUNT_TRANSACTION_CATEGORIES[txnForm.type].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                type="number"
                placeholder="Amount (USD)"
                value={txnForm.amount}
                onChange={(e) => setTxnForm(f => ({ ...f, amount: e.target.value }))}
                className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={txnForm.date}
                onChange={(e) => setTxnForm(f => ({ ...f, date: e.target.value }))}
                className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={txnForm.note}
                onChange={(e) => setTxnForm(f => ({ ...f, note: e.target.value }))}
                className="bg-background border border-border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <Button variant="primary" className="w-full" disabled={isSavingTxn} onClick={handleAddTransaction}>
              {isSavingTxn ? 'Saving...' : `Add ${txnForm.type === 'cost' ? 'Cost' : 'Payout'}`}
            </Button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {isLoadingTransactions ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No transactions logged yet.</p>
            ) : transactions.map(t => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl bg-accent/20">
                <div className="flex items-center gap-3">
                  {t.type === 'cost'
                    ? <ArrowDownCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    : <ArrowUpCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
                  <div>
                    <p className="text-sm font-bold">{t.category}</p>
                    <p className="text-xs text-muted-foreground">{t.date}{t.note ? ` · ${t.note}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("text-sm font-bold", t.type === 'cost' ? 'text-rose-500' : 'text-emerald-500')}>
                    {t.type === 'cost' ? '-' : '+'}${t.amount.toLocaleString()}
                  </span>
                  <button
                    onClick={() => setPendingDeleteTxnId(t.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                    title="Delete transaction"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!pendingDeleteTxnId}
        onClose={() => setPendingDeleteTxnId(null)}
        title="Delete Transaction?"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDeleteTxnId(null)}>Cancel</Button>
            <Button variant="primary" className="bg-rose-500 hover:bg-rose-600" onClick={() => pendingDeleteTxnId && handleDeleteTransaction(pendingDeleteTxnId)}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This transaction will be permanently deleted. This can't be undone.</p>
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </Card>
  );
}
