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
export function useMarketBars(trade: Trade | null): { market: MarketBarsData | null; isLoading: boolean } {
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
    fetch(`/api/market/candles?${params}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(data => {
        if (cancelled || !Array.isArray(data.bars) || data.bars.length === 0) return;
        setMarket({ yahooSymbol: data.yahooSymbol, interval: data.interval, bars: data.bars });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [trade?.id]);

  return { market, isLoading };
}
