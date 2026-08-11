// lightweight-charts v5 Series Primitives for the trade candlestick chart's
// drawing tools: trend line, price channel, rectangle, Fibonacci
// retracement, and text note. The core library ships no drawing tools of
// its own — these are custom primitives built on its Plugin API.
//
// Coordinates are recomputed from each primitive's own time/price anchors on
// every `updateAllViews()` call (which the chart invokes on pan/zoom/resize),
// so drawings stay pinned to the right spot rather than a fixed pixel
// position.
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface TrendLinePoint {
  time: Time;
  price: number;
}

interface PixelPoint {
  x: number | null;
  y: number | null;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type Extend = 'none' | 'left' | 'right' | 'both';

// Shared style fields every two-point drawing (and, minus extend, the text
// note) exposes through the properties panel's Style/Text tabs.
export interface DrawingStylePatch {
  color?: string;
  opacity?: number;
  lineStyle?: LineStyle;
  extend?: Extend;
  label?: string;
  labelColor?: string;
  labelOpacity?: number;
  labelSize?: number;
  labelBold?: boolean;
}

// A price channel's boundary + quadrant/extension lines, each independently
// styleable — mirrors TradingView's Parallel Channel "Style" tab. Ratio 0 is
// the drawn line (p1-p2), ratio 1 is the parallel line offset by `offset`;
// everything else divides or extends past that band (e.g. 0.5 = the
// midline, -0.25/1.25 = extensions beyond either edge).
export interface ChannelLevel {
  ratio: number;
  visible: boolean;
  color: string;
  opacity?: number; // 0-1, defaults to 1
  lineStyle: LineStyle;
  lineWidth: number;
}

export const CHANNEL_LEVEL_RATIOS = [-0.25, 0, 0.25, 0.5, 0.75, 1, 1.25];

// Matches the channel's own boundaries (0/1) on, solid, 2px by default;
// every quadrant/extension level off, dashed, 1px — so a fresh channel looks
// exactly like it did before this feature existed until the user opts in.
export function defaultChannelLevels(color: string): ChannelLevel[] {
  return CHANNEL_LEVEL_RATIOS.map(ratio => {
    const boundary = ratio === 0 || ratio === 1;
    return { ratio, visible: boundary, color, lineStyle: boundary ? 'solid' : 'dashed', lineWidth: boundary ? 2 : 1 };
  });
}

// Pixel distance (or, for filled shapes, "am I inside it") a click needs to
// satisfy to count as "on" a drawing, for click-to-delete hit testing.
export const DRAWING_HIT_TOLERANCE_PX = 6;

// Exported for the chart component's own handle hit-testing (deciding
// whether a click/drag on an existing drawing is grabbing an endpoint, a
// channel's offset line, or its body) — the same distance math used
// internally by the two-point primitives below.
export function segmentDistance(x1: number | null, y1: number | null, x2: number | null, y2: number | null, x: number, y: number): number {
  if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function applyLineDash(ctx: CanvasRenderingContext2D, style: LineStyle, scale: number) {
  if (style === 'dashed') ctx.setLineDash([6 * scale, 4 * scale]);
  else if (style === 'dotted') ctx.setLineDash([1.5 * scale, 3.5 * scale]);
  else ctx.setLineDash([]);
}

// Converts a plain 6-digit hex color + an opacity (0-1) into an rgba()
// string, for the "Opacity" slider every drawing's Style/Text tab now has
// next to its color picker — a native <input type="color"> has no alpha
// channel of its own, so opacity is tracked as a separate 0-1 field and
// combined with the hex color only at draw time. Anything that isn't a
// plain 6-digit hex (already rgba(), a CSS name, etc.) is returned as-is,
// since there's no clean alpha channel to inject into it.
export function withAlpha(color: string, opacity: number): string {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!hex) return color;
  const r = parseInt(hex[1].slice(0, 2), 16);
  const g = parseInt(hex[1].slice(2, 4), 16);
  const b = parseInt(hex[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, style: LineStyle, scale: number, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = style === 'dotted' ? 'round' : 'butt';
  applyLineDash(ctx, style, scale);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Small square drawn at each anchor/handle of a selected drawing, matching
// the usual "grab here to resize" affordance trading platforms show once
// something is selected.
function drawHandle(ctx: CanvasRenderingContext2D, x: number | null, y: number | null, color: string, hr: number, vr: number) {
  if (x === null || y === null) return;
  const hw = 4 * hr;
  const hh = 4 * vr;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - hw, y - hh, hw * 2, hh * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - hw, y - hh, hw * 2, hh * 2);
  ctx.restore();
}

// The optional label every drawing type can carry, rendered at a fixed spot
// (just above its second anchor) rather than anywhere freely positionable —
// matching "predetermined position" rather than building full alignment
// controls.
function drawLabel(ctx: CanvasRenderingContext2D, x: number | null, y: number | null, text: string, color: string, size: number, bold: boolean, vr: number) {
  if (x === null || y === null || !text) return;
  ctx.save();
  ctx.font = `${bold ? '700' : '500'} ${size * vr}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 6 * vr, y - 6 * vr);
  ctx.restore();
}

// Projects a two-point line's endpoint(s) out to the edge of the chart when
// `extend` calls for it. Only ever changes what gets *drawn* — the
// primitive's own p1/p2 (and hit-testing/dragging against them) always stay
// exactly at the anchors the user placed.
function extendLine(p1: PixelPoint, p2: PixelPoint, extend: Extend, edgeLeft: number, edgeRight: number): [PixelPoint, PixelPoint] {
  if (extend === 'none' || p1.x === null || p1.y === null || p2.x === null || p2.y === null) return [p1, p2];
  const [left, right] = p1.x <= p2.x ? [p1, p2] : [p2, p1];
  if (left.x === right.x) return [p1, p2]; // vertical — nothing meaningful to project
  const slope = (right.y! - left.y!) / (right.x! - left.x!);
  const newLeft = extend === 'left' || extend === 'both' ? { x: edgeLeft, y: left.y! + slope * (edgeLeft - left.x!) } : left;
  const newRight = extend === 'right' || extend === 'both' ? { x: edgeRight, y: right.y! + slope * (edgeRight - right.x!) } : right;
  return p1.x <= p2.x ? [newLeft, newRight] : [newRight, newLeft];
}

// A straight line in (time, price) space keeps the same slope if you add a
// constant to both endpoints' price — so "parallel, offset by N in price" is
// just p1.price + N / p2.price + N, no real geometry needed.
export function priceOnLineAtTime(p1: TrendLinePoint, p2: TrendLinePoint, time: number): number {
  const t1 = p1.time as unknown as number;
  const t2 = p2.time as unknown as number;
  if (t2 === t1) return p1.price;
  const t = (time - t1) / (t2 - t1);
  return p1.price + t * (p2.price - p1.price);
}

// Shared base for the two-point primitives (trend line, box, channel, fib) —
// they differ only in how they render and hit-test given the same p1/p2
// anchors, cached pixel coordinates, and style fields.
abstract class TwoPointPrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  opacity: number;
  p1: TrendLinePoint;
  p2: TrendLinePoint;
  lineStyle: LineStyle;
  extend: Extend;
  label: string;
  labelColor: string;
  labelOpacity: number;
  labelSize: number;
  labelBold: boolean;
  selected = false;

  p1Coord: PixelPoint = { x: null, y: null };
  p2Coord: PixelPoint = { x: null, y: null };

  protected _chart: IChartApi | null = null;
  protected _series: ISeriesApi<SeriesType> | null = null;
  protected _requestUpdate: (() => void) | null = null;
  protected _paneViews: IPrimitivePaneView[] = [];

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color: string, style?: DrawingStylePatch) {
    this.id = id;
    this.p1 = p1;
    this.p2 = p2;
    this.color = color;
    this.opacity = style?.opacity ?? 1;
    this.lineStyle = style?.lineStyle ?? 'solid';
    this.extend = style?.extend ?? 'none';
    this.label = style?.label ?? '';
    this.labelColor = style?.labelColor ?? color;
    this.labelOpacity = style?.labelOpacity ?? 1;
    this.labelSize = style?.labelSize ?? 12;
    this.labelBold = style?.labelBold ?? false;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this._chart || !this._series) return;
    this.p1Coord = {
      x: this._chart.timeScale().timeToCoordinate(this.p1.time),
      y: this._series.priceToCoordinate(this.p1.price),
    };
    this.p2Coord = {
      x: this._chart.timeScale().timeToCoordinate(this.p2.time),
      y: this._series.priceToCoordinate(this.p2.price),
    };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setPoint(which: 'p1' | 'p2', point: TrendLinePoint): void {
    this[which] = point;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setCoordinates(p1: TrendLinePoint, p2: TrendLinePoint): void {
    this.p1 = p1;
    this.p2 = p2;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this._requestUpdate?.();
  }

  setStyle(patch: DrawingStylePatch): void {
    if (patch.color !== undefined) this.color = patch.color;
    if (patch.opacity !== undefined) this.opacity = patch.opacity;
    if (patch.lineStyle !== undefined) this.lineStyle = patch.lineStyle;
    if (patch.extend !== undefined) this.extend = patch.extend;
    if (patch.label !== undefined) this.label = patch.label;
    if (patch.labelColor !== undefined) this.labelColor = patch.labelColor;
    if (patch.labelOpacity !== undefined) this.labelOpacity = patch.labelOpacity;
    if (patch.labelSize !== undefined) this.labelSize = patch.labelSize;
    if (patch.labelBold !== undefined) this.labelBold = patch.labelBold;
    this._requestUpdate?.();
  }

  abstract distanceToPoint(x: number, y: number): number;
}

// ---- Trend line -----------------------------------------------------------

class TrendLinePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: TrendLinePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, color, opacity, lineStyle, extend, selected, label, labelColor, labelOpacity, labelSize, labelBold } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const [a, b] = extendLine(p1, p2, extend, 0, scope.mediaSize.width);
      ctx.save();
      strokeLine(ctx, a.x! * hr, a.y! * vr, b.x! * hr, b.y! * vr, withAlpha(color, opacity), lineStyle, hr);
      if (label) drawLabel(ctx, p2.x! * hr, p2.y! * vr, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) { drawHandle(ctx, p1.x, p1.y, color, hr, vr); drawHandle(ctx, p2.x, p2.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class TrendLinePaneView implements IPrimitivePaneView {
  constructor(private _source: TrendLinePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new TrendLinePaneRenderer(this._source);
  }
}

export class TrendLinePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this._paneViews = [new TrendLinePaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    return segmentDistance(this.p1Coord.x, this.p1Coord.y, this.p2Coord.x, this.p2Coord.y, x, y);
  }
}

// ---- Rectangle / box -------------------------------------------------------

class RectanglePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: RectanglePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, color, opacity, lineStyle, extend, selected, label, labelColor, labelOpacity, labelSize, labelBold } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      let leftX = Math.min(p1.x, p2.x);
      let rightX = Math.max(p1.x, p2.x);
      if (extend === 'right' || extend === 'both') rightX = Math.max(rightX, scope.mediaSize.width);
      if (extend === 'left' || extend === 'both') leftX = Math.min(leftX, 0);
      const left = leftX * hr;
      const right = rightX * hr;
      const top = Math.min(p1.y, p2.y) * vr;
      const width = right - left;
      const height = Math.abs(p2.y - p1.y) * vr;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fillRect(left, top, width, height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = withAlpha(color, opacity);
      ctx.lineWidth = 2;
      applyLineDash(ctx, lineStyle, hr);
      ctx.strokeRect(left, top, width, height);
      ctx.setLineDash([]);
      if (label) drawLabel(ctx, p2.x * hr, Math.min(p1.y, p2.y) * vr, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) { drawHandle(ctx, p1.x, p1.y, color, hr, vr); drawHandle(ctx, p2.x, p2.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class RectanglePaneView implements IPrimitivePaneView {
  constructor(private _source: RectanglePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new RectanglePaneRenderer(this._source);
  }
}

export class RectanglePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this._paneViews = [new RectanglePaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    const { x: x1, y: y1 } = this.p1Coord;
    const { x: x2, y: y2 } = this.p2Coord;
    if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    if (x >= left && x <= right && y >= top && y <= bottom) return 0; // inside the box counts as a hit
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return Math.hypot(dx, dy);
  }
}

// ---- Price channel (trend line + a parallel line offset in price) --------

interface ChannelLevelCoord {
  ratio: number;
  y1: number | null;
  y2: number | null;
}

class PriceChannelPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: PriceChannelPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const {
        p1Coord: p1, p2Coord: p2, p1OffsetCoord: p1o, p2OffsetCoord: p2o,
        color, levels, levelCoords, extend, selected, label, labelColor, labelOpacity, labelSize, labelBold,
        backgroundVisible, backgroundColor, backgroundOpacity,
      } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null || p1o.x === null || p1o.y === null || p2o.x === null || p2o.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const [a, b] = extendLine(p1, p2, extend, 0, scope.mediaSize.width);
      const [ao, bo] = extendLine(p1o, p2o, extend, 0, scope.mediaSize.width);
      ctx.save();
      if (backgroundVisible) {
        ctx.beginPath();
        ctx.moveTo(a.x! * hr, a.y! * vr);
        ctx.lineTo(b.x! * hr, b.y! * vr);
        ctx.lineTo(bo.x! * hr, bo.y! * vr);
        ctx.lineTo(ao.x! * hr, ao.y! * vr);
        ctx.closePath();
        ctx.globalAlpha = backgroundOpacity;
        ctx.fillStyle = backgroundColor;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Boundary (ratio 0/1) and quadrant/extension lines are all driven by
      // the same `levels` list now, each with its own color/style/width and
      // an independent on/off toggle.
      for (const lvl of levels) {
        if (!lvl.visible) continue;
        const coord = levelCoords.find(lc => lc.ratio === lvl.ratio);
        if (!coord || coord.y1 === null || coord.y2 === null || p1.x === null || p2.x === null) continue;
        const [la, lb] = extendLine({ x: p1.x, y: coord.y1 }, { x: p2.x, y: coord.y2 }, extend, 0, scope.mediaSize.width);
        strokeLine(ctx, la.x! * hr, la.y! * vr, lb.x! * hr, lb.y! * vr, withAlpha(lvl.color, lvl.opacity ?? 1), lvl.lineStyle, hr, lvl.lineWidth);
      }
      if (label) drawLabel(ctx, p2.x * hr, p2.y * vr, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) {
        drawHandle(ctx, p1.x, p1.y, color, hr, vr);
        drawHandle(ctx, p2.x, p2.y, color, hr, vr);
        drawHandle(ctx, p1o.x, p1o.y, color, hr, vr);
        drawHandle(ctx, p2o.x, p2o.y, color, hr, vr);
      }
      ctx.restore();
    });
  }
}

class PriceChannelPaneView implements IPrimitivePaneView {
  constructor(private _source: PriceChannelPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new PriceChannelPaneRenderer(this._source);
  }
}

export class PriceChannelPrimitive extends TwoPointPrimitive {
  offset: number; // price units, applied to both points for the second line
  p1OffsetCoord: PixelPoint = { x: null, y: null };
  p2OffsetCoord: PixelPoint = { x: null, y: null };
  levels: ChannelLevel[];
  levelCoords: ChannelLevelCoord[] = [];
  backgroundVisible: boolean;
  backgroundColor: string;
  backgroundOpacity: number;

  constructor(
    id: string,
    p1: TrendLinePoint,
    p2: TrendLinePoint,
    offset = 0,
    color = '#5a7d9f',
    style?: DrawingStylePatch,
    levels?: ChannelLevel[],
    background?: { visible: boolean; color: string; opacity: number },
  ) {
    super(id, p1, p2, color, style);
    this.offset = offset;
    this.levels = levels && levels.length ? levels : defaultChannelLevels(color);
    this.backgroundVisible = background?.visible ?? true;
    this.backgroundColor = background?.color ?? color;
    this.backgroundOpacity = background?.opacity ?? 0.12;
    this._paneViews = [new PriceChannelPaneView(this)];
  }

  updateAllViews(): void {
    super.updateAllViews();
    if (!this._series) return;
    const series = this._series;
    this.p1OffsetCoord = { x: this.p1Coord.x, y: series.priceToCoordinate(this.p1.price + this.offset) };
    this.p2OffsetCoord = { x: this.p2Coord.x, y: series.priceToCoordinate(this.p2.price + this.offset) };
    this.levelCoords = this.levels.map(lvl => ({
      ratio: lvl.ratio,
      y1: series.priceToCoordinate(this.p1.price + lvl.ratio * this.offset),
      y2: series.priceToCoordinate(this.p2.price + lvl.ratio * this.offset),
    }));
  }

  setOffset(offset: number): void {
    this.offset = offset;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setLevels(levels: ChannelLevel[]): void {
    this.levels = levels;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setBackground(visible: boolean, color: string, opacity: number): void {
    this.backgroundVisible = visible;
    this.backgroundColor = color;
    this.backgroundOpacity = opacity;
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    let best = Infinity;
    for (const lc of this.levelCoords) {
      const lvl = this.levels.find(l => l.ratio === lc.ratio);
      if (!lvl?.visible) continue;
      best = Math.min(best, segmentDistance(this.p1Coord.x, lc.y1, this.p2Coord.x, lc.y2, x, y));
    }
    return best;
  }
}

// ---- Fibonacci retracement --------------------------------------------------

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// Every level starts on, solid, 1px, in the base color, and the banding
// alternates 0.5x/1x of a single opacity — with the 0.1 default below that's
// 0.05/0.1, exactly the two hardcoded shades this replaced, so an existing
// fib drawing (no stored `levels`/background fields yet) renders unchanged.
export function defaultFibLevels(color: string): ChannelLevel[] {
  return FIB_LEVELS.map(ratio => ({ ratio, visible: true, color, lineStyle: 'solid', lineWidth: 1 }));
}

interface FibLevelCoord {
  ratio: number;
  price: number;
  y: number | null;
}

class FibRetracementPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: FibRetracementPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const {
        p1Coord, p2Coord, levels, levelCoords, color, selected, label, labelColor, labelOpacity, labelSize, labelBold,
        backgroundVisible, backgroundColor, backgroundOpacity,
      } = this._source;
      const x1 = p1Coord.x, x2 = p2Coord.x;
      if (x1 === null || x2 === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const left = Math.min(x1, x2) * hr;
      const right = Math.max(x1, x2) * hr;
      const sorted = levelCoords.filter((l): l is FibLevelCoord & { y: number } => l.y !== null).sort((a, b) => a.ratio - b.ratio);
      ctx.save();
      if (backgroundVisible) {
        for (let i = 0; i < sorted.length - 1; i++) {
          const yTop = sorted[i].y * vr;
          const yBot = sorted[i + 1].y * vr;
          ctx.globalAlpha = i % 2 === 0 ? backgroundOpacity * 0.5 : backgroundOpacity;
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(left, Math.min(yTop, yBot), right - left, Math.abs(yBot - yTop));
        }
        ctx.globalAlpha = 1;
      }
      ctx.font = `${11 * vr}px sans-serif`;
      ctx.textBaseline = 'middle';
      for (const coord of sorted) {
        const lvl = levels.find(l => l.ratio === coord.ratio);
        if (!lvl?.visible) continue;
        const y = coord.y * vr;
        const lvlColor = withAlpha(lvl.color, lvl.opacity ?? 1);
        strokeLine(ctx, left, y, right, y, lvlColor, lvl.lineStyle, hr, lvl.lineWidth);
        ctx.fillStyle = lvlColor;
        ctx.fillText(`${(coord.ratio * 100).toFixed(1)}%  ${coord.price.toFixed(2)}`, left + 4 * hr, y - 6 * vr);
      }
      if (label) drawLabel(ctx, p2Coord.x! * hr, p2Coord.y! * vr, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) { drawHandle(ctx, p1Coord.x, p1Coord.y, color, hr, vr); drawHandle(ctx, p2Coord.x, p2Coord.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class FibRetracementPaneView implements IPrimitivePaneView {
  constructor(private _source: FibRetracementPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new FibRetracementPaneRenderer(this._source);
  }
}

export class FibRetracementPrimitive extends TwoPointPrimitive {
  levelCoords: FibLevelCoord[] = [];
  levels: ChannelLevel[];
  backgroundVisible: boolean;
  backgroundColor: string;
  backgroundOpacity: number;

  constructor(
    id: string,
    p1: TrendLinePoint,
    p2: TrendLinePoint,
    color = '#5a7d9f',
    style?: DrawingStylePatch,
    levels?: ChannelLevel[],
    background?: { visible: boolean; color: string; opacity: number },
  ) {
    super(id, p1, p2, color, style);
    this.levels = levels && levels.length ? levels : defaultFibLevels(color);
    this.backgroundVisible = background?.visible ?? true;
    this.backgroundColor = background?.color ?? color;
    this.backgroundOpacity = background?.opacity ?? 0.1;
    this._paneViews = [new FibRetracementPaneView(this)];
  }

  updateAllViews(): void {
    super.updateAllViews();
    if (!this._series) return;
    const series = this._series;
    this.levelCoords = FIB_LEVELS.map(ratio => {
      const price = this.p1.price + (this.p2.price - this.p1.price) * ratio;
      return { ratio, price, y: series.priceToCoordinate(price) };
    });
  }

  setLevels(levels: ChannelLevel[]): void {
    this.levels = levels;
    this._requestUpdate?.();
  }

  setBackground(visible: boolean, color: string, opacity: number): void {
    this.backgroundVisible = visible;
    this.backgroundColor = color;
    this.backgroundOpacity = opacity;
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    const { x: x1 } = this.p1Coord;
    const { x: x2 } = this.p2Coord;
    if (x1 === null || x2 === null) return Infinity;
    const left = Math.min(x1, x2) - DRAWING_HIT_TOLERANCE_PX;
    const right = Math.max(x1, x2) + DRAWING_HIT_TOLERANCE_PX;
    if (x < left || x > right) return Infinity;
    let best = Infinity;
    for (const lvl of this.levelCoords) {
      if (lvl.y === null) continue;
      const style = this.levels.find(l => l.ratio === lvl.ratio);
      if (!style?.visible) continue;
      best = Math.min(best, Math.abs(y - lvl.y));
    }
    return best;
  }
}

// ---- Text note --------------------------------------------------------------

class TextNotePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: TextNotePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { pointCoord: point, text, color, opacity, fontSize, bold, selected } = this._source;
      const { x, y } = point;
      if (x === null || y === null || !text) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const px = x * hr;
      const py = y * vr;
      const strokeColor = withAlpha(color, opacity);
      ctx.save();

      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(px, py, 3 * hr, 0, Math.PI * 2);
      ctx.fill();

      const size = fontSize * vr;
      ctx.font = `${bold ? '700' : '600'} ${size}px sans-serif`;
      const paddingX = 6 * hr;
      const paddingY = 4 * vr;
      const textWidth = ctx.measureText(text).width;
      const boxW = textWidth + paddingX * 2;
      const boxH = size + paddingY * 2;
      const boxX = px + 6 * hr;
      const boxY = py - boxH - 6 * vr;

      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, boxY, boxW, boxH, 4 * hr);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, boxX + paddingX, boxY + boxH / 2);

      if (selected) drawHandle(ctx, px, py, color, hr, vr);
      ctx.restore();
    });
  }
}

class TextNotePaneView implements IPrimitivePaneView {
  constructor(private _source: TextNotePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new TextNotePaneRenderer(this._source);
  }
}

export class TextNotePrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  opacity: number;
  point: TrendLinePoint;
  text: string;
  fontSize: number;
  bold: boolean;
  selected = false;

  pointCoord: PixelPoint = { x: null, y: null };

  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: IPrimitivePaneView[];

  constructor(id: string, point: TrendLinePoint, text: string, color = '#5a7d9f', fontSize = 11, bold = true, opacity = 1) {
    this.id = id;
    this.point = point;
    this.text = text;
    this.color = color;
    this.opacity = opacity;
    this.fontSize = fontSize;
    this.bold = bold;
    this._paneViews = [new TextNotePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this._chart || !this._series) return;
    this.pointCoord = {
      x: this._chart.timeScale().timeToCoordinate(this.point.time),
      y: this._series.priceToCoordinate(this.point.price),
    };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setPoint(point: TrendLinePoint): void {
    this.point = point;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this._requestUpdate?.();
  }

  setStyle(patch: { color?: string; opacity?: number; text?: string; fontSize?: number; bold?: boolean }): void {
    if (patch.color !== undefined) this.color = patch.color;
    if (patch.opacity !== undefined) this.opacity = patch.opacity;
    if (patch.text !== undefined) this.text = patch.text;
    if (patch.fontSize !== undefined) this.fontSize = patch.fontSize;
    if (patch.bold !== undefined) this.bold = patch.bold;
    this._requestUpdate?.();
  }

  // Rough hit box covering the anchor dot and the label pill drawn near it
  // (text width isn't known outside a canvas context, so this estimates it).
  distanceToPoint(x: number, y: number): number {
    const { x: px, y: py } = this.pointCoord;
    if (px === null || py === null) return Infinity;
    const estWidth = Math.max(20, this.text.length * 6 + 14);
    const estHeight = 20;
    const boxX = px + 4;
    const boxY = py - estHeight - 8;
    if (x >= boxX - 4 && x <= boxX + estWidth + 4 && y >= boxY - 4 && y <= boxY + estHeight + 4) return 0;
    return Math.hypot(x - px, y - py);
  }
}

// ---- Arrow -------------------------------------------------------------
// A trend line with an arrowhead at p2, otherwise identical.

class ArrowPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: ArrowPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, color, opacity, lineStyle, selected, label, labelColor, labelOpacity, labelSize, labelBold } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const x1 = p1.x * hr, y1 = p1.y * vr, x2 = p2.x * hr, y2 = p2.y * vr;
      const strokeColor = withAlpha(color, opacity);
      ctx.save();
      strokeLine(ctx, x1, y1, x2, y2, strokeColor, lineStyle, hr);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10 * hr;
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      if (label) drawLabel(ctx, x2, y2, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) { drawHandle(ctx, p1.x, p1.y, color, hr, vr); drawHandle(ctx, p2.x, p2.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class ArrowPaneView implements IPrimitivePaneView {
  constructor(private _source: ArrowPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new ArrowPaneRenderer(this._source);
  }
}

export class ArrowPrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this._paneViews = [new ArrowPaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    return segmentDistance(this.p1Coord.x, this.p1Coord.y, this.p2Coord.x, this.p2Coord.y, x, y);
  }
}

// ---- Price range (measuring tool) ---------------------------------------
// A shaded box between two price levels, labeled with the $ and % delta —
// green if p2 is higher than p1, red otherwise, matching the usual
// "measure this move" convention.

class PriceRangePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: PriceRangePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, opacity, selected } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const priceDelta = this._source.p2.price - this._source.p1.price;
      const up = priceDelta >= 0;
      const color = up ? '#22c55e' : '#ef4444';
      const strokeColor = withAlpha(color, opacity);
      const left = Math.min(p1.x, p2.x) * hr;
      const right = Math.max(p1.x, p2.x) * hr;
      const top = Math.min(p1.y, p2.y) * vr;
      const bottom = Math.max(p1.y, p2.y) * vr;
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = color;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left, top, right - left, bottom - top);
      const pct = this._source.p1.price !== 0 ? (priceDelta / this._source.p1.price) * 100 : 0;
      const text = `${up ? '+' : ''}${priceDelta.toFixed(2)} (${up ? '+' : ''}${pct.toFixed(2)}%)`;
      ctx.font = `700 ${11 * vr}px sans-serif`;
      ctx.fillStyle = strokeColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, (left + right) / 2, (top + bottom) / 2);
      ctx.textAlign = 'left';
      if (selected) { drawHandle(ctx, p1.x, p1.y, color, hr, vr); drawHandle(ctx, p2.x, p2.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class PriceRangePaneView implements IPrimitivePaneView {
  constructor(private _source: PriceRangePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new PriceRangePaneRenderer(this._source);
  }
}

export class PriceRangePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this._paneViews = [new PriceRangePaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    const { x: x1, y: y1 } = this.p1Coord;
    const { x: x2, y: y2 } = this.p2Coord;
    if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    if (x >= left && x <= right && y >= top && y <= bottom) return 0;
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return Math.hypot(dx, dy);
  }
}

// ---- Date/time range (measuring tool) -----------------------------------
// Same shape as price range, but labeled with the elapsed time instead of a
// price delta, and always drawn in a single neutral color.

function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 60) return `${Math.round(abs)}s`;
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${(abs / 3600).toFixed(1)}h`;
  return `${(abs / 86400).toFixed(1)}d`;
}

class TimeRangePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: TimeRangePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, color, opacity, selected } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const strokeColor = withAlpha(color, opacity);
      const left = Math.min(p1.x, p2.x) * hr;
      const right = Math.max(p1.x, p2.x) * hr;
      const top = Math.min(p1.y, p2.y) * vr;
      const bottom = Math.max(p1.y, p2.y) * vr;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left, top, right - left, bottom - top);
      const seconds = (this._source.p2.time as unknown as number) - (this._source.p1.time as unknown as number);
      ctx.font = `700 ${11 * vr}px sans-serif`;
      ctx.fillStyle = strokeColor;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      ctx.fillText(formatDuration(seconds), (left + right) / 2, top - 4 * vr);
      ctx.textAlign = 'left';
      if (selected) { drawHandle(ctx, p1.x, p1.y, color, hr, vr); drawHandle(ctx, p2.x, p2.y, color, hr, vr); }
      ctx.restore();
    });
  }
}

