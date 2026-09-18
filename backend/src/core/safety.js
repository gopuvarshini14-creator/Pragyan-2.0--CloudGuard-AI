'use strict';

const { config } = require('./config');
const state = require('./state');
const observation = require('./observation');

const STATE_CHANGING = ['scale_up', 'scale_down', 'resize', 'stop_idle_service', 'delay_batch'];

const POLICIES = [
  {
    id: 'min_capacity',
    name: 'Minimum Instances',
    description: 'A service may never be scaled below its declared minimum instance count.',
    applies_to: ['scale_down', 'stop_idle_service'],
    enabled: true
  },
  {
    id: 'max_capacity',
    name: 'Maximum Instances',
    description: 'A service may never be scaled above its declared maximum instance count.',
    applies_to: ['scale_up'],
    enabled: true
  },
  {
    id: 'latency_protection',
    name: 'Latency Protection',
    description: 'Predicted latency after the change must stay at or below the service latency target.',
    applies_to: ['scale_down', 'resize'],
    enabled: true
  },
  {
    id: 'availability_protection',
    name: 'Availability Protection',
    description:
      'Capacity is never reduced while traffic is rising, and a critical service is never stopped automatically.',
    applies_to: ['scale_down', 'stop_idle_service', 'resize'],
    enabled: true
  },
  {
    id: 'health_check',
    name: 'Health Checks',
    description: 'A service reporting unhealthy cannot have its capacity reduced.',
    applies_to: ['scale_down', 'stop_idle_service', 'resize'],
    enabled: true
  },
  {
    id: 'freshness_validation',
    name: 'Stale Data Protection',
    description: `Observations older than ${config.dataFreshnessThresholdMinutes} minutes cannot be used for a capacity decision.`,
    applies_to: STATE_CHANGING,
    enabled: true
  },
  {
    id: 'workload_guard',
    name: 'Workload Guard',
    description: 'Batch deferral is restricted to background workloads. Idle stop is restricted to non-critical services.',
    applies_to: ['delay_batch', 'stop_idle_service'],
    enabled: true
  },
  {
    id: 'justification_required',
    name: 'Scale-Up Justification',
    description: 'Extra capacity is only approved when CPU, memory, latency or traffic growth justifies it.',
    applies_to: ['scale_up'],
    enabled: true
  },
  {
    id: 'post_action_verification',
    name: 'Post-action Verification',
    description: 'Every executed action is re-measured against the service targets before it is reported as successful.',
    applies_to: STATE_CHANGING,
    enabled: true
  },
  {
    id: 'failure_handling',
    name: 'Failure Handling',
    description: 'A rejected cloud operation is always reported as failed and never as a success.',
    applies_to: STATE_CHANGING,
    enabled: true
  }
];

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

/**
 * Evaluates a proposed action against every policy. Pure function of the current
 * state and the proposal: the agent cannot influence the outcome except through
 * the proposal itself.
 */
