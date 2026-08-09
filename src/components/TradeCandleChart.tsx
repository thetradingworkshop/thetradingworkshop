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
import { Pencil, Waves, Square, Percent, Type, Eraser, Settings2, Trash2, Minus, SeparatorVertical, ArrowUpRight, Ruler, CalendarRange, TrendingUp, TrendingDown } from 'lucide-react';
import { Trade, ChartDrawing } from '../types';
import { MarketBarsData } from '../hooks/useMarketBars';
import { cn } from '@/src/utils';
import { Modal, Button, Input } from './Shared';
import {
  TrendLinePrimitive,
  PriceChannelPrimitive,
  RectanglePrimitive,
  FibRetracementPrimitive,
  TextNotePrimitive,
  ArrowPrimitive,
  PriceRangePrimitive,
  TimeRangePrimitive,
  HorizontalLinePrimitive,
  VerticalLinePrimitive,
  PositionPrimitive,
  DRAWING_HIT_TOLERANCE_PX,
  priceOnLineAtTime,
  segmentDistance,
  TrendLinePoint,
  LineStyle,
  Extend,
  DrawingStylePatch,
} from '../lib/chartDrawingPrimitives';

// Snapshot of a selected drawing's editable properties, read by the
// properties panel when it opens and used to seed its form state.
interface DrawingProps {
  type: ChartDrawing['type'];
  color: string;
  lineStyle: LineStyle;
  extend: Extend;
  label: string; // the overlay label, or the text note's own content
  labelColor: string;
  labelSize: number;
  labelBold: boolean;
  p1: { time: number; price: number };
  p2: { time: number; price: number } | null; // null for text notes / hline / vline (single point)
  offset: number | null; // channel only
  direction: 'long' | 'short' | null; // position only
  targetOffset: number | null; // position only
  stopOffset: number | null; // position only
}

type DrawingPrimitive = TrendLinePrimitive | PriceChannelPrimitive | RectanglePrimitive | FibRetracementPrimitive | TextNotePrimitive
  | ArrowPrimitive | PriceRangePrimitive | TimeRangePrimitive | HorizontalLinePrimitive | VerticalLinePrimitive | PositionPrimitive;
