import { useEffect, useState } from 'react';
import { Trade } from '../types';

export interface MarketBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketBarsData {
  yahooSymbol: string;
  interval: string;
  bars: MarketBar[];
}

// Real, delayed NASDAQ/CME futures data for a trade's own time window (via
// Yahoo Finance, proxied server-side through /api/market/candles). Shared by
// the candlestick chart and the MAE/MFE stat so both draw on one fetch per
// trade instead of two.
//
// `timeframe` is optional: omitted (the default) fetches a narrow window
// tightly bracketing the trade's own entry/exit, with the server picking a
// short interval automatically. Passing an explicit interval (e.g. "1h",
// "1d") instead fetches a much longer lookback at that interval, for
// top-down context review rather than just the trade's own candles.
export function useMarketBars(trade: Trade | null, timeframe?: string): { market: MarketBarsData | null; isLoading: boolean } {
  const [market, setMarket] = useState<MarketBarsData | null>(null);
  const [isLoading, setIsLoading] = useState(!!trade);

  useEffect(() => {
    if (!trade) {
      setMarket(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setMarket(null);

    const params = new URLSearchParams({ symbol: trade.symbol, start: trade.entryTime, end: trade.exitTime });
    if (timeframe) params.set('interval', timeframe);
    fetch(`/api/market/candles?${params}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(data => {
        if (cancelled || !Array.isArray(data.bars) || data.bars.length === 0) return;
        setMarket({ yahooSymbol: data.yahooSymbol, interval: data.interval, bars: data.bars });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [trade?.id, timeframe]);

  return { market, isLoading };
}
