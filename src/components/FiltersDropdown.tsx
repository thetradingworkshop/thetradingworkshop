import React, { useState, useRef, useEffect } from 'react';
import { Filter as FilterIcon } from 'lucide-react';
import { cn } from '../utils';
import { TradeFilters, TradeFilterOptions, EMPTY_TRADE_FILTERS } from '../context/TradeContext';

interface FiltersDropdownProps {
  filters: TradeFilters;
  setFilters: (filters: TradeFilters) => void;
  filterOptions: TradeFilterOptions;
}

const SIDES: Array<'LONG' | 'SHORT'> = ['LONG', 'SHORT'];

function FilterGroup<T extends string>({ label, options, selected, onToggle }: {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1">{label}</p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => onToggle(opt)}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function FiltersDropdown({ filters, setFilters, filterOptions }: FiltersDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeCount = filters.symbols.length + filters.sides.length + filters.grades.length + filters.tags.length;

  const toggle = (field: keyof TradeFilters, value: string) => {
    const current = filters[field] as string[];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    setFilters({ ...filters, [field]: next } as TradeFilters);
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border/60 rounded-xl hover:bg-accent transition-all text-sm font-medium shadow-sm"
      >
        <FilterIcon className="w-4 h-4 text-muted-foreground" />
        <span>Filters</span>
        {activeCount > 0 && (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 z-[100] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 w-72 p-4 space-y-4">
          <FilterGroup label="Symbol" options={filterOptions.symbols} selected={filters.symbols} onToggle={(v) => toggle('symbols', v)} />
          <FilterGroup label="Side" options={SIDES} selected={filters.sides} onToggle={(v) => toggle('sides', v)} />
          <FilterGroup label="Trade Grade" options={filterOptions.grades} selected={filters.grades} onToggle={(v) => toggle('grades', v)} />
          <FilterGroup label="Tags" options={filterOptions.tags} selected={filters.tags} onToggle={(v) => toggle('tags', v)} />

          {filterOptions.symbols.length === 0 && filterOptions.grades.length === 0 && filterOptions.tags.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-1">No filterable data yet — import some trades first.</p>
          )}

          {activeCount > 0 && (
            <button
              onClick={() => setFilters(EMPTY_TRADE_FILTERS)}
              className="text-xs font-bold text-primary hover:underline px-1"
            >
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
