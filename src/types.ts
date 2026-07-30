export type Role = 'admin' | 'user' | 'guest' | 'Admin' | 'Mentor' | 'Student' | 'Viewer';

// Fixed broker list — a user picks one of these when creating a named
// account to organize imports under. Not user-extensible; add here to
// support a new broker.
export const BROKERS = ['Tradovate', 'NinjaTrader', 'Topstep', 'ThinkorSwim', 'Lucid', 'Tradeify', 'MyFundedFutures'] as const;
export type Broker = typeof BROKERS[number];

export interface BrokerConnection {
  id: string;
  userId: string;
  brokerName: string;
  authType: 'OAuth' | 'APIKey' | 'Manual';
  status: 'connected' | 'disconnected' | 'error' | 'paused' | 'manual_sync_active' | 'requires_reconnect';
  environment: 'live' | 'demo';
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  externalUserId?: string;
  syncMode?: 'auto' | 'manual_csv' | 'api_live';
  importCount?: number;
  lastSuccessfulSyncAt?: string;
  lastFailedSyncAt?: string;
  lastSyncError?: string;
  lastImportAt?: string;
  lastSyncAt?: string;
  syncStatus?: 'idle' | 'syncing' | 'failed';
  syncStartedAt?: string;
  syncLockExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  accounts?: BrokerAccount[];
  logs?: any[];
}

// Fixed trading-account types a user picks when setting an account's
// economics in Settings > Accounts (same accounts used to tag imports).
export const TRADING_ACCOUNT_TYPES = ['Evaluation', 'Funded', 'Live Funded', 'Private Capital'] as const;
export type TradingAccountType = typeof TRADING_ACCOUNT_TYPES[number];

// Preset evaluation target / drawdown amounts keyed by account size (USD).
// Selecting a size in the UI pre-fills these fields; both remain editable.
export const ACCOUNT_SIZE_PRESETS: Record<number, { evaluationTarget: number; drawdown?: number }> = {
  25000: { evaluationTarget: 1500, drawdown: 1500 },
  50000: { evaluationTarget: 3000, drawdown: 200 },
  100000: { evaluationTarget: 6000 },
};

// Itemized ledger of real money in and out of a trading account — separate
// from initialCost/activationFees below (which are just single running
// totals). This is what actually determines whether a trader is
// profitable: in-platform P&L only reflects what happened inside a
// funded account, not what it cost to acquire/maintain across every
// eval attempt, reset, and subscription charge, or what was ever
// actually paid out and withdrawn.
export const ACCOUNT_TRANSACTION_TYPES = ['cost', 'payout'] as const;
export type AccountTransactionType = typeof ACCOUNT_TRANSACTION_TYPES[number];

export const ACCOUNT_TRANSACTION_CATEGORIES: Record<AccountTransactionType, string[]> = {
  cost: ['Evaluation Fee', 'Reset Fee', 'Activation Fee', 'Monthly Subscription', 'Other Cost'],
  payout: ['Payout', 'Other Income'],
};

export interface AccountTransaction {
  id: string;
  userId: string;
  connectionId: string;
  accountId: string;
  type: AccountTransactionType;
  category: string;
  amount: number; // USD, always positive — `type` determines the sign in aggregation
  date: string; // yyyy-MM-dd
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerAccount {
  id: string;
  connectionId: string;
  externalAccountId: string;
  displayName: string;
  status: 'active' | 'inactive';
  selectedForSync: boolean;

  // Trading-account economics, set via Settings > Accounts. Optional since
  // accounts created directly from Import Orders / Broker Connections don't
  // set these — they can be filled in later from Settings.
  accountType?: TradingAccountType;
  initialCost?: number; // USD
  activationFees?: number; // USD
  accountSize?: number; // 25000 | 50000 | 100000, undefined when "Custom"
  evaluationTarget?: number; // USD profit target
  // Only applicable to Evaluation and Funded account types.
  drawdown?: number; // USD
  createdAt?: string;
  updatedAt?: string;
}

export interface IngestionError {
  id: string;
  userId: string;
  connectionId: string;
  importRunId?: string;
  errorType: string;
  message: string;
  errorMessage?: string;
  rawPayload?: any;
  resolved: boolean;
  createdAt: string;
}

export type IngestionEvent = {
  id: string;
  userId: string;
  connectionId: string;
  accountId: string;
  type: 'tradovate_sync' | 'csv_upload';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processingStatus: 'pending' | 'processing' | 'processed' | 'failed';
  processedAt?: string;
  processingRunId?: string;
  processingError?: string;
  timestamp: string;
  eventTimestamp: string;
  symbol: string;
  side: string;
  quantity: number;
  avgFillPrice: number;
  orderId: string;
  fillId?: string;
  dedupeHash?: string;
  externalEventId?: string;
  eventType?: string;
  importRunId?: string;
  payload: any;
  rawPayload?: any;
  normalizedPayload?: any;
  metadata?: Record<string, any>;
};

export type Order = {
  id: string;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: string;
  orderType: string;
  status: string;
  brokerOrderId?: string;
  accountId?: string;
  fillId?: string;
  normalizedTimestamp?: string;
  commission?: number;
  fees?: number;
  source?: 'csv' | 'api' | 'manual';
  importRunId?: string;
  
  // Snake case aliases for backward compatibility
  order_id?: string;
  avg_price?: number;
  fill_time?: string;
};

export interface TradeTruth {
  id: string;
  userId: string;
  sessionId: string;
  sessionDate: string; // YYYY-MM-DD

