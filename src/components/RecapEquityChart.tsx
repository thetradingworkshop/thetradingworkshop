import React, { useEffect, useRef } from 'react';
import { createChart, BaselineSeries, UTCTimestamp, LineData } from 'lightweight-charts';

interface RecapEquityChartProps {
  points: { date: string; cumPnl: number }[];
}

// Cumulative realized P&L by day across a Sessions Recap's date range —
// mirrors RunningPnlChart's baseline styling (green above zero, red below)
// for visual consistency with the rest of the app.
export function RecapEquityChart({ points }: RecapEquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148,163,184,0.1)' } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: false },
      autoSize: true,
    });

    const firstDayEpoch = Math.floor(new Date(`${points[0].date}T00:00:00`).getTime() / 1000);
    const data: LineData[] = [
      { time: (firstDayEpoch - 86400) as UTCTimestamp, value: 0 },
      ...points.map(p => ({
        time: Math.floor(new Date(`${p.date}T00:00:00`).getTime() / 1000) as UTCTimestamp,
        value: p.cumPnl,
      })),
    ];

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#10b981',
      topFillColor1: 'rgba(16,185,129,0.28)',
      topFillColor2: 'rgba(16,185,129,0.05)',
      bottomLineColor: '#f43f5e',
      bottomFillColor1: 'rgba(244,63,94,0.05)',
      bottomFillColor2: 'rgba(244,63,94,0.28)',
    });
    series.setData(data);
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [points]);

  return <div ref={containerRef} className="h-full w-full" />;
}
