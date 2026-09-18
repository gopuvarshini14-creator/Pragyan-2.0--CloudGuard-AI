import type { ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Circle, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import type { CheckStatus, PolicyCheck } from '../lib/types';

export function Panel({
  title,
  note,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5'
}: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="panel-title">{title}</h2>}
            {note && <p className="panel-note mt-0.5">{note}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-signal/30 bg-signal/10 text-signal',
  agent: 'border-agent/30 bg-agent/10 text-agent',
  neutral: 'border-line bg-raised text-muted'
};

export function Badge({
  tone = 'neutral',
  children,
  icon
}: {
  tone?: keyof typeof TONES | string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className={`chip ${TONES[tone] || TONES.neutral}`}>
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: string; label: string; icon: ReactNode }> = {
    success: { tone: 'ok', label: 'SUCCESS', icon: <CheckCircle2 size={11} /> },
    succeeded: { tone: 'ok', label: 'SUCCESS', icon: <CheckCircle2 size={11} /> },
    passed: { tone: 'ok', label: 'PASSED', icon: <CheckCircle2 size={11} /> },
    approved: { tone: 'ok', label: 'APPROVED', icon: <CheckCircle2 size={11} /> },
    failed: { tone: 'danger', label: 'FAILED', icon: <XCircle size={11} /> },
    blocked: { tone: 'warn', label: 'BLOCKED', icon: <Ban size={11} /> },
    running: { tone: 'info', label: 'RUNNING', icon: <Loader2 size={11} className="animate-spin" /> },
    completed: { tone: 'ok', label: 'COMPLETED', icon: <CheckCircle2 size={11} /> }
  };
  const entry = map[status] || { tone: 'neutral', label: status.toUpperCase(), icon: null };
  return (
    <Badge tone={entry.tone} icon={entry.icon}>
      {entry.label}
    </Badge>
  );
}

export function HealthDot({ state }: { state: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-ok',
    degraded: 'bg-warn',
    unhealthy: 'bg-danger',
    unknown: 'bg-muted',
    stopped: 'bg-dim'
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className={`h-2 w-2 rounded-full ${colors[state] || 'bg-muted'}`} />
      {state === 'healthy' && (
        <span className="absolute inset-0 rounded-full bg-ok/60 animate-pulseRing" aria-hidden="true" />
      )}
    </span>
  );
}

export function Meter({ value, max = 100, tone = 'signal' }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar =
    tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : tone === 'ok' ? 'bg-ok' : 'bg-signal';
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line" role="presentation">
      <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CheckRow({ check }: { check: PolicyCheck }) {
  const icons: Record<CheckStatus, ReactNode> = {
    passed: <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />,
    failed: <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />,
    skipped: <Circle size={14} className="mt-0.5 shrink-0 text-dim" />
  };
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {icons[check.status] || icons.skipped}
      <div className="min-w-0">
        <p className={`text-xs font-medium ${check.status === 'failed' ? 'text-danger' : 'text-ink'}`}>
          {check.label}
        </p>
        <p className="text-2xs leading-relaxed text-muted">{check.detail}</p>
      </div>
    </li>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 text-dim">{icon || <Circle size={22} />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger/30 bg-danger/[0.07] p-5">
      <div className="flex items-center gap-2 text-danger">
        <ShieldAlert size={16} />
        <p className="text-sm font-semibold">Cannot reach the simulation engine</p>
      </div>
      <p className="text-xs leading-relaxed text-muted">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Warning({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/[0.07] p-4">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-warn">{title}</p>
        <div className="mt-1 text-2xs leading-relaxed text-muted">{body}</div>
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded bg-raised ${className}`}>
      <div className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent animate-sweep" />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="metric-label">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}
