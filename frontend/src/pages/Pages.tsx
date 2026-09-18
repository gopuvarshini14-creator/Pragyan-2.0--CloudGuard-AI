import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Inbox,
  Loader2,
  RotateCcw,
  ScrollText,
  Shield,
  Sparkles,
  Zap
} from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { CostByServiceChart, SavingsProjectionChart } from '../components/Charts';
import PromptConsole from '../components/PromptConsole';
import { Badge, EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from '../components/Primitives';
import {
  actionLabel,
  clockTime,
  compactMoney,
  count,
  duration,
  errorLabel,
  money,
  percent,
  shortTime
} from '../lib/format';

/* ------------------------------------------------------------------ Cost */

export function CostAnalysisPage() {
  const { cost, error, refresh } = useStore();

  if (error) {
    return (
      <div className="p-5 sm:p-6">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  if (!cost) {
    return (
      <div className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Current spend" value={`${money(cost.actual.per_hour)}/hr`} sub={compactMoney(cost.actual.per_month) + ' per month'} />
        <Figure
          label="Projected spend"
          value={compactMoney(cost.actual.per_month)}
          sub={`${percent(cost.overspend_percent)} above the ${compactMoney(cost.expected.per_month)} plan`}
          tone="warn"
        />
        <Figure
          label="Potential savings"
          value={compactMoney(cost.potential_savings.per_month)}
          sub={`${money(cost.potential_savings.per_hour)}/hr recoverable now`}
          tone="ok"
        />
        <Figure
          label="Spend after optimization"
          value={compactMoney(cost.projected_after_optimization.per_month)}
          sub={`${money(cost.projected_after_optimization.per_hour)}/hr run rate`}
          tone="signal"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Cost by service" note="Hourly spend and the portion that is recoverable" className="xl:col-span-2" bodyClassName="p-4">
          <CostByServiceChart cost={cost} />
        </Panel>
        <Panel title="Savings projection" note="Monthly run rate at each stage" bodyClassName="p-4">
          <SavingsProjectionChart cost={cost} />
        </Panel>
      </div>

      <Panel title="Savings by service" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-raised/40">
                <th className="th">Service</th>
                <th className="th">Instances</th>
                <th className="th text-right">Cost/hr</th>
                <th className="th text-right">Projected monthly</th>
                <th className="th text-right">Share</th>
                <th className="th text-right">Recoverable/hr</th>
              </tr>
            </thead>
            <tbody>
              {cost.by_service.map((row) => (
                <tr key={row.service_id} className="border-b border-lineSoft">
                  <td className="cell num text-ink">{row.service_id}</td>
                  <td className="cell num text-muted">{row.instances}</td>
                  <td className="cell num text-right text-ink">{money(row.cost_per_hour)}</td>
                  <td className="cell num text-right text-muted">{compactMoney(row.projected_monthly)}</td>
                  <td className="cell num text-right text-muted">{percent(row.share_percent, 1)}</td>
                  <td className={`cell num text-right ${row.savings_per_hour > 0 ? 'text-ok' : 'text-dim'}`}>
                    {row.savings_per_hour > 0 ? money(row.savings_per_hour) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Optimization opportunities" note="Detected deterministically from current state" bodyClassName="p-0">
        {cost.opportunities.length === 0 ? (
          <EmptyState
            title="Nothing to recover right now"
            body="Every service is inside its utilisation, latency and capacity bounds."
            icon={<CheckCircle2 size={22} />}
          />
        ) : (
          <ul className="divide-y divide-lineSoft">
            {cost.opportunities.map((opportunity, index) => (
              <li key={`${opportunity.service_id}-${index}`} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <Badge
                  tone={
                    opportunity.confidence === 'high'
                      ? 'ok'
                      : opportunity.confidence === 'blocked'
                      ? 'warn'
                      : 'info'
                  }
                >
                  {opportunity.confidence}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="num text-sm text-ink">
                    {opportunity.service_id} · {actionLabel(opportunity.action)}
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-muted">{opportunity.description}</p>
                </div>
                <p className={`num shrink-0 text-sm ${opportunity.savings_per_hour > 0 ? 'text-ok' : 'text-dim'}`}>
                  {opportunity.savings_per_hour > 0 ? `${money(opportunity.savings_per_hour)}/hr` : 'no saving'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  tone = 'ink'
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ink' | 'warn' | 'ok' | 'signal';
}) {
  const tones: Record<string, string> = {
    ink: 'text-ink',
    warn: 'text-warn',
    ok: 'text-ok',
    signal: 'text-signal'
  };
  return (
    <div className="panel px-4 py-3.5">
      <p className="metric-label">{label}</p>
      <p className={`num mt-1.5 text-xl font-semibold ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-2xs text-muted">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------- Agent runs */

export function AgentRunsPage() {
  const { runs, openRun } = useStore();

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <PromptConsole />

      <Panel
        title="Agent runs"
        note="Every investigation the agent has carried out in this session"
        bodyClassName="p-0"
      >
        {runs.length === 0 ? (
          <EmptyState
            title="No agent runs yet"
            body="Start one from the dashboard, or run a scenario from the simulator to see the full workflow."
            icon={<Sparkles size={22} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-line bg-raised/40">
                  <th className="th">Run ID</th>
                  <th className="th">Request</th>
                  <th className="th">Service</th>
                  <th className="th">Action</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Savings</th>
                  <th className="th text-right">Duration</th>
                  <th className="th text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.run_id} className="row-link" onClick={() => void openRun(run.run_id)}>
                    <td className="cell num text-signal">{run.run_id}</td>
                    <td className="cell max-w-[280px] truncate text-xs text-muted">{run.prompt}</td>
                    <td className="cell num text-xs text-ink">{run.service_id}</td>
                    <td className="cell text-xs text-ink">{actionLabel(run.action)}</td>
                    <td className="cell">
                      <StatusBadge status={run.outcome} />
                    </td>
                    <td className={`cell num text-right text-xs ${run.savings_per_hour > 0 ? 'text-ok' : 'text-dim'}`}>
                      {run.savings_per_hour > 0 ? `${money(run.savings_per_hour)}/hr` : '—'}
                    </td>
                    <td className="cell num text-right text-xs text-muted">{duration(run.duration_ms)}</td>
                    <td className="cell num text-right text-xs text-dim">{clockTime(run.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- Actions */

export function ActionsPage() {
  const { actions } = useStore();

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <Panel
        title="Cloud actions"
        note="Every change submitted to the simulated control plane, including the ones that were blocked or rejected"
        bodyClassName="p-0"
      >
        {actions.length === 0 ? (
          <EmptyState
            title="No actions submitted yet"
            body="Run the agent or use the manual controls on a service to submit a change."
            icon={<Zap size={22} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-line bg-raised/40">
                  <th className="th">Action ID</th>
                  <th className="th">Service</th>
                  <th className="th">Action</th>
                  <th className="th">Requested state</th>
                  <th className="th">Status</th>
                  <th className="th">Result</th>
                  <th className="th text-right">Created</th>
                  <th className="th text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.action_id} className="border-b border-lineSoft">
                    <td className="cell num text-xs text-signal">{action.action_id}</td>
                    <td className="cell num text-xs text-ink">{action.service_id}</td>
                    <td className="cell text-xs text-ink">{actionLabel(action.action)}</td>
                    <td className="cell num text-xs text-muted">{action.requested_state}</td>
                    <td className="cell">
                      <StatusBadge status={action.status} />
                    </td>
                    <td className="cell max-w-[260px] text-2xs text-muted">
                      {action.status === 'success' && action.before && action.after
                        ? `${action.before.instances} → ${action.after.instances} instances`
                        : action.error
                        ? <span className="num text-danger">{errorLabel(action.error)}</span>
                        : '—'}
                    </td>
                    <td className="cell num text-right text-2xs text-dim">{clockTime(action.created_at)}</td>
                    <td className="cell num text-right text-2xs text-dim">{clockTime(action.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- Events */

export function EventsPage() {
  const { events } = useStore();
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? events : events.filter((event) => event.severity === filter);

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <Panel
        title="Event log"
        note="Observations, actions and agent activity across the simulated estate"
        actions={
          <div className="flex gap-1.5">
            {['all', 'info', 'warning', 'critical'].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setFilter(level)}
                className={`rounded border px-2.5 py-1 text-2xs transition-colors ${
                  filter === level ? 'border-signal/40 bg-signal/12 text-signal' : 'border-line text-muted hover:text-ink'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        {filtered.length === 0 ? (
          <EmptyState title="No events at this level" body="Change the filter or run the agent to generate activity." icon={<ScrollText size={22} />} />
        ) : (
          <ul className="divide-y divide-lineSoft">
            {filtered.map((event) => (
              <li key={event.event_id} className="flex items-start gap-3 px-5 py-3">
                <span className="num w-[62px] shrink-0 text-2xs text-dim">{clockTime(event.timestamp)}</span>
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    event.severity === 'critical' ? 'bg-danger' : event.severity === 'warning' ? 'bg-warn' : 'bg-signal'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed text-ink">{event.message}</p>
                  <p className="num mt-0.5 text-2xs text-dim">
                    {event.service_id ?? 'estate'} · {event.type}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- Policies */

export function PoliciesPage() {
  const { policies } = useStore();
  const [thresholds, setThresholds] = useState<Record<string, number> | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .policies()
      .then((data) => {
        if (cancelled) return;
        setThresholds(data.thresholds);
        setAllowed(data.allowed_actions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <div className="rounded-lg border border-signal/25 bg-signal/[0.06] px-5 py-4">
        <div className="flex items-start gap-3">
          <Shield size={16} className="mt-0.5 shrink-0 text-signal" />
          <div>
            <p className="text-sm font-semibold text-ink">The agent proposes. The policy engine decides.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Every proposal is evaluated against these rules before it reaches the cloud simulation. The rules are
              deterministic code, not model output, and the agent has no path around them. Policies are read-only in
              this demo build.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {policies.map((policy) => (
          <article key={policy.id} className="panel flex flex-col px-4 py-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-ink">{policy.name}</p>
              <Badge tone={policy.enabled ? 'ok' : 'neutral'}>{policy.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </div>
            <p className="mt-2 flex-1 text-2xs leading-relaxed text-muted">{policy.description}</p>
            {policy.threshold && <p className="num mt-2 text-2xs text-signal">Threshold: {policy.threshold}</p>}
            <div className="mt-3 flex flex-wrap gap-1">
              {policy.applies_to.map((action) => (
                <span key={action} className="num rounded bg-raised px-1.5 py-0.5 text-2xs text-dim">
                  {action}
                </span>
              ))}
            </div>
          </article>
        ))}
        {policies.length === 0 && <Skeleton className="h-40 sm:col-span-2 xl:col-span-3" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Thresholds" note="Values the policy engine compares against">
          {thresholds ? (
            <dl className="divide-y divide-lineSoft">
              {Object.entries(thresholds).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between py-2">
                  <dt className="text-xs text-muted">{key.replace(/_/g, ' ')}</dt>
                  <dd className="num text-xs text-ink">{count(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>

        <Panel title="Permitted actions" note="The complete action vocabulary available to the agent">
          <div className="flex flex-wrap gap-2">
            {allowed.map((action) => (
              <span key={action} className="num rounded border border-line bg-raised px-2.5 py-1 text-xs text-muted">
                {action}
              </span>
            ))}
            {allowed.length === 0 && <Skeleton className="h-8 w-full" />}
          </div>
          <p className="mt-4 text-2xs leading-relaxed text-muted">
            Anything outside this list is rejected before evaluation. An LLM proposal naming an unknown action or an
            unknown service is discarded and the deterministic agent decides instead.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Settings */

export function SettingsPage() {
  const { health, resetSimulation, resetting, agent } = useStore();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .settings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [health?.uptime_seconds]);

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Agent mode" note="How the reasoning layer is currently configured">
          <div className="flex items-center gap-3">
            <span
              className={`num rounded-md border px-3 py-1.5 text-sm font-semibold ${
                health?.agent_mode === 'LLM'
                  ? 'border-agent/40 bg-agent/10 text-agent'
                  : 'border-signal/40 bg-signal/10 text-signal'
              }`}
            >
              Agent Mode: {health?.agent_mode ?? 'DEMO'}
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            In <span className="num text-ink">DEMO</span> mode the reasoning layer is a deterministic rule engine that
            runs the same investigate, decide, validate, execute and verify workflow. No API key is required and the
            demo cannot break because a key is missing.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Set <span className="num text-ink">AI_PROVIDER</span> to <span className="num text-ink">anthropic</span> or{' '}
            <span className="num text-ink">openai</span> and supply <span className="num text-ink">AI_API_KEY</span> to
            switch to <span className="num text-ink">LLM</span> mode. The model only proposes an action; the safety
            engine still decides, and any malformed or unsafe proposal falls back to the demo agent.
          </p>
        </Panel>

        <Panel title="Runtime" note="Reported by the backend container">
          {settings ? (
            <dl className="divide-y divide-lineSoft">
              {Object.entries(settings).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-xs text-muted">{key.replace(/_/g, ' ')}</dt>
                  <dd className="num max-w-[60%] break-words text-right text-xs text-ink">
                    {value === null ? '—' : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <Skeleton className="h-48" />
          )}
        </Panel>
      </div>

      <Panel title="Reset simulation" note="Restore every service, action, event and agent run to the seeded state">
        <p className="text-xs leading-relaxed text-muted">
          Resetting returns the estate to four services at{' '}
          <span className="num text-ink">$321.00/hour</span>, clears the action and run history, and re-freezes the
          checkout API observation so the stale-data scenario can be demonstrated again. Nothing outside this
          container is touched.
        </p>
        <button
          type="button"
          className="btn-danger mt-4"
          onClick={() => void resetSimulation()}
          disabled={resetting || agent.status === 'running'}
        >
          {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Reset simulation
        </button>
      </Panel>

      <Panel title="Health" note="GET /api/health">
        {health ? (
          <dl className="grid gap-4 sm:grid-cols-3">
            <Stat label="Status" value={health.status} tone="ok" />
            <Stat label="Version" value={health.version} />
            <Stat label="Services loaded" value={String(health.services_loaded)} />
            <Stat label="Simulated time" value={shortTime(health.simulated_time)} />
            <Stat label="Freshness threshold" value={`${health.data_freshness_threshold_minutes} min`} />
            <Stat label="Uptime" value={`${health.uptime_seconds}s`} />
          </dl>
        ) : (
          <EmptyState title="Backend unreachable" body="The health endpoint did not respond." icon={<Inbox size={22} />} />
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'ok' }) {
  return (
    <div>
      <dt className="metric-label">{label}</dt>
      <dd className={`num mt-1 text-sm ${tone === 'ok' ? 'text-ok' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