function evaluate(proposal) {
  const action = proposal.action;
  const service = state.getService(proposal.service_id);
  const checks = [];

  if (!service) {
    checks.push(check('service_exists', 'Service resolution', 'failed', `Unknown service "${proposal.service_id}".`));
    return blocked(proposal, checks, `Service "${proposal.service_id}" does not exist in the cloud inventory.`);
  }

  const enriched = observation.enrich(service);

  if (action === 'no_action') {
    checks.push(check('no_state_change', 'No state change', 'passed', 'The proposal does not modify any service.'));
    return approved(proposal, checks, enriched, 'No change requested, so no policy applies.');
  }

  if (action === 'refresh_observation') {
    checks.push(
      check('no_state_change', 'No state change', 'passed', 'Refreshing an observation is a read operation.')
    );
    return approved(proposal, checks, enriched, 'Observation refresh is a read-only operation.');
  }

  if (!STATE_CHANGING.includes(action)) {
    checks.push(check('known_action', 'Action vocabulary', 'failed', `Action "${action}" is not permitted.`));
    return blocked(proposal, checks, `Action "${action}" is outside the approved action set.`);
  }

  // 1. Freshness — evaluated before anything else so stale data can never drive a change.
  if (enriched.freshness.stale) {
    checks.push(
      check(
        'freshness_validation',
        'Freshness validation',
        'failed',
        `Observation is ${Math.round(enriched.freshness.age_minutes)} minutes old, past the ${enriched.freshness.threshold_minutes} minute threshold.`
      )
    );
    return blocked(
      proposal,
      checks,
      'Fresh service metrics are required before making a capacity decision.',
      enriched
    );
  }
  checks.push(
    check(
      'freshness_validation',
      'Freshness validation',
      'passed',
      `Observation is ${Math.round(enriched.freshness.age_minutes)} minutes old, inside the ${enriched.freshness.threshold_minutes} minute threshold.`
    )
  );

  // 2. Service must be running to be changed.
  if (service.status !== 'running') {
    checks.push(check('service_state', 'Service state', 'failed', `Service is ${service.status}.`));
    return blocked(proposal, checks, `Service is ${service.status} and cannot accept this action.`, enriched);
  }

  const target = resolveTarget(service, proposal);
  const reducesCapacity = action === 'scale_down' || action === 'stop_idle_service' || action === 'resize';

  // 3. Health.
  if (reducesCapacity) {
    if (!service.healthy) {
      checks.push(check('health_check', 'Health check', 'failed', 'Service is reporting unhealthy.'));
      return blocked(proposal, checks, 'Capacity cannot be reduced while the service is unhealthy.', enriched);
    }
    checks.push(check('health_check', 'Health check', 'passed', 'Service is reporting healthy.'));
  } else {
    checks.push(check('health_check', 'Health check', 'passed', `Health state is ${enriched.health_state}.`));
  }

  // 4. Capacity floor.
  if (action === 'scale_down' || action === 'scale_up') {
    if (target < service.min_instances) {
      checks.push(
        check(
          'min_capacity',
          'Minimum capacity',
          'failed',
          `Target ${target} is below the minimum of ${service.min_instances}.`
        )
      );
      return blocked(
        proposal,
        checks,
        `Target of ${target} instances breaches the minimum of ${service.min_instances}.`,
        enriched
      );
    }
    checks.push(
      check('min_capacity', 'Minimum capacity', 'passed', `Target ${target} ≥ minimum ${service.min_instances}.`)
    );

    if (target > service.max_instances) {
      checks.push(
        check(
          'max_capacity',
          'Maximum capacity',
          'failed',
          `Target ${target} exceeds the maximum of ${service.max_instances}.`
        )
      );
      return blocked(
        proposal,
        checks,
        `Target of ${target} instances breaches the maximum of ${service.max_instances}.`,
        enriched
      );
    }
    checks.push(
      check('max_capacity', 'Maximum capacity', 'passed', `Target ${target} ≤ maximum ${service.max_instances}.`)
    );
  }

  // 5. Stop-idle guard.
  if (action === 'stop_idle_service') {
    if (service.requests_per_minute !== 0) {
      checks.push(
        check(
          'workload_guard',
          'Idle verification',
          'failed',
          `Service is serving ${service.requests_per_minute} requests per minute.`
        )
      );
      return blocked(proposal, checks, 'A service that is still serving traffic cannot be stopped.', enriched);
    }
    if (service.critical) {
      checks.push(
        check('workload_guard', 'Criticality guard', 'failed', 'Service is marked critical.')
      );
      return blocked(proposal, checks, 'A critical service is never stopped automatically.', enriched);
    }
    checks.push(
      check(
        'workload_guard',
        'Idle and criticality',
        'passed',
        `0 requests per minute on a non-critical ${service.workload_type} workload.`
      )
    );
  }

  // 6. Batch deferral guard.
  if (action === 'delay_batch') {
    if (!['batch', 'background'].includes(service.workload_type)) {
      checks.push(
        check(
          'workload_guard',
          'Workload guard',
          'failed',
          `Workload type is "${service.workload_type}", not a background workload.`
        )
      );
      return blocked(proposal, checks, 'Only background or batch workloads can be deferred.', enriched);
    }
    checks.push(
      check('workload_guard', 'Workload guard', 'passed', `Workload type is "${service.workload_type}".`)
    );
  }

  // 7. Scale-up justification.
  if (action === 'scale_up') {
    const reasons = [];
    if (service.cpu_percent >= config.cpuHighThreshold) reasons.push(`CPU at ${service.cpu_percent}%`);
    if (service.memory_percent >= config.memoryHighThreshold) reasons.push(`memory at ${service.memory_percent}%`);
    if (service.latency_ms > service.max_latency_ms)
      reasons.push(`latency ${service.latency_ms} ms above the ${service.max_latency_ms} ms target`);
    if (enriched.traffic_trend.direction === 'rising')
      reasons.push(`traffic up ${enriched.traffic_trend.change_percent}%`);
    const previousRpm = service.previous_requests_per_minute || 0;
    if (previousRpm > 0) {
      const growth = ((service.requests_per_minute - previousRpm) / previousRpm) * 100;
      if (growth > config.trafficSurgeThresholdPercent)
        reasons.push(`request rate up ${Math.round(growth)}% on the previous window`);
    }
    if (service.latency_ms >= service.max_latency_ms * (config.latencyHeadroomPercent / 100))
      reasons.push(`latency within ${100 - config.latencyHeadroomPercent}% of the target`);

    if (!reasons.length) {
      checks.push(
        check('justification_required', 'Scale-up justification', 'failed', 'No pressure signal is present.')
      );
      return blocked(
        proposal,
        checks,
        'Additional capacity is not justified by CPU, memory, latency or traffic growth.',
        enriched
      );
    }
    checks.push(
      check('justification_required', 'Scale-up justification', 'passed', `Justified by ${reasons.join(', ')}.`)
    );
  }

  // 8. Latency protection on any capacity reduction.
  let predictedLatency = service.latency_ms;
  if (reducesCapacity) {
    const effectiveTarget = action === 'stop_idle_service' ? 0 : target;
    predictedLatency =
      action === 'resize'
        ? Math.round(service.latency_ms * 1.35)
        : observation.predictLatency(service, effectiveTarget);
    if (service.requests_per_minute > 0 && predictedLatency > service.max_latency_ms) {
      checks.push(
        check(
          'latency_protection',
          'Latency protection',
          'failed',
          `Predicted ${predictedLatency} ms would exceed the ${service.max_latency_ms} ms target.`
        )
      );
      return blocked(
        proposal,
        checks,
        `Predicted latency of ${predictedLatency} ms would breach the ${service.max_latency_ms} ms target.`,
        enriched
      );
    }
    checks.push(
      check(
        'latency_protection',
        'Latency protection',
        'passed',
        service.requests_per_minute === 0
          ? 'No traffic is being served, so there is no latency risk.'
          : `Predicted ${predictedLatency} ms ≤ target ${service.max_latency_ms} ms.`
      )
    );

    // 9. Availability protection.
    if (enriched.traffic_trend.direction === 'rising') {
      checks.push(
        check(
          'availability_protection',
          'Availability protection',
          'failed',
          `Traffic is rising ${enriched.traffic_trend.change_percent}% and capacity must not be reduced.`
        )
      );
      return blocked(proposal, checks, 'Capacity cannot be reduced while traffic is rising.', enriched);
    }
    checks.push(
      check(
        'availability_protection',
        'Availability protection',
        'passed',
        `Traffic change is ${enriched.traffic_trend.change_percent}%, inside the ${config.trafficSurgeThresholdPercent}% surge threshold.`
      )
    );
  } else {
    checks.push(
      check('latency_protection', 'Latency protection', 'passed', 'The action does not reduce serving capacity.')
    );
    checks.push(
      check('availability_protection', 'Availability protection', 'passed', 'The action does not reduce availability.')
    );
  }

  return approved(proposal, checks, enriched, buildApprovalReason(action, service, target), {
    predicted_latency_ms: predictedLatency,
    target_instances: target
  });
}

