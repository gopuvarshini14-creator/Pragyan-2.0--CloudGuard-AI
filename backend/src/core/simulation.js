'use strict';

const { config } = require('./config');
const clock = require('./clock');
const state = require('./state');
const observation = require('./observation');

const round = state.round;

const SIZE_TIERS = {
  small: { factor: 0.55, cpu_multiplier: 1.6 },
  medium: { factor: 1, cpu_multiplier: 1 },
  large: { factor: 1.8, cpu_multiplier: 0.65 }
};

class ExecutionRejected extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function snapshot(service) {
  return {
    instances: service.instances,
    status: service.status,
    size: service.size,
    cpu_percent: service.cpu_percent,
    memory_percent: service.memory_percent,
    latency_ms: service.latency_ms,
    requests_per_minute: service.requests_per_minute,
    cost_per_hour: round(service.status === 'running' ? service.instances * service.cost_per_hour : 0, 2)
  };
}

function record(fields) {
  return state.addAction({
    action_id: state.nextActionId(),
    service_id: fields.service_id,
    action: fields.action,
    requested_state: fields.requested_state,
    status: fields.status,
    error: fields.error || null,
    error_detail: fields.error_detail || null,
    before: fields.before || null,
    after: fields.after || null,
    safety: fields.safety || null,
    run_id: fields.run_id || null,
    source: fields.source || 'api',
    created_at: fields.created_at,
    completed_at: fields.completed_at || clock.nowIso()
  });
}

/**
 * The only path that mutates a service. It refuses to run without an approved
 * verdict from the safety engine, so the agent can never reach the cloud directly.
 */
function execute(proposal, safetyVerdict, options) {
  const opts = options || {};
  const createdAt = clock.nowIso();
  const service = state.getService(proposal.service_id);

  if (!safetyVerdict || safetyVerdict.approved !== true) {
    return record({
      service_id: proposal.service_id,
      action: proposal.action,
      requested_state: describeRequest(proposal),
      status: 'blocked',
      error: 'policy_violation',
      error_detail: safetyVerdict ? safetyVerdict.reason : 'No safety verdict was supplied.',
      before: service ? snapshot(service) : null,
      safety: safetyVerdict || null,
      run_id: opts.run_id,
      source: opts.source,
      created_at: createdAt
    });
  }

  if (!service) {
    return record({
      service_id: proposal.service_id,
      action: proposal.action,
      requested_state: describeRequest(proposal),
      status: 'failed',
      error: 'service_not_found',
      error_detail: `Service "${proposal.service_id}" is not present in the cloud inventory.`,
      run_id: opts.run_id,
      source: opts.source,
      created_at: createdAt
    });
  }

  const before = snapshot(service);

  if (proposal.action === 'no_action' || proposal.action === 'refresh_observation') {
    if (proposal.action === 'refresh_observation') refreshObservation(service);
    const after = snapshot(service);
    return record({
      service_id: service.service_id,
      action: proposal.action,
      requested_state: describeRequest(proposal),
      status: 'success',
      before,
      after,
      safety: safetyVerdict,
      run_id: opts.run_id,
      source: opts.source,
      created_at: createdAt
    });
  }

  try {
    applyAction(service, proposal, safetyVerdict);
  } catch (err) {
    if (err instanceof ExecutionRejected) {
      state.addEvent({
        service_id: service.service_id,
        severity: 'critical',
        type: 'action',
        message: `Cloud rejected ${proposal.action} on ${service.service_id}: ${err.code}.`
      });
      return record({
        service_id: service.service_id,
        action: proposal.action,
        requested_state: describeRequest(proposal),
        status: 'failed',
        error: err.code,
        error_detail: err.message,
        before,
        after: snapshot(service),
        safety: safetyVerdict,
        run_id: opts.run_id,
        source: opts.source,
        created_at: createdAt
      });
    }
    throw err;
  }

  service.timestamp = clock.nowIso();
  state.pushHistoryPoint(service.service_id);
  const after = snapshot(service);

  state.addEvent({
    service_id: service.service_id,
    severity: 'info',
    type: 'action',
    message: describeApplied(proposal.action, service, before, after)
  });

  return record({
    service_id: service.service_id,
    action: proposal.action,
    requested_state: describeRequest(proposal),
    status: 'success',
    before,
    after,
    safety: safetyVerdict,
    run_id: opts.run_id,
    source: opts.source,
    created_at: createdAt
  });
}

