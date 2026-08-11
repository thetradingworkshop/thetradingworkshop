import React, { useEffect, useRef } from 'react';
import { createChart, BaselineSeries, UTCTimestamp, LineData } from 'lightweight-charts';

interface DayEquitySparklineProps {
  // One point per trade, in chronological order — cumulative net P&L as of
  // that trade's exit. Distinct from RecapEquityChart (one point per *day*,
  // used for multi-day recaps): this is intraday, time-of-day granularity,
  // for a single day's Day View card.
  points: { time: number; cumPnl: number }[];
  className?: string;
}

// A compact, chrome-light area chart — no visible axes/labels by design,
// matching the small footprint a day-feed card has room for. Same
// baseline-series styling convention as RecapEquityChart/RunningPnlChart
// (green above zero, red below) for visual consistency with the rest of
// the app's equity curves.
export function DayEquitySparkline({ points, className }: DayEquitySparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: 'transparent' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
      autoSize: true,
    });

    // A flat opening point at the day's first trade time so the line
    // doesn't appear to start mid-air at whatever the first trade's P&L was.
    const data: LineData[] = [
      { time: (points[0].time - 60) as UTCTimestamp, value: 0 },
      ...points.map(p => ({ time: p.time as UTCTimestamp, value: p.cumPnl })),
    ];

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#10b981',
      topFillColor1: 'rgba(16,185,129,0.28)',
      topFillColor2: 'rgba(16,185,129,0.04)',
      bottomLineColor: '#f43f5e',
      bottomFillColor1: 'rgba(244,63,94,0.04)',
      bottomFillColor2: 'rgba(244,63,94,0.28)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(data);
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [points]);

  if (points.length === 0) {
    return <div className={className} />;
  }

  return <div ref={containerRef} className={className} />;
}
