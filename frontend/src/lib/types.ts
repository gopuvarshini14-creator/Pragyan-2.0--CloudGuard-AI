export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'stopped';

export interface Freshness {
  observed_at: string;
  age_minutes: number;
  threshold_minutes: number;
  stale: boolean;
}

export interface TrafficTrend {
  change_percent: number;
  direction: 'rising' | 'falling' | 'flat';
  recent_rpm: number;
  previous_rpm: number;
}

export interface Service {
  service_id: string;
  display_name: string;
  cpu_percent: number;
  memory_percent: number;
  requests_per_minute: number;
  previous_requests_per_minute: number;
  latency_ms: number;
  instances: number;
  cost_per_hour: number;
  min_instances: number;
  max_instances: number;
  max_latency_ms: number;
  healthy: boolean;
  critical: boolean;
  workload_type: string;
  size: string;
  status: 'running' | 'stopped';
  timestamp: string;
  running: boolean;
  cost_per_hour_total: number;
  cost_per_hour_per_instance: number;
  projected_monthly_cost: number;
  traffic_feed_rpm: number;
  traffic_trend: TrafficTrend;
  freshness: Freshness;
  signals: string[];
  optimization: string;
  health_state: HealthState;
  idle: boolean;
  headroom_instances: number;
}

export interface HistoryPoint {
  timestamp: string;
  requests_per_minute: number;
  cpu_percent: number;
  memory_percent: number;
  latency_ms: number;
  instances: number;
  cost_per_hour: number;
}

export interface CloudEvent {
  event_id: string;
  service_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  timestamp: string;
}

export interface Money {
  per_hour: number;
  per_day: number;
  per_month: number;
}

export interface Opportunity {
  service_id: string;
  type: string;
  action: string;
  savings_per_hour: number;
  target_instances?: number;
  confidence: string;
  description: string;
}

export interface CostTrendPoint {
  timestamp: string;
  expected: number;
  actual: number | null;
  projected: number | null;
}

export interface CostSummary {
  actual: Money;
  expected: Money;
  projected_after_optimization: Money;
  potential_savings: Money;
  overspend_percent: number;
  overspend: Money;
  high_confidence_opportunities: number;
  services_monitored: number;
  services_healthy: number;
  services_attention: number;
  opportunities: Opportunity[];
  by_service: Array<{
    service_id: string;
    display_name: string;
    cost_per_hour: number;
    projected_monthly: number;
    instances: number;
    share_percent: number;
    savings_per_hour: number;
  }>;
  trend: CostTrendPoint[];
}

export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface PolicyCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SafetyVerdict {
  decision: 'approved' | 'blocked';
  approved: boolean;
  action: string;
  service_id: string;
  target_instances: number | null;
  predicted_latency_ms: number | null;
  reason: string;
  checks: PolicyCheck[];
  policies_evaluated: number;
  blocked_by: string | null;
  evaluated_at: string;
}

export interface ActionSnapshot {
  instances: number;
  status: string;
  size: string;
  cpu_percent: number;
  memory_percent: number;
  latency_ms: number;
  requests_per_minute: number;
  cost_per_hour: number;
}

export interface CloudAction {
  action_id: string;
  service_id: string;
  action: string;
  requested_state: string;
  status: 'success' | 'failed' | 'blocked';
  error: string | null;
  error_detail: string | null;
  before: ActionSnapshot | null;
  after: ActionSnapshot | null;
  run_id: string | null;
  source: string;
  created_at: string;
  completed_at: string;
}

export interface Verification {
  status: 'passed' | 'failed';
  service_id: string;
  verified_at?: string;
  observed?: Record<string, number | string>;
  checks: PolicyCheck[];
  summary: string;
}

export type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'blocked' | 'warning';

export interface AgentStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  duration_ms: number;
}

export interface ToolCall {
  sequence: number;
  method: string;
  path: string;
  summary: string;
  status: 'ok' | 'warning' | 'error' | 'blocked';
  at: string;
}

export interface TimelineEntry {
  at: string;
  time: string;
  label: string;
}

export interface AgentAttempt {
  sequence: number;
  action: string;
  service_id: string;
  target_instances: number | null;
  problem: string | null;
  rationale: string | null;
  safety: SafetyVerdict;
  safety_decision: string;
  safety_reason: string;
  execution: CloudAction | null;
  execution_status: string;
  execution_error: string | null;
  verification: Verification | null;
  verification_status: string;
}

export interface AgentRun {
  run_id: string;
  status: string;
  agent_mode: 'DEMO' | 'LLM';
  decision_source: string;
  prompt: string;
  intent: string;
  intent_label: string;
  scenario_id: string | null;
  service_id: string;
  problem: string;
  decision: string;
  action: string;
  target_instances: number | null;
  rationale: string;
  safety: SafetyVerdict;
  execution: CloudAction | null;
  verification: Verification | null;
  attempts: AgentAttempt[];
  blocked: boolean;
  blocked_message: string | null;
  blocked_reason: string | null;
  cost_impact: {
    before_per_hour: number;
    after_per_hour: number;
    delta_per_hour: number;
    savings: Money;
    projected_monthly_before: number;
    projected_monthly_after: number;
    overspend_percent_before: number;
    overspend_percent_after: number;
  };
  steps: AgentStep[];
  tool_calls: ToolCall[];
  timeline: TimelineEntry[];
  notes: string[];
  outcome: 'succeeded' | 'failed' | 'blocked';
  savings_per_hour: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  final_message: string;
}

export interface AgentRunSummary {
  run_id: string;
  prompt: string;
  service_id: string;
  action: string;
  status: string;
  outcome: 'succeeded' | 'failed' | 'blocked';
  blocked: boolean;
  agent_mode: string;
  scenario_id: string | null;
  savings_per_hour: number;
  savings_per_month: number;
  duration_ms: number;
  started_at: string;
  completed_at: string;
}

export interface Scenario {
  id: string;
  letter: string;
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
  focus_service: string;
  expected: { service_id: string; action: string; safety: string; outcome?: string };
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  applies_to: string[];
  enabled: boolean;
  threshold: string | null;
}

export interface Health {
  status: string;
  service: string;
  version: string;
  agent_mode: 'DEMO' | 'LLM';
  ai_provider: string;
  simulated_time: string;
  services_loaded: number;
  data_freshness_threshold_minutes: number;
  uptime_seconds: number;
}