class TimeRangePaneView implements IPrimitivePaneView {
  constructor(private _source: TimeRangePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new TimeRangePaneRenderer(this._source);
  }
}

export class TimeRangePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this._paneViews = [new TimeRangePaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    const { x: x1, y: y1 } = this.p1Coord;
    const { x: x2, y: y2 } = this.p2Coord;
    if (x1 === null || y1 === null || x2 === null || y2 === null) return Infinity;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    if (x >= left && x <= right && y >= top && y <= bottom) return 0;
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return Math.hypot(dx, dy);
  }
}

// ---- Horizontal line ------------------------------------------------------
// A single price level spanning the full width of the chart.

class HorizontalLinePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: HorizontalLinePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { priceCoord: y, color, opacity, lineStyle, selected, label, labelColor, labelOpacity, labelSize, labelBold } = this._source;
      if (y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const py = y * vr;
      const width = scope.mediaSize.width * hr;
      ctx.save();
      strokeLine(ctx, 0, py, width, py, withAlpha(color, opacity), lineStyle, hr);
      if (label) drawLabel(ctx, width - 60 * hr, py, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) drawHandle(ctx, width / 2, py, color, hr, vr);
      ctx.restore();
    });
  }
}

class HorizontalLinePaneView implements IPrimitivePaneView {
  constructor(private _source: HorizontalLinePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new HorizontalLinePaneRenderer(this._source);
  }
}

