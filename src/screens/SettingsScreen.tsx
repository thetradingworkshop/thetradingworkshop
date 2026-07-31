import React, { useState, useEffect } from 'react';
import { SectionHeader, Card, Button, Badge, Toast } from '../components/Shared';
import { Settings as SettingsIcon, Bell, Shield, User, Database, Globe, Wallet, AlertTriangle } from 'lucide-react';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { RiskSettings } from '../types';
import TradingAccountsSettings from './TradingAccountsSettings';

const EMPTY_RISK_FORM = {
  maxDailyLossUsd: '',
  maxDailyLossPct: '',
  riskPerTradePct: '',
  maxPositionSize: '',
  maxConsecutiveLosses: '',
};

export default function SettingsScreen() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'trading-parameters' | 'risk-parameters' | 'accounts'>('trading-parameters');
  const { clearTrades } = useTrades();
  const { user } = useAuth();

  const [riskForm, setRiskForm] = useState(EMPTY_RISK_FORM);
  const [isLoadingRisk, setIsLoadingRisk] = useState(true);
  const [isSavingRisk, setIsSavingRisk] = useState(false);

  useEffect(() => {
    if (!user) { setIsLoadingRisk(false); return; }
    setIsLoadingRisk(true);
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const risk: RiskSettings = snap.data()?.riskSettings || {};
      setRiskForm({
        maxDailyLossUsd: risk.maxDailyLossUsd?.toString() ?? '',
        maxDailyLossPct: risk.maxDailyLossPct?.toString() ?? '',
        riskPerTradePct: risk.riskPerTradePct?.toString() ?? '',
        maxPositionSize: risk.maxPositionSize?.toString() ?? '',
        maxConsecutiveLosses: risk.maxConsecutiveLosses?.toString() ?? '',
      });
    }).finally(() => setIsLoadingRisk(false));
  }, [user?.uid]);

  const handleSaveRisk = async () => {
    if (!user) return;
    setIsSavingRisk(true);
    try {
      const riskSettings: RiskSettings = {};
      (Object.keys(riskForm) as (keyof typeof riskForm)[]).forEach(key => {
        const raw = riskForm[key];
        if (raw !== '') riskSettings[key] = Number(raw);
      });
      await setDoc(doc(db, 'users', user.uid), { riskSettings }, { merge: true });
      setToast({ message: 'Risk parameters saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: `Failed to save risk parameters: ${err?.message || 'Unknown error'}`, type: 'error' });
    } finally {
      setIsSavingRisk(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleAction = (action: string) => {
    setToast({ message: `${action} action performed (Simulated)`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-6">
      <SectionHeader 
        title="Settings" 
        subtitle="Configure your trading parameters and account preferences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Navigation */}
        <div className="lg:col-span-3 space-y-2">
          <button
            onClick={() => handleAction('Profile Settings')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-accent transition-colors text-muted-foreground"
          >
            <User className="w-4 h-4" />
            <span>Profile</span>
          </button>
          <button
            onClick={() => setActiveTab('trading-parameters')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'trading-parameters' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Database className="w-4 h-4" />
            <span>Trading Parameters</span>
          </button>
          <button
            onClick={() => setActiveTab('risk-parameters')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'risk-parameters' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>Risk Parameters</span>
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'accounts' ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground'}`}
          >
            <Wallet className="w-4 h-4" />
            <span>Accounts</span>
          </button>
          <button
            onClick={() => handleAction('Notification Settings')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-accent transition-colors text-muted-foreground"
          >
            <Bell className="w-4 h-4" />
            <span>Notifications</span>
          </button>
          <button 
            onClick={() => handleAction('Security Settings')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-accent transition-colors text-muted-foreground"
          >
            <Shield className="w-4 h-4" />
            <span>Security</span>
          </button>
        </div>

        {/* Right: Content */}
        <div className="lg:col-span-9 space-y-6">
          {activeTab === 'accounts' && <TradingAccountsSettings />}

          {activeTab === 'trading-parameters' && (
          <Card className="p-8">
            <h3 className="text-lg font-bold mb-6">Trading Parameters</h3>
            {/* ... existing fields ... */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Re-entry Threshold (Seconds)</label>
                <input type="number" defaultValue={300} className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Fast Loser Threshold (Seconds)</label>
                <input type="number" defaultValue={60} className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Max Trades Per Day</label>
                <input type="number" defaultValue={15} className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Baseline Position Size</label>
                <input type="number" defaultValue={1} className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-border">
              <h4 className="text-sm font-bold mb-4">Weak Time Windows</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-accent/30 rounded-2xl">
                  <div className="flex items-center space-x-3">
                    <Badge variant="warning">Lunch Hour</Badge>
                    <span className="text-sm">12:00 PM - 1:30 PM EST</span>
                  </div>
                  <Button variant="ghost" className="text-rose-500" onClick={() => handleAction('Remove Time Window')}>Remove</Button>
                </div>
                <Button variant="outline" className="w-full border-dashed" onClick={() => handleAction('Add Time Window')}>Add Time Window</Button>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-border flex justify-end">
              <Button variant="primary" onClick={() => handleAction('Save Changes')}>Save Changes</Button>
            </div>
          </Card>
          )}

          {activeTab === 'risk-parameters' && (
          <Card className="p-8">
            <h3 className="text-lg font-bold mb-2">Risk Parameters</h3>
            <p className="text-sm text-muted-foreground mb-6">Limits used to flag when a session or trade breaks your risk rules.</p>
            {isLoadingRisk ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Daily Loss (USD)</label>
                    <input
                      type="number"
                      placeholder="e.g. 500"
                      value={riskForm.maxDailyLossUsd}
                      onChange={e => setRiskForm(f => ({ ...f, maxDailyLossUsd: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Daily Loss (%)</label>
                    <input
                      type="number"
                      placeholder="e.g. 2"
                      value={riskForm.maxDailyLossPct}
                      onChange={e => setRiskForm(f => ({ ...f, maxDailyLossPct: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Risk Per Trade (%)</label>
                    <input
                      type="number"
                      placeholder="e.g. 1"
                      value={riskForm.riskPerTradePct}
                      onChange={e => setRiskForm(f => ({ ...f, riskPerTradePct: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Position Size (Contracts)</label>
                    <input
                      type="number"
                      placeholder="e.g. 5"
                      value={riskForm.maxPositionSize}
                      onChange={e => setRiskForm(f => ({ ...f, maxPositionSize: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Max Consecutive Losses</label>
                    <input
                      type="number"
                      placeholder="e.g. 3"
                      value={riskForm.maxConsecutiveLosses}
                      onChange={e => setRiskForm(f => ({ ...f, maxConsecutiveLosses: e.target.value }))}
                      className="w-full bg-accent/50 border border-border rounded-xl px-4 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-border flex justify-end">
                  <Button variant="primary" disabled={isSavingRisk} onClick={handleSaveRisk}>
                    {isSavingRisk ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </>
            )}
          </Card>
          )}

          {activeTab === 'trading-parameters' && (
          <Card className="p-8 border-rose-500/20 bg-rose-500/5">
            <h3 className="text-lg font-bold mb-6 text-rose-500">Danger Zone</h3>
            <div className="flex items-center justify-between p-6 bg-rose-500/10 rounded-2xl border border-rose-500/20">
              <div className="space-y-1">
                <h4 className="font-bold text-rose-500">Clear All Trade Data</h4>
                <p className="text-sm text-muted-foreground">This will permanently delete all your imported trades from the database.</p>
              </div>
              <Button
                variant="ghost"
                className="bg-rose-500 text-white hover:bg-rose-600"
                onClick={() => {
                  if (window.confirm("Are you absolutely sure you want to delete ALL your trade data? This cannot be undone.")) {
                    clearTrades();
                    setToast({ message: 'All trades cleared successfully.', type: 'success' });
                    setTimeout(() => setToast(null), 3000);
                  }
                }}
              >
                Clear All Trades
              </Button>
            </div>
          </Card>
          )}
        </div>
      </div>

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
