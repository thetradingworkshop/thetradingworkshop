import { Trade, ModelValidation } from '../types';

export class ModelValidationEngine {
  /**
   * Evaluates a trade against the defined trading model using heuristics.
   * Model Requirements: Displacement, Reversal, Imbalance, Entry Timing.
   */
  static validateTrade(trade: Trade, previousTrade?: Trade): ModelValidation {
    const violations: string[] = [];

    // 1. Premature Entry Detection
    // IF hold time < 30s AND loss: → violation: "Premature entry"
    if ((trade.holdTimeSeconds || 0) < 30 && (trade.pnlCurrency || 0) < 0) {
      violations.push("Premature entry");
    }

    // 2. Chasing Entry Detection
    // IF entry occurs immediately after move without pullback
    // Heuristic: If multiple entry fills exist and the price is moving away from the first fill
    // in the direction of the trade (buying higher or selling lower).
    if (trade.fills && trade.fills.length > 1) {
      const entryFills = trade.fills.filter(f => 
        (trade.direction === 'LONG' && f.side === 'BUY') || 
        (trade.direction === 'SHORT' && f.side === 'SELL')
      ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (entryFills.length > 1) {
        const firstPrice = entryFills[0].price;
        const lastPrice = entryFills[entryFills.length - 1].price;
        
        if (trade.direction === 'LONG' && lastPrice > firstPrice * 1.001) {
          violations.push("Chasing entry (buying into strength)");
        } else if (trade.direction === 'SHORT' && lastPrice < firstPrice * 0.999) {
          violations.push("Chasing entry (selling into weakness)");
        }
      }
    }

    // 3. Displacement Detection
    // IF no displacement detected: → violation: "No strong directional move"
    // Heuristic: If the PnL points are very small, it likely wasn't a strong directional move.
    if (Math.abs(trade.pnlPoints || 0) < 2) {
      violations.push("No strong directional move");
    }

    // 4. Reversal Structure Detection
    // IF no reversal structure: → violation: "No structure shift"
    // Heuristic: If this trade is in the same direction as the previous trade 
    // and happened shortly after, it's likely a continuation, not a reversal.
    if (previousTrade) {
      const timeSincePrev = (new Date(trade.entryTime).getTime() - new Date(previousTrade.exitTime).getTime()) / 1000;
      if (timeSincePrev < 300 && trade.direction === previousTrade.direction) {
        violations.push("No structure shift (trend continuation)");
      }
    }

    // 5. Entry Timing (Pullback)
    // Heuristic: If the entry price is at the extreme of the recent range (not implemented fully without candles)
    // For now, we use the "Chasing" check as a proxy for lack of pullback.

    return {
      followsModel: violations.length === 0,
      violations
    };
  }

  static getTradeTag(validation: ModelValidation): string {
    return validation.followsModel ? "Valid Setup" : "Invalid Setup";
  }
}
