import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { Pencil, Waves, Square, Percent, Type, Eraser } from 'lucide-react';
import { Trade, ChartDrawing } from '../types';
import { MarketBarsData } from '../hooks/useMarketBars';
import { cn } from '@/src/utils';
import {
  TrendLinePrimitive,
  PriceChannelPrimitive,
  RectanglePrimitive,
  FibRetracementPrimitive,
  TextNotePrimitive,
  DRAWING_HIT_TOLERANCE_PX,
  priceOnLineAtTime,
  TrendLinePoint,
} from '../lib/chartDrawingPrimitives';

type DrawingPrimitive = TrendLinePrimitive | PriceChannelPrimitive | RectanglePrimitive | FibRetracementPrimitive | TextNotePrimitive;
type DrawTool = 'none' | 'trendline' | 'channel' | 'box' | 'fib' | 'text';
// Tools that are drawn with a single click-drag (start point on mousedown,
// end point on mouseup). 'channel' needs a third click for its width and
// 'text' needs a click plus typed input, so those are handled separately.
const DRAG_TOOLS: DrawTool[] = ['trendline', 'box', 'fib'];

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
  { id: 'w', label: 'W' },
  { id: '1h', label: '1H' },
  { id: '1d', label: '1D' },
];

interface TradeCandleChartProps {
  trade: Trade;
  market: MarketBarsData | null;
  isLoadingMarket: boolean;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string | undefined) => void;
  drawings: ChartDrawing[];
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
}

