import { format } from 'date-fns';
import { Trade, TradeStats, Session } from '../types';
import { SessionBuilder } from './SessionBuilder';

export interface CalendarDay {
  day: number | null;
  date: Date;
  /** Net dollar P&L (realizedPnL, after commission) for this day — not raw points. */
  pnl: number;
  trades: number;
  winRate: number;
  isWeekend: boolean;
  isEmpty: boolean;
}

export interface WeeklySummary {
  label: string;
  /** Net dollar P&L (realizedPnL, after commission) for this week — not raw points. */
  pnl: number;
  activeDays: number;
  winRate: number;
  startDate: Date;
  endDate: Date;
}

export interface DashboardModel {
  stats: TradeStats | null;
  calendarDays: CalendarDay[];
  weeklySummaries: WeeklySummary[];
  behaviorMetrics: {
    disciplineScore: number;
    disciplineTrend: number;
    riskScore: number;
    riskTrend: number;
    biasScore: number;
    biasTrend: number;
    consistencyScore: number;
    sessionVerdict: string;
    insights: { title: string; value: string; status: string; icon: string }[];
    lossPatterns: { percentage: number; details: string[] };
    peakWindow: { time: string; details: string[] };
    reEntryImpact: { value: number; details: string[] };
    keyPatterns: { title: string; details: string[] };
  };
}

export const buildSessionMetrics = (trades: Trade[], intents: any[] = []): Partial<Session> => {
  if (trades.length === 0) return {};

  const userId = trades[0].userId;
  const sessionDate = format(new Date(trades[0].entryTime), 'yyyy-MM-dd');
  
  try {
    const session = SessionBuilder.buildSession(userId, sessionDate, trades, intents);
    return session;
  } catch (error) {
    console.error('Error building session metrics:', error);
    return {};
  }
};

export const buildDashboardModel = (
  trades: Trade[],
  filteredTrades: Trade[],
  currentDate: Date,
  showWeekends: boolean
): DashboardModel => {
  const stats = buildTradeStats(filteredTrades);
  const calendarDays = buildCalendarDays(trades, currentDate, showWeekends);
  const weeklySummaries = buildWeeklySummaries(calendarDays, showWeekends);
  
  const behaviorMetrics = {
    disciplineScore: computeDisciplineScore(filteredTrades),
    disciplineTrend: 0,
    riskScore: computeRiskScore(filteredTrades),
    riskTrend: 0,
    biasScore: computeBiasScore(filteredTrades),
    biasTrend: 0,
    consistencyScore: computeConsistencyScore(filteredTrades),
    sessionVerdict: computeSessionVerdict(filteredTrades),
    insights: computeBehavioralInsights(filteredTrades),
    lossPatterns: computeLossPatterns(filteredTrades),
    peakWindow: computePeakWindow(filteredTrades),
    reEntryImpact: computeReEntryImpact(filteredTrades),
    keyPatterns: computeKeyPatterns(filteredTrades),
  };

  return {
    stats,
    calendarDays,
    weeklySummaries,
    behaviorMetrics,
  };
};