export class HorizontalLinePrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  opacity: number;
  price: number;
  lineStyle: LineStyle;
  label: string;
  labelColor: string;
  labelOpacity: number;
  labelSize: number;
  labelBold: boolean;
  selected = false;

  priceCoord: number | null = null;

  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: IPrimitivePaneView[];

  constructor(id: string, price: number, color = '#5a7d9f', style?: DrawingStylePatch) {
    this.id = id;
    this.price = price;
    this.color = color;
    this.opacity = style?.opacity ?? 1;
    this.lineStyle = style?.lineStyle ?? 'solid';
    this.label = style?.label ?? '';
    this.labelColor = style?.labelColor ?? color;
    this.labelOpacity = style?.labelOpacity ?? 1;
    this.labelSize = style?.labelSize ?? 12;
    this.labelBold = style?.labelBold ?? false;
    this._paneViews = [new HorizontalLinePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this._series) return;
    this.priceCoord = this._series.priceToCoordinate(this.price);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setPrice(price: number): void {
    this.price = price;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this._requestUpdate?.();
  }

  setStyle(patch: DrawingStylePatch): void {
    if (patch.color !== undefined) this.color = patch.color;
    if (patch.opacity !== undefined) this.opacity = patch.opacity;
    if (patch.lineStyle !== undefined) this.lineStyle = patch.lineStyle;
    if (patch.label !== undefined) this.label = patch.label;
    if (patch.labelColor !== undefined) this.labelColor = patch.labelColor;
    if (patch.labelOpacity !== undefined) this.labelOpacity = patch.labelOpacity;
    if (patch.labelSize !== undefined) this.labelSize = patch.labelSize;
    if (patch.labelBold !== undefined) this.labelBold = patch.labelBold;
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    if (this.priceCoord === null) return Infinity;
    return Math.abs(y - this.priceCoord);
  }
}

