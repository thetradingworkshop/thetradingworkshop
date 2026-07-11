import { GoogleGenAI } from "@google/genai";
import { AIProvider, StructuredInsight } from "./mentorService";
import { Trade, TradeStats } from "../types";

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;
  private modelName: string;
  private static cooldownUntil: number = 0;

  constructor(apiKey: string, modelName: string = "gemini-3-flash-preview") {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  static getCooldownRemaining(): number {
    if (!GeminiProvider.cooldownUntil) return 0;
    const remaining = GeminiProvider.cooldownUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  async enhanceInsight(insight: StructuredInsight, trades: Trade[], stats: TradeStats | null): Promise<StructuredInsight> {
    // Check cooldown
    if (Date.now() < GeminiProvider.cooldownUntil) {
      return insight;
    }

    const tradeSummary = trades.slice(0, 10).map(t => 
      `- ${t.symbol} ${t.direction}: ${t.isWinner ? 'WIN' : 'LOSS'} ($${t.pnlPoints.toFixed(0)}), Grade: ${t.tradeGrade}, Hold: ${Math.round(t.holdTimeSeconds/60)}m`
    ).join('\n');

    const prompt = `
      You are an expert trading performance coach. I will provide you with a structured trading insight and the underlying trade data.
      Your goal is to enhance the natural language parts of this insight while maintaining the core data and structure.
      
      UNDERLYING DATA:
      - Total Trades: ${trades.length}
      - Win Rate: ${stats?.winRate.toFixed(1)}%
      - Profit Factor: ${stats?.profitFactor.toFixed(2)}
      - Avg Winner: $${stats?.avgWinner.toFixed(0)}
      - Avg Loser: $${stats?.avgLoser.toFixed(0)}
      - Sample Trades:
      ${tradeSummary}
      
      STRUCTURED INSIGHT (DETERMINISTIC):
      - Session Summary: ${insight.sessionSummary}
      - What Worked: ${insight.whatWorked.join(", ")}
      - What Hurt: ${insight.whatHurt.join(", ")}
      - Core Problem: ${insight.coreProblem}
      - Execution vs Strategy: ${insight.executionVsStrategy}
      - Action Plan: ${insight.actionPlan.join(", ")}
      
      INSTRUCTIONS:
      1. Be precise and data-driven.
      2. Use measurable cause-effect statements (e.g., "Re-entries reduced expectancy by 0.6R").
      3. Ensure the Core Problem is singular and specific.
      4. Action Plan must be max 3 bullets and directly map to detected issues.
      5. Maintain the exact structure.
      
      OUTPUT FORMAT (JSON):
      {
        "sessionSummary": "Enhanced natural language summary",
        "whatWorked": ["Enhanced point 1", "Enhanced point 2"],
        "whatHurt": ["Enhanced point 1", "Enhanced point 2"],
        "coreProblem": "Enhanced core problem description",
        "executionVsStrategy": "Detailed analysis of execution quality vs strategy correctness",
        "actionPlan": ["Enhanced action 1", "Enhanced action 2", "Enhanced action 3"]
      }
      
      Return ONLY the JSON.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (text) {
        const enhanced = JSON.parse(text);
        return {
          ...insight,
          ...enhanced,
          // Ensure structure is strictly followed
          actionPlan: (enhanced.actionPlan || insight.actionPlan).slice(0, 3)
        };
      }
    } catch (error: any) {
      // Robust error detection for quota limits
      const isQuotaError = 
        error?.status === "RESOURCE_EXHAUSTED" || 
        error?.code === 429 ||
        error?.error?.status === "RESOURCE_EXHAUSTED" ||
        error?.error?.code === 429 ||
        (typeof error?.message === 'string' && error.message.includes("429")) ||
        (typeof error?.message === 'string' && error.message.includes("quota"));

      if (isQuotaError) {
        console.warn("Gemini API quota exceeded. Cooling down for 5 minutes.");
        // Set cooldown for 5 minutes
        GeminiProvider.cooldownUntil = Date.now() + (5 * 60 * 1000);
      } else {
        console.error("Gemini enhancement failed", error);
      }
    }

    return insight;
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
