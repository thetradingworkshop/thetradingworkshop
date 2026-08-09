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

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
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

// Shared base for the two-point primitives (trend line, box, fib) — they
// differ only in how they render and hit-test given the same p1/p2 anchors
// and cached pixel coordinates.
abstract class TwoPointPrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  p1: TrendLinePoint;
  p2: TrendLinePoint;

  p1Coord: PixelPoint = { x: null, y: null };
  p2Coord: PixelPoint = { x: null, y: null };

  protected _chart: IChartApi | null = null;
  protected _series: ISeriesApi<SeriesType> | null = null;
  protected _requestUpdate: (() => void) | null = null;
  protected _paneViews: IPrimitivePaneView[] = [];

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color: string) {
    this.id = id;
    this.p1 = p1;
    this.p2 = p2;
    this.color = color;
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

  abstract distanceToPoint(x: number, y: number): number;
}

// ---- Trend line -----------------------------------------------------------

class TrendLinePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _p1: PixelPoint, private _p2: PixelPoint, private _color: string) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { x: x1, y: y1 } = this._p1;
      const { x: x2, y: y2 } = this._p2;
      if (x1 === null || y1 === null || x2 === null || y2 === null) return;
      const ctx = scope.context;
      ctx.save();
      strokeLine(ctx, x1 * scope.horizontalPixelRatio, y1 * scope.verticalPixelRatio, x2 * scope.horizontalPixelRatio, y2 * scope.verticalPixelRatio, this._color);
      ctx.restore();
    });
  }
}

class TrendLinePaneView implements IPrimitivePaneView {
  constructor(private _source: TrendLinePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new TrendLinePaneRenderer(this._source.p1Coord, this._source.p2Coord, this._source.color);
  }
}

export class TrendLinePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#6366f1') {
    super(id, p1, p2, color);
    this._paneViews = [new TrendLinePaneView(this)];
  }

  distanceToPoint(x: number, y: number): number {
    return segmentDistance(this.p1Coord.x, this.p1Coord.y, this.p2Coord.x, this.p2Coord.y, x, y);
  }
}

// ---- Rectangle / box -------------------------------------------------------

class RectanglePaneRenderer implements IPrimitivePaneRenderer {
  constructor(private _p1: PixelPoint, private _p2: PixelPoint, private _color: string) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { x: x1, y: y1 } = this._p1;
      const { x: x2, y: y2 } = this._p2;
      if (x1 === null || y1 === null || x2 === null || y2 === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const left = Math.min(x1, x2) * hr;
      const top = Math.min(y1, y2) * vr;
      const width = Math.abs(x2 - x1) * hr;
      const height = Math.abs(y2 - y1) * vr;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = this._color;
      ctx.fillRect(left, top, width, height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this._color;
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, width, height);
      ctx.restore();
    });
  }
}

class RectanglePaneView implements IPrimitivePaneView {
  constructor(private _source: RectanglePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new RectanglePaneRenderer(this._source.p1Coord, this._source.p2Coord, this._source.color);
  }
}

export class RectanglePrimitive extends TwoPointPrimitive {
  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#22c55e') {
    super(id, p1, p2, color);
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
  constructor(
    private _p1: PixelPoint,
    private _p2: PixelPoint,
    private _p1Offset: PixelPoint,
    private _p2Offset: PixelPoint,
    private _color: string
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { x: x1, y: y1 } = this._p1;
      const { x: x2, y: y2 } = this._p2;
      const { x: x1o, y: y1o } = this._p1Offset;
      const { x: x2o, y: y2o } = this._p2Offset;
      if (x1 === null || y1 === null || x2 === null || y2 === null || x1o === null || y1o === null || x2o === null || y2o === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1 * hr, y1 * vr);
      ctx.lineTo(x2 * hr, y2 * vr);
      ctx.lineTo(x2o * hr, y2o * vr);
      ctx.lineTo(x1o * hr, y1o * vr);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = this._color;
      ctx.fill();
      ctx.globalAlpha = 1;
      strokeLine(ctx, x1 * hr, y1 * vr, x2 * hr, y2 * vr, this._color);
      strokeLine(ctx, x1o * hr, y1o * vr, x2o * hr, y2o * vr, this._color);
      ctx.restore();
    });
  }
}

