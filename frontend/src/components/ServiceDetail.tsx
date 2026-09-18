import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { CloudEvent, HistoryPoint, SafetyVerdict, Service } from '../lib/types';
import { clockTime, count, healthLabel, money, percent, relativeAge } from '../lib/format';
import { MetricChart } from './Charts';
import { Badge, CheckRow, ErrorState, HealthDot, Skeleton, Warning } from './Primitives';

const CHARTS: Array<{ metric: 'traffic' | 'latency' | 'cpu' | 'memory' | 'instances' | 'cost'; title: string }> = [
  { metric: 'traffic', title: 'Traffic' },
  { metric: 'latency', title: 'Latency' },
  { metric: 'cpu', title: 'CPU' },
  { metric: 'memory', title: 'Memory' },
  { metric: 'instances', title: 'Instances' },
  { metric: 'cost', title: 'Cost' }
];

export default function ServiceDetail({ serviceId, onClose }: { serviceId: string; onClose: () => void }) {
  const { refresh, runAgent, agent } = useStore();
  const [service, setService] = useState<Service | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ safety: SafetyVerdict; status: string; error: string | null } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const data = await api.service(serviceId);
      setService(data.service);
      setHistory(data.history);
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This service could not be loaded.');
    }
  }, [serviceId]);

  useEffect(() => {
    setService(null);
    setVerdict(null);
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (fn: () => Promise<{ safety: SafetyVerdict; action: { status: string; error: string | null } }>) => {
    setBusy(true);
    setVerdict(null);
    try {
      const result = await fn();
      setVerdict({ safety: result.safety, status: result.action.status, error: result.action.error });
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close service detail" className="flex-1 bg-black/55" onClick={onClose} />
      <div className="flex h-full w-full max-w-[720px] flex-col border-l border-line bg-panel shadow-drawer">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <p className="metric-label">Service</p>
            <h2 className="num mt-0.5 truncate text-lg font-semibold text-ink">{serviceId}</h2>
          </div>
          <button type="button" className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && <ErrorState message={error} onRetry={() => void load()} />}

          {!service && !error && (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          )}

          {service && (
            <>
              {service.freshness.stale && (
                <Warning
                  title="STALE DATA DETECTED"
                  body={
                    <>
                      The stored observation is{' '}
                      <span className="num">{Math.round(service.freshness.age_minutes)} minutes</span> old, past the{' '}
                      <span className="num">{service.freshness.threshold_minutes} minute</span> freshness threshold,
                      while the traffic feed reports{' '}
                      <span className="num">{count(service.traffic_feed_rpm)} RPM</span>. Capacity decisions are
                      blocked until a fresh observation is collected.
                    </>
                  }
                />
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-line bg-raised/40 p-4 sm:grid-cols-4">
                <div>
                  <p className="metric-label">Health</p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-ink">
                    <HealthDot state={service.health_state} />
                    {healthLabel[service.health_state]}
                  </p>
                </div>
                <div>
                  <p className="metric-label">Traffic</p>
                  <p className="num mt-1 text-sm text-ink">{count(service.requests_per_minute)} RPM</p>
                </div>
                <div>
                  <p className="metric-label">CPU</p>
                  <p className="num mt-1 text-sm text-ink">{percent(service.cpu_percent)}</p>
                </div>
                <div>
                  <p className="metric-label">Memory</p>
                  <p className="num mt-1 text-sm text-ink">{percent(service.memory_percent)}</p>
                </div>
                <div>
                  <p className="metric-label">Latency</p>
                  <p
                    className={`num mt-1 text-sm ${
                      service.latency_ms > service.max_latency_ms ? 'text-danger' : 'text-ink'
                    }`}
                  >
                    {Math.round(service.latency_ms)} ms
                  </p>
                </div>
                <div>
                  <p className="metric-label">Latency target</p>
                  <p className="num mt-1 text-sm text-ink">{service.max_latency_ms} ms</p>
                </div>
                <div>
                  <p className="metric-label">Instances</p>
                  <p className="num mt-1 text-sm text-ink">
                    {service.instances} / {service.max_instances}
                  </p>
                </div>
                <div>
                  <p className="metric-label">Cost</p>
                  <p className="num mt-1 text-sm text-ink">{money(service.cost_per_hour_total)}/hour</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={service.critical ? 'danger' : 'neutral'}>
                  {service.critical ? 'Critical service' : 'Non-critical'}
                </Badge>
                <Badge tone="neutral">{service.workload_type}</Badge>
                <Badge tone={service.freshness.stale ? 'warn' : 'ok'}>
                  Observed {relativeAge(service.freshness.age_minutes)}
                </Badge>
                <Badge tone={service.running ? 'ok' : 'neutral'}>{service.running ? 'Running' : 'Stopped'}</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-agent"
                  onClick={() => void runAgent(`Review ${service.service_id} and act only if it is safe.`, service.service_id)}
                  disabled={agent.status === 'running'}
                >
                  <Sparkles size={14} />
                  Investigate this service
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || !service.running}
                  onClick={() => void submit(() => api.scale(service.service_id, service.instances + 1))}
                >
                  Scale to {service.instances + 1}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || !service.running}
                  onClick={() => void submit(() => api.scale(service.service_id, service.instances - 1))}
                >
                  Scale to {Math.max(0, service.instances - 1)}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || !service.running}
                  onClick={() => void submit(() => api.stop(service.service_id))}
                >
                  Stop service
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void submit(() => api.refresh(service.service_id))}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Refresh observation
                </button>
              </div>

              {verdict && (
                <div
                  className={`rounded-lg border p-4 ${
                    verdict.safety.decision === 'blocked'
                      ? 'border-warn/30 bg-warn/[0.06]'
                      : verdict.status === 'failed'
                      ? 'border-danger/30 bg-danger/[0.06]'
                      : 'border-ok/30 bg-ok/[0.06]'
                  }`}
                >
                  <p
                    className={`text-xs font-semibold ${
                      verdict.safety.decision === 'blocked'
                        ? 'text-warn'
                        : verdict.status === 'failed'
                        ? 'text-danger'
                        : 'text-ok'
                    }`}
                  >
                    {verdict.safety.decision === 'blocked'
                      ? 'ACTION BLOCKED'
                      : verdict.status === 'failed'
                      ? `ACTION FAILED — ${verdict.error}`
                      : 'ACTION APPLIED'}
                  </p>
                  <p className="mt-1 text-2xs leading-relaxed text-muted">{verdict.safety.reason}</p>
                  <ul className="mt-2 divide-y divide-lineSoft">
                    {verdict.safety.checks.map((check) => (
                      <CheckRow key={check.id} check={check} />
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {CHARTS.map((chart) => (
                  <div key={chart.metric} className="rounded-lg border border-line bg-raised/30 p-3">
                    <p className="metric-label mb-1">{chart.title}</p>
                    <MetricChart
                      points={history}
                      metric={chart.metric}
                      threshold={chart.metric === 'latency' ? service.max_latency_ms : null}
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-line bg-raised/30">
                <p className="border-b border-lineSoft px-4 py-2.5 text-xs font-semibold text-ink">
                  Recent events
                </p>
                <ul className="divide-y divide-lineSoft">
                  {events.length === 0 && <li className="px-4 py-4 text-xs text-muted">No events recorded yet.</li>}
                  {events.slice(0, 8).map((event) => (
                    <li key={event.event_id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="num shrink-0 text-2xs text-dim">{clockTime(event.timestamp)}</span>
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                          event.severity === 'critical'
                            ? 'bg-danger'
                            : event.severity === 'warning'
                            ? 'bg-warn'
                            : 'bg-signal'
                        }`}
                      />
                      <span className="text-2xs leading-relaxed text-muted">{event.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