function applyAction(service, proposal, safetyVerdict) {
  const action = proposal.action;

  if (action === 'scale_up' || action === 'scale_down') {
    const target =
      safetyVerdict.target_instances != null ? safetyVerdict.target_instances : proposal.target_instances;
    assertCapacity(service, target);
    const beforeInstances = service.instances;
    service.instances = target;
    service.latency_ms = observation.predictLatency({ ...service, instances: beforeInstances }, target);
    service.cpu_percent = observation.predictCpu({ ...service, instances: beforeInstances }, target);
    service.memory_percent = round(
      state.clamp(service.memory_percent * Math.pow(beforeInstances / Math.max(1, target), 0.4), 5, 99),
      1
    );
    return;
  }

  if (action === 'stop_idle_service') {
    service.status = 'stopped';
    service.stopped_instances = service.instances;
    service.instances = 0;
    service.cpu_percent = 0;
    service.memory_percent = 0;
    service.latency_ms = 0;
    service.requests_per_minute = 0;
    return;
  }

  if (action === 'resize') {
    const targetSize = proposal.target_size || 'medium';
    const from = SIZE_TIERS[service.size] || SIZE_TIERS.medium;
    const to = SIZE_TIERS[targetSize];
    if (!to) throw new ExecutionRejected('invalid_size', `Instance size "${targetSize}" is not offered.`);
    service.size = targetSize;
    service.cost_per_hour = round((service.cost_per_hour / from.factor) * to.factor, 2);
    service.cpu_percent = round(state.clamp(service.cpu_percent * (to.cpu_multiplier / from.cpu_multiplier), 1, 99), 1);
    service.latency_ms = Math.round(service.latency_ms * (to.cpu_multiplier / from.cpu_multiplier));
    return;
  }

  if (action === 'delay_batch') {
    const target = Math.max(service.min_instances, 1);
    service.deferred_until = new Date(clock.now().getTime() + 4 * 60 * 60000).toISOString();
    service.instances = target;
    service.cpu_percent = round(service.cpu_percent * 0.4, 1);
    service.memory_percent = round(service.memory_percent * 0.6, 1);
    return;
  }

  throw new ExecutionRejected('unsupported_action', `Action "${action}" cannot be executed.`);
}

/**
 * The simulated region has a real allocation ceiling that is lower than the
 * service's configured maximum. Requests beyond it are rejected by the cloud,
 * not by the policy engine.
 */
function assertCapacity(service, target) {
  const limit = service.capacity_limit != null ? service.capacity_limit : service.max_instances;
  if (target > limit) {
    throw new ExecutionRejected(
      'capacity_unavailable',
      `The region cannot allocate ${target} instances for ${service.service_id}. Available ceiling is ${limit}.`
    );
  }
}

/** Pulls a genuinely current reading, replacing a frozen observation. */
function refreshObservation(service) {
  const live = service.live_observation;
  if (live) {
    service.cpu_percent = live.cpu_percent;
    service.memory_percent = live.memory_percent;
    service.previous_requests_per_minute = service.requests_per_minute;
    service.requests_per_minute = live.requests_per_minute;
    service.latency_ms = live.latency_ms;
    service.healthy = live.healthy;
    delete service.live_observation;
  }
  service.observation_frozen = false;
  delete service.observation_age_minutes;
  service.timestamp = clock.nowIso();
  state.pushHistoryPoint(service.service_id);
  state.addEvent({
    service_id: service.service_id,
    severity: 'info',
    type: 'observation',
    message: `Fresh observation collected: ${service.requests_per_minute} RPM, ${service.latency_ms} ms, CPU ${service.cpu_percent}%.`
  });
  return service;
}

function describeRequest(proposal) {
  if (proposal.action === 'stop_idle_service') return 'stopped';
  if (proposal.action === 'resize') return `size ${proposal.target_size}`;
  if (proposal.action === 'delay_batch') return 'batch window deferred 4h';
  if (proposal.target_instances != null) return `${proposal.target_instances} instances`;
  return proposal.action;
}

