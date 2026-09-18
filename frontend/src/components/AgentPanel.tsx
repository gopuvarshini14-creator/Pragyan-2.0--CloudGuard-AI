import { useEffect, useRef } from 'react';
import {
  Ban,
  Check,
  CircleDashed,
  Loader2,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  XCircle
} from 'lucide-react';
import { STEP_BLUEPRINT, useStore } from '../lib/store';
import type { AgentAttempt, AgentRun, StepStatus } from '../lib/types';
import { actionLabel, clockTime, compactMoney, duration, money } from '../lib/format';
import { Badge, CheckRow, ErrorState, StatusBadge } from './Primitives';

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <Check size={12} className="text-ok" />;
  if (status === 'warning') return <Check size={12} className="text-warn" />;
  if (status === 'failed') return <XCircle size={12} className="text-danger" />;
  if (status === 'blocked') return <Ban size={12} className="text-warn" />;
  if (status === 'active') return <Loader2 size={12} className="animate-spin text-signal" />;
  return <CircleDashed size={12} className="text-dim" />;
}

function WorkflowSteps({ run, activeStep, running }: { run: AgentRun | null; activeStep: number; running: boolean }) {
  const steps = STEP_BLUEPRINT.map((blueprint, index) => {
    const recorded = run?.steps.find((s) => s.id === blueprint.id);
    let status: StepStatus = 'pending';
    if (running) {
      if (index < activeStep) status = 'done';
      else if (index === activeStep) status = 'active';
    } else if (recorded) {
      status = recorded.status;
    }
    return { ...blueprint, status, detail: running ? null : recorded?.detail ?? null };
  });

  return (
    <ol className="space-y-0.5">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors ${
            step.status === 'active' ? 'bg-signal/[0.08]' : ''
          }`}
        >
          <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center">
            <StepIcon status={step.status} />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-xs ${
                step.status === 'pending'
                  ? 'text-dim'
                  : step.status === 'failed'
                  ? 'text-danger'
                  : step.status === 'blocked' || step.status === 'warning'
                  ? 'text-warn'
                  : 'text-ink'
              }`}
            >
              {step.label}
            </p>
            {step.detail && <p className="mt-0.5 text-2xs leading-relaxed text-muted">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ToolActivity({ run }: { run: AgentRun }) {
  const tones: Record<string, string> = {
    ok: 'text-ok',
    warning: 'text-warn',
    blocked: 'text-warn',
    error: 'text-danger'
  };
  return (
    <ul className="space-y-1.5">
      {run.tool_calls.map((call) => (
        <li key={`${call.sequence}-${call.path}`} className="rounded-md border border-lineSoft bg-raised/40 px-3 py-2">
          <p className="num flex items-center gap-2 text-2xs text-muted">
            <span className={call.method === 'POST' ? 'text-agent' : 'text-signal'}>{call.method}</span>
            <span className="truncate text-ink">{call.path}</span>
          </p>
          <p className={`mt-1 flex items-center gap-1.5 text-2xs ${tones[call.status] || 'text-muted'}`}>
            {call.status === 'ok' ? <Check size={10} /> : <XCircle size={10} />}
            {call.summary}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DecisionCard({ run }: { run: AgentRun }) {
  const savings = run.cost_impact.savings;
  return (
    <div className="rounded-lg border border-line bg-raised/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">Agent decision</p>
        <StatusBadge status={run.outcome} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="metric-label">Service</dt>
          <dd className="num mt-0.5 text-sm text-ink">{run.service_id}</dd>
        </div>
        <div>
          <dt className="metric-label">Decision</dt>
          <dd className="mt-0.5 text-sm text-ink">{run.decision}</dd>
        </div>
        <div className="col-span-2">
          <dt className="metric-label">Problem</dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-muted">{run.problem}</dd>
        </div>
        <div>
          <dt className="metric-label">Safety</dt>
          <dd className="mt-1">
            <StatusBadge status={run.safety.decision === 'approved' ? 'passed' : 'blocked'} />
          </dd>
        </div>
        <div>
          <dt className="metric-label">Verification</dt>
          <dd className="mt-1">
            {run.verification ? (
              <StatusBadge status={run.verification.status} />
            ) : (
              <Badge tone="neutral">NOT RUN</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="metric-label">Estimated savings</dt>
          <dd className="num mt-0.5 text-sm text-ok">
            {savings.per_hour > 0 ? `${money(savings.per_hour)}/hour` : 'No change'}
          </dd>
        </div>
        <div>
          <dt className="metric-label">Monthly impact</dt>
          <dd className="num mt-0.5 text-sm text-ok">
            {savings.per_month > 0 ? compactMoney(savings.per_month) : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SafetyPanel({ attempt }: { attempt: AgentAttempt }) {
  const blocked = attempt.safety.decision === 'blocked';
  return (
    <div
      className={`rounded-lg border p-4 ${
        blocked ? 'border-warn/30 bg-warn/[0.06]' : 'border-line bg-raised/40'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={13} className={blocked ? 'text-warn' : 'text-ok'} />
        <p className="text-xs font-semibold text-ink">
          Safety guardrails · {actionLabel(attempt.action)} on {attempt.service_id}
        </p>
      </div>
      {blocked && (
        <div className="mb-2 rounded-md border border-warn/30 bg-warn/[0.08] px-3 py-2">
          <p className="text-2xs font-semibold text-warn">ACTION BLOCKED</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted">
            <span className="text-dim">Reason: </span>
            {attempt.safety.reason}
          </p>
        </div>
      )}
      <ul className="divide-y divide-lineSoft">
        {attempt.safety.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      {attempt.execution && attempt.execution.status === 'failed' && (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger/[0.08] px-3 py-2">
          <p className="text-2xs font-semibold text-danger">ACTION FAILED</p>
          <p className="num mt-0.5 text-2xs text-danger">{attempt.execution.error}</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted">{attempt.execution.error_detail}</p>
        </div>
      )}
      {attempt.verification && (
        <div className="mt-3">
          <p className="metric-label mb-1">Post-action verification</p>
          <ul className="divide-y divide-lineSoft">
            {attempt.verification.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Timeline({ run }: { run: AgentRun }) {
  return (
    <ol className="relative space-y-3 pl-4">
      <span className="absolute left-[3px] top-1.5 bottom-1.5 w-px bg-line" aria-hidden="true" />
      {run.timeline.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="relative flex items-baseline gap-3">
          <span className="absolute -left-4 top-1.5 h-[7px] w-[7px] rounded-full border border-signal/60 bg-panel" />
          <span className="num w-[62px] shrink-0 text-2xs text-dim">{entry.time}</span>
          <span className="text-2xs text-muted">{entry.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function AgentPanel() {
  const { agent, panelOpen, closePanel } = useStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const run = agent.run;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel]);

  useEffect(() => {
    if (agent.status === 'done' && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [agent.status, run?.run_id]);

  if (!panelOpen) return null;

  const running = agent.status === 'running';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close agent panel" className="flex-1 bg-black/55" onClick={closePanel} />
      <div className="flex h-full w-full max-w-[540px] flex-col border-l border-line bg-panel shadow-drawer">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-md border border-agent/35 bg-agent/10">
              <Sparkles size={15} className="text-agent" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">AI Optimization Agent</h2>
              <p className="mt-0.5 text-2xs text-muted">
                {agent.scenario
                  ? `Scenario ${agent.scenario.letter} — ${agent.scenario.title}`
                  : run
                  ? `${run.run_id} · ${duration(run.duration_ms)} · mode ${run.agent_mode}`
                  : 'Investigating the simulated estate'}
              </p>
            </div>
          </div>
          <button type="button" className="text-muted hover:text-ink" onClick={closePanel} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {agent.status === 'error' && <ErrorState message={agent.error ?? 'The agent run failed.'} />}

          {(running || run) && (
            <div className="rounded-lg border border-line bg-raised/40 p-4">
              <p className="metric-label mb-2">Request</p>
              <p className="text-xs leading-relaxed text-muted">
                {run?.prompt ?? agent.scenario?.prompt ?? 'Review the current services and reduce unnecessary cost.'}
              </p>
            </div>
          )}

          {(running || run) && (
            <div>
              <p className="metric-label mb-2">Workflow</p>
              <WorkflowSteps run={run} activeStep={agent.activeStep} running={running} />
            </div>
          )}

          {run && run.blocked && run.blocked_message && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.07] px-4 py-3">
              <p className="text-xs font-semibold text-warn">{run.blocked_message}</p>
              {run.blocked_reason && (
                <p className="mt-1 text-2xs leading-relaxed text-muted">{run.blocked_reason}</p>
              )}
            </div>
          )}

          {run && !running && (
            <>
              <DecisionCard run={run} />

              <div>
                <p className="metric-label mb-2 flex items-center gap-1.5">
                  <Terminal size={11} /> Tool activity
                </p>
                <ToolActivity run={run} />
              </div>

              {run.attempts.map((attempt) => (
                <SafetyPanel key={`${attempt.sequence}-${attempt.action}`} attempt={attempt} />
              ))}

              <div>
                <p className="metric-label mb-2">Action timeline</p>
                <Timeline run={run} />
              </div>

              <div className="rounded-lg border border-signal/25 bg-signal/[0.06] p-4">
                <p className="metric-label mb-1.5">Final response</p>
                <p className="text-xs leading-relaxed text-ink">{run.final_message}</p>
              </div>

              <p className="num text-center text-2xs text-dim">
                Completed {clockTime(run.completed_at)} · {run.tool_calls.length} tool calls ·{' '}
                {run.safety.policies_evaluated} policies evaluated
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