type DrawTool = 'none' | 'trendline' | 'channel' | 'box' | 'fib' | 'text' | 'hline' | 'vline' | 'arrow' | 'pricerange' | 'timerange' | 'long' | 'short';
// Tools that are drawn with a single click-drag (start point on mousedown,
// end point on mouseup). 'channel'/'long'/'short' need a third click for
// their width and 'text' needs a click plus typed input, so those are
// handled separately. 'hline'/'vline' are a single click, no drag at all.
const DRAG_TOOLS: DrawTool[] = ['trendline', 'box', 'fib', 'arrow', 'pricerange', 'timerange'];
const POSITION_TOOLS: DrawTool[] = ['long', 'short'];

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

  // The currently-selected existing drawing (clicked while no tool is
  // active), purely to drive the hint text and the toolbar's delete
  // button — the chart-build effect below keeps its own live copy for
  // actual logic, since this state snapshot goes stale inside that
  // effect's closure.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deleteSelectedRef = useRef<(() => void) | null>(null);
  // Bridges for the properties panel (rendered outside the chart-build
  // effect's closure, where the live primitives actually are): read a
  // snapshot of the selected drawing to seed the panel's form, then push
  // Style/Text or Coordinates edits back in on Save.
  const getSelectedPropsRef = useRef<(() => DrawingProps | null) | null>(null);
  const applyStyleRef = useRef<((patch: DrawingStylePatch) => void) | null>(null);
  const applyCoordinatesRef = useRef<((p1: { time: number; price: number }, p2: { time: number; price: number } | null, offset: number | null) => void) | null>(null);
  const applyPositionRef = useRef<((direction: 'long' | 'short', targetOffset: number, stopOffset: number) => void) | null>(null);
  const commitPropertiesRef = useRef<(() => void) | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  // Deleting a selected drawing (Delete/Backspace or the toolbar's trash
  // icon) asks for confirmation first — mirrored into a ref since the
  // chart-build effect's keydown handler is a long-lived closure that
  // would otherwise only ever see this state's value from mount time.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const confirmDeleteOpenRef = useRef(false);
  useEffect(() => { confirmDeleteOpenRef.current = confirmDeleteOpen; }, [confirmDeleteOpen]);
  const [propTab, setPropTab] = useState<'style' | 'text' | 'coordinates'>('style');
  const [propForm, setPropForm] = useState<DrawingProps | null>(null);

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
    : tool === 'hline' ? 'Click to place a horizontal line.'
    : tool === 'vline' ? 'Click to place a vertical line.'
    : tool === 'arrow' ? 'Click-drag to draw an arrow.'
    : tool === 'pricerange' ? 'Click-drag to measure a price range.'
    : tool === 'timerange' ? 'Click-drag to measure a date/time range.'
    : tool === 'long' || tool === 'short' ? 'Click-drag for the entry/target zone, then click once more to set the stop-loss.'
    : null;
  const selectionHint = tool === 'none' && selectedId ? 'Drawing selected — drag a handle to edit, or use the toolbar to edit/delete it.' : null;

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
      const color = d.color ?? '#5a7d9f';
      const style: DrawingStylePatch = {
        lineStyle: d.lineStyle ?? 'solid',
        extend: d.extend ?? 'none',
        labelColor: d.labelColor ?? color,
        labelSize: d.labelSize ?? 12,
        labelBold: d.labelBold ?? false,
      };
      let prim: DrawingPrimitive;
      switch (d.type) {
        case 'channel': prim = new PriceChannelPrimitive(d.id, p1, p2, d.offset ?? 0, color, { ...style, label: d.text ?? '' }); break;
        case 'box': prim = new RectanglePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'fib': prim = new FibRetracementPrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'text': prim = new TextNotePrimitive(d.id, p1, d.text ?? '', color, d.labelSize ?? 11, d.labelBold ?? true); break;
        case 'arrow': prim = new ArrowPrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'pricerange': prim = new PriceRangePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'timerange': prim = new TimeRangePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'hline': prim = new HorizontalLinePrimitive(d.id, d.price1, color, { ...style, label: d.text ?? '' }); break;
        case 'vline': prim = new VerticalLinePrimitive(d.id, d.time1 as UTCTimestamp, color, { ...style, label: d.text ?? '' }); break;
        case 'position': prim = new PositionPrimitive(d.id, p1, p2, d.direction ?? 'long', d.targetOffset ?? 0, d.stopOffset ?? 0, color, { ...style, label: d.text ?? '' }); break;
        default: prim = new TrendLinePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
      }
      candleSeries.attachPrimitive(prim);
      primitives.set(d.id, prim);
    }

    // Firestore rejects a literal `undefined` anywhere in a write payload —
    // `text: someLabel || undefined` produces exactly that the moment a
    // drawing has no label, so build the optional `text` key by omission
    // instead of assignment.
    const withLabel = (base: Omit<ChartDrawing, 'text'>, label: string): ChartDrawing => (label ? { ...base, text: label } : base);

    const emitDrawings = () => {
      const next: ChartDrawing[] = Array.from(primitives.values()).map(prim => {
        if (prim instanceof PriceChannelPrimitive) {
          return withLabel({ id: prim.id, type: 'channel', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, offset: prim.offset, color: prim.color, lineStyle: prim.lineStyle, extend: prim.extend, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof PositionPrimitive) {
          return withLabel({ id: prim.id, type: 'position', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, direction: prim.direction, targetOffset: prim.targetOffset, stopOffset: prim.stopOffset, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof RectanglePrimitive) {
          return withLabel({ id: prim.id, type: 'box', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, extend: prim.extend, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof FibRetracementPrimitive) {
          return withLabel({ id: prim.id, type: 'fib', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof TextNotePrimitive) {
          return withLabel({ id: prim.id, type: 'text', time1: prim.point.time as unknown as number, price1: prim.point.price, time2: 0, price2: 0, color: prim.color, labelSize: prim.fontSize, labelBold: prim.bold }, prim.text);
        }
        if (prim instanceof ArrowPrimitive) {
          return withLabel({ id: prim.id, type: 'arrow', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof PriceRangePrimitive) {
          return withLabel({ id: prim.id, type: 'pricerange', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof TimeRangePrimitive) {
          return withLabel({ id: prim.id, type: 'timerange', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof HorizontalLinePrimitive) {
          return withLabel({ id: prim.id, type: 'hline', time1: 0, price1: prim.price, time2: 0, price2: 0, color: prim.color, lineStyle: prim.lineStyle, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof VerticalLinePrimitive) {
          return withLabel({ id: prim.id, type: 'vline', time1: prim.time as unknown as number, price1: 0, time2: 0, price2: 0, color: prim.color, lineStyle: prim.lineStyle, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        return withLabel({ id: prim.id, type: 'trendline', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, extend: prim.extend, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
      });
      onDrawingsChangeRef.current(next);
    };

    const removePrimitive = (id: string) => {
      const prim = primitives.get(id);
      if (!prim) return;
      candleSeries.detachPrimitive(prim);
      primitives.delete(id);
    };

    // What part of an existing drawing a mousedown in 'none' mode landed on:
    // an endpoint (resize), a channel's second line specifically (adjust its
    // width), the shape's body (move the whole thing), or a text note's
    // single anchor. Endpoints are checked with a slightly larger tolerance
    // than DRAWING_HIT_TOLERANCE_PX since they're a much smaller target than
    // the line/shape itself.
    type EditHandle = 'p1' | 'p2' | 'offset' | 'point' | 'body' | 'target' | 'stop';
    const HANDLE_HIT_TOLERANCE_PX = 10;

    const hitHandle = (x: number, y: number): { id: string; handle: EditHandle } | null => {
      let best: { id: string; handle: EditHandle } | null = null;
      let bestDist = HANDLE_HIT_TOLERANCE_PX;

      primitives.forEach((prim, id) => {
        if (prim instanceof TextNotePrimitive) {
          const d = prim.distanceToPoint(x, y);
          if (d <= DRAWING_HIT_TOLERANCE_PX && d < bestDist) { bestDist = d; best = { id, handle: 'point' }; }
          return;
        }

        // Single-parameter lines (a whole price level or a whole moment in
        // time) have no endpoints to grab — the entire line is the handle.
        if (prim instanceof HorizontalLinePrimitive || prim instanceof VerticalLinePrimitive) {
          const d = prim.distanceToPoint(x, y);
          if (d <= DRAWING_HIT_TOLERANCE_PX && d < bestDist) { bestDist = d; best = { id, handle: 'body' }; }
          return;
        }

        // An endpoint always wins over the body/offset line for this same
        // primitive, even when the body check below would report a smaller
        // raw distance — which it almost always does, since any point near
        // an endpoint is also practically sitting on the line itself (zero
        // width). Without this, a real drag anywhere but the exact endpoint
        // pixel would grab "move the whole shape" instead of "resize it".
        const p1d = Math.hypot((prim.p1Coord.x ?? Infinity) - x, (prim.p1Coord.y ?? Infinity) - y);
        const p2d = Math.hypot((prim.p2Coord.x ?? Infinity) - x, (prim.p2Coord.y ?? Infinity) - y);
        const nearestEndpointDist = Math.min(p1d, p2d);
        if (nearestEndpointDist <= HANDLE_HIT_TOLERANCE_PX) {
          if (nearestEndpointDist < bestDist) { bestDist = nearestEndpointDist; best = { id, handle: p1d <= p2d ? 'p1' : 'p2' }; }
          return;
        }

        if (prim instanceof PriceChannelPrimitive) {
          const dOffset = segmentDistance(prim.p1OffsetCoord.x, prim.p1OffsetCoord.y, prim.p2OffsetCoord.x, prim.p2OffsetCoord.y, x, y);
          if (dOffset <= DRAWING_HIT_TOLERANCE_PX && dOffset < bestDist) { bestDist = dOffset; best = { id, handle: 'offset' }; }
        }

        if (prim instanceof PositionPrimitive) {
          const midX = prim.p1Coord.x !== null && prim.p2Coord.x !== null ? (prim.p1Coord.x + prim.p2Coord.x) / 2 : null;
          if (midX !== null && prim.targetCoordY !== null) {
            const dTarget = Math.hypot(midX - x, prim.targetCoordY - y);
            if (dTarget <= HANDLE_HIT_TOLERANCE_PX && dTarget < bestDist) { bestDist = dTarget; best = { id, handle: 'target' }; }
          }
          if (midX !== null && prim.stopCoordY !== null) {
            const dStop = Math.hypot(midX - x, prim.stopCoordY - y);
            if (dStop <= HANDLE_HIT_TOLERANCE_PX && dStop < bestDist) { bestDist = dStop; best = { id, handle: 'stop' }; }
          }
        }

        const dBody = prim.distanceToPoint(x, y);
        if (dBody <= DRAWING_HIT_TOLERANCE_PX && dBody < bestDist) { bestDist = dBody; best = { id, handle: 'body' }; }
      });

      return best;
    };

    let dragState: { primitive: TrendLinePrimitive | RectanglePrimitive | FibRetracementPrimitive | PriceChannelPrimitive | ArrowPrimitive | PriceRangePrimitive | TimeRangePrimitive | PositionPrimitive; startX: number; startY: number } | null = null;
    let pendingChannel: PriceChannelPrimitive | null = null;
    let pendingPosition: PositionPrimitive | null = null;
    let pendingTextAnchor: TrendLinePoint | null = null;
    // An in-progress edit (resize/move) of an *existing* drawing, started by
    // a mousedown on one of its handles while no tool is active.
    let editState: {
      id: string;
      handle: EditHandle;
      startX: number;
      startY: number;
      startTime: number;
      startPrice: number;
      origP1: TrendLinePoint | null;
      origP2: TrendLinePoint | null;
      origOffset: number | null;
      origPoint: TrendLinePoint | null;
      origPrice: number | null; // horizontal line only
      origTime: number | null; // vertical line only
      origTargetOffset: number | null; // position only
      origStopOffset: number | null; // position only
    } | null = null;

    // The drawing currently selected by a plain click (no drag) in 'none'
    // mode — kept live here rather than read from React state, which would
    // be a stale snapshot from whenever this effect last ran.
    let activeSelection: string | null = null;
    const selectDrawing = (id: string | null) => {
      if (activeSelection === id) return;
      if (activeSelection) primitives.get(activeSelection)?.setSelected(false);
      activeSelection = id;
      if (id) primitives.get(id)?.setSelected(true);
      setSelectedId(id);
    };
    deleteSelectedRef.current = () => {
      if (!activeSelection) return;
      removePrimitive(activeSelection);
      selectDrawing(null);
      emitDrawings();
    };
    getSelectedPropsRef.current = (): DrawingProps | null => {
      if (!activeSelection) return null;
      const prim = primitives.get(activeSelection);
      if (!prim) return null;
      if (prim instanceof TextNotePrimitive) {
        return {
          type: 'text',
          color: prim.color,
          lineStyle: 'solid',
          extend: 'none',
          label: prim.text,
          labelColor: prim.color,
          labelSize: prim.fontSize,
          labelBold: prim.bold,
          p1: { time: prim.point.time as unknown as number, price: prim.point.price },
          p2: null,
          offset: null,
          direction: null,
          targetOffset: null,
          stopOffset: null,
        };
      }
      if (prim instanceof HorizontalLinePrimitive) {
        return {
          type: 'hline',
          color: prim.color,
          lineStyle: prim.lineStyle,
          extend: 'none',
          label: prim.label,
          labelColor: prim.labelColor,
          labelSize: prim.labelSize,
          labelBold: prim.labelBold,
          p1: { time: 0, price: prim.price },
          p2: null,
          offset: null,
          direction: null,
          targetOffset: null,
          stopOffset: null,
        };
      }
      if (prim instanceof VerticalLinePrimitive) {
        return {
          type: 'vline',
          color: prim.color,
          lineStyle: prim.lineStyle,
          extend: 'none',
          label: prim.label,
          labelColor: prim.labelColor,
          labelSize: prim.labelSize,
          labelBold: prim.labelBold,
          p1: { time: prim.time as unknown as number, price: 0 },
          p2: null,
          offset: null,
          direction: null,
          targetOffset: null,
          stopOffset: null,
        };
      }
      const type: ChartDrawing['type'] =
        prim instanceof PriceChannelPrimitive ? 'channel'
        : prim instanceof RectanglePrimitive ? 'box'
        : prim instanceof FibRetracementPrimitive ? 'fib'
        : prim instanceof ArrowPrimitive ? 'arrow'
        : prim instanceof PriceRangePrimitive ? 'pricerange'
        : prim instanceof TimeRangePrimitive ? 'timerange'
        : prim instanceof PositionPrimitive ? 'position'
        : 'trendline';
      return {
        type,
        color: prim.color,
        lineStyle: prim.lineStyle,
        extend: prim.extend,
        label: prim.label,
        labelColor: prim.labelColor,
        labelSize: prim.labelSize,
        labelBold: prim.labelBold,
        p1: { time: prim.p1.time as unknown as number, price: prim.p1.price },
        p2: { time: prim.p2.time as unknown as number, price: prim.p2.price },
        offset: prim instanceof PriceChannelPrimitive ? prim.offset : null,
        direction: prim instanceof PositionPrimitive ? prim.direction : null,
        targetOffset: prim instanceof PositionPrimitive ? prim.targetOffset : null,
        stopOffset: prim instanceof PositionPrimitive ? prim.stopOffset : null,
      };
    };
    // Style/Coordinates/Position each just mutate the primitive — none of
    // them persist on their own. The properties panel calls whichever of
    // these apply to the drawing it's editing, then commitPropertiesRef
    // exactly once at the end, so a single "Ok" click always produces one
    // Firestore write instead of two or three racing each other.
    applyStyleRef.current = (patch: DrawingStylePatch) => {
      if (!activeSelection) return;
      const prim = primitives.get(activeSelection);
      if (!prim) return;
      if (prim instanceof TextNotePrimitive) {
        prim.setStyle({ color: patch.color, text: patch.label, fontSize: patch.labelSize, bold: patch.labelBold });
      } else {
        prim.setStyle(patch);
      }
    };
    applyCoordinatesRef.current = (p1, p2, offset) => {
      if (!activeSelection) return;
      const prim = primitives.get(activeSelection);
      if (!prim) return;
      const point1: TrendLinePoint = { time: p1.time as UTCTimestamp, price: p1.price };
      if (prim instanceof TextNotePrimitive) {
        prim.setPoint(point1);
      } else if (prim instanceof HorizontalLinePrimitive) {
        prim.setPrice(p1.price);
      } else if (prim instanceof VerticalLinePrimitive) {
        prim.setTime(point1.time);
      } else if (p2) {
        const point2: TrendLinePoint = { time: p2.time as UTCTimestamp, price: p2.price };
        prim.setCoordinates(point1, point2);
        if (prim instanceof PriceChannelPrimitive && offset !== null) prim.setOffset(offset);
      }
    };
    applyPositionRef.current = (direction, targetOffset, stopOffset) => {
      if (!activeSelection) return;
      const prim = primitives.get(activeSelection);
      if (!(prim instanceof PositionPrimitive)) return;
      prim.direction = direction;
      prim.setTargetOffset(targetOffset);
      prim.setStopOffset(stopOffset);
    };
    commitPropertiesRef.current = () => emitDrawings();

    // Just the chart's own pan/zoom, with none of setInteractive's other
    // side effects — used to suspend panning for the duration of a single
    // drag (editing an existing drawing) without also clearing the
    // selection that drag is supposed to be acting on.
    const setChartPanZoom = (enabled: boolean) => {
      chart.applyOptions({ handleScroll: enabled, handleScale: enabled });
    };

    const setInteractive = (interactive: boolean) => {
      setChartPanZoom(interactive);
      // A draw tool just got selected — drop the leftover "move" hover
      // cursor from hovering an existing drawing beforehand, and any
      // selection (drawing a new shape isn't a reason to keep one selected).
      if (!interactive) {
        container.style.cursor = '';
        selectDrawing(null);
      }
    };

    const resetTool = () => {
      toolRef.current = 'none';
      setTool('none');
      setInteractive(true);
    };

    const cancelActive = () => {
      if (dragState) { removePrimitive(dragState.primitive.id); dragState = null; }
      if (pendingChannel) { removePrimitive(pendingChannel.id); pendingChannel = null; }
      if (pendingPosition) { removePrimitive(pendingPosition.id); pendingPosition = null; }
      if (editState) {
        // Put the drawing being edited back exactly how it was before this
        // drag started, rather than leaving it wherever the cursor happened
        // to be.
        const prim = primitives.get(editState.id);
        if (prim) {
          if (prim instanceof TextNotePrimitive) {
            if (editState.origPoint) prim.setPoint(editState.origPoint);
          } else if (prim instanceof HorizontalLinePrimitive) {
            if (editState.origPrice !== null) prim.setPrice(editState.origPrice);
          } else if (prim instanceof VerticalLinePrimitive) {
            if (editState.origTime !== null) prim.setTime(editState.origTime as UTCTimestamp);
          } else {
            if (editState.origP1) prim.setPoint('p1', editState.origP1);
            if (editState.origP2) prim.setPoint('p2', editState.origP2);
            if (prim instanceof PriceChannelPrimitive && editState.origOffset !== null) prim.setOffset(editState.origOffset);
            if (prim instanceof PositionPrimitive) {
              if (editState.origTargetOffset !== null) prim.setTargetOffset(editState.origTargetOffset);
              if (editState.origStopOffset !== null) prim.setStopOffset(editState.origStopOffset);
            }
          }
        }
        editState = null;
      }
      pendingTextAnchor = null;
      setPendingText(null);
      selectDrawing(null);
      resetTool();
    };
    cancelActiveRef.current = cancelActive;
    setInteractiveRef.current = setInteractive;
    clearAllRef.current = () => {
      primitives.forEach(prim => candleSeries.detachPrimitive(prim));
      primitives.clear();
      activeSelection = null;
      setSelectedId(null);
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

      // Without this, a real mouse drag over the canvas also kicks off the
      // browser's native text-selection drag (nothing on the chart itself is
      // selectable, but the gesture still highlights surrounding page text
      // and can interfere with our own drag tracking) — only synthetic,
      // programmatically-dispatched MouseEvents were exempt from this, which
      // is why it slipped past testing.
      if (pendingChannel || pendingPosition || toolRef.current !== 'none') e.preventDefault();

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

      // Third click of a long/short position: fix the stop-loss level and commit.
      if (pendingPosition) {
        const price = candleSeries.coordinateToPrice(y);
        if (price !== null) {
          const entry = pendingPosition.p1.price;
          pendingPosition.setStopOffset(pendingPosition.direction === 'long' ? entry - price : price - entry);
        }
        pendingPosition = null;
        resetTool();
        emitDrawings();
        return;
      }

      if (toolRef.current === 'none') {
        const hit = hitHandle(x, y);
        if (!hit) { selectDrawing(null); return; }
        e.preventDefault(); // about to drag an existing drawing — don't let this turn into a text selection either
        const prim = primitives.get(hit.id);
        if (!prim) return;
        const time = chart.timeScale().coordinateToTime(x);
        const price = candleSeries.coordinateToPrice(y);
        const hasPoints = !(prim instanceof TextNotePrimitive || prim instanceof HorizontalLinePrimitive || prim instanceof VerticalLinePrimitive);
        editState = {
          id: hit.id,
          handle: hit.handle,
          startX: x,
          startY: y,
          startTime: (time as unknown as number) ?? 0,
          startPrice: price ?? 0,
          origP1: hasPoints ? { ...prim.p1 } : null,
          origP2: hasPoints ? { ...prim.p2 } : null,
          origOffset: prim instanceof PriceChannelPrimitive ? prim.offset : null,
          origPoint: prim instanceof TextNotePrimitive ? { ...prim.point } : null,
          origPrice: prim instanceof HorizontalLinePrimitive ? prim.price : null,
          origTime: prim instanceof VerticalLinePrimitive ? (prim.time as unknown as number) : null,
          origTargetOffset: prim instanceof PositionPrimitive ? prim.targetOffset : null,
          origStopOffset: prim instanceof PositionPrimitive ? prim.stopOffset : null,
        };
        // Suspend the chart's own pan/zoom for the duration of this drag —
        // otherwise dragging a handle also scrolls the chart underneath it,
        // fighting the edit and making it impossible to land precisely.
        setChartPanZoom(false);
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

      // Single-click placement, no drag at all.
      const id = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (toolRef.current === 'hline') {
        const prim = new HorizontalLinePrimitive(id, price);
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        resetTool();
        emitDrawings();
        return;
      }
      if (toolRef.current === 'vline') {
        const prim = new VerticalLinePrimitive(id, time);
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        resetTool();
        emitDrawings();
        return;
      }

      // A long/short position's entry line is dragged exactly like a trend
      // line — the third click (handled via pendingPosition, once this drag
      // finishes in handleMouseUp) sets the stop-loss level.
      if (toolRef.current === 'long' || toolRef.current === 'short') {
        const prim = new PositionPrimitive(id, point, point, toolRef.current, 0, 0);
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        dragState = { primitive: prim, startX: x, startY: y };
        return;
      }

      // Channel's first line is dragged exactly like a trend line — only
      // the second click (handled via pendingChannel, once this drag
      // finishes in handleMouseUp) is different.
      if (toolRef.current === 'channel' || DRAG_TOOLS.includes(toolRef.current)) {
        const prim =
          toolRef.current === 'channel' ? new PriceChannelPrimitive(id, point, point, 0)
          : toolRef.current === 'box' ? new RectanglePrimitive(id, point, point)
          : toolRef.current === 'fib' ? new FibRetracementPrimitive(id, point, point)
          : toolRef.current === 'arrow' ? new ArrowPrimitive(id, point, point)
          : toolRef.current === 'pricerange' ? new PriceRangePrimitive(id, point, point)
          : toolRef.current === 'timerange' ? new TimeRangePrimitive(id, point, point)
          : new TrendLinePrimitive(id, point, point);
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        dragState = { primitive: prim, startX: x, startY: y };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (pendingChannel || dragState || editState) e.preventDefault();

      const { x, y } = toPixel(e);
      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time === null || price === null) return;

      if (pendingChannel) {
        pendingChannel.setOffset(price - priceOnLineAtTime(pendingChannel.p1, pendingChannel.p2, time as unknown as number));
        return;
      }
      if (dragState) {
        if (dragState.primitive instanceof PositionPrimitive) {
          // The entry line stays flat (p2.price === p1.price) — only the
          // time span extends with the drag; the vertical distance instead
          // sets the profit-zone height.
          const entry = dragState.primitive.p1.price;
          dragState.primitive.setPoint('p2', { time, price: entry });
          dragState.primitive.setTargetOffset(dragState.primitive.direction === 'long' ? price - entry : entry - price);
        } else {
          dragState.primitive.setPoint('p2', { time, price });
        }
        return;
      }

      if (editState) {
        const prim = primitives.get(editState.id);
        if (!prim) { editState = null; return; }
        const numericTime = time as unknown as number;
        const hasPoints = !(prim instanceof TextNotePrimitive || prim instanceof HorizontalLinePrimitive || prim instanceof VerticalLinePrimitive);
        if (editState.handle === 'point' && prim instanceof TextNotePrimitive) {
          prim.setPoint({ time, price });
        } else if (editState.handle === 'body' && prim instanceof HorizontalLinePrimitive) {
          prim.setPrice(price);
        } else if (editState.handle === 'body' && prim instanceof VerticalLinePrimitive) {
          prim.setTime(time);
        } else if (editState.handle === 'offset' && prim instanceof PriceChannelPrimitive) {
          prim.setOffset(price - priceOnLineAtTime(prim.p1, prim.p2, numericTime));
        } else if (editState.handle === 'target' && prim instanceof PositionPrimitive) {
          const entry = prim.p1.price;
          prim.setTargetOffset(prim.direction === 'long' ? price - entry : entry - price);
        } else if (editState.handle === 'stop' && prim instanceof PositionPrimitive) {
          const entry = prim.p1.price;
          prim.setStopOffset(prim.direction === 'long' ? entry - price : price - entry);
        } else if (editState.handle === 'p1' && hasPoints) {
          prim.setPoint('p1', { time, price });
        } else if (editState.handle === 'p2' && hasPoints) {
          prim.setPoint('p2', { time, price });
        } else if (editState.handle === 'body' && hasPoints && editState.origP1 && editState.origP2) {
          const deltaTime = numericTime - editState.startTime;
          const deltaPrice = price - editState.startPrice;
          const newP1: TrendLinePoint = { time: ((editState.origP1.time as unknown as number) + deltaTime) as UTCTimestamp, price: editState.origP1.price + deltaPrice };
          const newP2: TrendLinePoint = { time: ((editState.origP2.time as unknown as number) + deltaTime) as UTCTimestamp, price: editState.origP2.price + deltaPrice };
          prim.setPoint('p1', newP1);
          prim.setPoint('p2', newP2);
        }
        return;
      }

      // Idle hover, no tool active — show a grab cursor over anything
      // draggable so it's discoverable that existing drawings can be
      // adjusted, not just deleted with a plain click.
      if (toolRef.current === 'none') {
        container.style.cursor = hitHandle(x, y) ? 'move' : '';
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const edit = editState;
      editState = null;
      if (edit) {
        setChartPanZoom(true); // restore panning now that the drag is done
        const { x, y } = toPixel(e);
        const dragDistance = Math.hypot(x - edit.startX, y - edit.startY);
        if (dragDistance < 4) {
          // No real drag happened — select it instead of deleting. Delete/
          // Backspace (or the toolbar's trash icon) removes a selection;
          // dragging a handle edits it.
          selectDrawing(edit.id);
        } else {
          selectDrawing(edit.id);
          emitDrawings();
        }
        return;
      }

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
      if (drag.primitive instanceof PositionPrimitive) {
        // Entry line + profit zone are drawn — now wait for one more click to set the stop-loss level.
        pendingPosition = drag.primitive;
        return;
      }
      resetTool();
      emitDrawings();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteOpenRef.current) { setConfirmDeleteOpen(false); return; }
        cancelActive();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // This listener is on `window`, so it also sees Backspace while the
        // user is typing in an unrelated field (the verdict editor, entry
        // price, etc.) — only treat it as "delete the selected drawing"
        // when nothing editable currently has focus.
        const active = document.activeElement as HTMLElement | null;
        const isEditable = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (!isEditable && activeSelection) { e.preventDefault(); setConfirmDeleteOpen(true); }
      }
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
      deleteSelectedRef.current = null;
      getSelectedPropsRef.current = null;
      applyStyleRef.current = null;
      applyCoordinatesRef.current = null;
      applyPositionRef.current = null;
      commitPropertiesRef.current = null;
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

  const openProperties = () => {
    const props = getSelectedPropsRef.current?.();
    if (!props) return;
    setPropForm(props);
    setPropTab('style');
    setPropertiesOpen(true);
  };
  const saveProperties = () => {
    if (!propForm) return;
    applyStyleRef.current?.({
      color: propForm.color,
      lineStyle: propForm.lineStyle,
      extend: propForm.extend,
      label: propForm.label,
      labelColor: propForm.labelColor,
      labelSize: propForm.labelSize,
      labelBold: propForm.labelBold,
    });
    // A position's entry line is always flat — p2's price follows p1's
    // regardless of what (now-hidden) value it happened to carry.
    const p2ForSave = propForm.type === 'position' && propForm.p2 ? { ...propForm.p2, price: propForm.p1.price } : propForm.p2;
    applyCoordinatesRef.current?.(propForm.p1, p2ForSave, propForm.offset);
    if (propForm.type === 'position' && propForm.direction) {
      applyPositionRef.current?.(propForm.direction, propForm.targetOffset ?? 0, propForm.stopOffset ?? 0);
    }
    commitPropertiesRef.current?.();
    setPropertiesOpen(false);
  };
  const patchProp = <K extends keyof DrawingProps>(key: K, value: DrawingProps[K]) => {
    setPropForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  // datetime-local inputs work in local-time strings, not epoch seconds.
  const epochToLocalInput = (epochSeconds: number) => {
    const d = new Date(epochSeconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const localInputToEpoch = (value: string) => Math.floor(new Date(value).getTime() / 1000);

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
          <button
            onClick={() => handleToolClick('arrow')}
            title="Arrow"
            aria-label="Arrow"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'arrow' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('hline')}
            title="Horizontal line"
            aria-label="Horizontal line"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'hline' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('vline')}
            title="Vertical line"
            aria-label="Vertical line"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'vline' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <SeparatorVertical className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('pricerange')}
            title="Price range"
            aria-label="Price range"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'pricerange' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Ruler className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('timerange')}
            title="Date/time range"
            aria-label="Date/time range"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'timerange' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <CalendarRange className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('long')}
            title="Long position"
            aria-label="Long position"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'long' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <TrendingUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolClick('short')}
            title="Short position"
            aria-label="Short position"
            className={cn("p-1.5 rounded-lg transition-colors", tool === 'short' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <TrendingDown className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            onClick={openProperties}
            disabled={!selectedId}
            title="Edit selected drawing"
            aria-label="Edit selected drawing"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={!selectedId}
            title="Delete selected drawing"
            aria-label="Delete selected drawing"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Trash2 className="w-3.5 h-3.5" />
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
        {isLoadingMarket ? 'Loading market data...' : drawHint ?? selectionHint ?? caption}
        {!isLoadingMarket && drawHint && ' (Esc to cancel)'}
        {!isLoadingMarket && !drawHint && selectionHint && ' (Esc to deselect, Delete to remove)'}
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
          <div ref={containerRef} className="w-full h-full select-none" />
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
      <Modal
        isOpen={propertiesOpen}
        onClose={() => setPropertiesOpen(false)}
        title="Drawing properties"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPropertiesOpen(false)}>Cancel</Button>
            <Button onClick={saveProperties}>Ok</Button>
          </>
        }
      >
        {propForm && (
          <div className="space-y-5">
            <div className="flex items-center gap-1 border-b border-border/40 -mt-2 pb-3">
              {(['style', 'text', 'coordinates'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setPropTab(t)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors",
                    propTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {propTab === 'style' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={propForm.color}
                      onChange={e => patchProp('color', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                    <Input
                      value={propForm.color}
                      onChange={e => patchProp('color', e.target.value)}
                      className="h-9 flex-1 font-mono text-xs"
                    />
                  </div>
                </div>
                {propForm.type !== 'text' && propForm.type !== 'position' && (
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1.5">Line style</label>
                    <select
                      value={propForm.lineStyle}
                      onChange={e => patchProp('lineStyle', e.target.value as LineStyle)}
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </div>
                )}
                {(propForm.type === 'trendline' || propForm.type === 'channel' || propForm.type === 'box') && (
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1.5">Extend</label>
                    <select
                      value={propForm.extend}
                      onChange={e => patchProp('extend', e.target.value as Extend)}
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="none">Don't extend</option>
                      <option value="left">Extend left</option>
                      <option value="right">Extend right</option>
                      <option value="both">Extend both</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {propTab === 'text' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                    {propForm.type === 'text' ? 'Note text' : 'Label (optional, shown near the drawing)'}
                  </label>
                  <Input
                    value={propForm.label}
                    onChange={e => patchProp('label', e.target.value)}
                    placeholder={propForm.type === 'text' ? 'Note text' : 'e.g. Key resistance'}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">Text color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={propForm.labelColor}
                      onChange={e => patchProp('labelColor', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                    <Input
                      value={propForm.labelColor}
                      onChange={e => patchProp('labelColor', e.target.value)}
                      className="h-9 flex-1 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-muted-foreground mb-1.5">Size</label>
                    <Input
                      type="number"
                      min={8}
                      max={28}
                      value={propForm.labelSize}
                      onChange={e => patchProp('labelSize', Number(e.target.value) || 12)}
                      className="h-9"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm pt-5">
                    <input
                      type="checkbox"
                      checked={propForm.labelBold}
                      onChange={e => patchProp('labelBold', e.target.checked)}
                      className="rounded border-border"
                    />
                    Bold
                  </label>
                </div>
              </div>
            )}

            {propTab === 'coordinates' && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-bold text-muted-foreground mb-1.5">
                    {propForm.type === 'hline' ? 'Price' : propForm.type === 'vline' ? 'Time' : propForm.type === 'position' ? 'Entry price / start time' : 'Point 1 (price, time)'}
                  </div>
                  <div className="flex items-center gap-2">
                    {propForm.type !== 'vline' && (
                      <Input
                        type="number"
                        value={propForm.p1.price}
                        onChange={e => patchProp('p1', { ...propForm.p1, price: Number(e.target.value) })}
                        className="h-9 w-32"
                      />
                    )}
                    {propForm.type !== 'hline' && (
                      <Input
                        type="datetime-local"
                        step={1}
                        value={epochToLocalInput(propForm.p1.time)}
                        onChange={e => patchProp('p1', { ...propForm.p1, time: localInputToEpoch(e.target.value) })}
                        className="h-9 flex-1 text-xs"
                      />
                    )}
                  </div>
                </div>
                {propForm.p2 && (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground mb-1.5">
                      {propForm.type === 'position' ? 'End time' : 'Point 2 (price, time)'}
                    </div>
                    <div className="flex items-center gap-2">
                      {propForm.type !== 'position' && (
                        <Input
                          type="number"
                          value={propForm.p2.price}
                          onChange={e => patchProp('p2', propForm.p2 ? { ...propForm.p2, price: Number(e.target.value) } : propForm.p2)}
                          className="h-9 w-32"
                        />
                      )}
                      <Input
                        type="datetime-local"
                        step={1}
                        value={epochToLocalInput(propForm.p2.time)}
                        onChange={e => patchProp('p2', propForm.p2 ? { ...propForm.p2, time: localInputToEpoch(e.target.value) } : propForm.p2)}
                        className="h-9 flex-1 text-xs"
                      />
                    </div>
                  </div>
                )}
                {propForm.type === 'channel' && (
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground mb-1.5">Channel width (price offset)</label>
                    <Input
                      type="number"
                      value={propForm.offset ?? 0}
                      onChange={e => patchProp('offset', Number(e.target.value))}
                      className="h-9 w-32"
                    />
                  </div>
                )}
                {propForm.type === 'position' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground mb-1.5">Direction</label>
                      <select
                        value={propForm.direction ?? 'long'}
                        onChange={e => patchProp('direction', e.target.value as 'long' | 'short')}
                        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                      >
                        <option value="long">Long</option>
                        <option value="short">Short</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-emerald-500 mb-1.5">Target (price offset)</label>
                        <Input
                          type="number"
                          value={propForm.targetOffset ?? 0}
                          onChange={e => patchProp('targetOffset', Number(e.target.value))}
                          className="h-9"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-rose-500 mb-1.5">Stop (price offset)</label>
                        <Input
                          type="number"
                          value={propForm.stopOffset ?? 0}
                          onChange={e => patchProp('stopOffset', Number(e.target.value))}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete drawing?"
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { deleteSelectedRef.current?.(); setConfirmDeleteOpen(false); }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This removes the selected drawing from the chart. This can't be undone.</p>
      </Modal>
    </div>
  );
}
