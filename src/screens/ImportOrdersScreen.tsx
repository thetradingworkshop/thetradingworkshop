import React, { useState, useRef, useEffect } from 'react';
import { SectionHeader, Card, Button, Badge } from '../components/Shared';
import { Upload, FileText, CheckCircle2, AlertCircle, ArrowRight, Info, ChevronDown, ChevronUp, Terminal, Loader2, Activity, Wallet } from 'lucide-react';
import { parseTradovateCsv, reconstructTrades, ParseResult } from '../engine';
import { Order, Trade, ReconstructionStep, BrokerAccount } from '../types';
import { cn } from '@/src/utils';
import { useTrades } from '../context/TradeContext';
import { useAuth } from '../context/AuthContext';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface ImportAccountOption {
  connectionId: string;
  accountId: string;
  brokerName: string;
  accountName: string;
}

export default function ImportOrdersScreen({ setActivePage }: { setActivePage: (page: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [reconstructed, setReconstructed] = useState<{ trades: Trade[], steps: ReconstructionStep[] } | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [skippedCount, setSkippedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addTrades, trades } = useTrades();
  const { user } = useAuth();

  const [accountOptions, setAccountOptions] = useState<ImportAccountOption[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>('');

  // Every account the user has created (across all their broker connections),
  // flattened for the picker below. Required before import is allowed so
  // every trade gets tagged with which account it came from.
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'broker_connections'), where('userId', '==', user.uid)),
      async (snapshot) => {
        const options: ImportAccountOption[] = [];
        for (const connDoc of snapshot.docs) {
          const brokerName = (connDoc.data() as any).brokerName || 'Unknown';
          const accountsSnap = await getDocs(collection(db, 'broker_connections', connDoc.id, 'accounts'));
          accountsSnap.docs.forEach(accDoc => {
            const acc = accDoc.data() as BrokerAccount;
            options.push({ connectionId: connDoc.id, accountId: accDoc.id, brokerName, accountName: acc.displayName });
          });
        }
        setAccountOptions(options);
      }
    );
    return () => unsubscribe();
  }, [user]);

  const selectedAccount = accountOptions.find(a => `${a.connectionId}::${a.accountId}` === selectedAccountKey);

  const handleFile = (file: File) => {
    if (!selectedAccount) return;
    setError(null);
    setSkippedCount(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseTradovateCsv(text, user?.uid || 'manual-user');
      console.log("Parse Result:", result);

      if (result.errors.length > 0) {
        setError(result.errors[0]);
        setParseResult(null);
        setReconstructed(null);
      } else {
        setParseResult(result);
        const recon = reconstructTrades(result.orders, {
          connectionId: selectedAccount.connectionId,
          accountId: selectedAccount.accountId,
          brokerName: selectedAccount.brokerName,
        });
        console.log("Reconstructed Trades:", recon.trades.length);
        setReconstructed(recon);
      }
    };
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "text/csv" || file.name.endsWith('.csv'))) {
      handleFile(file);
    } else {
      setError("Please upload a valid CSV file.");
    }
  };

  const handleImport = () => {
    if (!reconstructed || reconstructed.trades.length === 0) {
      console.warn("No reconstructed trades to import.");
      alert("No trades detected in the CSV. Please ensure the file contains valid filled orders.");
      return;
    }
    
    setIsProcessing(true);
    console.log(`Starting import of ${reconstructed.trades.length} trades...`);
    
    // Calculate duplicates before adding
    const existingHashes = new Set(trades.map(t => t.dedupeHash));
    const newTrades = reconstructed.trades.filter(t => !existingHashes.has(t.dedupeHash));
    const duplicates = reconstructed.trades.length - newTrades.length;
    console.log(`Found ${duplicates} duplicates. New trades to add: ${newTrades.length}`);
    setSkippedCount(duplicates);

    // Simulate processing delay for "Analysis" feel
    setTimeout(async () => {
      try {
        await addTrades(reconstructed.trades, reconstructed.steps);
        console.log("Import process completed successfully.");
        setIsProcessing(false);
        if (duplicates === 0) {
          setActivePage('dashboard');
        }
      } catch (error) {
        console.error("Import failed:", error);
        setIsProcessing(false);
        alert("Failed to persist trades. Please check your connection and try again.");
      }
    }, 1500);
  };

  const [showIgnored, setShowIgnored] = useState(false);

  return (
    <div className="space-y-8 pb-20">
      <SectionHeader 
        title="Import Orders" 
        subtitle="Upload Tradovate or supported broker exports to reconstruct your trades"
      />

      {/* Error Message */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center space-x-3 text-rose-500">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Section 0: Account Selection — required so every imported trade is
          tagged with which account it came from, for later filtering. */}
      <Card className="p-5 space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5" />
          Import To Account
        </label>
        {accountOptions.length === 0 ? (
          <div className="flex items-center justify-between gap-4 p-4 bg-accent/30 rounded-xl">
            <p className="text-sm text-muted-foreground">
              You haven't created any accounts yet. Create one to organize and filter imports by broker/account.
            </p>
            <Button variant="outline" className="shrink-0" onClick={() => setActivePage('connections')}>
              Create Account
            </Button>
          </div>
        ) : (
          <select
            value={selectedAccountKey}
            onChange={(e) => setSelectedAccountKey(e.target.value)}
            className="w-full h-11 px-4 bg-accent/30 border border-border rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Select an account...</option>
            {accountOptions.map(a => (
              <option key={`${a.connectionId}::${a.accountId}`} value={`${a.connectionId}::${a.accountId}`}>
                {a.brokerName} — {a.accountName}
              </option>
            ))}
          </select>
        )}
      </Card>

      {/* Section 1: Upload Zone */}
      <div
        className={cn(
          "h-[240px] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all group",
          !selectedAccount ? "border-border opacity-50 cursor-not-allowed" :
          isDragging ? "border-primary bg-primary/5 cursor-pointer" : "border-border hover:border-primary/50 hover:bg-accent/50 cursor-pointer"
        )}
        onDragOver={(e) => { e.preventDefault(); if (selectedAccount) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={selectedAccount ? onDrop : (e) => e.preventDefault()}
        onClick={() => selectedAccount && fileInputRef.current?.click()}
      >
        <div className="p-5 bg-accent group-hover:bg-primary/10 rounded-2xl mb-4 transition-colors">
          <Upload className="w-10 h-10 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div className="text-center">
          <p className="font-bold text-lg">
            {selectedAccount ? 'Drag and drop your CSV file here' : 'Select an account above to enable import'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedAccount ? 'or click to browse files from your computer' : ''}
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          ref={fileInputRef}
          accept=".csv"
          disabled={!selectedAccount}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {parseResult && (
        <>
          {/* Section 2: Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="p-5 flex flex-col justify-between border-primary/20 bg-primary/5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Broker Format</p>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-primary" />
                <p className="text-sm font-bold">{parseResult.summary.brokerFormat}</p>
              </div>
              {parseResult.summary.sideHeaderUsed && (
                <div className="mt-2 pt-2 border-t border-primary/10">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">Side Column Detected</p>
                  <p className="text-[10px] font-mono truncate">{parseResult.summary.sideHeaderUsed}</p>
                </div>
              )}
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Total Rows</p>
              <p className="text-2xl font-bold">{parseResult.summary.totalRows}</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Parsed Rows</p>
              <p className="text-2xl font-bold text-indigo-500">{parseResult.summary.parsedRows}</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Valid Fills</p>
              <p className="text-2xl font-bold text-emerald-500">{parseResult.summary.validFilledRows}</p>
            </Card>
            <Card className={cn(
              "p-5 flex flex-col justify-between transition-colors",
              parseResult.summary.ignoredRows > 0 ? "border-rose-500/20 bg-rose-500/5" : ""
            )}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Ignored</p>
              <p className="text-2xl font-bold text-rose-500">{parseResult.summary.ignoredRows}</p>
            </Card>
          </div>

          {/* Ignored Rows Details (Conditional) */}
          {parseResult.summary.ignoredRows > 0 && (
            <div className="space-y-4">
              <Card className="overflow-hidden border-rose-500/20">
                <button 
                  onClick={() => setShowIgnored(!showIgnored)}
                  className="w-full p-4 flex items-center justify-between bg-rose-500/5 hover:bg-rose-500/10 transition-colors"
                >
                  <div className="flex items-center space-x-2 text-rose-500">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-bold">View {parseResult.summary.ignoredRows} Ignored Rows</span>
                  </div>
                  {showIgnored ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showIgnored && (
                  <div className="max-h-[300px] overflow-y-auto border-t border-rose-500/10">
                    <table className="w-full text-[10px]">
                      <thead className="bg-rose-500/10 sticky top-0">
                        <tr>
                          <th className="text-left p-3 text-rose-500/70 font-bold">Row</th>
                          <th className="text-left p-3 text-rose-500/70 font-bold">Reason</th>
                          <th className="text-left p-3 text-rose-500/70 font-bold">Raw Data Snippet</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-500/10">
                        {parseResult.ignoredRowsDetails.map((detail, i) => (
                          <tr key={i} className="hover:bg-rose-500/5">
                            <td className="p-3 font-mono">{detail.rowNumber}</td>
                            <td className="p-3 font-bold text-rose-500">{detail.reason}</td>
                            <td className="p-3 text-muted-foreground font-mono truncate max-w-[400px]">
                              {JSON.stringify(detail.data)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Parser Inspection Panel for Missing Side/Action */}
              {parseResult.ignoredRowsDetails.some(d => d.reason.includes('side/action')) && (
                <Card className="border-amber-500/20 bg-amber-500/5 overflow-hidden">
                  <div className="p-4 border-b border-amber-500/10 flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-amber-600">
                      <Terminal className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Parser Inspection: Missing Side/Action</h3>
                    </div>
                    <Badge variant="neutral" className="text-amber-600 border-amber-500/20">Debug View</Badge>
                  </div>
                  
                  <div className="p-4 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Detected Headers</p>
                        <div className="flex flex-wrap gap-1">
                          {parseResult.summary.allHeaders?.map((h, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-background border border-border rounded text-[9px] font-mono">
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Candidate Side Fields</p>
                        <div className="flex flex-wrap gap-1">
                          {parseResult.summary.sideCandidateFields?.map((f, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 rounded text-[9px] font-mono font-bold">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sample Row Diagnostics (First 10)</p>
                      <div className="space-y-3">
                        {parseResult.ignoredRowsDetails
                          .filter(d => d.reason.includes('side/action'))
                          .slice(0, 10)
                          .map((detail, i) => (
                            <div key={i} className="bg-background border border-amber-500/10 rounded-xl p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-amber-600">Row {detail.rowNumber}</span>
                                <span className="text-[9px] text-muted-foreground font-mono">Normalized Data Keys: {Object.keys(detail.data).join(', ')}</span>
                              </div>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <p className="text-[9px] font-bold text-muted-foreground uppercase">Candidate Field Values</p>
                                  <div className="grid grid-cols-1 gap-1">
                                    {Object.entries(detail.sideValuesFound || {}).map(([field, val], j) => (
                                      <div key={j} className="flex items-center justify-between text-[10px] bg-accent/30 p-1.5 rounded">
                                        <span className="font-mono text-muted-foreground">{field}:</span>
                                        <span className="font-bold">"{val !== undefined ? String(val) : 'undefined'}"</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[9px] font-bold text-muted-foreground uppercase">Full Row Object (JSON)</p>
                                  <pre className="text-[9px] font-mono bg-accent/20 p-2 rounded max-h-[100px] overflow-y-auto">
                                    {JSON.stringify(detail.data, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Section 3: Previews */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="overflow-hidden border-border/40">
              <div className="p-5 border-b border-border/50 bg-accent/20 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">Raw Fills Preview</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">First 10 valid filled rows from CSV</p>
                </div>
                <Badge>Raw Data</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-accent/10 border-b border-border/50">
                    <tr>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Order ID</th>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Time</th>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Side</th>
                      <th className="text-right p-4 font-bold text-muted-foreground uppercase tracking-wider">Qty</th>
                      <th className="text-right p-4 font-bold text-muted-foreground uppercase tracking-wider">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {parseResult.orders.slice(0, 10).map((order, i) => (
                      <tr key={i} className="hover:bg-accent/5 transition-colors">
                        <td className="p-4 font-mono text-muted-foreground">{order.order_id}</td>
                        <td className="p-4 whitespace-nowrap">{new Date(order.fill_time).toLocaleString()}</td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md font-bold text-[10px]",
                            order.side === 'BUY' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                          )}>
                            {order.side}
                          </span>
                        </td>
                        <td className="p-4 text-right font-medium">{order.quantity}</td>
                        <td className="p-4 text-right font-mono">{order.avg_price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden border-border/40">
              <div className="p-5 border-b border-border/50 bg-accent/20 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">Reconstructed Trades</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Detected trades based on flat-to-flat logic</p>
                </div>
                <Badge variant="positive">Normalized</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-accent/10 border-b border-border/50">
                    <tr>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Trade ID</th>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Symbol</th>
                      <th className="text-left p-4 font-bold text-muted-foreground uppercase tracking-wider">Side</th>
                      <th className="text-right p-4 font-bold text-muted-foreground uppercase tracking-wider">PnL Pts</th>
                      <th className="text-right p-4 font-bold text-muted-foreground uppercase tracking-wider">Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {reconstructed?.trades.slice(0, 10).map((trade, i) => (
                      <tr key={i} className="hover:bg-accent/5 transition-colors">
                        <td className="p-4 font-mono text-primary font-bold">{trade.id}</td>
                        <td className="p-4 font-bold">{trade.symbol}</td>
                        <td className="p-4">
                          <Badge variant={trade.direction === 'LONG' ? 'positive' : 'negative'}>
                            {trade.direction}
                          </Badge>
                        </td>
                        <td className={cn(
                          "p-4 text-right font-bold",
                          trade.pnlPoints > 0 ? "text-emerald-500" : "text-rose-500"
                        )}>
                          {trade.pnlPoints > 0 ? '+' : ''}{trade.pnlPoints.toFixed(2)}
                        </td>
                        <td className="p-4 text-right text-muted-foreground">{trade.orderCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Section 4: Reconstruction Steps (Debug View) */}
          <Card className="overflow-hidden border-border/40">
            <button 
              onClick={() => setShowSteps(!showSteps)}
              className="w-full p-5 flex items-center justify-between bg-accent/10 hover:bg-accent/20 transition-colors border-b border-border/50"
            >
              <div className="flex items-center space-x-3">
                <Terminal className="w-5 h-5 text-indigo-500" />
                <div className="text-left">
                  <h3 className="font-bold text-sm">Reconstruction Steps</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Step-by-step logic of how trades were built from fills</p>
                </div>
              </div>
              {showSteps ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            
            {showSteps && (
              <div className="overflow-x-auto bg-black/5 dark:bg-black/20">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-accent/20 border-b border-border/50">
                    <tr>
                      <th className="text-left p-3 text-muted-foreground">Time</th>
                      <th className="text-left p-3 text-muted-foreground">Action</th>
                      <th className="text-left p-3 text-muted-foreground">Side</th>
                      <th className="text-right p-3 text-muted-foreground">Qty</th>
                      <th className="text-right p-3 text-muted-foreground">Price</th>
                      <th className="text-right p-3 text-muted-foreground">Pos</th>
                      <th className="text-left p-3 text-muted-foreground">Trade ID</th>
                      <th className="text-left p-3 text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {reconstructed?.steps.map((step, i) => (
                      <tr key={i} className="hover:bg-accent/10">
                        <td className="p-3 whitespace-nowrap opacity-60">{new Date(step.time).toLocaleString()}</td>
                        <td className="p-3">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-bold",
                            step.action.includes('FLIP') ? "bg-amber-500/20 text-amber-500" :
                            step.action === 'CLOSE' ? "bg-rose-500/20 text-rose-500" : "bg-indigo-500/20 text-indigo-500"
                          )}>
                            {step.action}
                          </span>
                        </td>
                        <td className="p-3">{step.side}</td>
                        <td className="p-3 text-right">{step.quantity}</td>
                        <td className="p-3 text-right">{step.price.toFixed(2)}</td>
                        <td className={cn(
                          "p-3 text-right font-bold",
                          step.currentPosition > 0 ? "text-emerald-500" : step.currentPosition < 0 ? "text-rose-500" : "text-muted-foreground"
                        )}>
                          {step.currentPosition}
                        </td>
                        <td className="p-3 font-bold text-primary">{step.tradeId || '-'}</td>
                        <td className="p-3 text-muted-foreground italic">{step.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Section 5: Final Action */}
          <Card className={cn(
            "p-8 border-emerald-500/20",
            skippedCount !== null ? "bg-amber-500/5 border-amber-500/20" : "bg-emerald-500/5"
          )}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="flex items-center space-x-5">
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0",
                  skippedCount !== null ? "bg-amber-500/10" : "bg-emerald-500/10"
                )}>
                  {skippedCount !== null ? <AlertCircle className="w-8 h-8 text-amber-500" /> : <CheckCircle2 className="w-8 h-8 text-emerald-500" />}
                </div>
                <div>
                  <h3 className="font-bold text-xl">
                    {skippedCount !== null ? 'Import Summary' : 'Ready to Process'}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {skippedCount !== null ? (
                      <>
                        <span className="font-bold text-primary">{reconstructed?.trades.length! - skippedCount} new trades</span> imported. 
                        <span className="font-bold text-amber-500 ml-1">{skippedCount} duplicates</span> were skipped.
                      </>
                    ) : (
                      <>
                        {parseResult.summary.validFilledRows} orders mapped successfully. 
                        Detected <span className="font-bold text-primary">{reconstructed?.trades.length} trades</span> for analysis.
                      </>
                    )}
                  </p>
                </div>
              </div>
              {skippedCount !== null ? (
                <Button 
                  variant="outline"
                  className="h-14 px-10 text-lg font-bold rounded-2xl"
                  onClick={() => setActivePage('dashboard')}
                >
                  Go to Dashboard
                </Button>
              ) : (
                <Button 
                  className="h-14 px-10 text-lg font-bold rounded-2xl shadow-lg shadow-emerald-500/10" 
                  icon={isProcessing ? Loader2 : ArrowRight}
                  onClick={handleImport}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Analyzing...' : 'Import & Analyze'}
                </Button>
              )}
            </div>
          </Card>
        </>
      )}

      {!parseResult && (
        <Card className="p-8 border-dashed border-2 bg-accent/5">
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-indigo-500/10 rounded-xl flex-shrink-0">
              <Info className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <h4 className="font-bold text-lg">Supported Formats</h4>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Currently optimized for <span className="font-bold text-primary">Tradovate CSV</span> exports. 
                Ensure your file includes columns for Order ID, Symbol, Side, Fill Time, Quantity, and Price. 
                The system will automatically detect and normalize these fields for trade reconstruction.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
