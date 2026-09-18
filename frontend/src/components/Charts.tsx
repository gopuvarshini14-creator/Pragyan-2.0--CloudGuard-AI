import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { CostSummary, HistoryPoint } from '../lib/types';
import { compactMoney, money, shortTime } from '../lib/format';

const AXIS = { stroke: '#3A4A63', fontSize: 10, tickLine: false, axisLine: false } as const;
const GRID = '#18212F';

function TooltipBox({
  active,
  payload,
  label,
  formatter
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border border-line bg-panel/95 px-3 py-2 shadow-panel backdrop-blur">
      <p className="num mb-1 text-2xs text-dim">{label}</p>
      {payload
        .filter((entry) => entry.value != null)
        .map((entry) => (
          <p key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
            <span className="text-muted">{entry.name}</span>
            <span className="num ml-auto pl-3 text-ink">
              {formatter ? formatter(Number(entry.value)) : String(entry.value)}
            </span>
          </p>
        ))}
    </div>
  );
}

export function CostTrendChart({ cost }: { cost: CostSummary }) {
  const data = cost.trend.map((point) => ({ ...point, t: shortTime(point.timestamp) }));

  return (
    <div className="h-[268px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4C8EFF" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#4C8EFF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="t" {...AXIS} minTickGap={24} />
          <YAxis {...AXIS} width={56} tickFormatter={(v) => `$${v}`} />
          <Tooltip content={<TooltipBox formatter={(v) => `${money(v)}/hr`} />} cursor={{ stroke: '#2A3A52' }} />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual spend"
            stroke="#4C8EFF"
            strokeWidth={2}
            fill="url(#actualFill)"
            connectNulls
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            name="Expected spend"
            stroke="#8497B1"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="projected"
            name="Projected spend"
            stroke="#F6B43C"
            strokeWidth={2}
            strokeDasharray="2 3"
            connectNulls
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const METRIC_CONFIG: Record<
  string,
  { key: keyof HistoryPoint; label: string; color: string; format: (v: number) => string }
> = {
  traffic: {
    key: 'requests_per_minute',
    label: 'Requests / minute',
    color: '#22D3EE',
    format: (v) => `${Math.round(v).toLocaleString('en-US')} RPM`
  },
  latency: { key: 'latency_ms', label: 'Latency', color: '#F6B43C', format: (v) => `${Math.round(v)} ms` },
  cpu: { key: 'cpu_percent', label: 'CPU', color: '#4C8EFF', format: (v) => `${v.toFixed(1)}%` },
  memory: { key: 'memory_percent', label: 'Memory', color: '#8B7BF7', format: (v) => `${v.toFixed(1)}%` },
  instances: { key: 'instances', label: 'Instances', color: '#2FD4A0', format: (v) => `${v}` },
  cost: { key: 'cost_per_hour', label: 'Cost / hour', color: '#FF5C6C', format: (v) => money(v) }
};

export function MetricChart({
  points,
  metric,
  threshold
}: {
  points: HistoryPoint[];
  metric: keyof typeof METRIC_CONFIG;
  threshold?: number | null;
}) {
  const config = METRIC_CONFIG[metric];
  const data = points.map((point) => ({
    t: shortTime(point.timestamp),
    value: Number(point[config.key])
  }));

  return (
    <div className="h-[132px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="t" {...AXIS} minTickGap={36} />
          <YAxis {...AXIS} width={44} />
          <Tooltip content={<TooltipBox formatter={config.format} />} cursor={{ stroke: '#2A3A52' }} />
          {threshold != null && (
            <ReferenceLine
              y={threshold}
              stroke="#FF5C6C"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{ value: 'target', fill: '#FF5C6C', fontSize: 9, position: 'insideTopRight' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            name={config.label}
            stroke={config.color}
            strokeWidth={1.8}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostByServiceChart({ cost }: { cost: CostSummary }) {
  const data = cost.by_service.map((row) => ({
    name: row.service_id,
    spend: row.cost_per_hour,
    recoverable: row.savings_per_hour
  }));

  return (
    <div className="h-[268px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" {...AXIS} interval={0} angle={-12} textAnchor="end" height={48} />
          <YAxis {...AXIS} width={56} tickFormatter={(v) => `$${v}`} />
          <Tooltip
            content={<TooltipBox formatter={(v) => `${money(v)}/hr`} />}
            cursor={{ fill: 'rgba(76,142,255,0.06)' }}
          />
          <Bar dataKey="spend" name="Spend" fill="#4C8EFF" radius={[3, 3, 0, 0]} maxBarSize={44} />
          <Bar dataKey="recoverable" name="Recoverable" fill="#2FD4A0" radius={[3, 3, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SavingsProjectionChart({ cost }: { cost: CostSummary }) {
  const data = [
    { name: 'Current', value: cost.actual.per_month },
    { name: 'After optimization', value: cost.projected_after_optimization.per_month },
    { name: 'Plan', value: cost.expected.per_month }
  ];

  return (
    <div className="h-[196px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v) => compactMoney(v)} />
          <YAxis type="category" dataKey="name" {...AXIS} width={124} />
          <Tooltip
            content={<TooltipBox formatter={(v) => `${compactMoney(v)}/month`} />}
            cursor={{ fill: 'rgba(76,142,255,0.06)' }}
          />
          <Bar dataKey="value" name="Monthly" fill="#4C8EFF" radius={[0, 3, 3, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
