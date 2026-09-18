import { ChevronRight } from 'lucide-react';
import type { Service } from '../lib/types';
import { count, healthLabel, healthTone, money, percent, utilisationTone } from '../lib/format';
import { Badge, HealthDot, Meter, Skeleton } from './Primitives';

const OPTIMIZATION_TONE: Record<string, string> = {
  'Optimization candidate': 'ok',
  'Stale data': 'warn',
  'Latency exceeded': 'danger',
  'Traffic rising': 'info',
  'Over-provisioned': 'ok',
  Stopped: 'neutral',
  Stable: 'neutral'
};

export default function ServicesTable({
  services,
  onSelect,
  loading
}: {
  services: Service[];
  onSelect: (serviceId: string) => void;
  loading?: boolean;
}) {
  if (loading && !services.length) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr className="border-b border-line bg-raised/40">
            <th className="th">Service</th>
            <th className="th">Health</th>
            <th className="th">CPU</th>
            <th className="th">Memory</th>
            <th className="th">Traffic</th>
            <th className="th">Latency</th>
            <th className="th">Instances</th>
            <th className="th text-right">Cost/hr</th>
            <th className="th">Optimization</th>
            <th className="th w-8" aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {services.map((service) => {
            const latencyBreach = service.running && service.latency_ms > service.max_latency_ms;
            return (
              <tr
                key={service.service_id}
                className="row-link"
                onClick={() => onSelect(service.service_id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(service.service_id);
                  }
                }}
              >
                <td className="cell">
                  <div className="flex items-center gap-2">
                    <span className="num font-medium text-ink">{service.service_id}</span>
                    {service.critical && (
                      <span className="chip border-danger/25 bg-danger/[0.08] text-danger">Critical</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-2xs text-dim">
                    {service.workload_type} · {service.size}
                  </p>
                </td>

                <td className="cell">
                  <span className="flex items-center gap-2">
                    <HealthDot state={service.health_state} />
                    <span className={`text-xs ${healthTone[service.health_state]}`}>
                      {healthLabel[service.health_state]}
                    </span>
                  </span>
                </td>

                <td className="cell w-[96px]">
                  <span className={`num text-xs ${utilisationTone(service.cpu_percent)}`}>
                    {percent(service.cpu_percent)}
                  </span>
                  <div className="mt-1.5">
                    <Meter
                      value={service.cpu_percent}
                      tone={service.cpu_percent >= 75 ? 'danger' : service.cpu_percent >= 55 ? 'warn' : 'signal'}
                    />
                  </div>
                </td>

                <td className="cell w-[96px]">
                  <span className={`num text-xs ${utilisationTone(service.memory_percent)}`}>
                    {percent(service.memory_percent)}
                  </span>
                  <div className="mt-1.5">
                    <Meter
                      value={service.memory_percent}
                      tone={
                        service.memory_percent >= 75 ? 'danger' : service.memory_percent >= 55 ? 'warn' : 'signal'
                      }
                    />
                  </div>
                </td>

                <td className="cell">
                  <span className="num text-xs text-ink">{count(service.requests_per_minute)} RPM</span>
                  {service.traffic_trend.direction !== 'flat' && (
                    <p
                      className={`num mt-0.5 text-2xs ${
                        service.traffic_trend.direction === 'rising' ? 'text-warn' : 'text-muted'
                      }`}
                    >
                      {service.traffic_trend.change_percent > 0 ? '+' : ''}
                      {service.traffic_trend.change_percent}%
                    </p>
                  )}
                </td>

                <td className="cell">
                  <span className={`num text-xs ${latencyBreach ? 'text-danger' : 'text-ink'}`}>
                    {service.running ? `${Math.round(service.latency_ms)} ms` : '—'}
                  </span>
                  <p className="num mt-0.5 text-2xs text-dim">max {service.max_latency_ms} ms</p>
                </td>

                <td className="cell">
                  <span className="num text-xs text-ink">
                    {service.instances} / {service.max_instances}
                  </span>
                  <p className="num mt-0.5 text-2xs text-dim">min {service.min_instances}</p>
                </td>

                <td className="cell text-right">
                  <span className="num text-xs text-ink">{money(service.cost_per_hour_total)}</span>
                  <p className="num mt-0.5 text-2xs text-dim">{money(service.cost_per_hour)}/inst</p>
                </td>

                <td className="cell">
                  <Badge tone={OPTIMIZATION_TONE[service.optimization] || 'neutral'}>{service.optimization}</Badge>
                </td>

                <td className="cell text-dim">
                  <ChevronRight size={14} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
