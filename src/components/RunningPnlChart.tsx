import React, { useEffect, useRef } from 'react';
import { createChart, BaselineSeries, UTCTimestamp, LineData } from 'lightweight-charts';
import { Trade } from '../types';
import { getPointValue } from '../contractSpecs';

// Running $ P&L across this trade's own real fills — a step chart from 0 at
// entry to the trade's realized P&L at exit. Not a live market feed; purely
// derived from the trade's recorded execution fills.
export function RunningPnlChart({ trade }: { trade: Trade }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(148,163,184,0.1)' }, horzLines: { color: 'rgba(148,163,184,0.1)' } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: true },
      autoSize: true,
    });

    const pointValue = getPointValue(trade.symbol);
    const isLong = trade.direction === 'LONG';

    // Walk the trade's own fills in order, tracking running position and
    // realized $ P&L as each fill closes part of the position.
    const sortedFills = [...trade.fills].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let entryQty = 0;
    let entryValue = 0;
    let realized = 0;
    const data: LineData[] = [{ time: Math.floor(new Date(trade.entryTime).getTime() / 1000) as UTCTimestamp, value: 0 }];

    for (const fill of sortedFills) {
      const isEntry = (isLong && fill.side === 'BUY') || (!isLong && fill.side === 'SELL');
      if (isEntry) {
        entryValue += fill.quantity * fill.price;
        entryQty += fill.quantity;
      } else if (entryQty > 0) {
        const avgEntry = entryValue / entryQty;
        const move = isLong ? fill.price - avgEntry : avgEntry - fill.price;
        realized += move * fill.quantity * pointValue;
        data.push({
          time: Math.floor(new Date(fill.timestamp).getTime() / 1000) as UTCTimestamp,
          value: Number(realized.toFixed(2)),
        });
      }
    }

    // Ensure it ends exactly at the trade's recorded realized P&L, and has at
    // least two points so the series renders.
    const finalValue = trade.realizedPnL ?? realized;
    const exitTime = Math.floor(new Date(trade.exitTime).getTime() / 1000) as UTCTimestamp;
    if (data.length === 1 || data[data.length - 1].time !== exitTime) {
      data.push({ time: exitTime, value: finalValue });
    } else {
      data[data.length - 1] = { ...data[data.length - 1], value: finalValue };
    }

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
  }, [trade.id]);

  return <div ref={containerRef} className="h-full w-full" />;
}
