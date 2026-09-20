import { Trade, ModelValidation } from '../types';

export class ModelValidationEngine {
  /**
   * Evaluates a trade against the defined trading model using heuristics.
   * Model Requirements: Displacement, Reversal, Imbalance, Entry Timing.
   */
  // `sortedTrades`/`index` (chronologically sorted, trade === sortedTrades[index])
  // replaces the old single `previousTrade` param — rule #4 below needs to
  // walk back further than one trade to count a flip streak, not just
  // compare this trade to the one right before it.
  static validateTrade(trade: Trade, sortedTrades: Trade[], index: number): ModelValidation {
    const violations: string[] = [];
    const previousTrade = index > 0 ? sortedTrades[index - 1] : undefined;

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

    // 4. Rapid Re-entry Detection — two severities, not one flag, per a
    // real trading-psychology distinction validated against real trade
    // data (a 7-trade same-direction trend run vs. a 5-trade
    // LONG/SHORT/LONG/SHORT/LONG whipsaw in the same session):
    //   - Same direction, rapid re-entry: impatience — jumping back in
    //     before waiting for a fresh, independent setup, not profitable,
    //     but at least reflects real directional conviction. Mild.
    //   - Opposite direction, rapid re-entry, repeated 3+ times in a row:
    //     genuine indecision/gambling, a tilt precursor — worse than a
    //     single bad trade. A single flip is often legitimate trade
    //     management (stopped out, real new signal, reversed), so this
    //     only fires once it's the 3rd consecutive flip in an active
    //     rapid-fire chain ("more than twice"), not on the first one.
    if (previousTrade) {
      const timeSincePrev = (new Date(trade.entryTime).getTime() - new Date(previousTrade.exitTime).getTime()) / 1000;
      const isChained = timeSincePrev >= 0 && timeSincePrev < 300;
      if (isChained && trade.direction === previousTrade.direction) {
        violations.push("Impatient re-entry");
      } else if (isChained) {
        // Walk backward through the rapid-fire chain counting how many
        // consecutive direction flips led up to this one. Stops at the
        // first non-flip (same-direction) transition or the first
        // transition outside the 5-minute window.
        let flipStreak = 1;
        for (let i = index - 1; i > 0; i--) {
          const cur = sortedTrades[i];
          const prior = sortedTrades[i - 1];
          const gap = (new Date(cur.entryTime).getTime() - new Date(prior.exitTime).getTime()) / 1000;
          if (gap < 0 || gap >= 300 || cur.direction === prior.direction) break;
          flipStreak++;
        }
        if (flipStreak >= 3) {
          violations.push("Rapid direction flip");
        }
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
