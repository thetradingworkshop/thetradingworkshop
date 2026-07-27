import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils';
import { AccountOption } from '../context/TradeContext';

interface AccountFilterDropdownProps {
  accountOptions: AccountOption[];
  accountFilter: string[];
  setAccountFilter: (value: string[]) => void;
  className?: string;
}

// Shared across Trades, Dashboard, and Sessions so all three respect the
// same selected account(s) — filtering out unwanted/other-account
// executions. Supports selecting multiple accounts at once so their trades
// can be reviewed together; "All Accounts" is mutually exclusive with
// picking specific ones.
export function AccountFilterDropdown({ accountOptions, accountFilter, setAccountFilter, className }: AccountFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (accountOptions.length === 0) return null;

  const isAll = accountFilter.length === 0 || accountFilter.includes('all');

  const toggle = (value: string) => {
    if (value === 'all') {
      setAccountFilter(['all']);
      return;
    }
    const current = isAll ? [] : accountFilter;
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    setAccountFilter(next);
  };

  const selectedLabel = (() => {
    if (isAll) return 'All Accounts';
    if (accountFilter.length === 1) {
      if (accountFilter[0] === 'unassigned') return 'Unassigned';
      const match = accountOptions.find(a => `${a.connectionId}::${a.accountId}` === accountFilter[0]);
      return match ? match.accountName : '1 Account';
    }
    return `${accountFilter.length} Accounts`;
  })();

  return (
    <div className={cn("relative", className)} ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border/60 rounded-xl hover:bg-accent transition-all text-sm font-medium shadow-sm max-w-[220px]"
        title="Filter by account"
      >
        <span className="truncate" title={selectedLabel}>{selectedLabel}</span>
        {!isAll && (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
            {accountFilter.length}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 z-[100] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 w-72 p-2">
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-accent cursor-pointer text-sm font-bold">
            <input
              type="checkbox"
              checked={isAll}
              onChange={() => toggle('all')}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            <span>All Accounts</span>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-accent cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={!isAll && accountFilter.includes('unassigned')}
              onChange={() => toggle('unassigned')}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            <span>Unassigned</span>
          </label>
          <div className="max-h-72 overflow-y-auto space-y-0.5 mt-1 pt-1 border-t border-border/40">
            {accountOptions.map(a => {
              const key = `${a.connectionId}::${a.accountId}`;
              return (
                <label key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-accent cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={!isAll && accountFilter.includes(key)}
                    onChange={() => toggle(key)}
                    className="w-4 h-4 rounded border-border accent-primary shrink-0"
                  />
                  <span className="truncate" title={`${a.brokerName} — ${a.accountName}`}>{a.brokerName} — {a.accountName}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