function resolveTarget(service, proposal) {
  if (proposal.target_instances != null) return Number(proposal.target_instances);
  if (proposal.action === 'stop_idle_service') return 0;
  if (proposal.action === 'scale_up') return Math.min(service.max_instances, service.instances + 1);
  if (proposal.action === 'scale_down') return Math.max(service.min_instances, service.instances - 1);
  return service.instances;
}

function buildApprovalReason(action, service, target) {
  switch (action) {
    case 'stop_idle_service':
      return `Stopping ${service.instances} idle instances of a non-critical batch workload releases capacity with no traffic impact.`;
    case 'scale_down':
      return `Reducing ${service.service_id} from ${service.instances} to ${target} instances keeps latency inside the ${service.max_latency_ms} ms target.`;
    case 'scale_up':
      return `Raising ${service.service_id} from ${service.instances} to ${target} instances restores headroom against the ${service.max_latency_ms} ms target.`;
    case 'resize':
      return `Resizing ${service.service_id} keeps utilisation inside safe bounds at a lower unit cost.`;
    case 'delay_batch':
      return `Deferring the ${service.service_id} batch window moves load off the peak period.`;
    default:
      return 'Proposal satisfies every applicable policy.';
  }
}

function approved(proposal, checks, enriched, reason, extra) {
  return {
    decision: 'approved',
    approved: true,
    action: proposal.action,
    service_id: proposal.service_id,
    target_instances: extra && extra.target_instances != null ? extra.target_instances : proposal.target_instances,
    predicted_latency_ms: extra ? extra.predicted_latency_ms : null,
    reason,
    checks,
    policies_evaluated: checks.length,
    blocked_by: null,
    evaluated_at: require('./clock').nowIso()
  };
}

function blocked(proposal, checks, reason, enriched) {
  const failed = checks.filter((c) => c.status === 'failed');
  return {
    decision: 'blocked',
    approved: false,
    action: proposal.action,
    service_id: proposal.service_id,
    target_instances: proposal.target_instances != null ? proposal.target_instances : null,
    predicted_latency_ms: null,
    reason,
    checks,
    policies_evaluated: checks.length,
    blocked_by: failed.length ? failed[failed.length - 1].id : 'policy',
    evaluated_at: require('./clock').nowIso()
  };
}

function listPolicies() {
  return POLICIES.map((policy) => ({
    ...policy,
    threshold:
      policy.id === 'freshness_validation'
        ? `${config.dataFreshnessThresholdMinutes} minutes`
        : policy.id === 'availability_protection'
        ? `${config.trafficSurgeThresholdPercent}% traffic surge`
        : null
  }));
}

module.exports = { evaluate, listPolicies, POLICIES, STATE_CHANGING };