function describeApplied(action, service, before, after) {
  if (action === 'stop_idle_service')
    return `Stopped ${service.service_id}. ${before.instances} idle instances released, $${round(before.cost_per_hour, 2)}/hour recovered.`;
  if (action === 'scale_up' || action === 'scale_down')
    return `${service.service_id} moved from ${before.instances} to ${after.instances} instances. Latency ${before.latency_ms} ms → ${after.latency_ms} ms.`;
  if (action === 'resize') return `${service.service_id} resized from ${before.size} to ${after.size}.`;
  if (action === 'delay_batch') return `${service.service_id} batch window deferred. Pool reduced to ${after.instances}.`;
  return `${action} applied to ${service.service_id}.`;
}

/**
 * Post-action verification. Re-reads the service and checks it against its own
 * targets rather than against the agent's expectations.
 */
function verify(serviceId, expectation) {
  const service = state.getService(serviceId);
  if (!service) {
    return {
      status: 'failed',
      service_id: serviceId,
      checks: [{ id: 'service_exists', label: 'Service present', status: 'failed', detail: 'Service not found.' }],
      summary: `Service "${serviceId}" could not be re-read after the action.`
    };
  }

  const enriched = observation.enrich(service);
  const checks = [];
  const expected = expectation || {};

  if (expected.instances != null) {
    const ok = service.instances === expected.instances;
    checks.push({
      id: 'instance_count',
      label: 'Instance count',
      status: ok ? 'passed' : 'failed',
      detail: ok
        ? `Cloud reports ${service.instances} instances as requested.`
        : `Expected ${expected.instances} instances, cloud reports ${service.instances}.`
    });
  }

  if (expected.status) {
    const ok = service.status === expected.status;
    checks.push({
      id: 'service_status',
      label: 'Service status',
      status: ok ? 'passed' : 'failed',
      detail: ok ? `Service is ${service.status}.` : `Expected ${expected.status}, service is ${service.status}.`
    });
  }

  const latencyOk = service.status !== 'running' || service.latency_ms <= service.max_latency_ms;
  checks.push({
    id: 'latency_target',
    label: 'Latency target',
    status: latencyOk ? 'passed' : 'failed',
    detail:
      service.status !== 'running'
        ? 'Service is stopped, so no latency target applies.'
        : `${service.latency_ms} ms against a ${service.max_latency_ms} ms target.`
  });

  const healthOk = service.status !== 'running' || service.healthy;
  checks.push({
    id: 'health',
    label: 'Health check',
    status: healthOk ? 'passed' : 'failed',
    detail: service.status !== 'running' ? 'Service is stopped.' : service.healthy ? 'Service is healthy.' : 'Service is unhealthy.'
  });

  const saturated = service.status === 'running' && service.cpu_percent >= config.cpuHighThreshold;
  checks.push({
    id: 'utilisation',
    label: 'Utilisation',
    status: saturated ? 'failed' : 'passed',
    detail:
      service.status !== 'running'
        ? 'No utilisation to report.'
        : `CPU ${service.cpu_percent}%, memory ${service.memory_percent}%.`
  });

  const freshOk = !enriched.freshness.stale;
  checks.push({
    id: 'freshness',
    label: 'Observation freshness',
    status: freshOk ? 'passed' : 'failed',
    detail: `Observation is ${Math.round(enriched.freshness.age_minutes)} minutes old.`
  });

  const failed = checks.filter((c) => c.status === 'failed');
  return {
    status: failed.length ? 'failed' : 'passed',
    service_id: serviceId,
    verified_at: clock.nowIso(),
    observed: {
      instances: service.instances,
      status: service.status,
      cpu_percent: service.cpu_percent,
      memory_percent: service.memory_percent,
      latency_ms: service.latency_ms,
      requests_per_minute: service.requests_per_minute,
      cost_per_hour: enriched.cost_per_hour_total
    },
    checks,
    summary: failed.length
      ? `Verification failed: ${failed.map((c) => c.label.toLowerCase()).join(', ')}.`
      : 'Post-action state matches the service targets.'
  };
}

module.exports = { execute, verify, refreshObservation, snapshot, SIZE_TIERS };
