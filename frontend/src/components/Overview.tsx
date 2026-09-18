import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { compactMoney, count, money, percent } from '../lib/format';
import { Skeleton } from './Primitives';

export function AlertBanner() {
  const { cost, agent, runAgent } = useStore();
  const running = agent.status === 'running';

  if (!cost) return <Skeleton className="h-24 w-full" />;

  const opportunities = cost.high_confidence_opportunities;

  return (
    <div className="relative overflow-hidden rounded-lg border border-warn/25 bg-gradient-to-r from-warn/[0.09] via-panel to-panel">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-warn" aria-hidden="true" />
      <div className="flex flex-col gap-4 px-5 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="text-sm font-semibold text-ink">
              Cloud spending is <span className="num text-warn">{percent(cost.overspend_percent)}</span> higher than
              expected
            </p>
            <p className="mt-1 text-xs text-muted">
              <span className="num text-ink">{cost.services_monitored}</span> services are being monitored ·{' '}
              <span className="num text-ink">{opportunities}</span> optimization{' '}
              {opportunities === 1 ? 'opportunity' : 'opportunities'} detected ·{' '}
              <span className="num text-ink">{compactMoney(cost.overspend.per_month)}</span> above plan this month
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-agent shrink-0 self-start md:self-auto"
          onClick={() => void runAgent()}
          disabled={running}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Investigate with AI
        </button>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = 'ink',
  trend
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: 'ink' | 'warn' | 'ok' | 'danger' | 'signal';
  trend?: 'up' | 'down';
}) {
  const tones: Record<string, string> = {
    ink: 'text-ink',
    warn: 'text-warn',
    ok: 'text-ok',
    danger: 'text-danger',
    signal: 'text-signal'
  };
  return (
    <div className="panel px-4 py-3.5">
      <p className="metric-label">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <p className={`num text-xl font-semibold ${tones[tone]}`}>{value}</p>
        {trend === 'up' && <ArrowUpRight size={14} className="text-danger" />}
        {trend === 'down' && <ArrowDownRight size={14} className="text-ok" />}
      </div>
      {sub && <p className="mt-1 text-2xs text-muted">{sub}</p>}
    </div>
  );
}

export function KpiRow() {
  const { cost } = useStore();

  if (!cost) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi
        label="Total cost / hour"
        value={money(cost.actual.per_hour)}
        sub={`Plan ${money(cost.expected.per_hour)}/hr`}
        trend="up"
      />
      <Kpi
        label="Projected monthly cost"
        value={compactMoney(cost.actual.per_month)}
        sub={`${percent(cost.overspend_percent)} above plan`}
        tone="warn"
      />
      <Kpi
        label="Potential savings"
        value={compactMoney(cost.potential_savings.per_month)}
        sub={`${money(cost.potential_savings.per_hour)}/hr recoverable`}
        tone="ok"
        trend="down"
      />
      <Kpi label="Services" value={count(cost.services_monitored)} sub="In the simulated estate" />
      <Kpi label="Healthy" value={count(cost.services_healthy)} sub="Inside every target" tone="ok" />
      <Kpi
        label="Attention required"
        value={count(cost.services_attention)}
        sub="Degraded, stale or unhealthy"
        tone={cost.services_attention > 0 ? 'danger' : 'ink'}
      />
    </div>
  );
}