export const buildTradeStats = (trades: Trade[]): TradeStats | null => {
  if (trades.length === 0) return null;

  // Filter valid trades
  const validTrades = trades.filter(t => typeof t.pnlPoints === 'number' && !isNaN(t.pnlPoints));
  if (validTrades.length === 0) return null;

  const netPnl = validTrades.reduce((sum, t) => sum + (t.pnlPoints || 0), 0);
  const netPnlDollars = validTrades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
  const winners = validTrades.filter(t => (t.pnlPoints || 0) > 0);
  const losers = validTrades.filter(t => (t.pnlPoints || 0) < 0);
  const winRate = validTrades.length > 0 ? (winners.length / validTrades.length) * 100 : 0;
  
  const totalProfit = winners.reduce((sum, t) => sum + (t.pnlPoints || 0), 0);
  const totalLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnlPoints || 0), 0));
  
  let profitFactor = 0;
  if (totalLoss === 0) {
    profitFactor = totalProfit; // If no losses, PF is total wins
  } else if (totalProfit === 0) {
    profitFactor = 0;
  } else {
    profitFactor = totalProfit / totalLoss;
  }

  const avgWinner = winners.length > 0 ? totalProfit / winners.length : 0;
  const avgLoser = losers.length > 0 ? totalLoss / losers.length : 0;

  const sortedTrades = [...validTrades].sort((a, b) => 
    new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  );

  let cumulative = 0;
  const equityData = sortedTrades.map((t) => {
    cumulative += (t.pnlPoints || 0);
    const date = new Date(t.entryTime);
    const label = format(date, 'MMM d');
    return { name: label, value: Number(cumulative.toFixed(2)) || 0 };
  });
  equityData.unshift({ name: 'Start', value: 0 });

  // Dollar equivalent of equityData above — EquityCurveChart always renders
  // its values with a "$" prefix, so it needs realizedPnL (actual currency),
  // not pnlPoints (raw price movement, meaningless summed across symbols
  // with different point values).
  let cumulativeDollars = 0;
  const equityDataDollars = sortedTrades.map((t) => {
    cumulativeDollars += (t.realizedPnL || 0);
    const date = new Date(t.entryTime);
    const label = format(date, 'MMM d');
    return { name: label, value: Number(cumulativeDollars.toFixed(2)) || 0 };
  });
  equityDataDollars.unshift({ name: 'Start', value: 0 });

  const grades = validTrades.reduce((acc, t) => {
    if (t.tradeGrade) {
      acc[t.tradeGrade] = (acc[t.tradeGrade] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  
  const gradePct = (grade: string) => validTrades.length > 0 ? Math.round((grades[grade] || 0) / validTrades.length * 100) : 0;

  const gradeData = [
    { name: 'A+', value: gradePct('A+'), color: '#16a34a' },
    { name: 'A', value: gradePct('A'), color: '#22c55e' },
    { name: 'B', value: gradePct('B'), color: '#3b82f6' },
    { name: 'C', value: gradePct('C'), color: '#eab308' },
    { name: 'D', value: gradePct('D'), color: '#f97316' },
    { name: 'F', value: gradePct('F'), color: '#ef4444' },
  ].filter(g => g.value > 0);

  const pnlByTrade = validTrades.slice(-10).map((t, i) => ({ 
    id: `T${Math.max(0, validTrades.length - 10) + i + 1}`, 
    pnl: Number((t.pnlPoints || 0).toFixed(2)) || 0
  }));

  const hourly = validTrades.reduce((acc, t) => {
    try {
      const hour = new Date(t.entryTime).getHours();
      const label = hour >= 12 ? `${hour === 12 ? 12 : hour - 12}pm` : `${hour}am`;
      acc[label] = (acc[label] || 0) + (t.pnlPoints || 0);
    } catch (e) {
      console.warn("Invalid entryTime for trade:", t.id);
    }
    return acc;
  }, {} as Record<string, number>);
  const hourlyData = Object.entries(hourly).map(([hour, pnl]) => ({ hour, pnl: Number(pnl.toFixed(2)) || 0 }));

  const holdTimes = validTrades.reduce((acc, t) => {
    const mins = (t.holdTimeSeconds || 0) / 60;
    if (mins <= 1) acc['0-1m']++;
    else if (mins <= 5) acc['1-5m']++;
    else if (mins <= 15) acc['5-15m']++;
    else if (mins <= 30) acc['15-30m']++;
    else acc['30m+']++;
    return acc;
  }, { '0-1m': 0, '1-5m': 0, '5-15m': 0, '15-30m': 0, '30m+': 0 });
  const holdData = Object.entries(holdTimes).map(([range, count]) => ({ range, count }));

  return {
    netPnl: Number(netPnl.toFixed(2)) || 0,
    netPnlDollars: Number(netPnlDollars.toFixed(2)) || 0,
    winRate: Number(winRate.toFixed(2)) || 0,
    profitFactor: Number(profitFactor.toFixed(2)) || 0,
    avgWinner: Number(avgWinner.toFixed(2)) || 0,
    avgLoser: Number(avgLoser.toFixed(2)) || 0,
    equityData,
    equityDataDollars,
    gradeData,
    pnlByTrade,
    hourlyData,
    holdData,
    totalTrades: validTrades.length
  };
};

export const buildCalendarDays = (
  trades: Trade[],
  currentDate: Date,
  showWeekends: boolean
): CalendarDay[] => {
  const days: CalendarDay[] = [];
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  for (let i = 0; i < firstDayOfMonth; i++) {
    const date = new Date(year, month, i - firstDayOfMonth + 1);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (!showWeekends && isWeekend) continue;
    days.push({ 
      day: null, 
      date,
      pnl: 0, 
      trades: 0, 
      winRate: 0, 
      isWeekend, 
      isEmpty: true 
    });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(year, month, i);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    
    if (!showWeekends && isWeekend) continue;

    const dayTrades = trades.filter(t => {
      const d = new Date(t.entryTime);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === i;
    });

    // Dollar-denominated (not raw points) so the "$" shown in the UI is accurate,
    // and so aggregation is meaningful if trades ever span multiple symbols.
    const pnl = dayTrades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
    const winners = dayTrades.filter(t => t.isWinner);
    const winRate = dayTrades.length > 0 ? (winners.length / dayTrades.length) * 100 : 0;

    days.push({ 
      day: i, 
      date,
      pnl: Number(pnl.toFixed(2)), 
      trades: dayTrades.length, 
      winRate: Number(winRate.toFixed(2)), 
      isWeekend, 
      isEmpty: dayTrades.length === 0 
    });
  }

  const daysPerWeek = showWeekends ? 7 : 5;
  const remainingDays = days.length % daysPerWeek;
  if (remainingDays > 0) {
    const fillCount = daysPerWeek - remainingDays;
    let lastDate = new Date(days[days.length - 1].date);
    
    for (let i = 1; i <= fillCount; i++) {
      lastDate.setDate(lastDate.getDate() + 1);
      if (!showWeekends) {
        while (lastDate.getDay() === 0 || lastDate.getDay() === 6) {
          lastDate.setDate(lastDate.getDate() + 1);
        }
      }
      const date = new Date(lastDate);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      days.push({
        day: null,
        date,
        pnl: 0,
        trades: 0,
        winRate: 0,
        isWeekend,
        isEmpty: true
      });
    }
  }

  return days;
};

export const buildWeeklySummaries = (
  calendarDays: CalendarDay[],
  showWeekends: boolean
): WeeklySummary[] => {
  const weeks: WeeklySummary[] = [];
  const daysPerWeek = showWeekends ? 7 : 5;
  
  for (let i = 0; i < calendarDays.length; i += daysPerWeek) {
    const weekDays = calendarDays.slice(i, i + daysPerWeek);
    const activeDays = weekDays.filter(d => d.day && d.trades > 0);
    const totalPnL = weekDays.reduce((sum, d) => sum + d.pnl, 0);
    const totalTrades = weekDays.reduce((sum, d) => sum + d.trades, 0);
    const totalWinners = weekDays.reduce((sum, d) => sum + (d.winRate / 100) * d.trades, 0);
    
    const winRate = totalTrades > 0 ? (totalWinners / totalTrades) * 100 : 0;
    
    if (weekDays.length > 0) {
      weeks.push({
        label: `Week ${Math.floor(i / daysPerWeek) + 1}`,
        pnl: Number(totalPnL.toFixed(2)),
        activeDays: activeDays.length,
        winRate: Math.round(winRate),
        startDate: weekDays[0].date,
        endDate: weekDays[weekDays.length - 1].date
      });
    }
  }
  return weeks;
};

const computeDisciplineScore = (trades: Trade[]): number => {
  // Filter valid trades: must have entry/exit times and valid numeric pnl
  const validTrades = trades.filter(t => 
    t.entryTime && 
    t.exitTime && 
    typeof t.pnlPoints === 'number' && 
    !isNaN(t.pnlPoints)
  );

  if (validTrades.length === 0) return 0;
  
  // Group trades by sessionDate to calculate average session discipline
  const tradesBySession: Record<string, Trade[]> = {};
  validTrades.forEach(t => {
    const date = t.sessionDate || (t.entryTime ? format(new Date(t.entryTime), 'yyyy-MM-dd') : 'unknown');
    if (!tradesBySession[date]) tradesBySession[date] = [];
    tradesBySession[date].push(t);
  });
  
  const sessionScores = Object.values(tradesBySession).map(sessionTrades => {
    const totalTrades = sessionTrades.length;
    // validTrades = trades where isViolation = false (or followsModel = true as fallback)
    const validTradesCount = sessionTrades.filter(t => {
      // Use isViolation if available (it should be if backend ran)
      if (t.isViolation !== undefined) return !t.isViolation;
      // Fallback to followsModel
      return t.modelValidation?.followsModel ?? true;
    }).length;
    
    let score = (validTradesCount / totalTrades) * 100;
    
    // Penalties
    // IF overrideUsed = true: subtract 5 points each (max -20)
    const overrides = sessionTrades.filter(t => t.wasForced || t.modelValidation?.isManualOverride).length;
    score -= Math.min(20, overrides * 5);
    
    // IF fastLoss (<1min): subtract 1 point each (max -10)
    const fastLosses = sessionTrades.filter(t => (t.pnlCurrency || t.pnlPoints || 0) < 0 && (t.holdTimeSeconds || 0) < 60).length;
    score -= Math.min(10, fastLosses * 1);
    
    // Clamp score for this session: 0-100
    return Math.min(100, Math.max(0, Math.round(score)));
  });
  
  if (sessionScores.length === 0) return 0;
  
  // Return simple average of session scores
  const avgScore = sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length;
  return Math.round(avgScore);
};

const computeRiskScore = (trades: Trade[]): number => {
  if (trades.length === 0) return 0;
  const winners = trades.filter(t => t.isWinner);
  const losers = trades.filter(t => !t.isWinner);
  if (losers.length === 0) return 100;
  
  const avgWinner = winners.reduce((sum, t) => sum + (t.pnlPoints || 0), 0) / (winners.length || 1);
  const avgLoser = Math.abs(losers.reduce((sum, t) => sum + (t.pnlPoints || 0), 0) / losers.length);
  
  const ratio = avgWinner / (avgLoser || 1);
  return Math.min(100, Math.round(ratio * 50));
};

const computeConsistencyScore = (trades: Trade[]): number => {
  if (trades.length === 0) return 0;
  const winners = trades.filter(t => t.isWinner);
  const winRate = (winners.length / trades.length);
  return Math.round(winRate * 100);
};

const computeBiasScore = (trades: Trade[]): number => {
  if (trades.length === 0) return 0;
  const highTiming = trades.filter(t => (t.timingScore || 0) >= 80).length;
  return Math.round((highTiming / trades.length) * 100);
};

const computeSessionVerdict = (trades: Trade[]): string => {
  if (trades.length === 0) return "No data for analysis";
  const disciplineScore = computeDisciplineScore(trades);
  
  if (disciplineScore < 60) return "Significant deviation from strategy detected";
  if (disciplineScore <= 80) return "Moderate discipline with inconsistencies";
  return "Strong discipline maintained";
};

const computeBehavioralInsights = (trades: Trade[]) => {
  if (trades.length === 0) return [];
  
  const winners = trades.filter(t => t.isWinner);
  const losers = trades.filter(t => !t.isWinner);
  
  const avgHoldWinners = winners.length > 0 
    ? winners.reduce((sum, t) => sum + (t.holdTimeSeconds || 0), 0) / winners.length 
    : 0;
    
  const totalProfit = winners.reduce((sum, t) => sum + (t.pnlPoints || 0), 0);
  const totalLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnlPoints || 0), 0));
  const profitFactor = totalLoss === 0 ? totalProfit : totalProfit / totalLoss;

  const hourlyPnL = trades.reduce((acc, t) => {
    const hour = new Date(t.entryTime).getHours();
    acc[hour] = (acc[hour] || 0) + (t.pnlPoints || 0);
    return acc;
  }, {} as Record<number, number>);
  
  let bestHour = -1;
  let maxPnL = -Infinity;
  Object.entries(hourlyPnL).forEach(([hour, pnl]) => {
    if (pnl > maxPnL) {
      maxPnL = pnl;
      bestHour = parseInt(hour);
    }
  });

  const bestHourLabel = bestHour !== -1 
    ? (bestHour >= 12 ? `${bestHour === 12 ? 12 : bestHour - 12}pm` : `${bestHour}am`)
    : "N/A";

  return [
    { title: "Best Trading Hour", value: bestHourLabel, status: "positive", icon: "Clock" },
    { title: "Avg. Hold (Winners)", value: `${(avgHoldWinners / 60).toFixed(1)} mins`, status: "neutral", icon: "TrendingUp" },
    { title: "Profit Factor", value: profitFactor.toFixed(2), status: profitFactor >= 1.5 ? "positive" : "neutral", icon: "Shield" },
    { title: "Total Trades", value: trades.length.toString(), status: "neutral", icon: "Activity" },
  ];
};

