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

    // Strengths (Limit to 2)
    if (disciplineScore >= 90) {
      strengths.push(`Discipline score is ${disciplineScore}%. You followed the model with near-perfect consistency.`);
    } else if (modelFollowRate >= 80) {
      strengths.push(`Followed model in ${modelFollowRate}% of trades. High setup discipline.`);
    }

    if (Number(profitFactor) > 2.0) {
      strengths.push(`Profit factor is ${profitFactor}. Your edge is mathematically significant.`);
    } else if (winRate > 60) {
      strengths.push(`Win rate is ${winRate}%. Your selection quality is currently high.`);
    }

    // Weaknesses (Limit to 2)
    if (violationRate > 15) {
      weaknesses.push(`Violation rate is ${violationRate}%. You are gambling, not trading.`);
    } else if (disciplineScore < 70) {
      weaknesses.push(`Discipline score is a failing ${disciplineScore}%. Your execution is erratic and unreliable.`);
    }

    if (pnlFromViolations < 0) {
      weaknesses.push(`Violations cost you $${Math.abs(pnlFromViolations).toFixed(2)}. This is pure waste from lack of control.`);
    } else if (fastLossCount > 2) {
      weaknesses.push(`${fastLossCount} trades were fast losses. You are likely chasing or entering without confirmation.`);
    }

    // Next Action (Strict & Minimal)
    let nextAction = "Maintain current discipline. Do not deviate from the proven model.";

    if (violationRate > 30) {
      nextAction = "Stop trading immediately. You have zero discipline. Re-read your rules before the next session.";
    } else if (violationRate > 15) {
      nextAction = "Tighten your selection. Only take trades that meet 100% of your criteria.";
    } else if (pnlFromViolations < 0) {
      nextAction = "Eliminate overrides. Your 'intuition' is costing you money.";
    } else if (fastLossCount > 2) {
      nextAction = "Wait for candle closes. Stop front-running your entries.";
    } else if (disciplineScore < 85) {
      nextAction = "Focus on execution, not PnL. The goal is 100% adherence.";
    }

    return {
      strengths: strengths.length > 0 ? strengths.slice(0, 2) : ["No strengths. Follow your rules first."],
      weaknesses: weaknesses.length > 0 ? weaknesses.slice(0, 2) : ["No weaknesses detected. Don't get complacent."],
      nextAction
    };
  }
}