class PriceChannelPaneView implements IPrimitivePaneView {
  constructor(private _source: PriceChannelPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new PriceChannelPaneRenderer(this._source.p1Coord, this._source.p2Coord, this._source.p1OffsetCoord, this._source.p2OffsetCoord, this._source.color);
  }
}

export class PriceChannelPrimitive extends TwoPointPrimitive {
  offset: number; // price units, applied to both points for the second line
  p1OffsetCoord: PixelPoint = { x: null, y: null };
  p2OffsetCoord: PixelPoint = { x: null, y: null };

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, offset = 0, color = '#f59e0b') {
    super(id, p1, p2, color);
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
  constructor(private _x1: number | null, private _x2: number | null, private _levels: FibLevelCoord[], private _color: string) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      if (this._x1 === null || this._x2 === null) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const left = Math.min(this._x1, this._x2) * hr;
      const right = Math.max(this._x1, this._x2) * hr;
      const sorted = this._levels.filter((l): l is FibLevelCoord & { y: number } => l.y !== null).sort((a, b) => a.ratio - b.ratio);
      ctx.save();
      for (let i = 0; i < sorted.length - 1; i++) {
        const yTop = sorted[i].y * vr;
        const yBot = sorted[i + 1].y * vr;
        ctx.globalAlpha = i % 2 === 0 ? 0.05 : 0.1;
        ctx.fillStyle = this._color;
        ctx.fillRect(left, Math.min(yTop, yBot), right - left, Math.abs(yBot - yTop));
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this._color;
      ctx.lineWidth = 1;
      ctx.font = `${11 * vr}px sans-serif`;
      ctx.fillStyle = this._color;
      ctx.textBaseline = 'middle';
      for (const lvl of sorted) {
        const y = lvl.y * vr;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillText(`${(lvl.ratio * 100).toFixed(1)}%  ${lvl.price.toFixed(2)}`, left + 4 * hr, y - 6 * vr);
      }
      ctx.restore();
    });
  }
}

class FibRetracementPaneView implements IPrimitivePaneView {
  constructor(private _source: FibRetracementPrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new FibRetracementPaneRenderer(this._source.p1Coord.x, this._source.p2Coord.x, this._source.levelCoords, this._source.color);
  }
}

export class FibRetracementPrimitive extends TwoPointPrimitive {
  levelCoords: FibLevelCoord[] = [];

  constructor(id: string, p1: TrendLinePoint, p2: TrendLinePoint, color = '#22d3ee') {
    super(id, p1, p2, color);
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
  constructor(private _point: PixelPoint, private _text: string, private _color: string) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const { x, y } = this._point;
      if (x === null || y === null || !this._text) return;
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const px = x * hr;
      const py = y * vr;
      ctx.save();

      ctx.fillStyle = this._color;
      ctx.beginPath();
      ctx.arc(px, py, 3 * hr, 0, Math.PI * 2);
      ctx.fill();

      const fontSize = 11 * vr;
      ctx.font = `600 ${fontSize}px sans-serif`;
      const paddingX = 6 * hr;
      const paddingY = 4 * vr;
      const textWidth = ctx.measureText(this._text).width;
      const boxW = textWidth + paddingX * 2;
      const boxH = fontSize + paddingY * 2;
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
      ctx.strokeStyle = this._color;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._text, boxX + paddingX, boxY + boxH / 2);
      ctx.restore();
    });
  }
}

class TextNotePaneView implements IPrimitivePaneView {
  constructor(private _source: TextNotePrimitive) {}
  renderer(): IPrimitivePaneRenderer | null {
    return new TextNotePaneRenderer(this._source.pointCoord, this._source.text, this._source.color);
  }
}

export class TextNotePrimitive implements ISeriesPrimitive<Time> {
  readonly id: string;
  color: string;
  point: TrendLinePoint;
  text: string;

  pointCoord: PixelPoint = { x: null, y: null };

  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: IPrimitivePaneView[];

  constructor(id: string, point: TrendLinePoint, text: string, color = '#f9fafb') {
    this.id = id;
    this.point = point;
    this.text = text;
    this.color = color;
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