// ---- Vertical line ----------------------------------------------------------
// A single point in time spanning the full height of the chart's pane.

class VerticalLinePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: VerticalLinePrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { timeCoord: x, color, opacity, lineStyle, selected, label, labelColor, labelOpacity, labelSize, labelBold } = this._source;
      if (x === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const px = x * hr;
      const height = scope.mediaSize.height * vr;
      ctx.save();
      strokeLine(ctx, px, 0, px, height, withAlpha(color, opacity), lineStyle, vr);
      if (label) drawLabel(ctx, px, 20 * vr, label, withAlpha(labelColor, labelOpacity), labelSize, labelBold, vr);
      if (selected) drawHandle(ctx, px, height / 2, color, hr, vr);
      ctx.restore();
    });
  }
}

class VerticalLinePaneView implements IPrimitivePaneView {
  constructor(private _source: VerticalLinePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new VerticalLinePaneRenderer(this._source);
  }
}

export class VerticalLinePrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  opacity: number;
  time: Time;
  lineStyle: LineStyle;
  label: string;
  labelColor: string;
  labelOpacity: number;
  labelSize: number;
  labelBold: boolean;
  selected = false;

  timeCoord: number | null = null;

  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: IPrimitivePaneView[];

  constructor(id: string, time: Time, color = '#5a7d9f', style?: DrawingStylePatch) {
    this.id = id;
    this.time = time;
    this.color = color;
    this.opacity = style?.opacity ?? 1;
    this.lineStyle = style?.lineStyle ?? 'solid';
    this.label = style?.label ?? '';
    this.labelColor = style?.labelColor ?? color;
    this.labelOpacity = style?.labelOpacity ?? 1;
    this.labelSize = style?.labelSize ?? 12;
    this.labelBold = style?.labelBold ?? false;
    this._paneViews = [new VerticalLinePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this._chart) return;
    this.timeCoord = this._chart.timeScale().timeToCoordinate(this.time);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setTime(time: Time): void {
    this.time = time;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this._requestUpdate?.();
  }

  setStyle(patch: DrawingStylePatch): void {
    if (patch.color !== undefined) this.color = patch.color;
    if (patch.opacity !== undefined) this.opacity = patch.opacity;
    if (patch.lineStyle !== undefined) this.lineStyle = patch.lineStyle;
    if (patch.label !== undefined) this.label = patch.label;
    if (patch.labelColor !== undefined) this.labelColor = patch.labelColor;
    if (patch.labelOpacity !== undefined) this.labelOpacity = patch.labelOpacity;
    if (patch.labelSize !== undefined) this.labelSize = patch.labelSize;
    if (patch.labelBold !== undefined) this.labelBold = patch.labelBold;
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    if (this.timeCoord === null) return Infinity;
    return Math.abs(x - this.timeCoord);
  }
}

