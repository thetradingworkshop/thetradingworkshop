import { Trade, Session } from "./types";

/**
 * Computes comprehensive trade statistics from a list of reconstructed trades.
 * This function is deterministic and relies only on TradeTruth and TradeDerivedMetrics.
 */
export function computeTradeStats(trades: Trade[]) {
  // Filter valid trades: must have entry/exit times and valid numeric pnl
  const validTrades = trades.filter(t => 
    t.entryTime && 
    t.exitTime && 
    typeof t.pnlPoints === 'number' && 
    !isNaN(t.pnlPoints)
  );

  const totalTrades = validTrades.length;
  if (totalTrades === 0) {
    return {
      netPnl: 0,
      winRate: 0,
      profitFactor: 0,
      avgWinner: 0,
      avgLoser: 0,
      totalTrades: 0,
      equityData: [{ name: "Start", value: 0 }],
      pnlByTrade: [],
      hourlyData: [],
      holdData: [],
      gradeData: []
    };
  }

  const sortedTrades = [...validTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
  
  let netPnl = 0;
  let winners = 0;
  let losers = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  
  const equityData: { name: string; value: number }[] = [{ name: "Start", value: 0 }];
  const pnlByTrade: { id: string; pnl: number }[] = [];
  const hourlyMap: Record<string, number> = {};
  const holdBuckets: Record<string, number> = {
    "0-1m": 0,
    "1-5m": 0,
    "5-15m": 0,
    "15-30m": 0,
    "30m-1h": 0,
    "1h+": 0
  };
  const gradeMap: Record<string, number> = { "A+": 0, "A": 0, "B": 0, "C": 0, "D": 0, "F": 0 };

  sortedTrades.forEach((trade, index) => {
    const pnl = trade.pnlPoints || 0;
    netPnl += pnl;
    pnlByTrade.push({ id: trade.id || `T${index}`, pnl });
    equityData.push({ name: `Trade ${index + 1}`, value: Number(netPnl.toFixed(2)) || 0 });

    if (pnl > 0) {
      winners++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losers++;
      grossLoss += Math.abs(pnl);
    }

    // Hourly PnL aggregation
    try {
      const hour = new Date(trade.entryTime).getHours().toString().padStart(2, '0') + ":00";
      hourlyMap[hour] = (hourlyMap[hour] || 0) + pnl;
    } catch (e) {
      console.warn("Invalid entryTime for trade:", trade.id);
    }

    // Hold-time buckets
    const hold = trade.holdTimeSeconds || 0;
    if (hold < 60) holdBuckets["0-1m"]++;
    else if (hold < 300) holdBuckets["1-5m"]++;
    else if (hold < 900) holdBuckets["5-15m"]++;
    else if (hold < 1800) holdBuckets["15-30m"]++;
    else if (hold < 3600) holdBuckets["30m-1h"]++;
    else holdBuckets["1h+"]++;

    // Grade counts (from TradeReview)
    if (trade.tradeGrade) {
      gradeMap[trade.tradeGrade]++;
    }
  });

  const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
  
  let profitFactor = 0;
  if (grossLoss === 0) {
    profitFactor = grossProfit; // If no losses, PF is total wins
  } else if (grossProfit === 0) {
    profitFactor = 0;
  } else {
    profitFactor = grossProfit / grossLoss;
  }

  return {
    netPnl: Number(netPnl.toFixed(2)) || 0,
    winRate: Number(winRate.toFixed(2)) || 0,
    profitFactor: Number(profitFactor.toFixed(2)) || 0,
    avgWinner: winners > 0 ? Number((grossProfit / winners).toFixed(2)) || 0 : 0,
    avgLoser: losers > 0 ? Number((grossLoss / losers).toFixed(2)) || 0 : 0,
    totalTrades,
    equityData,
    pnlByTrade,
    hourlyData: Object.entries(hourlyMap)
      .map(([hour, pnl]) => ({ hour, pnl: Number(pnl.toFixed(2)) || 0 }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    holdData: Object.entries(holdBuckets).map(([range, count]) => ({ range, count })),
    gradeData: [
      { name: "A+", value: gradeMap["A+"], color: "#16a34a" },
      { name: "A", value: gradeMap["A"], color: "#22c55e" },
      { name: "B", value: gradeMap["B"], color: "#3b82f6" },
      { name: "C", value: gradeMap["C"], color: "#eab308" },
      { name: "D", value: gradeMap["D"], color: "#f97316" },
      { name: "F", value: gradeMap["F"], color: "#ef4444" }
    ].filter(g => g.value > 0)
  };
}

/**
 * Computes session-level metrics from a list of trades for that session.
 */
export function computeSessionFromTrades(trades: Trade[], intents: any[] = []): Partial<Session> {
  const stats = computeTradeStats(trades);
  
  let largestWinner = 0;
  let largestLoser = 0;
  let totalHoldTime = 0;
  let fastLosersCount = 0;
  let reentryCount = 0;
  let currentLosingStreak = 0;
  let maxLosingStreak = 0;

  // Rule Enforcement Metrics
  let totalViolations = 0;
  let modelFollowCount = 0;
  let pnlFromViolations = 0;
  let pnlFromValidTrades = 0;

  const validTrades = trades.filter(t => 
    t.entryTime && 
    t.exitTime && 
    typeof t.pnlPoints === 'number' && 
    !isNaN(t.pnlPoints)
  );

  const sortedTrades = [...validTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  sortedTrades.forEach(trade => {
    const pnl = trade.pnlPoints || 0;
    if (pnl > 0) {
      largestWinner = Math.max(largestWinner, pnl);
    } else if (pnl < 0) {
      largestLoser = Math.min(largestLoser, pnl);
    }
    
    totalHoldTime += trade.holdTimeSeconds || 0;
    if (trade.isFastLoser) fastLosersCount++;
    if (trade.isReentry) reentryCount++;

    if (pnl < 0) {
      currentLosingStreak++;
      if (currentLosingStreak > maxLosingStreak) maxLosingStreak = currentLosingStreak;
    } else if (pnl > 0) {
      currentLosingStreak = 0;
    }

    // Match with intent
    const matchingIntent = intents.find(intent => 
      intent.symbol === trade.symbol && 
      Math.abs(new Date(intent.confirmedAt).getTime() - new Date(trade.entryTime).getTime()) < 300000 // 5 mins
    );

    const wasValidAtEntry = matchingIntent ? matchingIntent.isValidSetup : (trade.modelValidation?.followsModel ?? true);
    const wasForced = matchingIntent ? matchingIntent.overrideUsed : false;
    const isViolation = matchingIntent ? (!wasValidAtEntry || wasForced) : !(trade.modelValidation?.followsModel ?? true);

    if (wasValidAtEntry) modelFollowCount++;

    if (isViolation) {
      totalViolations++;
      pnlFromViolations += pnl;
    } else {
      pnlFromValidTrades += pnl;
    }
  });

  const winCount = validTrades.filter(t => (t.pnlPoints || 0) > 0).length;
  const lossCount = validTrades.filter(t => (t.pnlPoints || 0) < 0).length;

  return {
    netPnl: stats.netPnl || 0,
    totalTrades: stats.totalTrades || 0,
    winCount: winCount || 0,
    lossCount: lossCount || 0,
    grossProfit: Number(validTrades.reduce((acc, t) => (t.pnlPoints || 0) > 0 ? acc + (t.pnlPoints || 0) : acc, 0).toFixed(2)) || 0,
    grossLoss: Number(validTrades.reduce((acc, t) => (t.pnlPoints || 0) < 0 ? acc + Math.abs(t.pnlPoints || 0) : acc, 0).toFixed(2)) || 0,
    avgHoldTimeSeconds: stats.totalTrades > 0 ? Math.round(totalHoldTime / stats.totalTrades) : 0,
    fastLosersCount: fastLosersCount || 0,
    reentryCount: reentryCount || 0,
    largestWin: Number(largestWinner.toFixed(2)) || 0,
    largestLoss: Number(Math.abs(largestLoser).toFixed(2)) || 0,
    maxLosingStreak: maxLosingStreak || 0,
    trades: validTrades,
    totalViolations,
    violationRate: stats.totalTrades > 0 ? (totalViolations / stats.totalTrades) * 100 : 0,
    modelFollowRate: stats.totalTrades > 0 ? (modelFollowCount / stats.totalTrades) * 100 : 0,
    pnlFromViolations,
    pnlFromValidTrades
  };
}

/**
 * Determines the session window based on the entry time of the first trade.
 */
export function determineSessionWindow(entryTime: string): 'Morning' | 'Afternoon' | 'Evening' | 'Full Day' {
  const hour = new Date(entryTime).getHours();
  if (hour >= 8 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 16) return 'Afternoon';
  if (hour >= 16 && hour < 20) return 'Evening';
  return 'Full Day';
}
