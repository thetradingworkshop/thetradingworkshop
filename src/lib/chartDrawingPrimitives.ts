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
  lineStyle?: LineStyle;
  extend?: Extend;
  label?: string;
  labelColor?: string;
  labelSize?: number;
  labelBold?: boolean;
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

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, style: LineStyle, scale: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
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
  p1: TrendLinePoint;
  p2: TrendLinePoint;
  lineStyle: LineStyle;
  extend: Extend;
  label: string;
  labelColor: string;
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
    this.lineStyle = style?.lineStyle ?? 'solid';
    this.extend = style?.extend ?? 'none';
    this.label = style?.label ?? '';
    this.labelColor = style?.labelColor ?? color;
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
    if (patch.lineStyle !== undefined) this.lineStyle = patch.lineStyle;
    if (patch.extend !== undefined) this.extend = patch.extend;
    if (patch.label !== undefined) this.label = patch.label;
    if (patch.labelColor !== undefined) this.labelColor = patch.labelColor;
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
      const { p1Coord: p1, p2Coord: p2, color, lineStyle, extend, selected, label, labelColor, labelSize, labelBold } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const [a, b] = extendLine(p1, p2, extend, 0, scope.mediaSize.width);
      ctx.save();
      strokeLine(ctx, a.x! * hr, a.y! * vr, b.x! * hr, b.y! * vr, color, lineStyle, hr);
      if (label) drawLabel(ctx, p2.x! * hr, p2.y! * vr, label, labelColor, labelSize, labelBold, vr);
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
      const { p1Coord: p1, p2Coord: p2, color, lineStyle, extend, selected, label, labelColor, labelSize, labelBold } = this._source;
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
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      applyLineDash(ctx, lineStyle, hr);
      ctx.strokeRect(left, top, width, height);
      ctx.setLineDash([]);
      if (label) drawLabel(ctx, p2.x * hr, Math.min(p1.y, p2.y) * vr, label, labelColor, labelSize, labelBold, vr);
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

class PriceChannelPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: PriceChannelPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord: p1, p2Coord: p2, p1OffsetCoord: p1o, p2OffsetCoord: p2o, color, lineStyle, extend, selected, label, labelColor, labelSize, labelBold } = this._source;
      if (p1.x === null || p1.y === null || p2.x === null || p2.y === null || p1o.x === null || p1o.y === null || p2o.x === null || p2o.y === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const [a, b] = extendLine(p1, p2, extend, 0, scope.mediaSize.width);
      const [ao, bo] = extendLine(p1o, p2o, extend, 0, scope.mediaSize.width);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x! * hr, a.y! * vr);
      ctx.lineTo(b.x! * hr, b.y! * vr);
      ctx.lineTo(bo.x! * hr, bo.y! * vr);
      ctx.lineTo(ao.x! * hr, ao.y! * vr);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      strokeLine(ctx, a.x! * hr, a.y! * vr, b.x! * hr, b.y! * vr, color, lineStyle, hr);
      strokeLine(ctx, ao.x! * hr, ao.y! * vr, bo.x! * hr, bo.y! * vr, color, lineStyle, hr);
      if (label) drawLabel(ctx, p2.x * hr, p2.y * vr, label, labelColor, labelSize, labelBold, vr);
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

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, offset = 0, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
    this.offset = offset;
    this._paneViews = [new PriceChannelPaneView(this)];
  }

  updateAllViews(): void {
    super.updateAllViews();
    if (!this._series) return;
    this.p1OffsetCoord = { x: this.p1Coord.x, y: this._series.priceToCoordinate(this.p1.price + this.offset) };
    this.p2OffsetCoord = { x: this.p2Coord.x, y: this._series.priceToCoordinate(this.p2.price + this.offset) };
  }

  setOffset(offset: number): void {
    this.offset = offset;
    this.updateAllViews();
    this._requestUpdate?.();
  }

  distanceToPoint(x: number, y: number): number {
    const dMain = segmentDistance(this.p1Coord.x, this.p1Coord.y, this.p2Coord.x, this.p2Coord.y, x, y);
    const dOffset = segmentDistance(this.p1OffsetCoord.x, this.p1OffsetCoord.y, this.p2OffsetCoord.x, this.p2OffsetCoord.y, x, y);
    return Math.min(dMain, dOffset);
  }
}

// ---- Fibonacci retracement --------------------------------------------------

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

interface FibLevelCoord {
  ratio: number;
  price: number;
  y: number | null;
}

class FibRetracementPaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _source: FibRetracementPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { p1Coord, p2Coord, levelCoords, color, selected, label, labelColor, labelSize, labelBold } = this._source;
      const x1 = p1Coord.x, x2 = p2Coord.x;
      if (x1 === null || x2 === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const left = Math.min(x1, x2) * hr;
      const right = Math.max(x1, x2) * hr;
      const sorted = levelCoords.filter((l): l is FibLevelCoord & { y: number } => l.y !== null).sort((a, b) => a.ratio - b.ratio);
      ctx.save();
      for (let i = 0; i < sorted.length - 1; i++) {
        const yTop = sorted[i].y * vr;
        const yBot = sorted[i + 1].y * vr;
        ctx.globalAlpha = i % 2 === 0 ? 0.05 : 0.1;
        ctx.fillStyle = color;
        ctx.fillRect(left, Math.min(yTop, yBot), right - left, Math.abs(yBot - yTop));
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.font = `${11 * vr}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      for (const lvl of sorted) {
        const y = lvl.y * vr;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText(`${(lvl.ratio * 100).toFixed(1)}%  ${lvl.price.toFixed(2)}`, left + 4 * hr, y - 6 * vr);
      }
      if (label) drawLabel(ctx, p2Coord.x! * hr, p2Coord.y! * vr, label, labelColor, labelSize, labelBold, vr);
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

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#5a7d9f', style?: DrawingStylePatch) {
    super(id, p1, p2, color, style);
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
      const { pointCoord: point, text, color, fontSize, bold, selected } = this._source;
      const { x, y } = point;
      if (x === null || y === null || !text) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const px = x * hr;
      const py = y * vr;
      ctx.save();

      ctx.fillStyle = color;
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
      ctx.strokeStyle = color;
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

  constructor(id: string, point: TrendLinePoint, text: string, color = '#5a7d9f', fontSize = 11, bold = true) {
    this.id = id;
    this.point = point;
    this.text = text;
    this.color = color;
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

  setStyle(patch: { color?: string; text?: string; fontSize?: number; bold?: boolean }): void {
    if (patch.color !== undefined) this.color = patch.color;
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
