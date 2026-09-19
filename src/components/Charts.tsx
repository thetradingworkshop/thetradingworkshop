import React, { useState } from 'react';
import { cn } from '@/src/utils';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, ReferenceLine
} from 'recharts';
import { Card } from './Shared';

const data = [
  { name: '9:00', value: 0 },
  { name: '10:00', value: 1200 },
  { name: '11:00', value: 800 },
  { name: '12:00', value: 2400 },
  { name: '13:00', value: 2100 },
  { name: '14:00', value: 3500 },
  { name: '15:00', value: 3200 },
];

export function EquityCurveChart({ className, data: propData }: { className?: string, data?: { name: string, value: number }[] }) {
  const chartData = propData || [];

  const peak = chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : 0;
  const current = chartData.length > 0 ? chartData[chartData.length - 1]?.value : 0;

  // Points are one-per-trade, labeled by calendar day — several trades on the
  // same day repeat that day's label back-to-back, which reads as clutter.
  // The tooltip still needs the real label on every point, so only the tick
  // text is thinned here (first occurrence of each label), not the data.
  const firstLabelIndex = new Map<string, number>();
  chartData.forEach((d, i) => {
    if (!firstLabelIndex.has(d.name)) firstLabelIndex.set(d.name, i);
  });
  const renderTick = (props: any) => {
    const { x, y, payload } = props;
    const isFirstOccurrence = firstLabelIndex.get(payload.value) === payload.index;
    if (!isFirstOccurrence) return <g />;
    return (
      <text x={x} y={y + 10} textAnchor="middle" fontSize={11} fontWeight={500} fill="#71717a">
        {payload.value}
      </text>
    );
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="p-8 border-b border-border/50 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Equity Curve</h3>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">Cumulative performance over time</p>
        </div>
        <div className="flex items-center space-x-6">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Current P&L</p>
            <p className={cn("text-sm font-bold mt-0.5", current >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {current >= 0 ? '+' : ''}${current.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Peak P&L</p>
            <p className="text-sm font-bold text-emerald-500 mt-0.5">+${peak.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>
      <div className="h-[340px] w-full p-6 flex items-center justify-center">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={renderTick}
                interval={0}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }}
                tickFormatter={(value) => `$${value}`}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '12px' }}
                itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}
              />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke="#10b981" 
                strokeWidth={2.5}
                fillOpacity={1} 
                fill="url(#colorValue)" 
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground italic">No data available for equity curve</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TradeGradeBreakdown({ className, data: propData }: { className?: string, data?: { name: string, value: number, color: string }[] }) {
  const chartData = propData || [];

  return (
    <Card className={cn("p-6 h-[400px] flex flex-col", className)}>
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Trade Grade Breakdown</h3>
        <p className="text-[11px] text-muted-foreground/60 font-medium">Quality distribution</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {chartData.length > 0 ? (
          <>
            <div className="w-56 h-56 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    innerRadius={68}
                    outerRadius={96}
                    paddingAngle={6}
                    dataKey="value"
                    animationDuration={1000}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="ml-12 space-y-4">
              {chartData.map((item) => (
                <div key={item.name} className="flex items-center text-base">
                  <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: item.color }} />
                  <span className="font-bold w-8">{item.name}</span>
                  <span className="text-muted-foreground/80 font-medium ml-3">{item.value}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic">No data</p>
        )}
      </div>
    </Card>
  );
}

export function BiasVsOutcome({ className, data: propData }: { className?: string, data?: { name: string, value: number, color: string }[] }) {
  const chartData = propData || [];

  return (
    <Card className={cn("p-6 h-[400px] flex flex-col", className)}>
      <div className="mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Bias vs Outcome</h3>
        <p className="text-[11px] text-muted-foreground/60 font-medium">Strategy alignment</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {chartData.length > 0 ? (
          <>
            <div className="w-56 h-56 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    innerRadius={68}
                    outerRadius={96}
                    paddingAngle={6}
                    dataKey="value"
                    animationDuration={1000}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="ml-12 space-y-4">
              {chartData.map((item) => (
                <div key={item.name} className="flex items-center text-base">
                  <div className="w-3 h-3 rounded-full mr-3 shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="font-bold whitespace-nowrap">{item.name}</span>
                  <span className="text-muted-foreground/80 font-medium ml-3">{item.value}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic">No data</p>
        )}
      </div>
    </Card>
  );
}

export function PnlByTradeChart({ className, data: propData }: { className?: string, data?: { id: string, pnl: number }[] }) {
  const chartData = propData || [];

  return (
    <Card className={cn("p-8 h-[360px] flex flex-col", className)}>
      <div className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">P&L by Trade</h3>
        <p className="text-[11px] text-muted-foreground/60 font-medium">Individual trade results</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="id" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dx={-10} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px' }}
                itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px' }}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.pnl > 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground italic">No data</p>
        )}
      </div>
    </Card>
  );
}

export function HourlyPerformanceChart({ className, data: propData }: { className?: string, data?: { hour: string, pnl: number }[] }) {
  const chartData = propData || [];
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  return (
    <Card className={cn("p-8 h-[360px] flex flex-col", className)}>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Performance by Hour</h3>
          <p className="text-[11px] text-muted-foreground/60 font-medium">Intraday profitability</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-accent/30 border border-border shrink-0">
          {(['bar', 'line'] as const).map(t => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors",
                chartType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dx={-10} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px' }}
                  itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                  labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px' }}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl > 0 ? '#6366f1' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dx={-10} />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                  contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px' }}
                  itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                  labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px' }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                <Line type="monotone" dataKey="pnl" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 5 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground italic">No data</p>
        )}
      </div>
    </Card>
  );
}

export function HoldTimeHistogram({ className, data: propData }: { className?: string, data?: { range: string, count: number }[] }) {
  const chartData = propData || [];

  return (
    <Card className={cn("p-8 h-[360px] flex flex-col", className)}>
      <div className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Hold Time Distribution</h3>
        <p className="text-[11px] text-muted-foreground/60 font-medium">Trade duration analysis</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
              <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dx={-10} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px' }}
                itemStyle={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
                labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px' }}
              />
              <Bar dataKey="count" fill="#ec4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground italic">No data</p>
        )}
      </div>
    </Card>
  );
}
