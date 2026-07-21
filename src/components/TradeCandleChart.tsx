import React, { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { Trade } from '../types';
import { MarketBarsData } from '../hooks/useMarketBars';
import { cn } from '@/src/utils';

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash) || 1;
}

// Real fills, bucketed into OHLC bars. Only meaningfully populated for trades
// with several scaled fills — a plain single-entry/single-exit trade has just
// two data points, not enough for a candlestick series.
function buildBarsFromFills(trade: Trade): Bar[] {
  const points = trade.fills
    .map(f => ({ time: Math.floor(new Date(f.timestamp).getTime() / 1000), price: f.price, quantity: f.quantity }))
    .filter(p => !isNaN(p.time))
    .sort((a, b) => a.time - b.time);

  if (points.length < 3) return [];

  const span = Math.max(points[points.length - 1].time - points[0].time, 30);
  const bucketSeconds = Math.max(2, Math.ceil(span / 30));

  const buckets = new Map<number, typeof points>();
  for (const p of points) {
    const bucketTime = Math.floor(p.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (existing) existing.push(p);
    else buckets.set(bucketTime, [p]);
  }

  const sortedTimes = [...buckets.keys()].sort((a, b) => a - b);
  const bars: Bar[] = [];
  let prevClose: number | null = null;
  for (const t of sortedTimes) {
    const pts = buckets.get(t)!;
    const prices = pts.map(p => p.price);
    const open = prevClose ?? prices[0];
    const close = prices[prices.length - 1];
    bars.push({
      time: t,
      open,
      high: Math.max(open, close, ...prices),
      low: Math.min(open, close, ...prices),
      close,
      volume: pts.reduce((sum, p) => sum + p.quantity, 0),
    });
    prevClose = close;
  }
  return bars;
}

// Deterministic fallback for the common case (few fills): a synthetic path
// bracketing the trade's real entry and exit prices/times. Not real market
// data — no live feed or subscription is wired up.
function buildFallbackBars(trade: Trade): Bar[] {
  const entryEpoch = Math.floor(new Date(trade.entryTime).getTime() / 1000);
  const exitEpoch = Math.floor(new Date(trade.exitTime).getTime() / 1000);
  const rand = seededRandom(hashString(trade.id));
  const barCount = 40;
  const entryIndex = 15;
  const exitIndex = Math.min(barCount - 5, entryIndex + 10);
  const barInterval = Math.max(2, Math.floor((exitEpoch - entryEpoch) / Math.max(1, exitIndex - entryIndex)));
  const startTime = entryEpoch - entryIndex * barInterval;
  const volatility = Math.max(Math.abs(trade.avgEntryPrice - trade.avgExitPrice) * 0.1, trade.avgEntryPrice * 0.0006);

  const prices: number[] = new Array(barCount);
  prices[entryIndex] = trade.avgEntryPrice;
  prices[exitIndex] = trade.avgExitPrice;
  for (let i = entryIndex - 1; i >= 0; i--) prices[i] = prices[i + 1] + (rand() - 0.5) * volatility * 2;
  for (let i = entryIndex + 1; i < exitIndex; i++) {
    const progress = (i - entryIndex) / (exitIndex - entryIndex);
    prices[i] = trade.avgEntryPrice + (trade.avgExitPrice - trade.avgEntryPrice) * progress + (rand() - 0.5) * volatility;
  }
  for (let i = exitIndex + 1; i < barCount; i++) prices[i] = prices[i - 1] + (rand() - 0.5) * volatility * 2;

  const bars: Bar[] = [];
  for (let i = 0; i < barCount; i++) {
    const close = prices[i];
    const open = i === 0 ? close - (rand() - 0.5) * volatility : bars[i - 1].close;
    const wick = volatility * (0.4 + rand() * 0.6);
    bars.push({
      time: startTime + i * barInterval,
      open: Number(open.toFixed(4)),
      high: Number((Math.max(open, close) + wick * rand()).toFixed(4)),
      low: Number((Math.min(open, close) - wick * rand()).toFixed(4)),
      close: Number(close.toFixed(4)),
      volume: 20 + Math.round(rand() * 80),
    });
  }
  return bars;
}

function nearestBarTime(bars: Bar[], epochSeconds: number): number {
  let closest = bars[0].time;
  let bestDiff = Math.abs(bars[0].time - epochSeconds);
  for (const bar of bars) {
    const diff = Math.abs(bar.time - epochSeconds);
    if (diff < bestDiff) { bestDiff = diff; closest = bar.time; }
  }
  return closest;
}

const TIMEFRAMES: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'Auto' },
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '1d', label: '1D' },
];

interface TradeCandleChartProps {
  trade: Trade;
  market: MarketBarsData | null;
  isLoadingMarket: boolean;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string | undefined) => void;
}

export function TradeCandleChart({ trade, market, isLoadingMarket, timeframe, onTimeframeChange }: TradeCandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const realBars = buildBarsFromFills(trade);
  const bars = market?.bars ?? (realBars.length > 0 ? realBars : buildFallbackBars(trade));
  const source: 'market' | 'fills' | 'synthetic' = market ? 'market' : realBars.length > 0 ? 'fills' : 'synthetic';

  useEffect(() => {
    if (!containerRef.current || bars.length === 0 || isLoadingMarket) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(148,163,184,0.1)' }, horzLines: { color: 'rgba(148,163,184,0.1)' } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: true },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const candleData: CandlestickData[] = bars.map(b => ({
      time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close,
    }));
    const volumeData: HistogramData[] = bars.map(b => ({
      time: b.time as UTCTimestamp,
      value: b.volume,
      color: b.close >= b.open ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    const isLong = trade.direction === 'LONG';
    const entryEpoch = Math.floor(new Date(trade.entryTime).getTime() / 1000);
    const exitEpoch = Math.floor(new Date(trade.exitTime).getTime() / 1000);
    createSeriesMarkers(candleSeries, [
      {
        time: nearestBarTime(bars, entryEpoch) as UTCTimestamp,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: '#6366f1',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: `Entry ${trade.avgEntryPrice}`,
      },
      {
        time: nearestBarTime(bars, exitEpoch) as UTCTimestamp,
        position: isLong ? 'aboveBar' : 'belowBar',
        color: trade.isWinner ? '#10b981' : '#f43f5e',
        shape: isLong ? 'arrowDown' : 'arrowUp',
        text: `Exit ${trade.avgExitPrice}`,
      },
    ]);

    chart.timeScale().fitContent();

    return () => chart.remove();
    // `market` (not just `source`) is a dependency because switching
    // timeframes can produce a new dataset while `source` stays 'market'
    // both before and after, which wouldn't otherwise trigger a redraw.
  }, [trade.id, isLoadingMarket, source, market]);

  const caption =
    source === 'market'
      ? `Real ${market!.yahooSymbol} market data (${market!.interval} bars, delayed via Yahoo Finance) — for study, not live trading.`
      : source === 'fills'
      ? "Built from this trade's own execution fills — not a live market feed."
      : "No live market feed is wired up — this path is approximated between this trade's real entry and exit.";

  return (
    <div className="flex h-full flex-col space-y-2">
      {onTimeframeChange && (
        <div className="flex items-center gap-1 shrink-0">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.label}
              onClick={() => onTimeframeChange(tf.id)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors",
                timeframe === tf.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground shrink-0">{isLoadingMarket ? 'Loading market data...' : caption}</div>
      {isLoadingMarket ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading market data...</div>
      ) : bars.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No fill data to chart.</div>
      ) : (
        <div ref={containerRef} className="w-full flex-1" />
      )}
    </div>
  );
}
