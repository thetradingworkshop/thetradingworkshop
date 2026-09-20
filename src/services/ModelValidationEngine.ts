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

    // 4. Direction Flip Detection (was "Reversal Structure Detection" —
    // flagged the OPPOSITE pattern until real trade data showed why that
    // was backwards: it fired on same-direction re-entries within 5
    // minutes, treating "sticking to your bias" as a violation. For a
    // trend trader, taking several trades in the same direction as the
    // market moves IS the discipline, not a lapse in it — the same real
    // session that surfaced this also had a 5-trade stretch flipping
    // LONG/SHORT/LONG/SHORT/LONG with gaps as tight as 4 seconds and four
    // straight losses, which the old rule never caught at all since it
    // only ever looked at same-direction pairs.
    // Heuristic: a rapid flip to the opposite direction — no time to have
    // actually waited for a fresh, independent setup — is the real
    // indecision/whipsaw signal. Same-direction continuation, however
    // fast, no longer counts against you.
    if (previousTrade) {
      const timeSincePrev = (new Date(trade.entryTime).getTime() - new Date(previousTrade.exitTime).getTime()) / 1000;
      if (timeSincePrev < 300 && trade.direction !== previousTrade.direction) {
        violations.push("Rapid direction flip");
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
