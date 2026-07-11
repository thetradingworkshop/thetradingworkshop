import React, { useState, useRef, useEffect } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isWithinInterval,
  isToday,
  startOfDay,
  endOfDay,
  isValid
} from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Clock } from 'lucide-react';
import { cn } from '../utils';
import { Button, Card, Badge } from './Shared';
import { useDateRange, PRESETS, DateRange } from '../context/DateContext';

// --- Reusable Components ---

export function DatePresetChips({ activeLabel, onSelect }: { activeLabel: string, onSelect: (label: string) => void }) {
  const chips = ['7D', '30D', 'This Month', 'Custom'];
  const labelMap: Record<string, string> = {
    '7D': 'Last 7 Days',
    '30D': 'Last 30 Days',
    'This Month': 'This Month',
    'Custom': 'Custom Range'
  };

  return (
    <div className="flex items-center gap-2">
      {chips.map(chip => (
        <Badge
          key={chip}
          variant={activeLabel === labelMap[chip] ? 'info' : 'neutral'}
          onClick={() => onSelect(labelMap[chip])}
        >
          {chip}
        </Badge>
      ))}
    </div>
  );
}

export function PageDateFilterBar({ pageId }: { pageId: string }) {
  const { globalRange, pageOverrides, setPageOverride, getEffectiveRange } = useDateRange();
  const effectiveRange = getEffectiveRange(pageId);
  const isOverridden = !!pageOverrides[pageId];

  const handlePresetSelect = (label: string) => {
    const preset = PRESETS.find(p => p.label === label);
    if (preset) {
      const val = preset.getValue();
      if (val) {
        setPageOverride(pageId, { ...val, label });
      }
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-card border border-border/60 rounded-2xl mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <CalendarIcon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            {isOverridden ? 'Custom page range active' : 'Using global range'}
          </p>
          <p className="text-sm font-semibold">
            Showing data for {format(effectiveRange.from, 'MMM d, yyyy')} – {format(effectiveRange.to, 'MMM d, yyyy')}
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <DatePresetChips 
          activeLabel={effectiveRange.label} 
          onSelect={handlePresetSelect} 
        />
        {isOverridden && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs h-7"
            onClick={() => setPageOverride(pageId, null)}
          >
            Reset to Global
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Internal Calendar UI ---

function Calendar({ 
  selectedFrom, 
  selectedTo, 
  onSelect 
}: { 
  selectedFrom: Date | null, 
  selectedTo: Date | null, 
  onSelect: (date: Date) => void 
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const isSelected = (day: Date) => {
    if (selectedFrom && isSameDay(day, selectedFrom)) return true;
    if (selectedTo && isSameDay(day, selectedTo)) return true;
    return false;
  };

  const isInRange = (day: Date) => {
    if (selectedFrom && selectedTo) {
      return isWithinInterval(day, { start: startOfDay(selectedFrom), end: endOfDay(selectedTo) });
    }
    return false;
  };

  return (
    <div className="w-[280px]">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold">{format(currentMonth, 'MMMM yyyy')}</h4>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-accent rounded-md">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-accent rounded-md">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
          <div key={day} className="text-[10px] font-bold text-center text-muted-foreground uppercase py-1">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          const selected = isSelected(day);
          const inRange = isInRange(day);
          const sameMonth = isSameMonth(day, monthStart);
          const today = isToday(day);

          return (
            <button
              key={idx}
              onClick={() => onSelect(day)}
              className={cn(
                "h-8 w-8 text-xs rounded-lg flex items-center justify-center transition-all relative",
                !sameMonth && "text-muted-foreground/30",
                sameMonth && !selected && !inRange && "hover:bg-accent",
                selected && "bg-primary text-primary-foreground font-bold z-10",
                inRange && !selected && "bg-primary/10 text-primary font-medium",
                today && !selected && "border border-primary/30"
              )}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Global Date Range Picker ---

export function GlobalDateRangePicker() {
  const { globalRange, setGlobalRange } = useDateRange();
  const [isOpen, setIsOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState<Date | null>(globalRange.from);
  const [tempTo, setTempTo] = useState<Date | null>(globalRange.to);
  const [tempLabel, setTempLabel] = useState(globalRange.label);
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

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    const val = preset.getValue();
    if (val) {
      setTempFrom(val.from);
      setTempTo(val.to);
      setTempLabel(preset.label);
    } else {
      setTempLabel('Custom Range');
    }
  };

  const handleDateSelect = (date: Date) => {
    if (!tempFrom || (tempFrom && tempTo)) {
      setTempFrom(date);
      setTempTo(null);
      setTempLabel('Custom Range');
    } else {
      if (date < tempFrom) {
        setTempTo(tempFrom);
        setTempFrom(date);
      } else {
        setTempTo(date);
      }
    }
  };

  const handleApply = () => {
    if (tempFrom && tempTo) {
      setGlobalRange({
        from: startOfDay(tempFrom),
        to: endOfDay(tempTo),
        label: tempLabel
      });
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border/60 rounded-xl hover:bg-accent transition-all text-sm font-medium shadow-sm"
      >
        <CalendarIcon className="w-4 h-4 text-muted-foreground" />
        <span>{globalRange.label}</span>
        <span className="text-[11px] text-muted-foreground font-normal border-l border-border pl-2 ml-1">
          {format(globalRange.from, 'MMM d')} - {format(globalRange.to, 'MMM d')}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 z-[100] bg-card border border-border rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col md:flex-row min-w-[500px]">
          {/* Presets Sidebar */}
          <div className="w-full md:w-48 bg-muted/20 border-r border-border p-4 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-3 px-2">Presets</p>
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => handlePresetClick(preset)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                  tempLabel === preset.label ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Calendar Area */}
          <div className="p-6 flex flex-col">
            <div className="flex flex-col md:flex-row gap-8 mb-6">
              <Calendar 
                selectedFrom={tempFrom} 
                selectedTo={tempTo} 
                onSelect={handleDateSelect} 
              />
              <div className="hidden lg:block border-l border-border h-full" />
              <div className="space-y-4 w-full">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Range Start</label>
                  <div className="p-3 bg-accent/30 rounded-xl text-sm font-medium border border-border/40">
                    {tempFrom ? format(tempFrom, 'PPP') : 'Select start date'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Range End</label>
                  <div className="p-3 bg-accent/30 rounded-xl text-sm font-medium border border-border/40">
                    {tempTo ? format(tempTo, 'PPP') : 'Select end date'}
                  </div>
                </div>
                <div className="pt-4">
                   <p className="text-[11px] text-muted-foreground italic">
                     * Select two dates to define a custom range.
                   </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-auto pt-6 border-t border-border flex items-center justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleApply} disabled={!tempFrom || !tempTo}>Apply Range</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Week Picker for Reports ---

export function WeekPicker({ selectedDate, onChange }: { selectedDate: Date, onChange: (date: Date) => void }) {
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);

  return (
    <div className="flex items-center gap-2 bg-accent/30 p-1 rounded-xl border border-border/40">
      <button 
        onClick={() => onChange(subWeeks(selectedDate, 1))}
        className="p-2 hover:bg-background rounded-lg transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="px-4 text-sm font-bold flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        <span>{format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}</span>
      </div>
      <button 
        onClick={() => onChange(addWeeks(selectedDate, 1))}
        className="p-2 hover:bg-background rounded-lg transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

import { addWeeks, subWeeks } from 'date-fns';
