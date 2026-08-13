import { Trade, Session, BehaviorImpact } from '../types';
import { db } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { ModelValidationEngine } from './ModelValidationEngine';

export class SessionBuilder {
  static buildSession(userId: string, sessionDate: string, trades: Trade[], intents: any[] = []): Session {
    // 1. Validation Layer: Filter out invalid trades
    const validTrades = trades.filter(t => 
      t.entryTime && 
      t.exitTime && 
      typeof t.pnlCurrency === 'number' && 
      !isNaN(t.pnlCurrency)
    );

    const totalTrades = validTrades.length;
    if (totalTrades === 0) {
      throw new Error("No valid trades provided for session building");
    }

    // Sort trades by entry time to detect patterns
    const sortedTrades = [...validTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

    // 2. Initialize base values
    let netPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalVolume = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let largestWin = 0;
    let largestLoss = 0;
    
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    
    let fastLosersCount = 0;
    let scalingPatternCount = 0;
    let sizeEscalationDetected = false;

    let validModelTradesCount = 0;
    let validModelPnl = 0;
    let invalidModelPnl = 0;
    let ruleViolationsCount = 0;
    let unconfirmedTradesCount = 0;
    let manualOverrideCount = 0;

    // Rule Enforcement Metrics
    let totalViolations = 0;
    let pnlFromViolations = 0;
    let pnlFromValidTrades = 0;

    for (let i = 0; i < sortedTrades.length; i++) {
      const trade = sortedTrades[i];
      const previousTrade = i > 0 ? sortedTrades[i - 1] : undefined;

      // 2a. Model Validation
      const modelValidation = ModelValidationEngine.validateTrade(trade, previousTrade);
      trade.modelValidation = modelValidation;
      
      // Add Trade Tag
      const modelTag = ModelValidationEngine.getTradeTag(modelValidation);
      if (!trade.tags) trade.tags = [];
      if (!trade.tags.includes(modelTag)) {
        trade.tags.push(modelTag);
      }

      const pnl = trade.pnlCurrency || 0;
      netPnl += pnl;
      totalVolume += (trade.totalQuantity || 0);

      // Match with intent
      const matchingIntent = intents.find(intent => 
        intent.symbol === trade.symbol && 
        intent.status === 'pending' &&
        Math.abs(new Date(intent.confirmedAt).getTime() - new Date(trade.entryTime).getTime()) < 300000 // 5 mins
      );

      if (matchingIntent) {
        trade.intentId = matchingIntent.id;
        trade.wasValidAtEntry = matchingIntent.isValidSetup;
        trade.wasForced = matchingIntent.overrideUsed;
        
        // Rule Enforcement Logic
        trade.isViolation = !trade.wasValidAtEntry || trade.wasForced;
        
        // Mark intent as matched (in-memory for this loop)
        matchingIntent.status = 'matched';
        matchingIntent.tradeId = trade.id;

        trade.modelValidation.isManualOverride = matchingIntent.overrideUsed;
        if (matchingIntent.overrideUsed) manualOverrideCount++;

        // Carry the planned strategy onto the trade for display, but only
        // as a fallback — never overwrite a strategy the user already
        // assigned by hand from the trade's own Details view. This is
        // session-ephemeral like everything else on this line (nothing
        // here is written back to the trade's Firestore doc); it fills in
        // the display until the trade is actually confirmed in Trade
        // Details, which is also where its rules get checked (see
        // Trade.strategyChecklist) — this modal only ever assigns which
        // strategy was planned, never whether it was followed.
        if (!trade.strategyId && matchingIntent.strategyId) {
          trade.strategyId = matchingIntent.strategyId;
          trade.strategy = matchingIntent.strategyName;
        }
      } else {
        trade.modelValidation.isUnconfirmed = true;
        unconfirmedTradesCount++;
        // If no intent, infer violation from model validation
        trade.isViolation = !trade.modelValidation.followsModel;
      }

      if (trade.isViolation) {
        totalViolations++;
        pnlFromViolations += pnl;
        if (!trade.tags.includes("Rule Violated")) trade.tags.push("Rule Violated");
      } else {
        pnlFromValidTrades += pnl;
        if (!trade.tags.includes("Rule Followed")) trade.tags.push("Rule Followed");
      }

      if (modelValidation.followsModel) {
        validModelTradesCount++;
        validModelPnl += pnl;
      } else {
        invalidModelPnl += pnl;
      }

      if (!trade.modelValidation.followsModel || trade.modelValidation.isManualOverride) {
        ruleViolationsCount++;
      }

      if (pnl > 0) {
        winCount++;
        grossProfit += pnl;
        largestWin = Math.max(largestWin, pnl);
        currentWinStreak++;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
        currentLossStreak = 0;
      } else if (pnl < 0) {
        lossCount++;
        const absPnl = Math.abs(pnl);
        grossLoss += absPnl;
        largestLoss = Math.max(largestLoss, absPnl);
        currentLossStreak++;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
        currentWinStreak = 0;
        
        // Fast Loser check
        if ((trade.holdTimeSeconds || 0) < 60) {
          fastLosersCount++;
        }
      } else {
        // Breakeven
        currentWinStreak = 0;
        currentLossStreak = 0;
      }

      // Scaling Pattern check
      if (trade.diagnostics?.executionType === 'SCALED_IN' || trade.diagnostics?.executionType === 'FULL_SCALE') {
        scalingPatternCount++;
      }

      // Size Escalation check: loss followed immediately by larger position trade
      if (i > 0) {
        const prevTrade = sortedTrades[i - 1];
        const prevPnl = prevTrade.pnlCurrency || 0;
        if (prevPnl < 0 && (trade.totalQuantity || 0) > (prevTrade.totalQuantity || 0)) {
           // Check if they are close in time (e.g. within 30 mins)
           try {
             const timeDiff = (new Date(trade.entryTime).getTime() - new Date(prevTrade.exitTime).getTime()) / 1000;
             if (timeDiff < 1800) {
               sizeEscalationDetected = true;
             }
           } catch (e) {
             console.warn("Invalid timestamps for size escalation check");
           }
        }
      }
    }

    // 3. Safe calculations
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
    
    let profitFactor = 0;
    if (grossLoss === 0) {
      profitFactor = grossProfit; // If no losses, PF is total wins
    } else if (grossProfit === 0) {
      profitFactor = 0;
    } else {
      profitFactor = Number((grossProfit / grossLoss).toFixed(2)) || 0;
    }

    const avgWinner = winCount > 0 ? grossProfit / winCount : 0;
    const avgLoser = lossCount > 0 ? grossLoss / lossCount : 0;
    const overtradingFlag = totalTrades > 10;
    const violationRate = totalTrades > 0 ? (totalViolations / totalTrades) * 100 : 0;

    // Analysis Engine Logic
    const behaviorImpacts: BehaviorImpact[] = [];
    
    // 1. Fast Losers Impact
    const fastLoserTrades = validTrades.filter(t => (t.pnlCurrency || 0) < 0 && (t.holdTimeSeconds || 0) < 60);
    const fastLoserPnl = fastLoserTrades.reduce((sum, t) => sum + (t.pnlCurrency || 0), 0);
    if (fastLoserTrades.length > 0) {
      behaviorImpacts.push({
        behavior: "Fast Losses (<1m)",
        impact: Number(fastLoserPnl.toFixed(2)) || 0,
        tradeCount: fastLoserTrades.length,
        description: `${fastLoserTrades.length} trades closed prematurely.`
      });
    }

    // 2. Scaling Impact
    const scalingTrades = validTrades.filter(t => t.diagnostics?.executionType === 'SCALED_IN' || t.diagnostics?.executionType === 'FULL_SCALE');
    const scalingPnl = scalingTrades.reduce((sum, t) => sum + (t.pnlCurrency || 0), 0);
    if (scalingTrades.length > 0) {
      behaviorImpacts.push({
        behavior: "Scaling Execution",
        impact: Number(scalingPnl.toFixed(2)) || 0,
        tradeCount: scalingTrades.length,
        description: `${scalingTrades.length} trades used scaled entries.`
      });
    }

    // 3. Frequency Impact (Overtrading)
    if (totalTrades > 10) {
      const lateTrades = sortedTrades.slice(10);
      const latePnl = lateTrades.reduce((sum, t) => sum + (t.pnlCurrency || 0), 0);
      behaviorImpacts.push({
        behavior: "High Trade Frequency",
        impact: Number(latePnl.toFixed(2)) || 0,
        tradeCount: lateTrades.length,
        description: `PnL from trades 11 to ${totalTrades}.`
      });
    }

    // Pattern Detection for Issues (Factual & Statistical)
    const issuesList: { name: string; value: number }[] = [];
    
    // A. Loss clustering
    if (maxConsecutiveLosses >= 3) {
      issuesList.push({ name: "Loss Clustering", value: maxConsecutiveLosses * 10 });
    }
    
    // B. High loss frequency
    if (totalTrades > 0 && (lossCount / totalTrades) > 0.6) {
      issuesList.push({ name: "High Loss Frequency", value: (lossCount / totalTrades) * 100 });
    }
    
    // C. Repeated loss size (Low Variance)
    const losses = trades.filter(t => (t.pnlCurrency || 0) < 0).map(t => Math.abs(t.pnlCurrency || 0));
    if (losses.length >= 3) {
      const totalL = losses.reduce((a, b) => a + b, 0);
      const avgL = totalL / losses.length;
      if (avgL > 0) {
        const variance = losses.reduce((a, b) => a + Math.pow(b - avgL, 2), 0) / losses.length;
        const stdDev = Math.sqrt(variance);
        // If standard deviation is less than 15% of the average loss, it's highly consistent
        if (stdDev / avgL < 0.15) {
          issuesList.push({ name: "Repeated Loss Size", value: 50 });
        }
      }
    }
    
    // D. Outsized Loss
    if (lossCount > 1 && avgLoser > 0 && largestLoss > avgLoser * 2.5) {
      issuesList.push({ name: "Outsized Loss", value: largestLoss });
    }

    // E. Poor Risk-Reward
    if (winCount > 0 && lossCount > 0 && avgWinner > 0 && avgWinner < avgLoser) {
      issuesList.push({ name: "Poor Risk-Reward", value: (avgLoser / avgWinner) * 20 });
    }

    // F. High Trade Frequency
    if (totalTrades > 10) {
      issuesList.push({ name: "High Trade Frequency", value: totalTrades * 2 });
    }

    // Sort issues by "value" (severity)
    const sortedIssues = issuesList.sort((a, b) => b.value - a.value);
    
    let primaryIssue = "None detected";
    let secondaryIssue = "None detected";
    
    if (sortedIssues.length > 0) {
      primaryIssue = sortedIssues[0].name;
      if (sortedIssues.length > 1) {
        secondaryIssue = sortedIssues[1].name;
      }
    } else if (netPnl <= 0 && totalTrades > 0) {
      primaryIssue = "Negative Expectancy";
      secondaryIssue = "Insufficient Edge";
    }

    // Strength Detection
    const strengthsList: string[] = [];
    if (winCount > 1 && largestWin > avgWinner * 2.5) {
      strengthsList.push("Outsized Winners");
    }
    if (maxConsecutiveWins >= 2) {
      strengthsList.push("Winning Streaks");
    }
    if (winRate > 60) {
      strengthsList.push("High Win Rate");
    }
    if (winCount > 0 && lossCount > 0 && avgWinner > avgLoser * 1.5) {
      strengthsList.push("Strong Risk/Reward");
    }

    let primaryStrength = strengthsList.length > 0 ? strengthsList[0] : "Trade Execution";
    if (strengthsList.length === 0 && winCount > 0) {
      primaryStrength = "Consistent Execution";
    }

    // Key Insight (Minimal & Metric-Driven)
    let keyInsight = "Execution consistency is within expected range.";
    if (violationRate > 20) {
      keyInsight = `High violation rate (${violationRate.toFixed(1)}%) indicates lack of discipline.`;
    } else if (maxConsecutiveLosses >= 3) {
      keyInsight = `Cluster of ${maxConsecutiveLosses} consecutive losses detected.`;
    } else if (totalTrades > 0 && (lossCount / totalTrades) > 0.6) {
      keyInsight = `${Math.round((lossCount / totalTrades) * 100)}% of trades resulted in losses.`;
    } else if (winCount > 1 && avgWinner > 0 && largestWin > avgWinner * 2.5) {
      keyInsight = `Outsized winner ($${largestWin.toFixed(0)}) detected.`;
    } else if (winCount > 0 && lossCount > 0 && avgLoser > avgWinner) {
      keyInsight = `Negative expectancy: Avg loser ($${avgLoser.toFixed(0)}) > Avg winner ($${avgWinner.toFixed(0)}).`;
    } else if (winRate > 60 && netPnl <= 0) {
      keyInsight = `Inefficient R/R: ${winRate.toFixed(1)}% win rate but negative PnL.`;
    }

    // Scoring
    // totalTrades is already declared above (it is validTrades.length)
    // disciplinedTradesCount = trades where isViolation = false
    const disciplinedTradesCount = sortedTrades.filter(t => {
      return !t.isViolation;
    }).length;
    
    let score = totalTrades > 0 ? (disciplinedTradesCount / totalTrades) * 100 : 0;
    
    // Penalties
    // IF overrideUsed = true: subtract 5 points each (max -20)
    const overrides = sortedTrades.filter(t => t.wasForced || t.modelValidation?.isManualOverride).length;
    score -= Math.min(20, overrides * 5);
    
    // IF fastLoss (<1min): subtract 1 point each (max -10)
    const fastLosses = sortedTrades.filter(t => (t.pnlCurrency || t.pnlPoints || 0) < 0 && (t.holdTimeSeconds || 0) < 60).length;
    score -= Math.min(10, fastLosses * 1);
    
    // Clamp score: 0-100
    const disciplineScore = Math.min(100, Math.max(0, Math.round(score)));
    
    let disciplineVerdict = `Strong discipline maintained (${disciplineScore}%)`;
    if (disciplineScore < 60) {
      disciplineVerdict = `Failing discipline (${disciplineScore}%). Erratic execution.`;
    } else if (disciplineScore <= 80) {
      disciplineVerdict = `Moderate discipline (${disciplineScore}%). Inconsistent adherence.`;
    }

    // Consistency Score
    const consistencyScore = Math.min(100, Math.max(0, (winRate * 0.6) + (maxConsecutiveWins * 5) - (maxConsecutiveLosses * 5)));

    // Diagnostics
    const diagnostics: string[] = [];
    if (netPnl < 0 && fastLosersCount > 2) {
      diagnostics.push("Multiple fast losses contributed to negative session.");
    }
    if (netPnl > 0 && winRate > 60) {
      diagnostics.push("Positive session with strong win rate.");
    }
    if (overtradingFlag) {
      diagnostics.push("High trade frequency detected.");
    }
    if (sizeEscalationDetected) {
      diagnostics.push("Position size increased after a loss.");
    }
    if (maxConsecutiveLosses >= 3) {
      diagnostics.push("Cluster of consecutive losses detected.");
    }

    const modelFollowRate = totalTrades > 0 ? (validModelTradesCount / totalTrades) * 100 : 0;

    const session: Session = {
      id: `${userId}_${sessionDate}`,
      userId,
      sessionDate,
      startTime: sortedTrades[0].entryTime,
      endTime: sortedTrades[sortedTrades.length - 1].exitTime,
      totalTrades,
      winCount,
      lossCount,
      winRate,
      netPnl,
      profitFactor,
      avgWinner,
      avgLoser,
      largestWin,
      largestLoss,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      totalVolume,
      fastLosersCount,
      overtradingFlag,
      sizeEscalationDetected,
      scalingPatternCount,
      disciplineScore,
      disciplineVerdict,
      consistencyScore,
      diagnostics,
      primaryIssue,
      secondaryIssue,
      primaryStrength,
      keyInsight,
      behaviorImpacts,
      status: 'closed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modelFollowRate,
      validModelPnl,
      invalidModelPnl,
      ruleViolationsCount,
      unconfirmedTradesCount,
      manualOverrideCount,
      totalViolations,
      violationRate: totalTrades > 0 ? (totalViolations / totalTrades) * 100 : 0,
      pnlFromViolations,
      pnlFromValidTrades
    };

    return session;
  }

  static async saveSession(session: Session): Promise<void> {
    const sessionRef = doc(db, 'sessions', session.id);
    await setDoc(sessionRef, session);
  }
}