  // Which broker account these fills were imported under, for separating
  // and filtering executions from different accounts. Absent on trades
  // imported before this existed — treated as "Unassigned" in the UI.
  accountId?: string;
  connectionId?: string;
  brokerName?: string;

  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  exitTime: string;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  pnlPoints: number;
  pnlCurrency: number;
  isWinner: boolean;
  holdTimeSeconds: number;
  fills: Order[];
  dedupeHash: string;
  totalEntryValue: number;
  totalExitValue: number;
  realizedPnL: number;
  maxPositionSize: number;

  // Costs
  grossPnlCurrency?: number;
  totalCommission?: number;

  // Derived instrument economics (computed at reconstruction time)
  ticks?: number;
  ticksPerContract?: number;
  netRoi?: number; // percent
  adjustedCost?: number; // $ notional cost basis at entry (avgEntryPrice * pointValue * quantity)

  // Auto-computed by applyBatchDerivedGrading() at reconstruction time from
  // P&L, execution pattern, and re-entry timing — not user-editable.
  tradeGrade?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

  // Rule Enforcement
  intentId?: string;
  wasValidAtEntry?: boolean;
  wasForced?: boolean;
  isViolation?: boolean;

  // Set by AddTradeModal when a trade is entered by hand rather than
  // imported. Not derived from `fills[].source`, which reconstructTrades()
  // always overwrites to 'csv' regardless of the input orders' own source.
  isManualEntry?: boolean;
}

export interface TradeDerivedMetrics {
  riskRewardRatio?: number;
  mae?: number;
  mfe?: number;
  efficiency?: number;
  isFastLoser?: boolean;
  isReentry?: boolean;
  isLargeWinner?: boolean;
  isLargeLoser?: boolean;
  orderCount?: number;
}

export interface TradeDiagnostics {
  pnlResult: 'WIN' | 'LOSS' | 'BREAKEVEN';
  holdType: 'SCALP' | 'INTRADAY' | 'SWING';
  executionType: 'SINGLE_ENTRY' | 'SCALED_IN' | 'SCALED_OUT' | 'FULL_SCALE';
  efficiency: number;
  adverseExcursion?: number;
  dataInsight: string;
}

export interface PreTradeChecklist {
  displacement: boolean;
  reversal: boolean;
  imbalance: boolean;
  pullback: boolean;
  confirmedAt: string;
}

export interface ModelValidation {
  followsModel: boolean;
  violations: string[];
  checklist?: PreTradeChecklist;
  isManualOverride?: boolean;
  isUnconfirmed?: boolean;
}

export interface TradeReview {
  executionQuality?: number;
  strategyQuality?: number;
  entryQuality?: number;
  exitQuality?: number;
  timingScore?: number;
  behaviorFlags?: string[];
  tags?: string[];
  verdict?: string;
  lessonLearned?: string;
  // Standalone screenshots attached to the trade, separate from any images
  // embedded inline in verdict/lessonLearned — same downscaled-JPEG data URI
  // approach (see src/lib/imageProcessing.ts), no Firebase Storage bucket.
  attachments?: string[];
  diagnostics?: TradeDiagnostics;
  modelValidation?: ModelValidation;

  // Manual trade-plan fields, set by the trader (not derived)
  strategy?: string;
  starRating?: number; // 1-5
  initialTarget?: number;
  tradeRisk?: number;
  plannedRMultiple?: number;
  realizedRMultiple?: number;
  bestExitPrice?: number;
  bestExitTime?: string;
}

export type Trade = TradeTruth & TradeDerivedMetrics & TradeReview;

export interface BehaviorImpact {
  behavior: string;
  impact: number;
  tradeCount: number;
  description: string;
}

export interface Session {
  id: string;
  userId: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWinner: number;
  avgLoser: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  totalVolume: number;
  
  // Behavioral
  fastLosersCount: number;
  overtradingFlag: boolean;
  sizeEscalationDetected: boolean;
  scalingPatternCount: number;
  
  // Scoring
  disciplineScore: number;
  consistencyScore: number;
  
  // Diagnostics
  diagnostics: string[];
  
  // Analysis Engine
  primaryIssue?: string;
  secondaryIssue?: string;
  primaryStrength?: string;
  keyInsight?: string;
  behaviorImpacts?: BehaviorImpact[];
  
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  
  // Financials
  grossProfit?: number;
  grossLoss?: number;
  avgHoldTimeSeconds?: number;
  reentryCount?: number;
  maxLosingStreak?: number;

