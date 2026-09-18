export function money(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export function compactMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return money(value);
}

export function count(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function percent(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function signedPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function relativeAge(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    scale_up: 'Scale up',
    scale_down: 'Scale down',
    resize: 'Resize',
    stop_idle_service: 'Stop idle service',
    delay_batch: 'Delay batch',
    no_action: 'No action',
    refresh_observation: 'Refresh observation'
  };
  return map[action] || action;
}

export function errorLabel(code: string | null | undefined): string {
  if (!code) return '';
  return code.replace(/_/g, ' ');
}

export const healthTone: Record<string, string> = {
  healthy: 'text-ok',
  degraded: 'text-warn',
  unhealthy: 'text-danger',
  unknown: 'text-muted',
  stopped: 'text-dim'
};

export const healthLabel: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
  stopped: 'Stopped'
};

export function utilisationTone(value: number, high = 75, mid = 55): string {
  if (value >= high) return 'text-danger';
  if (value >= mid) return 'text-warn';
  return 'text-ink';
}
