import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  SeriesMarker,
  Time,
} from 'lightweight-charts';
import { Pencil, Waves, Square, Percent, Type, Eraser, Settings2, Settings, Trash2, Minus, SeparatorVertical, ArrowUpRight, Ruler, CalendarRange, TrendingUp, TrendingDown, Maximize2, Minimize2, Camera, ChevronDown, X as XIcon, History, SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { Trade, ChartDrawing, DrawingTemplate, DrawingTemplateStyle, ChartSettings } from '../types';
import { MarketBarsData } from '../hooks/useMarketBars';
import { cn } from '@/src/utils';
import { useAuth } from '../context/AuthContext';
import { subscribeDrawingTemplates, subscribeDrawingDefaults, saveDrawingTemplate, deleteDrawingTemplate, setDrawingDefault } from '../lib/drawingTemplates';
import { subscribeChartSettings, setChartSettings } from '../lib/chartSettings';
import { Modal, Button, Input, Toast } from './Shared';
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
  defaultChannelLevels,
  defaultFibLevels,
  TrendLinePoint,
  LineStyle,
  Extend,
  DrawingStylePatch,
  ChannelLevel,
  RiskMode,
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
  accountSize: number | null; // position only
  riskMode: RiskMode | null; // position only
  riskValue: number | null; // position only
  pointValue: number | null; // position only
  leverage: number | null; // position only
  lotSize: number | null; // position only
  qtyPrecision: number | null; // position only, null = default
  targetColor: string | null; // position only
  stopColor: string | null; // position only
  showPriceLabels: boolean | null; // position only
  levels: ChannelLevel[] | null; // channel only
  backgroundVisible: boolean | null; // channel only
  backgroundColor: string | null; // channel only
  backgroundOpacity: number | null; // channel only
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

// 'long'/'short' are two toolbar buttons for the same ChartDrawing type —
// templates and per-type "new drawing" defaults are keyed by the latter.
const drawingTypeForTool = (tool: DrawTool): ChartDrawing['type'] =>
  tool === 'long' || tool === 'short' ? 'position' : (tool as ChartDrawing['type']);

const DEFAULT_DRAWING_COLOR = '#5a7d9f';

// What "Apply defaults" resets a template back to, and what a brand-new
// drawing starts from when the user has never saved/applied a template for
// that type — i.e. this app's original, hardcoded look for each tool.
function hardcodedDefaultStyle(type: ChartDrawing['type']): DrawingTemplateStyle {
  const base: DrawingTemplateStyle = {
    color: DEFAULT_DRAWING_COLOR,
    lineStyle: 'solid',
    extend: 'none',
    labelColor: DEFAULT_DRAWING_COLOR,
    labelSize: type === 'text' ? 11 : 12,
    labelBold: type === 'text',
  };
  if (type === 'channel') return { ...base, levels: defaultChannelLevels(DEFAULT_DRAWING_COLOR), backgroundVisible: true, backgroundColor: DEFAULT_DRAWING_COLOR, backgroundOpacity: 0.12 };
  if (type === 'fib') return { ...base, levels: defaultFibLevels(DEFAULT_DRAWING_COLOR), backgroundVisible: true, backgroundColor: DEFAULT_DRAWING_COLOR, backgroundOpacity: 0.1 };
  if (type === 'position') return {
    ...base,
    targetColor: '#22c55e',
    stopColor: '#ef4444',
    showPriceLabels: true,
    accountSize: 10000,
    riskMode: 'usd',
    riskValue: 100,
    pointValue: 1,
    leverage: 1,
    lotSize: 1,
  };
  return base;
}

// The chart's own appearance — matches this app's original hardcoded look
// exactly (so nothing changes visually for anyone until they open Settings),
// except volumeVisible: the volume histogram is hidden by default for now.
const DEFAULT_CHART_SETTINGS: ChartSettings = {
  bodyUpColor: '#10b981',
  bodyDownColor: '#f43f5e',
  bordersVisible: false,
  borderUpColor: '#10b981',
  borderDownColor: '#f43f5e',
  wickVisible: true,
  wickUpColor: '#10b981',
  wickDownColor: '#f43f5e',
  background: '',
  vertGridVisible: true,
  horzGridVisible: true,
  volumeVisible: false,
};

// Applied both right after the chart/series are first built and again
// whenever the user's saved settings change — cheap `.applyOptions()` calls,
// no rebuild of the chart, its data, or the drawing primitives needed.
function applyChartSettings(chart: IChartApi, candleSeries: ISeriesApi<'Candlestick'>, volumeSeries: ISeriesApi<'Histogram'>, s: ChartSettings) {
  chart.applyOptions({
    layout: { background: { color: s.background || 'transparent' } },
    grid: {
      vertLines: { visible: s.vertGridVisible },
      horzLines: { visible: s.horzGridVisible },
    },
  });
  candleSeries.applyOptions({
    upColor: s.bodyUpColor,
    downColor: s.bodyDownColor,
    borderVisible: s.bordersVisible,
    borderUpColor: s.borderUpColor,
    borderDownColor: s.borderDownColor,
    wickVisible: s.wickVisible,
    wickUpColor: s.wickUpColor,
    wickDownColor: s.wickDownColor,
  });
  volumeSeries.applyOptions({ visible: s.volumeVisible });
}

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

// Same idea as nearestBarTime but returns the array index — bar replay
// slices `bars` up to (and including) an index, not a time.
function nearestBarIndex(bars: Bar[], epochSeconds: number): number {
  let closestIdx = 0;
  let bestDiff = Math.abs(bars[0].time - epochSeconds);
  for (let i = 1; i < bars.length; i++) {
    const diff = Math.abs(bars[i].time - epochSeconds);
    if (diff < bestDiff) { bestDiff = diff; closestIdx = i; }
  }
  return closestIdx;
}

// Shared by the initial chart build and every bar-replay step so both stay
// in sync on exactly how a Bar becomes chart data.
function toSeriesData(bars: Bar[]): { candleData: CandlestickData[]; volumeData: HistogramData[] } {
  return {
    candleData: bars.map(b => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })),
    volumeData: bars.map(b => ({
      time: b.time as UTCTimestamp,
      value: b.volume,
      color: b.close >= b.open ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)',
    })),
  };
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
  const applyPositionRef = useRef<((
    direction: 'long' | 'short',
    targetOffset: number,
    stopOffset: number,
    sizing: { accountSize: number; riskMode: RiskMode; riskValue: number; pointValue: number; leverage: number; lotSize: number },
    display: { targetColor: string; stopColor: string; showPriceLabels: boolean; qtyPrecision: number | undefined },
  ) => void) | null>(null);
  const applyChannelLevelsRef = useRef<((levels: ChannelLevel[], background: { visible: boolean; color: string; opacity: number }) => void) | null>(null);
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

  // Expanding the chart to fill the viewport, to work in it with more room.
  // Mirrored into a ref for the same reason as confirmDeleteOpen above —
  // the chart-build effect's keydown handler needs the live value.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
  const takeScreenshotRef = useRef<(() => HTMLCanvasElement | null) | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Drawing-tool style templates: saved templates (global to the account,
  // not just this trade's chart) and, per type, whichever template was most
  // recently saved/applied — read by the chart-build effect's "new drawing"
  // construction so freshly-drawn shapes start with the user's preferred
  // look instead of the hardcoded default.
  const { user } = useAuth();
  const [templates, setTemplates] = useState<DrawingTemplate[]>([]);
  const [drawingDefaults, setDrawingDefaults] = useState<Partial<Record<ChartDrawing['type'], DrawingTemplateStyle>>>({});
  const drawingDefaultsRef = useRef<Partial<Record<ChartDrawing['type'], DrawingTemplateStyle>>>({});
  useEffect(() => { drawingDefaultsRef.current = drawingDefaults; }, [drawingDefaults]);
  useEffect(() => {
    if (!user) { setTemplates([]); setDrawingDefaults({}); return; }
    const unsubTemplates = subscribeDrawingTemplates(user.uid, setTemplates);
    const unsubDefaults = subscribeDrawingDefaults(user.uid, setDrawingDefaults);
    return () => { unsubTemplates(); unsubDefaults(); };
  }, [user]);
  // Properties panel's "Template" control (Save as… / Apply defaults / a
  // saved template) — a small dropdown in the modal footer.
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templateSaveMode, setTemplateSaveMode] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');

  // The chart's own appearance (candle colors, canvas background/grid,
  // volume visibility) — global to the account, same as drawingDefaults.
  // Mirrored into a ref for the same reason as drawingDefaultsRef: the
  // chart-build effect reads it once at mount, and a separate lightweight
  // effect below re-applies it live (via .applyOptions(), no rebuild)
  // whenever it changes after that.
  const [chartSettings, setChartSettingsState] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);
  const chartSettingsRef = useRef<ChartSettings>(DEFAULT_CHART_SETTINGS);
  useEffect(() => { chartSettingsRef.current = chartSettings; }, [chartSettings]);
  useEffect(() => {
    if (!user) { setChartSettingsState(DEFAULT_CHART_SETTINGS); return; }
    return subscribeChartSettings(user.uid, saved => setChartSettingsState({ ...DEFAULT_CHART_SETTINGS, ...saved }));
  }, [user]);
  // Bridges for the live-apply effect (outside the chart-build effect's
  // closure) to reach the chart/series it built, mirroring takeScreenshotRef.
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  useEffect(() => {
    if (chartApiRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
      applyChartSettings(chartApiRef.current, candleSeriesRef.current, volumeSeriesRef.current, chartSettings);
    }
  }, [chartSettings]);
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const [chartSettingsTab, setChartSettingsTab] = useState<'candles' | 'canvas'>('candles');
  const [chartSettingsForm, setChartSettingsForm] = useState<ChartSettings>(DEFAULT_CHART_SETTINGS);

  // Bar replay: relive the trade bar-by-bar without seeing ahead. Picking
  // the start bar is a chart click, same shape as a drawing tool, so
  // replayPickingStart is mirrored into a ref for the same stale-closure
  // reason as toolRef — the chart-build effect's mousedown handler needs
  // the live value. Once replayActive, a separate effect below (not the
  // chart-build one) pushes replayIndex to the already-built candle/volume
  // series and markers plugin via their refs, so stepping through bars
  // never rebuilds the chart, drawings, or event handlers.
  const [replayPickingStart, setReplayPickingStart] = useState(false);
  const replayPickingStartRef = useRef(false);
  useEffect(() => { replayPickingStartRef.current = replayPickingStart; }, [replayPickingStart]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(600);
  // Read by the chart-build effect (which reruns on a timeframe switch,
  // since that swaps `market`) so it can rebuild the chart already
  // truncated to the replay position instead of showing the full,
  // un-replayed dataset — same stale-closure reasoning as toolRef.
  const replayActiveRef = useRef(false);
  useEffect(() => { replayActiveRef.current = replayActive; }, [replayActive]);
  // Tracks the *time* of the current replay bar, not just its index — a
  // timeframe switch can fetch a wildly different bar count (a few dozen
  // narrow intraday bars vs. thousands for a long top-down lookback), so
  // "index 14" means something completely different in the new dataset.
  // Re-finding the nearest bar to this same moment in time, rather than
  // reusing the raw index, is what keeps replay pointing at the same place
  // in the trade across a timeframe switch instead of jumping to an
  // unrelated point.
  const replayCutoffTimeRef = useRef<number | null>(null);
  useEffect(() => {
    replayCutoffTimeRef.current = replayIndex !== null ? bars[replayIndex]?.time ?? null : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayIndex]);
  const markersApiRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  const tradeMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    if (bars.length === 0) return [];
    const isLong = trade.direction === 'LONG';
    const entryEpoch = Math.floor(new Date(trade.entryTime).getTime() / 1000);
    const exitEpoch = Math.floor(new Date(trade.exitTime).getTime() / 1000);
    return [
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
    ];
    // `bars`/`trade` are recomputed fresh (new reference) on every render —
    // neither TradeCandleChart's props nor this file memoizes them — so
    // depending on them directly here would recompute this memo (and, worse,
    // re-run the effect below that depends on it) every render, not just
    // when the trade actually changes. trade.id/market/source is exactly
    // the dependency set the chart-build effect already trusts as "this
    // trade's actual bars changed", so mirror it here instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id, market, source]);

  // Pushes a replay step (or, once exited, the full dataset) to the
  // already-built series/markers via their refs — no chart rebuild. Only
  // depends on replayActive/replayIndex themselves: `bars`/`tradeMarkers`
  // are read from this render's closure, which is always current for "the
  // user stepped/played/exited" (the actual trigger for this effect).
  // Deliberately NOT depending on trade.id/market/source/bars/tradeMarkers
  // too — those change on a timeframe switch, which reruns the chart-build
  // effect instead (using replayActiveRef/replayIndexRef to rebuild
  // already-truncated); racing both effects over the same rebuild
  // previously either overwrote the fresh series with stale data or, via
  // `bars` being a fresh array reference every render, caused an infinite
  // render loop (this effect calls setHoverBar while replaying → re-render
  // → new `bars` reference → this effect re-fires → repeat).
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;
    const visibleBars = replayActive && replayIndex !== null ? bars.slice(0, replayIndex + 1) : bars;
    const { candleData, volumeData } = toSeriesData(visibleBars);
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    const cutoff = visibleBars[visibleBars.length - 1]?.time;
    markersApiRef.current?.setMarkers(cutoff === undefined ? tradeMarkers : tradeMarkers.filter(m => (m.time as unknown as number) <= cutoff));
    if (replayActive && visibleBars.length > 0) setHoverBar(visibleBars[visibleBars.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive, replayIndex]);

  // Auto-play: steps one bar every replaySpeedMs while playing, pausing
  // itself once it reaches the last bar.
  useEffect(() => {
    if (!replayPlaying || !replayActive || replayIndex === null) return;
    if (replayIndex >= bars.length - 1) { setReplayPlaying(false); return; }
    const timer = setTimeout(() => setReplayIndex(i => (i === null ? i : Math.min(i + 1, bars.length - 1))), replaySpeedMs);
    return () => clearTimeout(timer);
  }, [replayPlaying, replayActive, replayIndex, replaySpeedMs, bars.length]);

  // Switching to a different trade leaves this component mounted (no `key`
  // on it upstream) — replayIndex would otherwise carry over against a
  // completely different bar count. The refs are updated synchronously
  // (not just via their own mirroring effects, which only take effect next
  // render) so that if the chart-build effect also fires in this same
  // commit — which it always does on a new trade — it already sees "not
  // replaying" rather than the previous trade's stale replay position.
  useEffect(() => {
    replayActiveRef.current = false;
    replayCutoffTimeRef.current = null;
    setReplayActive(false);
    setReplayIndex(null);
    setReplayPlaying(false);
    setReplayPickingStart(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id]);

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
    replayPickingStart ? 'Click a bar to start the replay from.'
    : tool === 'trendline' ? 'Click-drag to draw a trend line.'
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
      layout: { textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(148,163,184,0.1)' }, horzLines: { color: 'rgba(148,163,184,0.1)' } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: true },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {});

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    // Candle colors / grid visibility / volume visibility all come from the
    // user's saved chart settings (or this app's hardcoded defaults) —
    // applied once here at build time, and again live by the effect below
    // whenever the settings themselves change.
    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    applyChartSettings(chart, candleSeries, volumeSeries, chartSettingsRef.current);

    // Switching timeframe mid-replay reruns this whole effect (it's keyed
    // on `market`, which a timeframe change replaces) — re-finding the bar
    // nearest replayCutoffTimeRef's *time* in this (possibly wildly
    // differently-sized) new `bars` array, rather than reusing the old
    // index or just loading the full dataset, is what keeps the user at
    // the same point in the trade instead of silently dumping them back on
    // the full, un-replayed chart or jumping to an unrelated bar count.
    let newReplayIndex: number | null = null;
    if (replayActiveRef.current && replayCutoffTimeRef.current !== null) {
      newReplayIndex = nearestBarIndex(bars, replayCutoffTimeRef.current);
      setReplayIndex(newReplayIndex);
    }
    const replayBars = newReplayIndex !== null ? bars.slice(0, newReplayIndex + 1) : bars;
    const { candleData, volumeData } = toSeriesData(replayBars);
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    setHoverBar(replayBars[replayBars.length - 1] ?? bars[bars.length - 1]);
    const barsByTime = new Map(bars.map(b => [b.time, b]));
    chart.subscribeCrosshairMove(param => {
      const bar = param.time != null ? barsByTime.get(param.time as unknown as number) : undefined;
      setHoverBar(bar ?? bars[bars.length - 1]);
    });

    // Entry/exit markers are recreated (not just re-set) here since this
    // whole effect reruns on a genuinely new trade/timeframe; bar replay
    // below re-filters this same `tradeMarkers` list live via .setMarkers()
    // as it steps through, without rebuilding the plugin.
    const replayCutoff = replayBars[replayBars.length - 1]?.time;
    markersApiRef.current = createSeriesMarkers(
      candleSeries,
      replayCutoff === undefined ? tradeMarkers : tradeMarkers.filter(m => (m.time as unknown as number) <= replayCutoff)
    );

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
        case 'channel': prim = new PriceChannelPrimitive(d.id, p1, p2, d.offset ?? 0, color, { ...style, label: d.text ?? '' }, d.levels, d.backgroundVisible !== undefined ? { visible: d.backgroundVisible, color: d.backgroundColor ?? color, opacity: d.backgroundOpacity ?? 0.12 } : undefined); break;
        case 'box': prim = new RectanglePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'fib': prim = new FibRetracementPrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }, d.levels, d.backgroundVisible !== undefined ? { visible: d.backgroundVisible, color: d.backgroundColor ?? color, opacity: d.backgroundOpacity ?? 0.1 } : undefined); break;
        case 'text': prim = new TextNotePrimitive(d.id, p1, d.text ?? '', color, d.labelSize ?? 11, d.labelBold ?? true); break;
        case 'arrow': prim = new ArrowPrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'pricerange': prim = new PriceRangePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'timerange': prim = new TimeRangePrimitive(d.id, p1, p2, color, { ...style, label: d.text ?? '' }); break;
        case 'hline': prim = new HorizontalLinePrimitive(d.id, d.price1, color, { ...style, label: d.text ?? '' }); break;
        case 'vline': prim = new VerticalLinePrimitive(d.id, d.time1 as UTCTimestamp, color, { ...style, label: d.text ?? '' }); break;
        case 'position': prim = new PositionPrimitive(d.id, p1, p2, d.direction ?? 'long', d.targetOffset ?? 0, d.stopOffset ?? 0, color, { ...style, label: d.text ?? '' },
          { accountSize: d.accountSize ?? 10000, riskMode: d.riskMode ?? 'usd', riskValue: d.riskValue ?? 100, pointValue: d.pointValue ?? 1, leverage: d.leverage ?? 1, lotSize: d.lotSize ?? 1 },
          { targetColor: d.targetColor ?? '#22c55e', stopColor: d.stopColor ?? '#ef4444', showPriceLabels: d.showPriceLabels ?? true, qtyPrecision: d.qtyPrecision },
        ); break;
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
          return withLabel({ id: prim.id, type: 'channel', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, offset: prim.offset, color: prim.color, lineStyle: prim.lineStyle, extend: prim.extend, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold, levels: prim.levels, backgroundVisible: prim.backgroundVisible, backgroundColor: prim.backgroundColor, backgroundOpacity: prim.backgroundOpacity }, prim.label);
        }
        if (prim instanceof PositionPrimitive) {
          // qtyPrecision is the one position field that's legitimately
          // undefined in the common case ("Default") — Firestore rejects a
          // literal `undefined` anywhere in a write, so it's spread in only
          // when actually set, same idiom as withLabel's `text` above.
          return withLabel({
            id: prim.id, type: 'position', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price,
            color: prim.color, direction: prim.direction, targetOffset: prim.targetOffset, stopOffset: prim.stopOffset,
            accountSize: prim.accountSize, riskMode: prim.riskMode, riskValue: prim.riskValue, pointValue: prim.pointValue, leverage: prim.leverage, lotSize: prim.lotSize,
            targetColor: prim.targetColor, stopColor: prim.stopColor, showPriceLabels: prim.showPriceLabels,
            labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold,
            ...(prim.qtyPrecision !== undefined ? { qtyPrecision: prim.qtyPrecision } : {}),
          }, prim.label);
        }
        if (prim instanceof RectanglePrimitive) {
          return withLabel({ id: prim.id, type: 'box', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, extend: prim.extend, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold }, prim.label);
        }
        if (prim instanceof FibRetracementPrimitive) {
          return withLabel({ id: prim.id, type: 'fib', time1: prim.p1.time as unknown as number, price1: prim.p1.price, time2: prim.p2.time as unknown as number, price2: prim.p2.price, color: prim.color, lineStyle: prim.lineStyle, labelColor: prim.labelColor, labelSize: prim.labelSize, labelBold: prim.labelBold, levels: prim.levels, backgroundVisible: prim.backgroundVisible, backgroundColor: prim.backgroundColor, backgroundOpacity: prim.backgroundOpacity }, prim.label);
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
          // Target/stop are hit-tested along their *entire* width, not a
          // single center pixel — this was the main reason the tool was
          // hard to adjust precisely, since missing that one pixel by a
          // couple of px would grab "move everything" (body) instead.
          //
          // Like the endpoint check above, a target/stop line match must
          // win outright and skip the body check below, not just compete
          // with it on raw distance — the box's own distanceToPoint()
          // returns exactly 0 for *any* point inside it (target line down
          // to stop line, full width), so without this a click even 1px
          // off the exact line row would always lose to "move everything"
          // regardless of how the two distances compare.
          const x1 = prim.p1Coord.x, x2 = prim.p2Coord.x;
          let targetDist = Infinity;
          let stopDist = Infinity;
          if (x1 !== null && x2 !== null && prim.targetCoordY !== null) {
            targetDist = segmentDistance(x1, prim.targetCoordY, x2, prim.targetCoordY, x, y);
          }
          if (x1 !== null && x2 !== null && prim.stopCoordY !== null) {
            stopDist = segmentDistance(x1, prim.stopCoordY, x2, prim.stopCoordY, x, y);
          }
          if (targetDist <= DRAWING_HIT_TOLERANCE_PX || stopDist <= DRAWING_HIT_TOLERANCE_PX) {
            const handle: EditHandle = targetDist <= stopDist ? 'target' : 'stop';
            const d = Math.min(targetDist, stopDist);
            if (d < bestDist) { bestDist = d; best = { id, handle }; }
            return;
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
          accountSize: null,
          riskMode: null,
          riskValue: null,
          pointValue: null,
          leverage: null,
          lotSize: null,
          qtyPrecision: null,
          targetColor: null,
          stopColor: null,
          showPriceLabels: null,
          levels: null,
          backgroundVisible: null,
          backgroundColor: null,
          backgroundOpacity: null,
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
          accountSize: null,
          riskMode: null,
          riskValue: null,
          pointValue: null,
          leverage: null,
          lotSize: null,
          qtyPrecision: null,
          targetColor: null,
          stopColor: null,
          showPriceLabels: null,
          levels: null,
          backgroundVisible: null,
          backgroundColor: null,
          backgroundOpacity: null,
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
          accountSize: null,
          riskMode: null,
          riskValue: null,
          pointValue: null,
          leverage: null,
          lotSize: null,
          qtyPrecision: null,
          targetColor: null,
          stopColor: null,
          showPriceLabels: null,
          levels: null,
          backgroundVisible: null,
          backgroundColor: null,
          backgroundOpacity: null,
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
        accountSize: prim instanceof PositionPrimitive ? prim.accountSize : null,
        riskMode: prim instanceof PositionPrimitive ? prim.riskMode : null,
        riskValue: prim instanceof PositionPrimitive ? prim.riskValue : null,
        pointValue: prim instanceof PositionPrimitive ? prim.pointValue : null,
        leverage: prim instanceof PositionPrimitive ? prim.leverage : null,
        lotSize: prim instanceof PositionPrimitive ? prim.lotSize : null,
        qtyPrecision: prim instanceof PositionPrimitive ? prim.qtyPrecision ?? null : null,
        targetColor: prim instanceof PositionPrimitive ? prim.targetColor : null,
        stopColor: prim instanceof PositionPrimitive ? prim.stopColor : null,
        showPriceLabels: prim instanceof PositionPrimitive ? prim.showPriceLabels : null,
        levels: prim instanceof PriceChannelPrimitive ? prim.levels : prim instanceof FibRetracementPrimitive ? prim.levels : null,
        backgroundVisible: prim instanceof PriceChannelPrimitive ? prim.backgroundVisible : prim instanceof FibRetracementPrimitive ? prim.backgroundVisible : null,
        backgroundColor: prim instanceof PriceChannelPrimitive ? prim.backgroundColor : prim instanceof FibRetracementPrimitive ? prim.backgroundColor : null,
        backgroundOpacity: prim instanceof PriceChannelPrimitive ? prim.backgroundOpacity : prim instanceof FibRetracementPrimitive ? prim.backgroundOpacity : null,
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
    applyPositionRef.current = (direction, targetOffset, stopOffset, sizing, display) => {
      if (!activeSelection) return;
      const prim = primitives.get(activeSelection);
      if (!(prim instanceof PositionPrimitive)) return;
      prim.direction = direction;
      prim.setTargetOffset(targetOffset);
      prim.setStopOffset(stopOffset);
      prim.setSizing(sizing.accountSize, sizing.riskMode, sizing.riskValue, sizing.pointValue, sizing.leverage, sizing.lotSize);
      prim.setDisplayOptions(display.targetColor, display.stopColor, display.showPriceLabels, display.qtyPrecision);
    };
    applyChannelLevelsRef.current = (levels, background) => {
      if (!activeSelection) return;
      const prim = primitives.get(activeSelection);
      if (prim instanceof PriceChannelPrimitive || prim instanceof FibRetracementPrimitive) {
        prim.setLevels(levels);
        prim.setBackground(background.visible, background.color, background.opacity);
      }
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
    // `addTopLayer: true` includes the drawing primitives in the capture,
    // not just the candles/volume — otherwise a "snapshot" would silently
    // drop every trend line, box, etc. the trade's been annotated with.
    takeScreenshotRef.current = () => chart.takeScreenshot(true, false);
    clearAllRef.current = () => {
      primitives.forEach(prim => candleSeries.detachPrimitive(prim));
      primitives.clear();
      activeSelection = null;
      setSelectedId(null);
      emitDrawings();
    };
    // A brand-new drawing starts from the user's saved template for that
    // type (drawingDefaultsRef, kept live via the mirroring effect above),
    // falling back to the app's original hardcoded look if they've never
    // saved/applied one.
    const newDrawingStyle = (type: ChartDrawing['type']): DrawingTemplateStyle =>
      drawingDefaultsRef.current[type] ?? hardcodedDefaultStyle(type);
    const newDrawingColor = (type: ChartDrawing['type']) => newDrawingStyle(type).color ?? DEFAULT_DRAWING_COLOR;
    const newDrawingPatch = (type: ChartDrawing['type']): DrawingStylePatch => {
      const s = newDrawingStyle(type);
      return { lineStyle: s.lineStyle, extend: s.extend, labelColor: s.labelColor, labelSize: s.labelSize, labelBold: s.labelBold };
    };
    const newDrawingBackground = (type: 'channel' | 'fib') => {
      const s = newDrawingStyle(type);
      if (s.backgroundVisible === undefined) return undefined;
      return { visible: s.backgroundVisible, color: s.backgroundColor ?? newDrawingColor(type), opacity: s.backgroundOpacity ?? (type === 'channel' ? 0.12 : 0.1) };
    };
    // A brand-new position also starts from the user's saved risk template
    // (account size / risk / leverage / lot size), not just its color —
    // same "saved default, falling back to hardcoded" pattern as every
    // other type's style.
    const newDrawingSizing = () => {
      const s = newDrawingStyle('position');
      return { accountSize: s.accountSize ?? 10000, riskMode: s.riskMode ?? 'usd', riskValue: s.riskValue ?? 100, pointValue: s.pointValue ?? 1, leverage: s.leverage ?? 1, lotSize: s.lotSize ?? 1 };
    };
    const newDrawingDisplay = () => {
      const s = newDrawingStyle('position');
      return { targetColor: s.targetColor ?? '#22c55e', stopColor: s.stopColor ?? '#ef4444', showPriceLabels: s.showPriceLabels ?? true, qtyPrecision: s.qtyPrecision };
    };

    commitTextRef.current = (text: string) => {
      const anchor = pendingTextAnchor;
      pendingTextAnchor = null;
      setPendingText(null);
      if (!anchor || !text.trim()) { resetTool(); return; }
      const id = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const textStyle = newDrawingStyle('text');
      const prim = new TextNotePrimitive(id, anchor, text.trim(), newDrawingColor('text'), textStyle.labelSize ?? 11, textStyle.labelBold ?? true);
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

      // Picking the bar replay starts from — takes over the click
      // regardless of whatever drawing tool might still be selected.
      if (replayPickingStartRef.current) {
        const { x } = toPixel(e);
        const time = chart.timeScale().coordinateToTime(x);
        if (time !== null) {
          setReplayIndex(nearestBarIndex(bars, time as unknown as number));
          setReplayActive(true);
        }
        setReplayPickingStart(false);
        return;
      }

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
        const prim = new HorizontalLinePrimitive(id, price, newDrawingColor('hline'), newDrawingPatch('hline'));
        candleSeries.attachPrimitive(prim);
        primitives.set(id, prim);
        resetTool();
        emitDrawings();
        return;
      }
      if (toolRef.current === 'vline') {
        const prim = new VerticalLinePrimitive(id, time, newDrawingColor('vline'), newDrawingPatch('vline'));
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
        const prim = new PositionPrimitive(id, point, point, toolRef.current, 0, 0, newDrawingColor('position'), newDrawingPatch('position'), newDrawingSizing(), newDrawingDisplay());
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
          toolRef.current === 'channel' ? new PriceChannelPrimitive(id, point, point, 0, newDrawingColor('channel'), newDrawingPatch('channel'), newDrawingStyle('channel').levels, newDrawingBackground('channel'))
          : toolRef.current === 'box' ? new RectanglePrimitive(id, point, point, newDrawingColor('box'), newDrawingPatch('box'))
          : toolRef.current === 'fib' ? new FibRetracementPrimitive(id, point, point, newDrawingColor('fib'), newDrawingPatch('fib'), newDrawingStyle('fib').levels, newDrawingBackground('fib'))
          : toolRef.current === 'arrow' ? new ArrowPrimitive(id, point, point, newDrawingColor('arrow'), newDrawingPatch('arrow'))
          : toolRef.current === 'pricerange' ? new PriceRangePrimitive(id, point, point, newDrawingColor('pricerange'), newDrawingPatch('pricerange'))
          : toolRef.current === 'timerange' ? new TimeRangePrimitive(id, point, point, newDrawingColor('timerange'), newDrawingPatch('timerange'))
          : new TrendLinePrimitive(id, point, point, newDrawingColor('trendline'), newDrawingPatch('trendline'));
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
      if (pendingPosition) {
        // Live-follow the stop line with the cursor while waiting for the
        // third click, exactly like pendingChannel does for its offset line
        // above — without this the stop level never visibly moves after the
        // target drag is released, so there's no way to see or aim it
        // before the next click silently commits whatever it happens to hit.
        const entry = pendingPosition.p1.price;
        pendingPosition.setStopOffset(pendingPosition.direction === 'long' ? entry - price : price - entry);
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
        } else if ((editState.handle === 'p1' || editState.handle === 'p2') && prim instanceof PositionPrimitive) {
          // The entry line is always flat — grabbing either end only resizes
          // the position's time span, it never drags the entry price (that's
          // what dragging inside the box, the 'body' handle, is for).
          prim.setPoint(editState.handle, { time, price: prim.p1.price });
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
        if (replayPickingStartRef.current) { setReplayPickingStart(false); return; }
        if (isFullscreenRef.current) { setIsFullscreen(false); return; }
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
    //
    // A named timeframe (5m/15m/1h/1d/w) fetches weeks of *context* data
    // around the trade, not just the trade's own narrow window (server.ts
    // widens period1/period2 to guarantee the trade's own candles are
    // actually in the response, regardless of how old the trade is) — so
    // fitting *all* of those bars into view by default would cram the
    // trade's own candles, markers, and any drawing on them down to a
    // sub-pixel sliver on one edge. Default the view to bracket the trade's
    // own entry/exit *and* every saved drawing's own time span instead — a
    // drawing is very often placed somewhere other than exactly on the
    // trade's own candles (marking a level from earlier/later context) —
    // with padding on each side; "Auto" keeps looking the same as before
    // since its fetch window already ~= the trade's own span.
    //
    // The padding itself has to be a fixed amount of real *time*, not a bar
    // count — the previous version padded by a fraction of the trade's own
    // bar-index span, which on a coarse interval (e.g. 15m, where a 30-min
    // trade is only ~2 bars apart) came out to tens of minutes of padding,
    // but the exact same formula on a fine interval (e.g. 1m, where that
    // same trade is ~30 bars apart) came out to only a few minutes. A
    // drawing placed comfortably inside the 15m view's padding could sit
    // clean outside the 1m view's much stingier one — which is exactly why
    // a position drawn while looking at 15m could vanish on switching to 1m.
    const entryEpoch = Math.floor(new Date(trade.entryTime).getTime() / 1000);
    const exitEpoch = Math.floor(new Date(trade.exitTime).getTime() / 1000);
    const spanEpochs = [entryEpoch, exitEpoch];
    for (const d of drawingsRef.current) {
      spanEpochs.push(Math.floor(d.time1), Math.floor(d.time2));
    }
    const minEpoch = Math.min(...spanEpochs);
    const maxEpoch = Math.max(...spanEpochs);
    const padSeconds = Math.max(30 * 60, (maxEpoch - minEpoch) * 0.5);
    const minIdx = nearestBarIndex(bars, minEpoch - padSeconds);
    const maxIdx = nearestBarIndex(bars, maxEpoch + padSeconds);
    const defaultFrom = Math.max(-0.5, Math.min(minIdx, maxIdx) - 0.5);
    const defaultTo = Math.min(bars.length - 0.5, Math.max(minIdx, maxIdx) + 0.5);
    const fitAllBars = () => {
      chart.timeScale().setVisibleLogicalRange({ from: defaultFrom, to: defaultTo });
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
      applyChannelLevelsRef.current = null;
      commitPropertiesRef.current = null;
      takeScreenshotRef.current = null;
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersApiRef.current = null;
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

  const startReplayPicking = () => {
    cancelActiveRef.current?.();
    setTool('none');
    setReplayPickingStart(true);
  };
  const exitReplay = () => {
    setReplayActive(false);
    setReplayIndex(null);
    setReplayPlaying(false);
    setReplayPickingStart(false);
  };
  const stepReplay = (delta: number) => {
    setReplayIndex(i => (i === null ? i : Math.max(0, Math.min(bars.length - 1, i + delta))));
  };

  const handleCopyImage = () => {
    const canvas = takeScreenshotRef.current?.();
    if (!canvas) { setToast({ message: 'Chart is not ready yet.', type: 'error' }); return; }
    // clipboard.write() must be called synchronously inside the click
    // handler to be recognized as a trusted user gesture — awaiting
    // canvas.toBlob()'s callback first (it's async) loses that and the
    // browser silently denies the write. Passing a Blob *promise* as the
    // ClipboardItem's value instead keeps the write call itself synchronous
    // while still letting the PNG encode happen in the background.
    const blobPromise = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png');
    });
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => setToast({ message: 'Chart image copied — paste it (Ctrl/Cmd+V) into Notes to attach it.', type: 'success' }))
      .catch(() => setToast({ message: "Couldn't copy the image — your browser may not support clipboard images.", type: 'error' }));
  };

  const openProperties = () => {
    const props = getSelectedPropsRef.current?.();
    if (!props) return;
    setPropForm(props);
    setPropTab('style');
    setPropertiesOpen(true);
    setTemplateMenuOpen(false);
    setTemplateSaveMode(false);
    setTemplateNameInput('');
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
      applyPositionRef.current?.(propForm.direction, propForm.targetOffset ?? 0, propForm.stopOffset ?? 0, {
        accountSize: propForm.accountSize ?? 10000,
        riskMode: propForm.riskMode ?? 'usd',
        riskValue: propForm.riskValue ?? 100,
        pointValue: propForm.pointValue ?? 1,
        leverage: propForm.leverage ?? 1,
        lotSize: propForm.lotSize ?? 1,
      }, {
        targetColor: propForm.targetColor ?? '#22c55e',
        stopColor: propForm.stopColor ?? '#ef4444',
        showPriceLabels: propForm.showPriceLabels ?? true,
        qtyPrecision: propForm.qtyPrecision ?? undefined,
      });
    }
    if ((propForm.type === 'channel' || propForm.type === 'fib') && propForm.levels) {
      applyChannelLevelsRef.current?.(propForm.levels, {
        visible: propForm.backgroundVisible ?? true,
        color: propForm.backgroundColor ?? propForm.color,
        opacity: propForm.backgroundOpacity ?? (propForm.type === 'channel' ? 0.12 : 0.1),
      });
    }
    commitPropertiesRef.current?.();
    setPropertiesOpen(false);
  };
  const patchProp = <K extends keyof DrawingProps>(key: K, value: DrawingProps[K]) => {
    setPropForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };
  const patchChannelLevel = (index: number, patch: Partial<ChannelLevel>) => {
    setPropForm(prev => {
      if (!prev || !prev.levels) return prev;
      const levels = prev.levels.map((l, i) => (i === index ? { ...l, ...patch } : l));
      return { ...prev, levels };
    });
  };

  // Just the appearance fields of the open form — what gets saved as a
  // template and what's compared against when deciding a new drawing's
  // starting look. Deliberately excludes coordinates/label text/the
  // position's own target-stop *offsets* (a saved "50pt stop" wouldn't mean
  // the same thing on a different symbol) — but for type 'position' does
  // include the risk-sizing inputs and target/stop colors, since a risk
  // profile ("1% risk, 10x leverage") is exactly what's worth saving.
  const extractStyleFromForm = (form: DrawingProps): DrawingTemplateStyle => ({
    color: form.color,
    lineStyle: form.lineStyle,
    extend: form.extend,
    labelColor: form.labelColor,
    labelSize: form.labelSize,
    labelBold: form.labelBold,
    ...(form.levels ? { levels: form.levels } : {}),
    ...(form.backgroundVisible !== null ? { backgroundVisible: form.backgroundVisible } : {}),
    ...(form.backgroundColor !== null ? { backgroundColor: form.backgroundColor } : {}),
    ...(form.backgroundOpacity !== null ? { backgroundOpacity: form.backgroundOpacity } : {}),
    // Firestore rejects a literal `undefined` anywhere in a write payload —
    // each field below is omitted entirely (not set to undefined) when the
    // form doesn't have a value for it, same as the background fields above.
    ...(form.type === 'position' && form.accountSize !== null ? { accountSize: form.accountSize } : {}),
    ...(form.type === 'position' && form.riskMode !== null ? { riskMode: form.riskMode } : {}),
    ...(form.type === 'position' && form.riskValue !== null ? { riskValue: form.riskValue } : {}),
    ...(form.type === 'position' && form.pointValue !== null ? { pointValue: form.pointValue } : {}),
    ...(form.type === 'position' && form.leverage !== null ? { leverage: form.leverage } : {}),
    ...(form.type === 'position' && form.lotSize !== null ? { lotSize: form.lotSize } : {}),
    ...(form.type === 'position' && form.qtyPrecision !== null ? { qtyPrecision: form.qtyPrecision } : {}),
    ...(form.type === 'position' && form.targetColor !== null ? { targetColor: form.targetColor } : {}),
    ...(form.type === 'position' && form.stopColor !== null ? { stopColor: form.stopColor } : {}),
    ...(form.type === 'position' && form.showPriceLabels !== null ? { showPriceLabels: form.showPriceLabels } : {}),
  });
  const applyStyleToForm = (style: DrawingTemplateStyle) => {
    setPropForm(prev => prev ? {
      ...prev,
      color: style.color ?? prev.color,
      lineStyle: style.lineStyle ?? prev.lineStyle,
      extend: style.extend ?? prev.extend,
      labelColor: style.labelColor ?? prev.labelColor,
      labelSize: style.labelSize ?? prev.labelSize,
      labelBold: style.labelBold ?? prev.labelBold,
      levels: style.levels ?? prev.levels,
      backgroundVisible: style.backgroundVisible ?? prev.backgroundVisible,
      backgroundColor: style.backgroundColor ?? prev.backgroundColor,
      backgroundOpacity: style.backgroundOpacity ?? prev.backgroundOpacity,
      ...(prev.type === 'position' ? {
        accountSize: style.accountSize ?? prev.accountSize,
        riskMode: style.riskMode ?? prev.riskMode,
        riskValue: style.riskValue ?? prev.riskValue,
        pointValue: style.pointValue ?? prev.pointValue,
        leverage: style.leverage ?? prev.leverage,
        lotSize: style.lotSize ?? prev.lotSize,
        qtyPrecision: style.qtyPrecision ?? prev.qtyPrecision,
        targetColor: style.targetColor ?? prev.targetColor,
        stopColor: style.stopColor ?? prev.stopColor,
        showPriceLabels: style.showPriceLabels ?? prev.showPriceLabels,
      } : {}),
    } : prev);
  };
  const handleApplyDefaults = () => {
    if (!propForm) return;
    applyStyleToForm(hardcodedDefaultStyle(propForm.type));
    if (user) setDrawingDefault(user.uid, propForm.type, null);
    setTemplateMenuOpen(false);
  };
  const handleApplyTemplate = (tpl: DrawingTemplate) => {
    applyStyleToForm(tpl.style);
    if (user) setDrawingDefault(user.uid, tpl.type, tpl.style);
    setTemplateMenuOpen(false);
  };
  const handleSaveTemplate = async () => {
    if (!propForm || !user || !templateNameInput.trim()) return;
    const style = extractStyleFromForm(propForm);
    await saveDrawingTemplate(user.uid, propForm.type, templateNameInput.trim(), style);
    await setDrawingDefault(user.uid, propForm.type, style);
    setTemplateNameInput('');
    setTemplateSaveMode(false);
    setTemplateMenuOpen(false);
  };
  const handleDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteDrawingTemplate(id);
  };

  const openChartSettings = () => {
    setChartSettingsForm(chartSettings);
    setChartSettingsTab('candles');
    setChartSettingsOpen(true);
  };
  const patchChartSettings = <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => {
    setChartSettingsForm(prev => ({ ...prev, [key]: value }));
  };
  const saveChartSettings = () => {
    if (user) setChartSettings(user.uid, chartSettingsForm);
    setChartSettingsOpen(false);
  };

  // datetime-local inputs work in local-time strings, not epoch seconds.
  const epochToLocalInput = (epochSeconds: number) => {
    const d = new Date(epochSeconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const localInputToEpoch = (value: string) => Math.floor(new Date(value).getTime() / 1000);

  return (
    <div className={cn(
      "flex h-full flex-col space-y-2",
      isFullscreen && "fixed inset-0 z-[100] bg-background p-4 h-screen"
    )}>
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
          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            onClick={() => (replayActive || replayPickingStart ? exitReplay() : startReplayPicking())}
            title={replayActive || replayPickingStart ? 'Exit replay' : 'Bar replay'}
            aria-label={replayActive || replayPickingStart ? 'Exit replay' : 'Bar replay'}
            className={cn("p-1.5 rounded-lg transition-colors", (replayPickingStart || replayActive) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            <History className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-0.5" />
          <button
            onClick={openChartSettings}
            title="Chart settings"
            aria-label="Chart settings"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCopyImage}
            title="Copy chart image"
            aria-label="Copy chart image"
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(v => !v)}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
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
          {replayActive && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border bg-popover shadow-2xl">
              <button
                onClick={exitReplay}
                title="Exit replay"
                aria-label="Exit replay"
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-500 transition-colors"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <button
                onClick={() => stepReplay(-1)}
                disabled={replayIndex === 0}
                title="Step back"
                aria-label="Step back"
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setReplayPlaying(p => !p)}
                disabled={!replayPlaying && replayIndex !== null && replayIndex >= bars.length - 1}
                title={replayPlaying ? 'Pause' : 'Play'}
                aria-label={replayPlaying ? 'Pause' : 'Play'}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
              >
                {replayPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => stepReplay(1)}
                disabled={replayIndex !== null && replayIndex >= bars.length - 1}
                title="Step forward"
                aria-label="Step forward"
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <select
                value={replaySpeedMs}
                onChange={e => setReplaySpeedMs(Number(e.target.value))}
                title="Playback speed"
                className="h-7 rounded-lg border border-border bg-background px-1.5 text-xs"
              >
                <option value={1200}>0.5x</option>
                <option value={600}>1x</option>
                <option value={300}>2x</option>
                <option value={120}>4x</option>
              </select>
              <span className="text-[11px] font-mono text-muted-foreground px-1 tabular-nums">
                {replayIndex !== null ? replayIndex + 1 : 0}/{bars.length}
              </span>
            </div>
          )}
        </div>
      )}
      <Modal
        isOpen={propertiesOpen}
        onClose={() => { setPropertiesOpen(false); setTemplateMenuOpen(false); setTemplateSaveMode(false); }}
        title="Drawing properties"
        maxWidth="sm"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setTemplateMenuOpen(o => !o)}>
                Template <ChevronDown className="w-3.5 h-3.5 ml-1" />
              </Button>
              {templateMenuOpen && propForm && (
                <>
                  <div className="fixed inset-0 z-[105]" onClick={() => { setTemplateMenuOpen(false); setTemplateSaveMode(false); }} />
                  <div className="absolute bottom-full left-0 mb-2 w-60 rounded-xl border border-border bg-popover shadow-2xl z-[110] overflow-hidden">
                    {templateSaveMode ? (
                      <div className="p-2 flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={templateNameInput}
                          onChange={e => setTemplateNameInput(e.target.value)}
                          placeholder="Template name"
                          className="h-8 flex-1 text-xs"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveTemplate();
                            if (e.key === 'Escape') setTemplateSaveMode(false);
                          }}
                        />
                        <Button size="sm" onClick={handleSaveTemplate} disabled={!templateNameInput.trim()}>Save</Button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => setTemplateSaveMode(true)} className="w-full text-left px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                          Save as…
                        </button>
                        <button onClick={handleApplyDefaults} className="w-full text-left px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                          Apply defaults
                        </button>
                        {templates.filter(t => t.type === propForm.type).length > 0 && (
                          <div className="border-t border-border/40 max-h-48 overflow-y-auto">
                            {templates.filter(t => t.type === propForm.type).map(tpl => (
                              <div
                                key={tpl.id}
                                onClick={() => handleApplyTemplate(tpl)}
                                className="group flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer"
                              >
                                <span className="truncate">{tpl.name}</span>
                                <button
                                  onClick={e => handleDeleteTemplate(e, tpl.id)}
                                  className="shrink-0 ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-500 transition-all"
                                  title="Delete template"
                                >
                                  <XIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setPropertiesOpen(false)}>Cancel</Button>
              <Button onClick={saveProperties}>Ok</Button>
            </div>
          </div>
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

            {propTab === 'style' && (propForm.type === 'channel' || propForm.type === 'fib') && propForm.levels && (
              <div className="space-y-4">
                {propForm.type === 'channel' && (
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
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">Levels</label>
                  <div className="space-y-1.5">
                    {propForm.levels.map((lvl, i) => {
                      // A channel's own boundary (ratio 0/1) is always shown —
                      // everything else, and every fib ratio, is optional.
                      const isBoundary = propForm.type === 'channel' && (lvl.ratio === 0 || lvl.ratio === 1);
                      const ratioLabel = propForm.type === 'fib' ? `${(lvl.ratio * 100).toFixed(1)}%` : String(lvl.ratio);
                      return (
                        <div key={lvl.ratio} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={lvl.visible}
                            disabled={isBoundary}
                            onChange={e => patchChannelLevel(i, { visible: e.target.checked })}
                            className="rounded border-border shrink-0 disabled:opacity-40"
                            title={isBoundary ? "The channel's own boundary line is always shown" : 'Show this level'}
                          />
                          <span className="w-12 shrink-0 text-xs font-mono text-muted-foreground">{ratioLabel}</span>
                          <input
                            type="color"
                            value={lvl.color}
                            onChange={e => patchChannelLevel(i, { color: e.target.value })}
                            className="h-7 w-8 shrink-0 rounded border border-border bg-background cursor-pointer"
                          />
                          <select
                            value={lvl.lineStyle}
                            onChange={e => patchChannelLevel(i, { lineStyle: e.target.value as LineStyle })}
                            className="h-7 flex-1 min-w-0 rounded border border-border bg-background px-1.5 text-xs"
                          >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                          </select>
                          <select
                            value={lvl.lineWidth}
                            onChange={e => patchChannelLevel(i, { lineWidth: Number(e.target.value) })}
                            className="h-7 w-14 shrink-0 rounded border border-border bg-background px-1 text-xs"
                          >
                            <option value={1}>1px</option>
                            <option value={2}>2px</option>
                            <option value={3}>3px</option>
                            <option value={4}>4px</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground mb-1.5">
                    <input
                      type="checkbox"
                      checked={propForm.backgroundVisible ?? true}
                      onChange={e => patchProp('backgroundVisible', e.target.checked)}
                      className="rounded border-border"
                    />
                    Background
                  </label>
                  {(propForm.backgroundVisible ?? true) && (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={propForm.backgroundColor ?? propForm.color}
                        onChange={e => patchProp('backgroundColor', e.target.value)}
                        className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((propForm.backgroundOpacity ?? (propForm.type === 'channel' ? 0.12 : 0.1)) * 100)}
                        onChange={e => patchProp('backgroundOpacity', Number(e.target.value) / 100)}
                        className="flex-1"
                      />
                      <span className="w-10 shrink-0 text-right text-xs font-mono text-muted-foreground">
                        {Math.round((propForm.backgroundOpacity ?? (propForm.type === 'channel' ? 0.12 : 0.1)) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {propTab === 'style' && propForm.type !== 'channel' && propForm.type !== 'fib' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                    {propForm.type === 'position' ? 'Entry line' : 'Color'}
                  </label>
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
                {propForm.type === 'position' && (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-emerald-500 mb-1.5">Target color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={propForm.targetColor ?? '#22c55e'}
                            onChange={e => patchProp('targetColor', e.target.value)}
                            className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                          />
                          <Input
                            value={propForm.targetColor ?? '#22c55e'}
                            onChange={e => patchProp('targetColor', e.target.value)}
                            className="h-9 flex-1 font-mono text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-rose-500 mb-1.5">Stop color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={propForm.stopColor ?? '#ef4444'}
                            onChange={e => patchProp('stopColor', e.target.value)}
                            className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                          />
                          <Input
                            value={propForm.stopColor ?? '#ef4444'}
                            onChange={e => patchProp('stopColor', e.target.value)}
                            className="h-9 flex-1 font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={propForm.showPriceLabels ?? true}
                        onChange={e => patchProp('showPriceLabels', e.target.checked)}
                        className="rounded border-border"
                      />
                      Price labels
                    </label>
                  </>
                )}
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
                {(propForm.type === 'trendline' || propForm.type === 'box') && (
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
                {propForm.type === 'position' && (() => {
                  const accountSize = propForm.accountSize ?? 10000;
                  const riskMode = propForm.riskMode ?? 'usd';
                  const riskValue = propForm.riskValue ?? 100;
                  const pointValue = propForm.pointValue ?? 1;
                  const leverage = propForm.leverage ?? 1;
                  const lotSize = propForm.lotSize ?? 1;
                  const qtyPrecision = propForm.qtyPrecision ?? null;
                  const targetOffset = propForm.targetOffset ?? 0;
                  const stopOffset = propForm.stopOffset ?? 0;
                  const riskAmount = riskMode === '%' ? accountSize * (riskValue / 100) : riskValue;
                  const quantity = stopOffset > 0 && pointValue > 0 ? (riskAmount / (stopOffset * pointValue)) * lotSize : 0;
                  const targetAmount = quantity * targetOffset * pointValue;
                  const stopAmount = quantity * stopOffset * pointValue;
                  const positionValue = quantity * propForm.p1.price * pointValue;
                  const marginRequired = leverage > 0 ? positionValue / leverage : positionValue;
                  const rr = stopOffset > 0 ? targetOffset / stopOffset : 0;
                  return (
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
                            value={targetOffset}
                            onChange={e => patchProp('targetOffset', Number(e.target.value))}
                            className="h-9"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-bold text-rose-500 mb-1.5">Stop (price offset)</label>
                          <Input
                            type="number"
                            value={stopOffset}
                            onChange={e => patchProp('stopOffset', Number(e.target.value))}
                            className="h-9"
                          />
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/40">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-3">Position sizing</div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Account size</label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">$</span>
                                <Input
                                  type="number"
                                  value={accountSize}
                                  onChange={e => patchProp('accountSize', Number(e.target.value))}
                                  className="h-9"
                                />
                              </div>
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Leverage</label>
                              <Input
                                type="number"
                                value={leverage}
                                onChange={e => patchProp('leverage', Number(e.target.value))}
                                className="h-9"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Risk</label>
                              <Input
                                type="number"
                                value={riskValue}
                                onChange={e => patchProp('riskValue', Number(e.target.value))}
                                className="h-9"
                              />
                            </div>
                            <div className="w-24">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">&nbsp;</label>
                              <select
                                value={riskMode}
                                onChange={e => patchProp('riskMode', e.target.value as RiskMode)}
                                className="w-full h-9 rounded-lg border border-border bg-background px-2 text-sm"
                              >
                                <option value="usd">USD</option>
                                <option value="%">%</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                                Point value <span className="font-normal normal-case text-muted-foreground/70">(USD per 1.00 price move, per unit)</span>
                              </label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">$</span>
                                <Input
                                  type="number"
                                  value={pointValue}
                                  onChange={e => patchProp('pointValue', Number(e.target.value))}
                                  className="h-9"
                                />
                              </div>
                            </div>
                            <div className="w-24">
                              <label className="block text-xs font-bold text-muted-foreground mb-1.5">Lot size</label>
                              <Input
                                type="number"
                                value={lotSize}
                                onChange={e => patchProp('lotSize', Number(e.target.value))}
                                className="h-9"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-muted-foreground mb-1.5">Qty precision</label>
                            <select
                              value={qtyPrecision ?? 'default'}
                              onChange={e => patchProp('qtyPrecision', e.target.value === 'default' ? null : Number(e.target.value))}
                              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                            >
                              <option value="default">Default (3)</option>
                              <option value={0}>0</option>
                              <option value={1}>1</option>
                              <option value={2}>2</option>
                              <option value={3}>3</option>
                              <option value={4}>4</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div className="text-muted-foreground">Quantity</div>
                        <div className="text-right font-mono font-bold">{quantity.toFixed(qtyPrecision ?? 3)}</div>
                        <div className="text-muted-foreground">Target amount</div>
                        <div className="text-right font-mono font-bold text-emerald-500">${targetAmount.toFixed(2)}</div>
                        <div className="text-muted-foreground">Stop amount (risk)</div>
                        <div className="text-right font-mono font-bold text-rose-500">${stopAmount.toFixed(2)}</div>
                        <div className="text-muted-foreground">Risk:reward</div>
                        <div className="text-right font-mono font-bold">{rr.toFixed(2)}</div>
                        <div className="text-muted-foreground">Position value</div>
                        <div className="text-right font-mono">${positionValue.toFixed(2)}</div>
                        <div className="text-muted-foreground">Margin required</div>
                        <div className="text-right font-mono">${marginRequired.toFixed(2)}</div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        isOpen={chartSettingsOpen}
        onClose={() => setChartSettingsOpen(false)}
        title="Chart settings"
        maxWidth="sm"
        footer={
          <div className="flex items-center justify-between w-full gap-3">
            <Button variant="outline" size="sm" onClick={() => setChartSettingsForm(DEFAULT_CHART_SETTINGS)}>Reset to defaults</Button>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setChartSettingsOpen(false)}>Cancel</Button>
              <Button onClick={saveChartSettings}>Ok</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-1 border-b border-border/40 -mt-2 pb-3">
            {(['candles', 'canvas'] as const).map(t => (
              <button
                key={t}
                onClick={() => setChartSettingsTab(t)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors",
                  chartSettingsTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {chartSettingsTab === 'candles' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1.5">Body</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    title="Up candles"
                    value={chartSettingsForm.bodyUpColor}
                    onChange={e => patchChartSettings('bodyUpColor', e.target.value)}
                    className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                  />
                  <input
                    type="color"
                    title="Down candles"
                    value={chartSettingsForm.bodyDownColor}
                    onChange={e => patchChartSettings('bodyDownColor', e.target.value)}
                    className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                  />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground mb-1.5">
                  <input
                    type="checkbox"
                    checked={chartSettingsForm.bordersVisible}
                    onChange={e => patchChartSettings('bordersVisible', e.target.checked)}
                    className="rounded border-border"
                  />
                  Borders
                </label>
                {chartSettingsForm.bordersVisible && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      title="Up candles"
                      value={chartSettingsForm.borderUpColor}
                      onChange={e => patchChartSettings('borderUpColor', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                    <input
                      type="color"
                      title="Down candles"
                      value={chartSettingsForm.borderDownColor}
                      onChange={e => patchChartSettings('borderDownColor', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground mb-1.5">
                  <input
                    type="checkbox"
                    checked={chartSettingsForm.wickVisible}
                    onChange={e => patchChartSettings('wickVisible', e.target.checked)}
                    className="rounded border-border"
                  />
                  Wick
                </label>
                {chartSettingsForm.wickVisible && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      title="Up candles"
                      value={chartSettingsForm.wickUpColor}
                      onChange={e => patchChartSettings('wickUpColor', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                    <input
                      type="color"
                      title="Down candles"
                      value={chartSettingsForm.wickDownColor}
                      onChange={e => patchChartSettings('wickDownColor', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {chartSettingsTab === 'canvas' && (
            <div className="space-y-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground mb-1.5">Background</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={chartSettingsForm.background || '#0a0e14'}
                      onChange={e => patchChartSettings('background', e.target.value)}
                      className="h-9 w-12 rounded-lg border border-border bg-background cursor-pointer"
                    />
                    {chartSettingsForm.background && (
                      <button
                        onClick={() => patchChartSettings('background', '')}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Use transparent
                      </button>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chartSettingsForm.vertGridVisible}
                    onChange={e => patchChartSettings('vertGridVisible', e.target.checked)}
                    className="rounded border-border"
                  />
                  Vertical grid lines
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chartSettingsForm.horzGridVisible}
                    onChange={e => patchChartSettings('horzGridVisible', e.target.checked)}
                    className="rounded border-border"
                  />
                  Horizontal grid lines
                </label>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-3">Volume</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chartSettingsForm.volumeVisible}
                    onChange={e => patchChartSettings('volumeVisible', e.target.checked)}
                    className="rounded border-border"
                  />
                  Show volume
                </label>
              </div>
            </div>
          )}
        </div>
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
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