  // Journaling
  premarketPlan?: string;
  sessionNotes?: string;
  whatWentWell?: string;
  whatHurt?: string;
  correctiveAction?: string;
  sessionCategory?: 'NY_AM' | 'NY_PM' | 'ASIA' | 'LONDON' | 'WEEKLY';

  // Trades
  trades?: Trade[];
  
  // Metadata for UI
  tags?: string[];
  notes?: string;

  // Model Performance
  modelFollowRate?: number;
  validModelPnl?: number;
  invalidModelPnl?: number;
  ruleViolationsCount?: number;
  unconfirmedTradesCount?: number;
  manualOverrideCount?: number;

  // Rule Enforcement
  totalViolations?: number;
  violationRate?: number;
  pnlFromViolations?: number;
  pnlFromValidTrades?: number;
  disciplineVerdict?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  tradovateConnected?: boolean;
  tradovateAccountId?: string;
  settings?: {
    riskPerTrade?: number;
    dailyLossLimit?: number;
    theme?: 'light' | 'dark' | 'system';
  };
}

export interface TagCategory {
  id: string;
  userId: string;
  name: string;
  tags: string[];
  order: number;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  sessionId: string;
  tradeId?: string;
  title: string;
  date: string; // yyyy-MM-dd
  content: string;
  tags: string[];
  mood?: 'happy' | 'neutral' | 'frustrated' | 'angry' | 'focused';
  entryReason?: string;
  followedPlan?: boolean;
  improvements?: string;
  status?: 'private' | 'shared';
  createdAt: string;
  updatedAt: string;

  isFavorite?: boolean;

  // Sessions Recap notes span a date range rather than a single trade/session,
  // so unlike Trade Notes (tradeId set) and Daily Journal (sessionId set) they
  // can't be inferred from existing fields — noteType marks them explicitly.
  noteType?: 'session_recap';
  recapStartDate?: string; // yyyy-MM-dd
  recapEndDate?: string; // yyyy-MM-dd
  accountId?: string;
  connectionId?: string;
  brokerName?: string;
  recapStats?: {
    netPnl: number;
    grossPnl: number;
    totalTrades: number;
    winners: number;
    losers: number;
    winRate: number; // percent, 0-100
    commissions: number;
    volume: number;
    profitFactor: number;
    // Cumulative realized P&L by day within the recap range, for the equity curve.
    equityCurve: { date: string; cumPnl: number }[];
  };
}

export interface ReconstructionStep {
  id: string;
  timestamp: string;
  type: 'order' | 'trade_open' | 'trade_close' | 'position_update';
  description: string;
  data: any;
  
  time?: string;
  action?: string;
  side?: string;
  quantity?: number;
  price?: number;
  currentPosition?: number;
  tradeId?: string;
  notes?: string;
}

export interface TradeStats {
  netPnl: number;
  netPnlDollars: number;
  winRate: number;
  profitFactor: number;
  avgWinner: number;
  avgLoser: number;
  totalTrades: number;
  equityData: { name: string; value: number }[];
  equityDataDollars: { name: string; value: number }[];
  pnlByTrade: { id: string; pnl: number }[];
  hourlyData: { hour: string; pnl: number }[];
  holdData: { range: string; count: number }[];
  gradeData: { name: string; value: number; color: string }[];
}

export interface PositionState {
  id: string;
  connectionId: string;
  accountId: string;
  brokerName?: string;
  symbol: string;
  currentPosition: number;
  avgEntryPrice: number;
  openTradeId: string | null;
  openTradeDirection: 'long' | 'short' | null;
  totalEntryQuantity: number;
  totalExitQuantity: number;
  entryValue: number;
  exitValue: number;
  entryTime: string | null;
  lastProcessedEventTimestamp: string;
  lastProcessedEventId: string;
  rawOrderIds: string[];
  fills: Order[];
  updatedAt: string;
  maxPositionSize: number;
}

export interface TradeIntent {
  id: string;
  userId: string;
  symbol: string;
  checklist: {
    displacement: boolean;
    reversal: boolean;
    imbalance: boolean;
    pullback: boolean;
  };
  isValidSetup: boolean;
  overrideUsed: boolean;
  confirmedAt: string;
  status: 'pending' | 'matched';
  tradeId?: string;
}

export interface ParseResult {
  orders: Order[];
  errors: string[];
  ignored: string[];
  summary: {
    brokerFormat: string;
    totalRows: number;
    parsedRows: number;
    validFilledRows: number;
    ignoredRows: number;
    symbols: string[];
    sideHeaderUsed?: string;
    allHeaders?: string[];
    sideCandidateFields?: string[];
  };
  ignoredRowsDetails: {
    rowNumber: number;
    reason: string;
    data: any;
    sideValuesFound?: Record<string, any>;
  }[];
}
