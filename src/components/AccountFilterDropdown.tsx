import React from 'react';
import { AccountOption } from '../context/TradeContext';

interface AccountFilterDropdownProps {
  accountOptions: AccountOption[];
  accountFilter: string;
  setAccountFilter: (value: string) => void;
  className?: string;
}

// Shared across Trades, Dashboard, and Sessions so all three respect the
// same selected account — filtering out unwanted/other-account executions.
export function AccountFilterDropdown({ accountOptions, accountFilter, setAccountFilter, className }: AccountFilterDropdownProps) {
  if (accountOptions.length === 0) return null;

  return (
    <div className={className}>
      <select
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        className="px-3 py-2 bg-card border border-border/60 rounded-xl text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        title="Filter by account"
      >
        <option value="all">All Accounts</option>
        <option value="unassigned">Unassigned</option>
        {accountOptions.map(a => (
          <option key={`${a.connectionId}::${a.accountId}`} value={`${a.connectionId}::${a.accountId}`}>
            {a.brokerName} — {a.accountName}
          </option>
        ))}
      </select>
    </div>
  );
}