export function TradeCandleChart({ trade, market, isLoadingMarket, timeframe, onTimeframeChange, drawings, onDrawingsChange }: TradeCandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const realBars = buildBarsFromFills(trade);
  const bars = market?.bars ?? (realBars.length > 0 ? realBars : buildFallbackBars(trade));
  const source: 'market' | 'fills' | 'synthetic' = market ? 'market' : realBars.length > 0 ? 'fills' : 'synthetic';

  // OHLC legend above the chart — shows the bar under the cursor, or the
  // most recent bar when the cursor isn't over the chart, matching the
  // standard candlestick-chart convention.
  const [hoverBar, setHoverBar] = useState<Bar | null>(null);

  // Drawing tools. `tool` drives the toolbar's active state and (via
  // toolRef) the native mouse handlers below, which are attached once per
  // chart build rather than re-attached on every tool change.
  const [tool, setTool] = useState<DrawTool>('none');
  const toolRef = useRef<DrawTool>('none');
  useEffect(() => { toolRef.current = tool; }, [tool]);

  // Screen position + time/price anchor for an in-progress text note, while
  // waiting on the floating input below for its content.
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);

  const drawingsRef = useRef(drawings);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  useEffect(() => { onDrawingsChangeRef.current = onDrawingsChange; }, [onDrawingsChange]);

  // Set inside the chart-build effect so the toolbar and the floating text
  // input (outside that effect's closure) can still trigger a clear-all,
  // cancel/commit an in-progress drawing, or toggle the chart's own
  // pan/zoom handling when a tool is (de)selected.
  const clearAllRef = useRef<(() => void) | null>(null);
  const cancelActiveRef = useRef<(() => void) | null>(null);
  const commitTextRef = useRef<((text: string) => void) | null>(null);
  const setInteractiveRef = useRef<((interactive: boolean) => void) | null>(null);

  const drawHint =
    tool === 'trendline' ? 'Click-drag to draw a trend line.'
    : tool === 'channel' ? 'Click-drag the first line, then click once more to set the channel width.'
    : tool === 'box' ? 'Click-drag to draw a box.'
    : tool === 'fib' ? 'Click-drag from the start to the end of the move.'
    : tool === 'text' ? 'Click on the chart to place a note.'
    : null;

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

    setHoverBar(bars[bars.length - 1]);
    const barsByTime = new Map(bars.map(b => [b.time, b]));
    chart.subscribeCrosshairMove(param => {
      const bar = param.time != null ? barsByTime.get(param.time as unknown as number) : undefined;
      setHoverBar(bar ?? bars[bars.length - 1]);
    });

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

    // --- Drawing tools (trend line / channel / box / fib / text note) -----
    // Read from refs rather than the `drawings`/`onDrawingsChange` props
    // directly so that editing a drawing doesn't force this whole effect
    // (and the chart it builds) to re-run — only the chart's own container
    // resizing or a genuinely new trade/timeframe should do that.
    const primitives = new Map<string, DrawingPrimitive>();
    for (const d of drawingsRef.current) {
      const p1: TrendLinePoint = { time: d.time1 as UTCTimestamp, price: d.price1 };
      const p2: TrendLinePoint = { time: d.time2 as UTCTimestamp, price: d.price2 };
      let prim: DrawingPrimitive;
      switch (d.type) {
        case 'channel': prim = new PriceChannelPrimitive(d.id, p1, p2, d.offset ?? 0, d.color ?? '#f59e0b'); break;
        case 'box': prim = new RectanglePrimitive(d.id, p1, p2, d.color ?? '#22c55e'); break;
        case 'fib': prim = new FibRetracementPrimitive(d.id, p1, p2, d.color ?? '#22d3ee'); break;
        case 'text': prim = new TextNotePrimitive(d.id, p1, d.text ?? '', d.color ?? '#f9fafb'); break;
        default: prim = new TrendLinePrimitive(d.id, p1, p2, d.color ?? '#6366f1'); break;
      }
      candleSeries.attachPrimitive(prim);
      primitives.set(d.id, prim);
    }

    const emitDrawings = () => {
      const next: ChartDrawing[] = Array.from(primitives.values()).map(prim => {
        if (prim instanceof PriceChannelPrimitive) {
          return { id: prim.id, type: 'channel', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, offset: prim.offset, color: prim.color };
        }
        if (prim instanceof RectanglePrimitive) {
          return { id: prim.id, type: 'box', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color };
        }
        if (prim instanceof FibRetracementPrimitive) {
          return { id: prim.id, type: 'fib', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color };
        }
        if (prim instanceof TextNotePrimitive) {
          return { id: prim.id, type: 'text', time1: prim.point.time as unknown as number, price1: prim.point.price, time2: 0, price2: 0, text: prim.text, color: prim.color };
        }
        return { id: prim.id, type: 'trendline', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color };
      });
      onDrawingsChangeRef.current(next);
    };

    const removePrimitive = (id: string) => {
      const prim = primitives.get(id);
      if (!prim) return;
      candleSeries.detachPrimitive(prim);
      primitives.delete(id);
    };

    const hitTest = (x: number, y: number): string | null => {
      let closestId: string | null = null;
      let closestDist = DRAWING_HIT_TOLERANCE_PX;
      primitives.forEach((prim, id) => {
        const d = prim.distanceToPoint(x, y);
        if (d < closestDist) { closestDist = d; closestId = id; }
      });
      return closestId;
    };

    let dragState: { primitive: TrendLinePrimitive | RectanglePrimitive | FibRetracementPrimitive | PriceChannelPrimitive; startX: number; startY: number } | null = null;
    let pendingChannel: PriceChannelPrimitive | null = null;
    let pendingTextAnchor: TrendLinePoint | null = null;

    const setInteractive = (interactive: boolean) => {
      chart.applyOptions({ handleScroll: interactive, handleScale: interactive });
    };

    const resetTool = () => {
      toolRef.current = 'none';
      setTool('none');
      setInteractive(true);
    };

    const cancelActive = () => {
      if (dragState) { removePrimitive(dragState.primitive.id); dragState = null; }
      if (pendingChannel) { removePrimitive(pendingChannel.id); pendingChannel = null; }
      pendingTextAnchor = null;
      setPendingText(null);
      resetTool();
    };
    cancelActiveRef.current = cancelActive;
    setInteractiveRef.current = setInteractive;
    clearAllRef.current = () => {
      primitives.forEach(prim => candleSeries.detachPrimitive(prim));
      primitives.clear();
      emitDrawings();
    };
    commitTextRef.current = (text: string) => {
      const anchor = pendingTextAnchor;
      pendingTextAnchor = null;
      setPendingText(null);
      if (!anchor || !text.trim()) { resetTool(); return; }
      const id = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const prim = new TextNotePrimitive(id, anchor, text.trim());
      candleSeries.attachPrimitive(prim);
      primitives.set(id, prim);
      resetTool();
      emitDrawings();
    };

    const toPixel = (e: MouseEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (pendingTextAnchor) return; // resolve the open text input first

      const { x, y } = toPixel(e);

      // Third click of a price channel: fix its width and commit.
      if (pendingChannel) {
        const time = chart.timeScale().coordinateToTime(x);
        const price = candleSeries.coordinateToPrice(y);
        if (time !== null && price !== null) {
          pendingChannel.setOffset(price - priceOnLineAtTime(pendingChannel.p1, pendingChannel.p2, time as unknown as number));
        }
        pendingChannel = null;
        resetTool();
        emitDrawings();
        return;
      }

      if (toolRef.current === 'none') {
        const hitId = hitTest(x, y);
        if (hitId) { removePrimitive(hitId); emitDrawings(); }
        return;
      }

      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time === null || price === null) return;
      const point: TrendLinePoint = { time, price };

      if (toolRef.current === 'text') {
        pendingTextAnchor = point;
        setPendingText({ x, y });
        return;
      }

      // Channel's first line is dragged exactly like a trend line — only
      // the second click (handled via pendingChannel, once this drag
      // finishes in handleMouseUp) is different.
      const id = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (toolRef.current === 'channel' || DRAG_TOOLS.includes(toolRef.current)) {
        const prim =
          toolRef.current === 'channel' ? new PriceChannelPrimitive(id, point, point, 0)
          : toolRef.current === 'box' ? new RectanglePrimitive(id, point, point)
          : toolRef.current === 'fib' ? new FibRetracementPrimitive(id, point, point)
          : new TrendLinePrimitive(id, point, point);
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        dragState = { primitive: prim, startX: x, startY: y };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = toPixel(e);
      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time === null || price === null) return;

      if (pendingChannel) {
        pendingChannel.setOffset(price - priceOnLineAtTime(pendingChannel.p1, pendingChannel.p2, time as unknown as number));
        return;
      }
      if (dragState) dragState.primitive.setPoint('p2', { time, price });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragState;
      dragState = null;
      if (!drag) return;
      const { x, y } = toPixel(e);
      const dragDistance = Math.hypot(x - drag.startX, y - drag.startY);
      if (dragDistance < 4) {
        // A click with no real drag — discard rather than keep a zero-size shape.
        removePrimitive(drag.primitive.id);
        return;
      }
      if (drag.primitive instanceof PriceChannelPrimitive) {
        // Main line is drawn — now wait for one more click to set the channel width.
        pendingChannel = drag.primitive;
        return;
      }
      resetTool();
      emitDrawings();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelActive();
    };

    const container = containerRef.current;
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    // Pin the visible range to exactly the bar count (index -0.5 to
    // length-0.5) rather than calling fitContent(), which re-derives bar
    // spacing from the container's width and — while the Trade Details
    // drawer is still sliding in — was compounding across several
    // ResizeObserver ticks into a visible range far wider than the actual
    // bar count (e.g. -81..39 for 40 bars), pushing most of the plotted
    // candles off to one side instead of spanning the width.
    const fitAllBars = () => {
      chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: bars.length - 0.5 });
    };
    // Calling this synchronously during the mount effect is unreliable —
    // the container hasn't necessarily been through a layout/paint pass yet
    // (again, the drawer's slide-in), so the chart's internal scale math
    // silently ignores the request. Deferring one frame is enough for it to
    // reliably stick; the ResizeObserver below (which only ever fires after
    // the chart already has a real layout) keeps it correct afterward.
    const initialFitFrame = requestAnimationFrame(fitAllBars);

    const resizeObserver = new ResizeObserver(fitAllBars);
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(initialFitFrame);
      resizeObserver.disconnect();
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      clearAllRef.current = null;
      cancelActiveRef.current = null;
      commitTextRef.current = null;
      setInteractiveRef.current = null;
      chart.remove();
    };
    // `market` (not just `source`) is a dependency because switching
    // timeframes can produce a new dataset while `source` stays 'market'
    // both before and after, which wouldn't otherwise trigger a redraw.
  }, [trade.id, isLoadingMarket, source, market]);

  // Toggling a drawing tool disables the chart's own pan/zoom handling —
  // otherwise dragging to draw a line also scrolls the chart underneath it.
  // Runs independently of the chart-build effect so switching tools never
  // rebuilds the chart; the mouse handlers inside that effect already read
  // `toolRef` live and only re-enable panning themselves once a drawing or
  // an Escape-cancel completes.
  useEffect(() => {
    setInteractiveRef.current?.(tool === 'none');
  }, [tool]);

  const caption =
    source === 'market'
      ? `Real ${market!.yahooSymbol} market data (${market!.interval} bars, delayed via Yahoo Finance) — for study, not live trading.`
      : source === 'fills'
      ? "Built from this trade's own execution fills — not a live market feed."
      : "No live market feed is wired up — this path is approximated between this trade's real entry and exit.";

  const handleToolClick = (t: DrawTool) => {
    cancelActiveRef.current?.();
    setTool(prev => (prev === t ? 'none' : t));
  };

  return (
    <div className="flex h-full flex-col space-y-2">
      <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
        {onTimeframeChange && (
          <div className="flex items-center gap-1">
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleToolClick('trendline')}
            title="Trend line"
            aria-label="Trend line"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'trendline' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('channel')}
            title="Price channel"
            aria-label="Price channel"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'channel' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Waves className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('box')}
            title="Rectangle"
            aria-label="Rectangle"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'box' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('fib')}
            title="Fibonacci retracement"
            aria-label="Fibonacci retracement"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'fib' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Percent className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('text')}
            title="Text note"
            aria-label="Text note"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'text' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Type className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            onClick={() => clearAllRef.current?.()}
            disabled={drawings.length === 0}
            title="Clear all drawings"
            aria-label="Clear all drawings"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground shrink-0">
        {isLoadingMarket ? 'Loading market data...' : drawHint ?? caption}
        {!isLoadingMarket && drawHint && ' (Esc to cancel)'}
      </div>
      {!isLoadingMarket && hoverBar && (
        <div className="flex items-center gap-3 text-[11px] font-mono shrink-0">
          {(() => {
            const up = hoverBar.close >= hoverBar.open;
            const barColor = up ? 'text-emerald-500' : 'text-rose-500';
            const fmt = (n: number) => n.toFixed(2);
            return (
              <>
                <span className="text-muted-foreground">
                  {new Date(hoverBar.time * 1000).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className={barColor}>O <span className="font-bold">{fmt(hoverBar.open)}</span></span>
                <span className={barColor}>H <span className="font-bold">{fmt(hoverBar.high)}</span></span>
                <span className={barColor}>L <span className="font-bold">{fmt(hoverBar.low)}</span></span>
                <span className={barColor}>C <span className="font-bold">{fmt(hoverBar.close)}</span></span>
                <span className="text-muted-foreground">Vol <span className="font-bold">{hoverBar.volume.toLocaleString()}</span></span>
              </>
            );
          })()}
        </div>
      )}
      {isLoadingMarket ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading market data...</div>
      ) : bars.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No fill data to chart.</div>
      ) : (
        <div className="relative w-full flex-1">
          <div ref={containerRef} className="w-full h-full" />
          {pendingText && (
            <input
              autoFocus
              type="text"
              placeholder="Note..."
              style={{ left: pendingText.x + 10, top: Math.max(0, pendingText.y - 14) }}
              className="absolute z-10 w-40 px-2 py-1 text-xs rounded-lg border border-primary bg-popover text-foreground shadow-lg focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTextRef.current?.((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') cancelActiveRef.current?.();
              }}
              onBlur={(e) => commitTextRef.current?.(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}
