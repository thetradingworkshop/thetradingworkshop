import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/src/utils';
import { METRIC_DEFS, METRIC_CATEGORY_LABELS, MetricCategory } from '../../services/reportMetrics';

// Checkbox multi-select capped at 3, grouped into the same categories as
// the metric glossary. Follows FiltersDropdown.tsx's open/close-popover +
// checkbox-list pattern rather than introducing a new dropdown idiom.
const MAX_METRICS = 3;
const CATEGORIES: MetricCategory[] = ['profitability', 'risk', 'activity', 'consistency'];

interface MetricPickerProps {
  selected: string[];
  onChange: (keys: string[]) => void;
}

export function MetricPicker({ selected, onChange }: MetricPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key));
    } else if (selected.length < MAX_METRICS) {
      onChange([...selected, key]);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border/60 rounded-xl hover:bg-accent transition-all text-sm font-medium shadow-sm"
      >
        <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
        <span>Metrics</span>
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
          {selected.length}
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 z-[100] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 w-72 p-4 space-y-4">
          <p className="text-[11px] text-muted-foreground px-1">Plot up to {MAX_METRICS} at once.</p>
          {CATEGORIES.map(cat => {
            const defs = METRIC_DEFS.filter(m => m.category === cat);
            return (
              <div key={cat} className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1">{METRIC_CATEGORY_LABELS[cat]}</p>
                <div className="space-y-1">
                  {defs.map(m => {
                    const checked = selected.includes(m.key);
                    const disabled = !checked && selected.length >= MAX_METRICS;
                    return (
                      <label
                        key={m.key}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm",
                          disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent cursor-pointer"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(m.key)}
                          className="w-4 h-4 rounded border-border accent-primary"
                        />
                        <span>{m.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
