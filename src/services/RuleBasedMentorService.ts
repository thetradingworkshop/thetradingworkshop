import { Session } from '../types';

export interface RuleBasedInsight {
  strengths: string[];
  weaknesses: string[];
  nextAction: string;
}

export class RuleBasedMentorService {
  static generateInsights(session: Partial<Session>): RuleBasedInsight {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    const violationRate = Math.round(session.violationRate || 0);
    const pnlFromViolations = session.pnlFromViolations || 0;
    const pnlFromValidTrades = session.pnlFromValidTrades || 0;
    const fastLossCount = session.fastLosersCount || 0;
    const disciplineScore = Math.round(session.disciplineScore || 0);
    const modelFollowRate = Math.round(session.modelFollowRate || 0);
    const winRate = Math.round(session.winRate || 0);
    const profitFactor = (session.profitFactor || 0).toFixed(2);
    const avgWinner = session.avgWinner || 0;
    const avgLoser = session.avgLoser || 0;
    const topViolationReason = session.topViolationReason;
    const topViolationCount = session.topViolationCount || 0;

    // Strengths (Limit to 2)
    if (disciplineScore >= 90) {
      strengths.push(`Discipline score: ${disciplineScore}%. Model followed with near-perfect consistency.`);
    } else if (modelFollowRate >= 80) {
      strengths.push(`Followed model in ${modelFollowRate}% of trades — high setup discipline.`);
    }

    if (Number(profitFactor) > 2.0) {
      strengths.push(`Profit factor: ${profitFactor}. Statistically significant edge.`);
    } else if (winRate > 60) {
      strengths.push(`Win rate: ${winRate}%. Selection quality is currently strong.`);
    }

    // Weaknesses (Limit to 2) — name the specific violation reason when
    // available (see SessionBuilder's violationReasonCounts tally) instead
    // of only a bare percentage.
    if (violationRate > 15) {
      const cause = topViolationReason
        ? ` Most common cause: ${topViolationReason} (${topViolationCount} trade${topViolationCount === 1 ? '' : 's'}).`
        : '';
      weaknesses.push(`Violation rate: ${violationRate}%, above the 15% threshold.${cause}`);
    } else if (disciplineScore < 70) {
      weaknesses.push(`Discipline score: ${disciplineScore}%, below the 70% threshold — execution was inconsistent.`);
    }

    if (pnlFromViolations < 0) {
      weaknesses.push(`Rule violations cost $${Math.abs(pnlFromViolations).toFixed(2)} this session.`);
    } else if (fastLossCount > 2) {
      weaknesses.push(`${fastLossCount} fast losses (under 1 minute) — likely entries without confirmation.`);
    }

    // Next Action (Strict & Minimal)
    let nextAction = "Maintain current discipline. Do not deviate from the proven model.";

    if (violationRate > 30) {
      const cause = topViolationReason ? `, driven mainly by ${topViolationReason}` : '';
      nextAction = `Stop trading for today. Violation rate is ${violationRate}%${cause} — review that rule before your next session.`;
    } else if (violationRate > 15) {
      nextAction = "Tighten your selection. Only take trades that meet 100% of your criteria.";
    } else if (pnlFromViolations < 0) {
      nextAction = `Eliminate discretionary overrides — they cost $${Math.abs(pnlFromViolations).toFixed(2)} this session.`;
    } else if (fastLossCount > 2) {
      nextAction = "Wait for candle closes. Stop front-running your entries.";
    } else if (disciplineScore < 85) {
      nextAction = "Focus on execution, not PnL. The goal is 100% adherence.";
    }

    return {
      strengths: strengths.length > 0 ? strengths.slice(0, 2) : ["No metric cleared the bar this session."],
      weaknesses: weaknesses.length > 0 ? weaknesses.slice(0, 2) : ["No weakness crossed a threshold this session — stay sharp."],
      nextAction
    };
  }
}