const computeLossPatterns = (trades: Trade[]) => {
  if (trades.length === 0) return { percentage: 0, details: ["No data"] };
  const losers = trades.filter(t => !t.isWinner);
  if (losers.length === 0) return { percentage: 0, details: ["No losses recorded"] };

  const fastLosses = losers.filter(t => (t.holdTimeSeconds || 0) < 60).length;
  const fastLossPct = Math.round((fastLosses / losers.length) * 100);
  
  const heldTooLong = losers.filter(t => (t.holdTimeSeconds || 0) > 600).length;
  const heldTooLongPct = Math.round((heldTooLong / losers.length) * 100);

  return {
    percentage: fastLossPct,
    details: [
      `Fast losses (<1m): ${fastLossPct}%`,
      `Held too long (>10m): ${heldTooLongPct}%`
    ]
  };
};

const computePeakWindow = (trades: Trade[]) => {
  if (trades.length === 0) return { time: "N/A", details: ["No data"] };
  
  const hourlyPnL = trades.reduce((acc, t) => {
    const hour = new Date(t.entryTime).getHours();
    acc[hour] = (acc[hour] || 0) + (t.pnlPoints || 0);
    return acc;
  }, {} as Record<number, number>);

  let bestHour = -1;
  let maxPnL = -Infinity;
  Object.entries(hourlyPnL).forEach(([hour, pnl]) => {
    if (pnl > maxPnL) {
      maxPnL = pnl;
      bestHour = parseInt(hour);
    }
  });

  if (bestHour === -1) return { time: "N/A", details: ["No data"] };

  const startLabel = bestHour >= 12 ? `${bestHour === 12 ? 12 : bestHour - 12}pm` : `${bestHour}am`;
  const endLabel = (bestHour + 1) >= 12 ? `${(bestHour + 1) === 12 ? 12 : (bestHour + 1) - 12}pm` : `${bestHour + 1}am`;

  const totalPnL = trades.reduce((sum, t) => sum + (t.pnlPoints || 0), 0);
  const peakPnL = hourlyPnL[bestHour] || 0;
  const pctOfTotal = totalPnL > 0 ? Math.round((peakPnL / totalPnL) * 100) : 0;

  return {
    time: `${startLabel} - ${endLabel}`,
    details: [
      "Strongest performance window",
      totalPnL > 0 ? `${pctOfTotal}% of total profit generated` : "Focus on this window"
    ]
  };
};

