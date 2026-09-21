import React, { useId, useMemo } from 'react';

interface DayEquitySparklineProps {
  // One point per trade, in chronological order — cumulative net P&L as of
  // that trade's exit. Distinct from RecapEquityChart (one point per *day*,
  // used for multi-day recaps): this is intraday, time-of-day granularity,
  // for a single day's Day View card.
  points: { time: number; cumPnl: number }[];
  className?: string;
}

const VIEW_W = 300;
const VIEW_H = 90;
const PAD_X = 3;
const PAD_Y = 6;

const TOP_LINE = '#10b981';
const TOP_FILL = 'rgba(16,185,129,0.28)';
const BOTTOM_LINE = '#f43f5e';
const BOTTOM_FILL = 'rgba(244,63,94,0.28)';

type Pt = { x: number; y: number; value: number };

// A card in a scrolling day-feed has no room for axes, a crosshair, zoom, or
// pan — DayEquitySparkline never turned any of that on (see the disabled
// scroll/scale/grid/scale options this replaced). The only thing actually
// on screen was a baseline-colored area fill over data we already compute
// client-side, so mounting a full charting engine (its own canvas +
// ResizeObserver) once per card was pure overhead — and lightweight-charts'
// free-tier attribution watermark, sized for a real chart, swallowed this
// entire 90px-tall card instead of sitting unobtrusively in a corner. A
// plain SVG path scales via CSS with no JS sizing logic at all.

export function DayEquitySparkline({ points, className }: DayEquitySparklineProps) {
  const gradientId = useId();

  const { segments, zeroY } = useMemo(() => {
    if (points.length === 0) return { segments: [] as { d: string; area: string; positive: boolean }[], zeroY: VIEW_H / 2 };

    const data = [
      { time: points[0].time - 60, value: 0 },
      ...points.map(p => ({ time: p.time, value: p.cumPnl })),
    ];

    const times = data.map(p => p.time);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const tRange = maxT - minT || 1;

    const values = data.map(p => p.value);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const vRange = maxV - minV || 1;

    const xScale = (t: number) => PAD_X + ((t - minT) / tRange) * (VIEW_W - PAD_X * 2);
    const yScale = (v: number) => VIEW_H - PAD_Y - ((v - minV) / vRange) * (VIEW_H - PAD_Y * 2);
    const zeroY = yScale(0);

    const pts: Pt[] = data.map(p => ({ x: xScale(p.time), y: yScale(p.value), value: p.value }));

    const rawSegments: { pts: Pt[]; positive: boolean }[] = [];
    let current: Pt[] = [pts[0]];
    let currentPositive = pts[0].value >= 0;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const pt = pts[i];
      const ptPositive = pt.value >= 0;
      if (ptPositive !== currentPositive && prev.value !== 0 && pt.value !== 0) {
        const t = prev.value / (prev.value - pt.value);
        const zero: Pt = { x: prev.x + (pt.x - prev.x) * t, y: zeroY, value: 0 };
        current.push(zero);
        rawSegments.push({ pts: current, positive: currentPositive });
        current = [zero, pt];
        currentPositive = ptPositive;
      } else {
        current.push(pt);
      }
    }
    rawSegments.push({ pts: current, positive: currentPositive });

    const segments = rawSegments.map(seg => {
      const line = seg.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      const first = seg.pts[0];
      const last = seg.pts[seg.pts.length - 1];
      const area = `${line} L${last.x.toFixed(2)},${zeroY.toFixed(2)} L${first.x.toFixed(2)},${zeroY.toFixed(2)} Z`;
      return { d: line, area, positive: seg.positive };
    });

    return { segments, zeroY };
  }, [points]);

  if (points.length === 0) {
    return <div className={className} />;
  }

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id={`${gradientId}-top`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TOP_FILL} />
            <stop offset="100%" stopColor="rgba(16,185,129,0.04)" />
          </linearGradient>
          <linearGradient id={`${gradientId}-bottom`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(244,63,94,0.04)" />
            <stop offset="100%" stopColor={BOTTOM_FILL} />
          </linearGradient>
        </defs>
        {segments.map((seg, i) => (
          <g key={i}>
            <path d={seg.area} fill={`url(#${gradientId}-${seg.positive ? 'top' : 'bottom'})`} stroke="none" />
            <path
              d={seg.d}
              fill="none"
              stroke={seg.positive ? TOP_LINE : BOTTOM_LINE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
