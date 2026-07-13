import { AIProvider, StructuredInsight } from "./mentorService";
import { Trade, TradeStats } from "../types";

export class AnthropicProvider implements AIProvider {
  private static cooldownUntil: number = 0;

  static getCooldownRemaining(): number {
    if (!AnthropicProvider.cooldownUntil) return 0;
    const remaining = AnthropicProvider.cooldownUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  async enhanceInsight(insight: StructuredInsight, trades: Trade[], stats: TradeStats | null): Promise<StructuredInsight> {
    if (Date.now() < AnthropicProvider.cooldownUntil) {
      return insight;
    }

    try {
      const response = await fetch("/api/mentor/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insight, trades: trades.slice(0, 10), stats }),
      });

      if (response.status === 429) {
        console.warn("Claude API rate limited. Cooling down for 5 minutes.");
        AnthropicProvider.cooldownUntil = Date.now() + 5 * 60 * 1000;
        return insight;
      }

      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

      const enhanced = await response.json();
      return {
        ...insight,
        ...enhanced,
        actionPlan: (enhanced.actionPlan || insight.actionPlan).slice(0, 3),
      };
    } catch (error) {
      console.error("AI enhancement failed:", error);
      return insight;
    }
  }
}

// Example of how to add another provider later:
/*
export class OpenAIProvider implements AIProvider {
  async enhanceInsight(insight: StructuredInsight): Promise<StructuredInsight> {
    // OpenAI implementation
    return insight;
  }
}
*/
