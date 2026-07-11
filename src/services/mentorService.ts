import { Trade, TradeStats } from '../types';

export enum ExecutionStrategyBalance {
  EXECUTION_HEAVY = 'Execution Heavy',
  STRATEGY_HEAVY = 'Strategy Heavy',
  BALANCED = 'Balanced',
}

export interface StructuredInsight {
  sessionSummary: string;
  whatWorked: string[];
  whatHurt: string[];
  coreProblem: string;
  executionVsStrategy: string;
  actionPlan: string[];
  isInsufficientData?: boolean;
}

export interface AIProvider {
  enhanceInsight(insight: StructuredInsight, trades: Trade[], stats: TradeStats | null): Promise<StructuredInsight>;
}

export class InsightEngine {
  generateDeterministicInsight(trades: Trade[], stats: TradeStats | null, contextLabel?: string): StructuredInsight {
    if (!trades || trades.length === 0) {
      return {
        sessionSummary: `No trading activity recorded for ${contextLabel || 'this period'}.`,
        whatWorked: [],
        whatHurt: [],
        coreProblem: "Insufficient Data",
        executionVsStrategy: "Not enough data to analyze execution vs strategy.",
        actionPlan: ["Wait for high-quality setups", "Document market conditions"],
        isInsufficientData: true
      };
    }

    const winRate = stats?.winRate || 0;
    const profitFactor = stats?.profitFactor || 0;
    const avgWinner = stats?.avgWinner || 0;
    const avgLoser = Math.abs(stats?.avgLoser || 0);

    // 1. Session Summary
    let sessionSummary = `During ${contextLabel || 'this period'}, you traded ${trades.length} sessions with a ${winRate.toFixed(1)}% win rate. `;
    if (profitFactor > 2) {
      sessionSummary += "Highly efficient performance with strong risk-adjusted returns.";
    } else if (profitFactor > 1) {
      sessionSummary += "Profitable session, but efficiency could be improved.";
    } else {
      sessionSummary += "Challenging session with negative expectancy.";
    }

    // 2. What Worked
    const whatWorked: string[] = [];
    if (winRate > 60) whatWorked.push(`High accuracy: ${winRate.toFixed(1)}% win rate indicates strong selection.`);
    if (avgWinner > avgLoser * 1.5) whatWorked.push(`Risk/Reward: Average winner ($${avgWinner.toFixed(0)}) significantly offsets average loser ($${avgLoser.toFixed(0)}).`);
    if (trades.length < 5) whatWorked.push("Selectivity: Low trade count suggests high patience and setup discipline.");

    // 3. What Hurt
    const whatHurt: string[] = [];
    if (winRate < 40) whatHurt.push(`Low accuracy: ${winRate.toFixed(1)}% win rate suggests forcing sub-optimal setups.`);
    if (avgLoser > avgWinner) whatHurt.push(`Outsized losers: Average loser ($${avgLoser.toFixed(0)}) exceeds average winner ($${avgWinner.toFixed(0)}).`);
    if (trades.length > 15) whatHurt.push(`Over-trading: ${trades.length} trades in a single period often leads to fatigue and slippage.`);

    // 4. Core Problem (ONLY ONE)
    let coreProblem = "Consistency";
    if (avgLoser > avgWinner) coreProblem = `Risk Management: Average loser ($${avgLoser.toFixed(0)}) is larger than average winner ($${avgWinner.toFixed(0)}).`;
    else if (winRate < 40) coreProblem = `Selection Quality: Win rate of ${winRate.toFixed(1)}% is below the required threshold for profitability.`;
    else if (trades.length > 15) coreProblem = `Discipline: Over-trading (${trades.length} trades) is diluting edge.`;
    else if (profitFactor < 1) coreProblem = `Negative Expectancy: Profit factor of ${profitFactor.toFixed(2)} indicates a leaking strategy.`;

    // 5. Execution vs Strategy
    let executionVsStrategy = "Strategy and execution are currently aligned.";
    if (winRate > 70 && profitFactor < 1.2) {
      executionVsStrategy = "Execution is high, but strategy edge is thin (low profit factor despite high win rate).";
    } else if (winRate < 40 && profitFactor > 1.5) {
      executionVsStrategy = "Strategy has high potential (large winners), but execution accuracy is poor.";
    }

    // 6. Action Plan (max 3)
    const actionPlan: string[] = [];
    if (coreProblem.includes("Risk Management")) {
      actionPlan.push("Strictly enforce hard stop-losses on all entries.");
      actionPlan.push("Reduce position size by 50% until R-multiple stabilizes.");
    } else if (coreProblem.includes("Selection Quality")) {
      actionPlan.push("Wait for 3-factor confluence before entering any trade.");
      actionPlan.push("Review 'Grade A' setup criteria and ignore all others.");
    } else if (coreProblem.includes("Discipline")) {
      actionPlan.push("Limit to 3 high-quality trades per session.");
      actionPlan.push("Walk away after reaching daily profit/loss target.");
    } else {
      actionPlan.push("Maintain current discipline and focus.");
      actionPlan.push("Document 'Grade A' setups for future reference.");
    }

    return {
      sessionSummary,
      whatWorked: whatWorked.slice(0, 3),
      whatHurt: whatHurt.slice(0, 3),
      coreProblem,
      executionVsStrategy,
      actionPlan: actionPlan.slice(0, 3)
    };
  }
}

export class MentorService {
  private engine: InsightEngine;
  private aiProvider?: AIProvider;

  constructor(aiProvider?: AIProvider) {
    this.engine = new InsightEngine();
    this.aiProvider = aiProvider;
  }

  async getMentorFeedback(trades: Trade[], stats: TradeStats | null, contextLabel?: string): Promise<StructuredInsight> {
    const baseInsight = this.engine.generateDeterministicInsight(trades, stats, contextLabel);
    
    if (this.aiProvider && trades.length > 0) {
      try {
        return await this.aiProvider.enhanceInsight(baseInsight, trades, stats);
      } catch (error) {
        console.error("AI Enhancement failed, falling back to deterministic insight", error);
        return baseInsight;
      }
    }

    return baseInsight;
  }
}
