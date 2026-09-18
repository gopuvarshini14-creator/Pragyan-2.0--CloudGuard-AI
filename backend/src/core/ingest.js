'use strict';

const clock = require('./clock');
const state = require('./state');

/**
 * Accepts the service/environment JSON exactly as an external caller would
 * supply it (a services array, a single service, a stale metric plus a
 * fresher traffic reading, or a service plus the result of a previously
 * attempted action) and turns it into the fully-formed internal schema the
 * rest of the engine (observation, safety, simulation) already understands.
 *
 * This is the boundary between "whatever shape the request arrived in" and
 * "the one shape the deterministic engine reasons over" — nothing downstream
 * needs a special case for missing fields, inferred workload types, or
 * synthesized live readings.
 */

const REQUIRED_FIELDS = [
  'service_id',
  'cpu_percent',
  'memory_percent',
  'requests_per_minute',
  'latency_ms',
  'instances',
  'cost_per_hour',
  'min_instances',
  'max_instances',
  'max_latency_ms'
];

function titleCase(id) {
  return String(id)
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function inferWorkloadType(raw) {
  if (raw.workload_type) return raw.workload_type;
  return /worker|batch|job|cron/i.test(String(raw.service_id)) ? 'batch' : 'api';
}

function clampNum(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Sub-linear scaling, matching the shape of load-driven metric change used elsewhere in the simulation. */
function scaleByRatio(base, ratio, exponent, min, max) {
  const scaled = base * Math.pow(Math.max(ratio, 0.0001), exponent);
  return Math.round(clampNum(scaled, min, max) * 10) / 10;
}

function validateRaw(raw, label) {
  const missing = REQUIRED_FIELDS.filter((field) => raw[field] === undefined || raw[field] === null);
  if (missing.length) {
    return `${label} is missing required field(s): ${missing.join(', ')}.`;
  }
  return null;
}

/** Fills in every field the internal engine expects, inferring sensible defaults for anything omitted. */
function normalizeService(raw) {
  const workloadType = inferWorkloadType(raw);
  const rpm = Number(raw.requests_per_minute) || 0;
  const prevRpm = raw.previous_requests_per_minute != null ? Number(raw.previous_requests_per_minute) : rpm;

  let trafficProfile = raw.traffic_profile;
  if (!trafficProfile) {
    if (workloadType === 'batch' && rpm === 0) trafficProfile = 'idle_decline';
    else if (prevRpm > 0 && rpm > prevRpm * 1.2) trafficProfile = 'ramp';
    else trafficProfile = 'steady';
  }

  return {
    service_id: String(raw.service_id),
    display_name: raw.display_name || titleCase(raw.service_id),
    cpu_percent: Number(raw.cpu_percent),
    memory_percent: Number(raw.memory_percent),
    requests_per_minute: rpm,
    previous_requests_per_minute: prevRpm,
    latency_ms: Number(raw.latency_ms) || 0,
    instances: Number(raw.instances),
    cost_per_hour: Number(raw.cost_per_hour),
    min_instances: Number(raw.min_instances),
    max_instances: Number(raw.max_instances),
    max_latency_ms: Number(raw.max_latency_ms),
    healthy: raw.healthy != null ? Boolean(raw.healthy) : true,
    critical: raw.critical != null ? Boolean(raw.critical) : workloadType !== 'batch',
    workload_type: workloadType,
    size: raw.size || 'medium',
    status: raw.status || 'running',
    capacity_limit: raw.capacity_limit != null ? Number(raw.capacity_limit) : Number(raw.max_instances),
    observation_frozen: false,
    traffic_profile: trafficProfile,
    timestamp: raw.timestamp || clock.nowIso()
  };
}

/**
 * Builds the "what the cloud is doing right now" reading used when a stale
 * stored observation is paired with a fresher traffic sample. Any field the
 * caller actually supplied on the traffic reading wins; anything else is
 * estimated from the change in request rate.
 */
function buildLiveObservation(normalized, trafficReading) {
  const oldRpm = normalized.requests_per_minute;
  const newRpm = trafficReading.requests_per_minute != null ? Number(trafficReading.requests_per_minute) : oldRpm;

  if (oldRpm <= 0 || newRpm <= 0) {
    return {
      cpu_percent: trafficReading.cpu_percent != null ? Number(trafficReading.cpu_percent) : normalized.cpu_percent,
      memory_percent:
        trafficReading.memory_percent != null ? Number(trafficReading.memory_percent) : normalized.memory_percent,
      requests_per_minute: newRpm,
      latency_ms: trafficReading.latency_ms != null ? Number(trafficReading.latency_ms) : normalized.latency_ms,
      healthy: trafficReading.healthy != null ? Boolean(trafficReading.healthy) : normalized.healthy
    };
  }

  const ratio = newRpm / oldRpm;
  return {
    cpu_percent:
      trafficReading.cpu_percent != null
        ? Number(trafficReading.cpu_percent)
        : scaleByRatio(normalized.cpu_percent, ratio, 0.62, 1, 99),
    memory_percent:
      trafficReading.memory_percent != null
        ? Number(trafficReading.memory_percent)
        : scaleByRatio(normalized.memory_percent, ratio, 0.3, 1, 99),
    requests_per_minute: newRpm,
    latency_ms:
      trafficReading.latency_ms != null
        ? Number(trafficReading.latency_ms)
        : scaleByRatio(normalized.latency_ms, ratio, 0.2, Math.max(20, normalized.latency_ms * 0.5), 5000),
    healthy: trafficReading.healthy != null ? Boolean(trafficReading.healthy) : normalized.healthy
  };
}

/**
 * When the caller hands us the outcome of an action that was already
 * attempted and rejected by the cloud for lack of capacity, that is a fact
 * about the environment, not a suggestion. Folding it into capacity_limit
 * means a fresh proposal reproduces the same, honest failure deterministically
 * instead of silently pretending the earlier rejection never happened.
 */
function applyActionResultHint(normalized, actionResult) {
  if (!actionResult) return normalized;
  if (
    actionResult.status === 'failed' &&
    actionResult.error === 'capacity_unavailable' &&
    actionResult.requested_instances != null
  ) {
    const ceiling = Math.max(normalized.instances, Number(actionResult.requested_instances) - 1);
    if (normalized.capacity_limit == null || normalized.capacity_limit > ceiling) {
      normalized.capacity_limit = ceiling;
    }
    normalized.last_action_result = {
      action_id: actionResult.action_id || null,
      action: actionResult.action || null,
      requested_instances: actionResult.requested_instances,
      status: actionResult.status,
      error: actionResult.error
    };
  }
  return normalized;
}

/**
 * Turns a request body into a validated, normalized list of services ready
 * for state.loadCustom(). Supports every shape the agent is expected to
 * accept: a fleet-wide services array, a single service, a stale metric
 * paired with a fresher traffic reading, or a service paired with the result
 * of a previously attempted action.
 */
function fromRequest(body) {
  const raw = body || {};
  const rawList = [];

  if (Array.isArray(raw.services)) rawList.push(...raw.services);
  if (raw.service) rawList.push(raw.service);
  if (raw.metric) rawList.push(raw.metric);

  if (!rawList.length) {
    return { error: 'Provide "services" (an array), or "service", or "metric" describing the environment to evaluate.' };
  }

  for (let i = 0; i < rawList.length; i += 1) {
    const problem = validateRaw(rawList[i], rawList.length > 1 ? `services[${i}]` : 'service');
    if (problem) return { error: problem };
  }

  const normalized = rawList.map(normalizeService);

  if (raw.metric && raw.latest_traffic) {
    const targetId = raw.latest_traffic.service_id || raw.metric.service_id;
    const target = normalized.find((s) => s.service_id === targetId) || normalized[0];
    target.observation_frozen = true;
    target.live_observation = buildLiveObservation(target, raw.latest_traffic);
  }

  if (raw.service && raw.action_result) {
    const targetId = raw.action_result.service_id || raw.service.service_id;
    const target = normalized.find((s) => s.service_id === targetId) || normalized[0];
    applyActionResultHint(target, raw.action_result);
  }

  const focusService =
    raw.focus_service || raw.service_id || (normalized.length === 1 ? normalized[0].service_id : null);

  return { services: normalized, focus_service: focusService };
}

/** Loads the normalized services as the live simulation state. */
function load(services) {
  return state.loadCustom(services);
}

module.exports = { normalizeService, buildLiveObservation, applyActionResultHint, fromRequest, load };