// ---- Long/short position (also serves as the risk/reward box) -------------
// A flat entry line spanning [p1.time, p2.time] at p1.price === p2.price,
// with a profit zone (green, `targetOffset` above entry for 'long', below
// for 'short') and a loss zone (red, `stopOffset` the other way), labeled
// with the $/% of each and the resulting risk:reward ratio. The sizing
// fields (accountSize/riskMode/riskValue/pointValue/leverage) drive a small
// position-sizing calculator — quantity is derived from "how much am I
// risking" rather than typed in directly, mirroring TradingView's own
// Long/Short Position tool.

class PositionPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: PositionPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const {
        p1Coord: p1, p2Coord: p2, targetCoordY, stopCoordY, targetOffset, stopOffset, selected,
        quantity, targetAmount, stopAmount, riskRewardRatio, targetColor, targetOpacity, stopColor, stopOpacity,
        showPriceLabels, qtyPrecision, color, opacity,
      } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || targetCoordY === null || stopCoordY === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const left = Math.min(p1.x, p2.x) * hr;
      const right = Math.max(p1.x, p2.x) * hr;
      const entryY = p1.y * vr;
      const targetY = targetCoordY * vr;
      const stopY = stopCoordY * vr;
      const targetStroke = withAlpha(targetColor, targetOpacity);
      const stopStroke = withAlpha(stopColor, stopOpacity);
      const entryStroke = withAlpha(color, opacity);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = targetColor;
      ctx.fillRect(left, Math.min(entryY, targetY), right - left, Math.abs(targetY - entryY));
      ctx.fillStyle = stopColor;
      ctx.fillRect(left, Math.min(entryY, stopY), right - left, Math.abs(stopY - entryY));
      ctx.globalAlpha = 1;

      // Target/stop lines span the full width and are draggable anywhere
      // along them (see hitHandle in TradeCandleChart.tsx) — square handles
      // at both ends make that discoverable, matching TradingView's own
      // Long/Short Position box rather than a single easy-to-miss center grip.
      strokeLine(ctx, left, targetY, right, targetY, targetStroke, 'solid', hr, 1.5);
      strokeLine(ctx, left, stopY, right, stopY, stopStroke, 'solid', hr, 1.5);
      ctx.strokeStyle = entryStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4 * hr, 3 * hr]);
      ctx.beginPath();
      ctx.moveTo(left, entryY);
      ctx.lineTo(right, entryY);
      ctx.stroke();
      ctx.setLineDash([]);

      if (showPriceLabels) {
        const entryPrice = this._source.p1.price;
        const pctTarget = entryPrice !== 0 ? (targetOffset / entryPrice) * 100 : 0;
        const pctStop = entryPrice !== 0 ? (stopOffset / entryPrice) * 100 : 0;
        const qtyStr = quantity.toFixed(qtyPrecision ?? 3);
        ctx.font = `700 ${11 * vr}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = targetStroke;
        ctx.fillText(
          `+${targetOffset.toFixed(2)} (${pctTarget.toFixed(2)}%)  $${targetAmount.toFixed(2)}`,
          left + 6 * hr, Math.min(entryY, targetY) + Math.abs(targetY - entryY) / 2
        );
        ctx.fillStyle = stopStroke;
        ctx.fillText(
          `-${stopOffset.toFixed(2)} (${pctStop.toFixed(2)}%)  $${stopAmount.toFixed(2)}`,
          left + 6 * hr, Math.min(entryY, stopY) + Math.abs(stopY - entryY) / 2
        );
        ctx.fillStyle = entryStroke;
        ctx.fillText(`Qty ${qtyStr}  ·  R:R ${riskRewardRatio.toFixed(2)}`, left + 6 * hr, entryY - 12 * vr);
      }

      if (selected) {
        drawHandle(ctx, p1.x, p1.y, color, hr, vr);
        drawHandle(ctx, p2.x, p2.y, color, hr, vr);
        drawHandle(ctx, p1.x, targetCoordY, targetColor, hr, vr);
        drawHandle(ctx, p2.x, targetCoordY, targetColor, hr, vr);
        drawHandle(ctx, p1.x, stopCoordY, stopColor, hr, vr);
        drawHandle(ctx, p2.x, stopCoordY, stopColor, hr, vr);
      }
      ctx.restore();
    });
  }
}

class PositionPaneView implements IPrimitivePaneView {
  constructor(private _source: PositionPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new PositionPaneRenderer(this._source);
  }
}

export type RiskMode = '%' | 'usd';

export class PositionPrimitive extends TwoPointPrimitive {
  direction: 'long' | 'short';
  targetOffset: number; // price units, always >= 0
  stopOffset: number; // price units, always >= 0
  targetCoordY: number | null = null;
  stopCoordY: number | null = null;

  // Position-sizing calculator inputs (mirrors TradingView's Long/Short
  // Position tool) — quantity is derived from these, not stored directly.
  accountSize: number; // USD
  riskMode: RiskMode;
  riskValue: number; // interpreted per riskMode: a percent of accountSize, or a flat USD amount
  pointValue: number; // USD value of a 1-price-unit move for 1 unit of quantity (e.g. $2/point for MNQ)
  leverage: number; // used only for the margin-required readout
  lotSize: number; // multiplies the risk-derived quantity, default 1

  // Display-only options — don't affect the sizing math, just how the box
  // is drawn.
  qtyPrecision: number | undefined; // decimal places for the displayed Quantity, undefined = default (3)
  targetColor: string;
  targetOpacity: number;
  stopColor: string;
  stopOpacity: number;
  showPriceLabels: boolean;

  constructor(
    id: string,
    p1: TrendLinePoint,
    p2: TrendLinePoint,
    direction: 'long' | 'short' = 'long',
    targetOffset = 0,
    stopOffset = 0,
    color = '#5a7d9f',
    style?: DrawingStylePatch,
    sizing?: { accountSize: number; riskMode: RiskMode; riskValue: number; pointValue: number; leverage: number; lotSize?: number },
    display?: { targetColor?: string; targetOpacity?: number; stopColor?: string; stopOpacity?: number; showPriceLabels?: boolean; qtyPrecision?: number },
  ) {
    super(id, p1, p2, color, style);
    this.direction = direction;
    this.targetOffset = targetOffset;
    this.stopOffset = stopOffset;
    this.accountSize = sizing?.accountSize ?? 10000;
    this.riskMode = sizing?.riskMode ?? 'usd';
    this.riskValue = sizing?.riskValue ?? 100;
    this.pointValue = sizing?.pointValue ?? 1;
    this.leverage = sizing?.leverage ?? 1;
    this.lotSize = sizing?.lotSize ?? 1;
    this.targetColor = display?.targetColor ?? '#22c55e';
    this.targetOpacity = display?.targetOpacity ?? 1;
    this.stopColor = display?.stopColor ?? '#ef4444';
    this.stopOpacity = display?.stopOpacity ?? 1;
    this.showPriceLabels = display?.showPriceLabels ?? true;
    this.qtyPrecision = display?.qtyPrecision;
    this._paneViews = [new PositionPaneView(this)];
  }

  get riskAmount(): number {
    return this.riskMode === '%' ? this.accountSize * (this.riskValue / 100) : this.riskValue;
  }
  get quantity(): number {
    return this.stopOffset > 0 && this.pointValue > 0 ? (this.riskAmount / (this.stopOffset * this.pointValue)) * this.lotSize : 0;
  }
  get targetAmount(): number {
    return this.quantity * this.targetOffset * this.pointValue;
  }
  get stopAmount(): number {
    return this.quantity * this.stopOffset * this.pointValue;
  }
  get positionValue(): number {
    return this.quantity * this.p1.price * this.pointValue;
  }
  get marginRequired(): number {
    return this.leverage > 0 ? this.positionValue / this.leverage : this.positionValue;
  }
  get riskRewardRatio(): number {
    return this.stopOffset > 0 ? this.targetOffset / this.stopOffset : 0;
  }

  updateAllViews(): void {
    super.updateAllViews();
    if (!this._series) return;
    const entry = this.p1.price;
    const targetPrice = this.direction === 'long' ? entry + this.targetOffset : entry - this.targetOffset;
    const stopPrice = this.direction === 'long' ? entry - this.stopOffset : entry + this.stopOffset;
    this.targetCoordY = this._series.priceToCoordinate(targetPrice);
    this.stopCoordY = this._series.priceToCoordinate(stopPrice);
  }

  setTargetOffset(offset: number): void {
    this.targetOffset = Math.max(0, offset);
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setStopOffset(offset: number): void {
    this.stopOffset = Math.max(0, offset);
    this.updateAllViews();
    this._requestUpdate?.();
  }

  setSizing(accountSize: number, riskMode: RiskMode, riskValue: number, pointValue: number, leverage: number, lotSize: number): void {
    this.accountSize = Math.max(0, accountSize);
    this.riskMode = riskMode;
    this.riskValue = Math.max(0, riskValue);
    this.pointValue = Math.max(0, pointValue);
    this.leverage = Math.max(0, leverage);
    this.lotSize = Math.max(0, lotSize);
    this._requestUpdate?.();
  }

  setDisplayOptions(
    targetColor: string,
    stopColor: string,
    showPriceLabels: boolean,
    qtyPrecision: number | undefined,
    targetOpacity?: number,
    stopOpacity?: number,
  ): void {
    this.targetColor = targetColor;
    this.stopColor = stopColor;
    this.showPriceLabels = showPriceLabels;
    this.qtyPrecision = qtyPrecision;
    if (targetOpacity !== undefined) this.targetOpacity = targetOpacity;
    if (stopOpacity !== undefined) this.stopOpacity = stopOpacity;
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    const { x: x1, y: y1 } = this.p1Coord;
    const x2 = this.p2Coord.x;
    if (x1 === null || y1 === null || x2 === null || this.targetCoordY === null || this.stopCoordY === null) return Infinity;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, this.targetCoordY, this.stopCoordY);
    const bottom = Math.max(y1, this.targetCoordY, this.stopCoordY);
    if (x >= left && x <= right && y >= top && y <= bottom) return 0;
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return Math.hypot(dx, dy);
  }
}
