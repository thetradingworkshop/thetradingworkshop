import { BrokerAccount, Trade } from '../types';

// Per-account max-drawdown tracking — the manual-entry equivalent of
// TradeZella's "Prop Firm Sync" (their most distinctive feature besides
// AI): each funded/evaluation account has its own drawdown rule, tracked
// independently against that account's own trades, not the trader's
// overall P&L. Static drawdown only (a fixed floor below the account's
// starting size) — the simplest and most broadly-applicable model; a
// firm using a trailing/EOD-anchored drawdown instead won't get an exact
// number here, but still gets a directionally-useful one.

export type DrawdownStatusKind = 'safe' | 'warning' | 'breached';

export interface AccountDrawdownStatus {
  startingBalance: number;
  netPnl: number;
  currentEquity: number;
  drawdownLimit: number;
  breachFloor: number;
  distanceToBreach: number;
  /** 0-100+, how much of the drawdown budget a losing streak has used. A net-positive account is 0, not negative. */
  pctUsed: number;
  status: DrawdownStatusKind;
}

const WARNING_THRESHOLD_PCT = 70;

/**
 * Returns null when the account doesn't carry enough configuration to
 * track a drawdown at all (no account size, no drawdown limit, or a type
 * the rule doesn't apply to — matches TradingAccountsSettings'
 * drawdownApplies()).
 */
export function computeAccountDrawdownStatus(account: BrokerAccount, trades: Trade[]): AccountDrawdownStatus | null {
  if (!account.accountSize || !account.drawdown || account.drawdown <= 0) return null;
  if (account.accountType !== 'Evaluation' && account.accountType !== 'Funded') return null;

  const netPnl = trades
    .filter(t => t.connectionId === account.connectionId && t.accountId === account.id)
    .reduce((sum, t) => sum + t.pnlCurrency, 0);

  const startingBalance = account.accountSize;
  const currentEquity = startingBalance + netPnl;
  const breachFloor = startingBalance - account.drawdown;
  const distanceToBreach = currentEquity - breachFloor;
  const pctUsed = Math.max(0, (-netPnl / account.drawdown) * 100);

  const status: DrawdownStatusKind =
    distanceToBreach <= 0 ? 'breached' : pctUsed >= WARNING_THRESHOLD_PCT ? 'warning' : 'safe';

  return { startingBalance, netPnl, currentEquity, drawdownLimit: account.drawdown, breachFloor, distanceToBreach, pctUsed, status };
}
