import type {
  AgentRun,
  AgentRunSummary,
  CloudAction,
  CloudEvent,
  CostSummary,
  Health,
  HistoryPoint,
  Policy,
  SafetyVerdict,
  Scenario,
  Service,
  Verification
} from './types';

// Relative base: nginx proxies /api to the backend container, and the Vite dev
// server proxies it to localhost:5000. No host address is ever hardcoded.
const BASE = '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  payload: unknown;

  constructor(status: number, code: string, message: string, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init
    });
  } catch (err) {
    throw new ApiError(0, 'network_error', 'The CloudGuard API is unreachable. Check that the backend container is running.');
  }

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      payload = null;
    }
  }

  if (!response.ok) {
    // 403 and 409 carry meaningful bodies (safety blocks and cloud failures).
    if (payload && (payload.safety || payload.action)) return payload as T;
    throw new ApiError(
      response.status,
      (payload && payload.error) || 'request_failed',
      (payload && payload.message) || `Request to ${path} failed with status ${response.status}.`,
      payload
    );
  }

  return payload as T;
}

export const api = {
  health: () => request<Health>('/health'),

  services: () => request<{ services: Service[]; count: number }>('/services'),

  service: (id: string) =>
    request<{ service: Service; history: HistoryPoint[]; events: CloudEvent[] }>(`/services/${id}`),

  traffic: (id: string) =>
    request<{ service_id: string; current_rpm: number; points: HistoryPoint[] }>(`/services/${id}/traffic`),

  serviceEvents: (id: string) => request<{ events: CloudEvent[] }>(`/services/${id}/events`),

  verify: (id: string) => request<Verification>(`/services/${id}/verify`),

  cost: () => request<CostSummary>('/cost'),

  events: () => request<{ events: CloudEvent[] }>('/events'),

  actions: () => request<{ actions: CloudAction[] }>('/actions'),

  action: (id: string) => request<{ action: CloudAction }>(`/actions/${id}`),

  policies: () =>
    request<{ policies: Policy[]; thresholds: Record<string, number>; allowed_actions: string[] }>('/policies'),

  scenarios: () => request<{ scenarios: Scenario[] }>('/scenarios'),

  settings: () => request<Record<string, unknown>>('/settings'),

  runAgent: (prompt?: string, focusService?: string) =>
    request<AgentRun>('/agent/run', {
      method: 'POST',
      body: JSON.stringify({ prompt, focus_service: focusService })
    }),

  runs: () => request<{ runs: AgentRunSummary[] }>('/agent/runs'),

  run: (id: string) => request<AgentRun>(`/agent/runs/${id}`),

  runScenario: (id: string) =>
    request<{ scenario: Scenario; run: AgentRun }>(`/scenarios/${id}/run`, { method: 'POST' }),

  scale: (serviceId: string, targetInstances: number) =>
    request<{ action: CloudAction; safety: SafetyVerdict; verification: Verification | null }>('/actions/scale', {
      method: 'POST',
      body: JSON.stringify({ service_id: serviceId, target_instances: targetInstances })
    }),

  stop: (serviceId: string) =>
    request<{ action: CloudAction; safety: SafetyVerdict; verification: Verification | null }>('/actions/stop', {
      method: 'POST',
      body: JSON.stringify({ service_id: serviceId })
    }),

  delayBatch: (serviceId: string) =>
    request<{ action: CloudAction; safety: SafetyVerdict; verification: Verification | null }>(
      '/actions/delay-batch',
      { method: 'POST', body: JSON.stringify({ service_id: serviceId }) }
    ),

  refresh: (serviceId: string) =>
    request<{ action: CloudAction; safety: SafetyVerdict; verification: Verification | null }>('/actions/refresh', {
      method: 'POST',
      body: JSON.stringify({ service_id: serviceId })
    }),

  reset: () => request<{ status: string; message: string }>('/reset', { method: 'POST' })
};
