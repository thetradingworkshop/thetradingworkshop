import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, Toast } from '../components/Shared';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { TradingAccount, TradingAccountType, TRADING_ACCOUNT_TYPES, ACCOUNT_SIZE_PRESETS } from '../types';

const ACCOUNT_SIZES = [25000, 50000, 100000];

function drawdownApplies(accountType: TradingAccountType) {
  return accountType === 'Evaluation' || accountType === 'Funded';
}

export default function TradingAccountsSettings() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | TradingAccountType>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<TradingAccountType>('Evaluation');
  const [initialCost, setInitialCost] = useState('');
  const [activationFees, setActivationFees] = useState('0');
  const [accountSize, setAccountSize] = useState<string>('25000');
  const [evaluationTarget, setEvaluationTarget] = useState('1500');
  const [drawdown, setDrawdown] = useState('1500');

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'trading_accounts'), where('userId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as TradingAccount));
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setAccounts(list);
    });
    return () => unsub();
  }, [user]);

  const resetForm = () => {
    setName('');
    setAccountType('Evaluation');
    setInitialCost('');
    setActivationFees('0');
    setAccountSize('25000');
    setEvaluationTarget('1500');
    setDrawdown('1500');
  };

  const handleAccountSizeChange = (value: string) => {
    setAccountSize(value);
    if (value === 'custom') return;
    const preset = ACCOUNT_SIZE_PRESETS[Number(value)];
    if (preset) {
      setEvaluationTarget(String(preset.evaluationTarget));
      setDrawdown(preset.drawdown !== undefined ? String(preset.drawdown) : '');
    }
  };

  const handleCreate = async () => {
    if (!user || !name.trim() || !initialCost || !evaluationTarget) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const data: Omit<TradingAccount, 'id'> = {
        userId: user.uid,
        name: name.trim(),
        accountType,
        initialCost: Number(initialCost),
        activationFees: Number(activationFees) || 0,
        evaluationTarget: Number(evaluationTarget),
        createdAt: now,
        updatedAt: now,
      };
      if (accountSize !== 'custom') data.accountSize = Number(accountSize);
      if (drawdownApplies(accountType) && drawdown) data.drawdown = Number(drawdown);

      await addDoc(collection(db, 'trading_accounts'), data);
      resetForm();
      setIsCreating(false);
    } catch (err: any) {
      setToast({ message: `Failed to create account: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (accountId: string) => {
    if (!window.confirm('Delete this trading account? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'trading_accounts', accountId));
    } catch (err: any) {
      setToast({ message: `Failed to delete account: ${err?.message || 'Unknown error'}`, type: 'error' });
    }
  };

  const filteredAccounts = typeFilter === 'all' ? accounts : accounts.filter(a => a.accountType === typeFilter);

  return (
    <Card className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold">Trading Accounts</h3>
          <p className="text-sm text-muted-foreground mt-1">Track evaluation, funded, and live account economics.</p>
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
          {!isCreating && (
            <Button variant="primary" icon={Plus} onClick={() => setIsCreating(true)}>New Account</Button>
          )}
        </div>
      </div>

      {isCreating && (
        <div className="mb-8 p-6 bg-accent/30 rounded-2xl border border-border space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Account Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Topstep 50k #1"
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Account Type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as TradingAccountType)}
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
              >
                {TRADING_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Initial Cost (USD)</label>
              <input
                type="number"
                value={initialCost}
                onChange={(e) => setInitialCost(e.target.value)}
                placeholder="0.00"
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Activation Fees (USD)</label>
              <input
                type="number"
                value={activationFees}
                onChange={(e) => setActivationFees(e.target.value)}
                placeholder="0.00"
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Account Size</label>
              <select
                value={accountSize}
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
                value={evaluationTarget}
                onChange={(e) => setEvaluationTarget(e.target.value)}
                placeholder="0.00"
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
              />
            </div>
            {drawdownApplies(accountType) && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Drawdown (USD)</label>
                <input
                  type="number"
                  value={drawdown}
                  onChange={(e) => setDrawdown(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={() => { setIsCreating(false); resetForm(); }}>Cancel</Button>
            <Button
              variant="primary"
              disabled={isSaving || !name.trim() || !initialCost || !evaluationTarget}
              onClick={handleCreate}
            >
              {isSaving ? 'Creating...' : 'Create Account'}
            </Button>
          </div>
        </div>
      )}

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
          {filteredAccounts.map(acc => (
            <div key={acc.id} className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm">{acc.name}</span>
                    <Badge variant="neutral">{acc.accountType}</Badge>
                    {acc.accountSize && <Badge variant="neutral">{`${acc.accountSize / 1000}K`}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-x-3">
                    <span>Cost: ${acc.initialCost.toLocaleString()}</span>
                    {acc.activationFees > 0 && <span>Activation: ${acc.activationFees.toLocaleString()}</span>}
                    <span>Target: ${acc.evaluationTarget.toLocaleString()}</span>
                    {acc.drawdown !== undefined && <span>Drawdown: ${acc.drawdown.toLocaleString()}</span>}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(acc.id)}
                className="p-2 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                title="Delete account"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </Card>
  );
}