const computeReEntryImpact = (trades: Trade[]) => {
  if (trades.length === 0) return { value: 0, details: ["No data"] };
  const reEntries = trades.filter(t => t.isReentry).length;
  return {
    value: reEntries, 
    details: [
      `Detected ${reEntries} re-entries`,
      "Monitor same-symbol frequency"
    ]
  };
};

const computeKeyPatterns = (trades: Trade[]) => {
  if (trades.length === 0) return { title: "N/A", details: ["No data"] };
  
  const symbols = trades.reduce((acc, t) => {
    if (!acc[t.symbol]) acc[t.symbol] = { count: 0, pnl: 0, winners: 0 };
    acc[t.symbol].count++;
    acc[t.symbol].pnl += (t.pnlPoints || 0);
    if (t.isWinner) acc[t.symbol].winners++;
    return acc;
  }, {} as Record<string, { count: number; pnl: number; winners: number }>);

  let bestSymbol = "";
  let maxPnL = -Infinity;
  Object.entries(symbols).forEach(([sym, data]) => {
    if (data.pnl > maxPnL) {
      maxPnL = data.pnl;
      bestSymbol = sym;
    }
  });

  if (!bestSymbol) return { title: "N/A", details: ["No data"] };

  const symData = symbols[bestSymbol];
  const winRate = Math.round((symData.winners / symData.count) * 100);

  return {
    title: `Symbol: ${bestSymbol}`,
    details: [
      `Win Rate: ${winRate}%`,
      `Total Trades: ${symData.count}`
    ]
  };
};
