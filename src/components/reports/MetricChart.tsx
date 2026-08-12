import React from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card } from '../Shared';
import { ReportMetricBundle, METRIC_DEFS } from '../../services/reportMetrics';

// The generic "plot any metric" chart the audit confirmed doesn't exist
// anywhere in the app yet (every chart in Charts.tsx is hardcoded to one
// metric's shape) — this one takes whichever 1-3 metric keys MetricPicker
// selected and renders them as grouped bars or overlaid lines, reusing the
// same tooltip/axis styling conventions as Charts.tsx's EquityCurveChart.
const SERIES_COLORS = ['#10b981', '#6366f1', '#f59e0b'];

interface MetricChartProps {
  bundles: ReportMetricBundle[];
  metricKeys: string[];
  chartType: 'bar' | 'line';
  className?: string;
}

export function MetricChart({ bundles, metricKeys, chartType, className }: MetricChartProps) {
  const defs = metricKeys.map(k => METRIC_DEFS.find(m => m.key === k)).filter((d): d is NonNullable<typeof d> => !!d);

  const data = bundles.map(b => {
    const row: Record<string, string | number> = { label: b.label };
    for (const d of defs) row[d.key] = d.value(b);
    return row;
  });

  const ChartComponent = chartType === 'bar' ? BarChart : LineChart;

  return (
    <Card className={className}>
      <div className="px-6 pt-6 pb-2">
        <h3 className="text-sm font-bold text-foreground">Chart</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {defs.length > 0 ? defs.map(d => d.label).join(' · ') : 'Pick up to 3 metrics to plot'}
        </p>
      </div>
      <div className="h-[300px] w-full p-4">
        {defs.length === 0 || data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground italic">No data to chart yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ChartComponent data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }}
                interval={0}
                angle={data.length > 8 ? -35 : 0}
                textAnchor={data.length > 8 ? 'end' : 'middle'}
                height={data.length > 8 ? 50 : 24}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 500 }} dx={-4} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '10px' }}
                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                labelStyle={{ color: '#71717a', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}
              />
              {defs.length > 1 && <Legend wrapperStyle={{ fontSize: '11px' }} />}
              {defs.map((d, i) =>
                chartType === 'bar' ? (
                  <Bar key={d.key} dataKey={d.key} name={d.label} fill={SERIES_COLORS[i]} radius={[4, 4, 0, 0]} />
                ) : (
                  <Line key={d.key} type="monotone" dataKey={d.key} name={d.label} stroke={SERIES_COLORS[i]} strokeWidth={2.5} dot={{ r: 3 }} />
                )
              )}
            </ChartComponent>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
