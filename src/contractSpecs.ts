/**
 * USD value of a 1.00-point move for common CME/CBOT/NYMEX/COMEX futures contracts,
 * keyed by root symbol (contract month/year codes are stripped before lookup).
 *
 * This replaces a previous hardcoded assumption that every trade was ES ($50/point),
 * which silently produced wrong dollar P&L for every other instrument (e.g. NQ/MNQ).
 */
export const CONTRACT_POINT_VALUES: Record<string, number> = {
  // Equity Index - CME
  ES: 50,      // E-mini S&P 500
  MES: 5,      // Micro E-mini S&P 500
  NQ: 20,      // E-mini Nasdaq-100
  MNQ: 2,      // Micro E-mini Nasdaq-100
  YM: 5,       // E-mini Dow
  MYM: 0.5,    // Micro E-mini Dow
  RTY: 50,     // E-mini Russell 2000
  M2K: 5,      // Micro E-mini Russell 2000

  // Energy - NYMEX
  CL: 1000,    // Crude Oil
  MCL: 100,    // Micro Crude Oil
  NG: 10000,   // Natural Gas
  RB: 42000,   // RBOB Gasoline

  // Metals - COMEX
  GC: 100,     // Gold
  MGC: 10,     // Micro Gold
  SI: 5000,    // Silver
  SIL: 1000,   // Micro Silver
  HG: 25000,   // Copper

  // Rates - CBOT
  ZB: 1000,    // 30-Year T-Bond
  ZN: 1000,    // 10-Year T-Note
  ZF: 1000,    // 5-Year T-Note
  ZT: 2000,    // 2-Year T-Note

  // Grains - CBOT
  ZC: 50,      // Corn
  ZS: 50,      // Soybeans
  ZW: 50,      // Wheat
};

/** Fallback multiplier used when a symbol isn't recognized. */
const DEFAULT_POINT_VALUE = 1;

/** Standard CME month codes: F,G,H,J,K,M,N,Q,U,V,X,Z */
const MONTH_CODE_PATTERN = /^([A-Z]{1,3})([FGHJKMNQUVXZ])(\d{1,4})$/;

/**
 * Extracts the root symbol from a broker contract string by stripping a trailing
 * month-code + year suffix (e.g. "NQZ4" -> "NQ", "MNQH25" -> "MNQ"). Falls back to
 * the raw (uppercased) symbol if no such suffix is present.
 */
export function getRootSymbol(symbol: string): string {
  if (!symbol) return symbol;
  const s = symbol.trim().toUpperCase();
  const match = s.match(MONTH_CODE_PATTERN);
  return match ? match[1] : s;
}

/**
 * Returns the USD value of a 1.00-point move for the given symbol. Unrecognized
 * symbols fall back to $1/point (rather than silently assuming ES's $50/point)
 * and log a warning so misconfigured/unknown instruments are visible.
 */
export function getPointValue(symbol: string): number {
  const root = getRootSymbol(symbol);
  const value = CONTRACT_POINT_VALUES[root];
  if (value === undefined) {
    console.warn(`[contractSpecs] Unrecognized symbol "${symbol}" (root "${root}") — defaulting to $${DEFAULT_POINT_VALUE}/point. Add it to CONTRACT_POINT_VALUES for correct P&L.`);
    return DEFAULT_POINT_VALUE;
  }
  return value;
}
