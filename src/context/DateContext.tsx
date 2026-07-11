import React, { createContext, useContext, useState, ReactNode } from 'react';
import { 
  startOfDay, 
  endOfDay, 
  subDays, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  subWeeks, 
  subMonths,
} from 'date-fns';

export type DateRange = {
  from: Date;
  to: Date;
  label: string;
};

interface DateContextType {
  globalRange: DateRange;
  setGlobalRange: (range: DateRange) => void;
  pageOverrides: Record<string, DateRange | null>;
  setPageOverride: (page: string, range: DateRange | null) => void;
  getEffectiveRange: (page: string) => DateRange;
}

const DateContext = createContext<DateContextType | undefined>(undefined);

export const PRESETS = [
  { label: 'Today', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: 'Yesterday', getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
  { label: 'Last 7 Days', getValue: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { label: 'Last 14 Days', getValue: () => ({ from: startOfDay(subDays(new Date(), 13)), to: endOfDay(new Date()) }) },
  { label: 'Last 30 Days', getValue: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }) },
  { label: 'This Week', getValue: () => ({ from: startOfWeek(new Date()), to: endOfWeek(new Date()) }) },
  { label: 'Last Week', getValue: () => ({ from: startOfWeek(subWeeks(new Date(), 1)), to: endOfWeek(subWeeks(new Date(), 1)) }) },
  { label: 'This Month', getValue: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
  { label: 'Last Month', getValue: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: 'Custom Range', getValue: () => null },
];

export function DateProvider({ children }: { children: ReactNode }) {
  const [globalRange, setGlobalRange] = useState<DateRange>(() => {
    const last30 = PRESETS.find(p => p.label === 'Last 30 Days')!;
    const range = last30.getValue()!;
    return { ...range, label: 'Last 30 Days' };
  });

  const [pageOverrides, setPageOverrides] = useState<Record<string, DateRange | null>>({});

  const setPageOverride = (page: string, range: DateRange | null) => {
    setPageOverrides(prev => ({ ...prev, [page]: range }));
  };

  const getEffectiveRange = (page: string) => {
    return pageOverrides[page] || globalRange;
  };

  return (
    <DateContext.Provider value={{ 
      globalRange, 
      setGlobalRange, 
      pageOverrides, 
      setPageOverride, 
      getEffectiveRange 
    }}>
      {children}
    </DateContext.Provider>
  );
}

export function useDateRange() {
  const context = useContext(DateContext);
  if (context === undefined) {
    throw new Error('useDateRange must be used within a DateProvider');
  }
  return context;
}
