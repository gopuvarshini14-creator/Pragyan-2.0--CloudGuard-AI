'use strict';

const { config, agentMode } = require('./config');
const clock = require('./clock');
const state = require('./state');
const observation = require('./observation');
const safety = require('./safety');
const simulation = require('./simulation');
const cost = require('./cost');
const llm = require('./llm');

const round = state.round;

const STEP_BLUEPRINT = [
  { id: 'understand', label: 'Understanding request' },
  { id: 'inspect', label: 'Inspecting services' },
  { id: 'traffic', label: 'Checking traffic' },
  { id: 'health', label: 'Checking health' },
  { id: 'freshness', label: 'Checking freshness' },
  { id: 'cost', label: 'Evaluating cost' },
  { id: 'select', label: 'Selecting action' },
  { id: 'safety', label: 'Safety validation' },
  { id: 'execute', label: 'Executing' },
  { id: 'verify', label: 'Verifying' }
];

const SERVICE_ALIASES = {
  orders: 'orders-api',
  order: 'orders-api',
  checkout: 'checkout-api',
  payment: 'payment-api',
  payments: 'payment-api',
  reports: 'reports-worker',
  report: 'reports-worker',
  worker: 'reports-worker',
  batch: 'reports-worker'
};

function createRunContext(prompt) {
  return {
    run_id: state.nextRunId(),
    prompt,
    started_at: clock.nowIso(),
    steps: STEP_BLUEPRINT.map((step) => ({ ...step, status: 'pending', detail: null, duration_ms: 0 })),
    tool_calls: [],
    timeline: [],
    notes: []
  };
}

function step(ctx, id, status, detail, durationMs) {
  const target = ctx.steps.find((s) => s.id === id);
  if (target) {
    target.status = status;
    target.detail = detail;
    target.duration_ms = durationMs || 240 + Math.round(Math.random() * 220);
    target.completed_at = clock.nowIso();
  }
  return target;
}

function tool(ctx, method, path, summary, status) {
  const call = {
    sequence: ctx.tool_calls.length + 1,
    method,
    path,
    summary,
    status: status || 'ok',
    at: clock.nowIso()
  };
  ctx.tool_calls.push(call);
  return call;
}

function mark(ctx, label) {
  ctx.timeline.push({ at: clock.nowIso(), time: clock.clockTime(clock.nowIso()), label });
}

/** Maps free text onto an intent and, where present, a target service. */
function understand(prompt, focusService) {
  const text = String(prompt || '').toLowerCase();
  let serviceId = focusService || null;
  if (!serviceId) {
    const services = state.listServices();
    const direct = services.find((s) => text.includes(s.service_id));
    if (direct) serviceId = direct.service_id;
    else {
      const aliasKey = Object.keys(SERVICE_ALIASES).find((alias) =>
        new RegExp(`\\b${alias}\\b`).test(text)
      );
      if (aliasKey) serviceId = SERVICE_ALIASES[aliasKey];
    }
  }

  // Cost wording states the goal; latency wording in the same sentence is usually
  // a constraint on that goal ("reduce cost without breaking latency"), so cost wins.
  const mentionsCost = /(cost|spend|save|saving|cheaper|unnecessary|waste|bill|optimi[sz])/.test(text);
  const mentionsScaling = /(scale|scaling|capacity|instance|resize)/.test(text);
  const mentionsPerformance = /(traffic|latency|slow|performance|availability|spike|surge|increas|throughput|target)/.test(
    text
  );

  let intent = 'reduce_cost';
  if (mentionsCost) intent = 'reduce_cost';
  else if (mentionsScaling) intent = 'evaluate_scaling';
  else if (mentionsPerformance) intent = 'protect_performance';

  const labels = {
    reduce_cost: 'Reduce spend without breaking latency or availability',
    protect_performance: 'Keep the service inside its latency and availability targets',
    evaluate_scaling: 'Decide whether the current state requires a capacity change'
  };

  return { intent, intent_label: labels[intent], service_id: serviceId };
}

/** Number of instances needed to bring latency and CPU back inside targets. */
function computeScaleUpTarget(service) {
  let needed = service.instances;
  for (let t = service.instances; t <= service.max_instances; t += 1) {
    const latency = observation.predictLatency(service, t);
    const cpu = observation.predictCpu(service, t);
    if (latency <= service.max_latency_ms && cpu < config.cpuHighThreshold) {
      needed = t;
      break;
    }
    needed = t;
  }
  // Always add at least one instance of headroom when scaling up for pressure.
  return Math.min(service.max_instances, Math.max(needed, service.instances + 1));
}

function buildCandidates(services, understanding) {
  const scope = understanding.service_id
    ? services.filter((s) => s.service_id === understanding.service_id)
    : services;
  const candidates = [];

  scope.forEach((service) => {
    if (!service.running) return;

    // A stale observation is still the only reading the agent has, so it reasons
    // from it. The safety engine is what refuses to act on it.
    const trendDirection = service.freshness.stale ? 'unknown' : service.traffic_trend.direction;

    const pressure =
      service.cpu_percent >= config.cpuHighThreshold ||
      service.memory_percent >= config.memoryHighThreshold ||
      service.latency_ms > service.max_latency_ms ||
      service.latency_ms >= service.max_latency_ms * (config.latencyHeadroomPercent / 100) ||
      trendDirection === 'rising';

    if (pressure) {
      const target = computeScaleUpTarget(service);
      candidates.push({
        service_id: service.service_id,
        action: 'scale_up',
        target_instances: target,
        rank: understanding.intent === 'reduce_cost' ? 20 : 10,
        savings_per_hour: 0,
        added_cost_per_hour: round((target - service.instances) * service.cost_per_hour, 2),
        problem: `${service.service_id} is running at ${service.cpu_percent}% CPU and ${service.latency_ms} ms against a ${service.max_latency_ms} ms target with ${service.requests_per_minute} requests per minute.`,
        rationale: `Capacity must rise from ${service.instances} to ${target} instances to restore headroom.`
      });
      return;
    }

    if (service.idle && !service.critical && service.healthy) {
      candidates.push({
        service_id: service.service_id,
        action: 'stop_idle_service',
        target_instances: 0,
        rank: understanding.intent === 'reduce_cost' ? 11 : 21,
        savings_per_hour: round(service.instances * service.cost_per_hour, 2),
        problem: `Idle workload consuming unnecessary capacity.`,
        rationale: `${service.instances} instances of a non-critical ${service.workload_type} workload are serving 0 requests per minute at $${service.cost_per_hour}/hour each.`
      });
      return;
    }

    if (
      service.instances > service.min_instances &&
      service.cpu_percent < config.cpuLowThreshold &&
      service.memory_percent < config.memoryLowThreshold &&
      trendDirection !== 'rising'
    ) {
      const target = Math.max(service.min_instances, service.instances - 1);
      candidates.push({
        service_id: service.service_id,
        action: 'scale_down',
        target_instances: target,
        rank: understanding.intent === 'reduce_cost' ? 12 : 22,
        savings_per_hour: round((service.instances - target) * service.cost_per_hour, 2),
        problem: `${service.service_id} holds ${service.instances} instances at ${service.cpu_percent}% CPU and ${service.memory_percent}% memory with flat traffic.`,
        rationale: `One instance can be released while staying above the minimum of ${service.min_instances}.`
      });
    }
  });

  // If a stale service produced no candidate of its own, refreshing it is still
  // worth doing so the next evaluation has something trustworthy to work with.
  scope.forEach((service) => {
    if (!service.running || !service.freshness.stale) return;
    if (candidates.some((c) => c.service_id === service.service_id)) return;
    candidates.push({
      service_id: service.service_id,
      action: 'refresh_observation',
      rank: 40,
      savings_per_hour: 0,
      problem: `The stored observation for ${service.service_id} is ${Math.round(service.freshness.age_minutes)} minutes old while the traffic feed reports ${service.traffic_feed_rpm} requests per minute.`,
      rationale: 'A capacity decision cannot be made on an observation past the freshness threshold.'
    });
  });

  candidates.sort((a, b) => a.rank - b.rank || b.savings_per_hour - a.savings_per_hour);
  return candidates;
}

function noActionCandidate(understanding, services) {
  const target = understanding.service_id || (services[0] && services[0].service_id);
  return {
    service_id: target,
    action: 'no_action',
    rank: 99,
    savings_per_hour: 0,
    problem: 'No service currently meets the criteria for a safe capacity change.',
    rationale: 'Every service is inside its latency, utilisation and capacity bounds.'
  };
}

async function run(options) {
  const opts = options || {};
  const prompt =
    opts.prompt ||
    'Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.';
  const ctx = createRunContext(prompt);
  const costBefore = cost.summary();
  mark(ctx, 'Agent started');

  // 1 — Understand.
  const understanding = understand(prompt, opts.focus_service);
  step(
    ctx,
    'understand',
    'done',
    `${understanding.intent_label}${understanding.service_id ? ` (scoped to ${understanding.service_id})` : ' (estate-wide)'}.`,
    220
  );
  mark(ctx, 'Request interpreted');

  // 2 — Inspect.
  let services = observation.enrichAll();
  tool(ctx, 'GET', '/api/services', `${services.length} services found`);
  step(ctx, 'inspect', 'done', `${services.length} services in the simulated estate.`, 260);
  mark(ctx, 'Metrics inspected');

  const inspected = understanding.service_id
    ? services.filter((s) => s.service_id === understanding.service_id)
    : services;
  inspected.forEach((s) => {
    tool(ctx, 'GET', `/api/services/${s.service_id}`, `${s.instances} instances, ${s.health_state}`);
  });

  // 3 — Traffic.
  inspected.forEach((s) => {
    tool(
      ctx,
      'GET',
      `/api/services/${s.service_id}/traffic`,
      `${s.traffic_feed_rpm} RPM, ${s.traffic_trend.direction} ${s.traffic_trend.change_percent}%`
    );
  });
  const rising = inspected.filter((s) => s.traffic_trend.direction === 'rising').map((s) => s.service_id);
  step(
    ctx,
    'traffic',
    'done',
    rising.length ? `Traffic rising on ${rising.join(', ')}.` : 'No traffic surge detected.',
    280
  );
  mark(ctx, 'Traffic feed checked');

  // 4 — Health.
  const unhealthy = inspected.filter((s) => s.running && !s.healthy).map((s) => s.service_id);
  const degraded = inspected.filter((s) => s.health_state === 'degraded').map((s) => s.service_id);
  step(
    ctx,
    'health',
    'done',
    unhealthy.length
      ? `Unhealthy: ${unhealthy.join(', ')}.`
      : degraded.length
      ? `Degraded: ${degraded.join(', ')}.`
      : 'All inspected services are reporting healthy.',
    240
  );
  mark(ctx, 'Health checked');

  // 5 — Freshness.
  const stale = inspected.filter((s) => s.freshness.stale);
  stale.forEach((s) => {
    tool(
      ctx,
      'GET',
      `/api/services/${s.service_id}/events`,
      `observation ${Math.round(s.freshness.age_minutes)} min old`,
      'warning'
    );
  });
  step(
    ctx,
    'freshness',
    stale.length ? 'warning' : 'done',
    stale.length
      ? `STALE DATA DETECTED on ${stale.map((s) => s.service_id).join(', ')}.`
      : `All observations are inside the ${config.dataFreshnessThresholdMinutes} minute threshold.`,
    260
  );
  if (stale.length) {
    mark(ctx, 'Stale observation detected');
    ctx.notes.push(
      `${stale.map((s) => s.service_id).join(', ')} reported an observation older than the ${config.dataFreshnessThresholdMinutes} minute freshness threshold.`
    );
  } else {
    mark(ctx, 'Freshness validated');
  }

  // 6 — Cost.
  tool(ctx, 'GET', '/api/cost', `$${costBefore.actual.per_hour}/hr, ${costBefore.overspend_percent}% over plan`);
  step(
    ctx,
    'cost',
    'done',
    `Estate is running at $${costBefore.actual.per_hour}/hour, ${costBefore.overspend_percent}% above the approved plan.`,
    300
  );
  mark(ctx, 'Cost analysed');

  // 7 — Candidate generation and selection.
  const candidates = buildCandidates(services, understanding);
  let chosen = candidates[0] || noActionCandidate(understanding, services);
  let decisionSource = 'demo';

  const llmProposal = await llm.propose(prompt, services, costBefore.opportunities);
  if (llmProposal) {
    const enrichedTarget = services.find((s) => s.service_id === llmProposal.service_id);
    if (enrichedTarget) {
      decisionSource = 'llm';
      chosen = {
        service_id: llmProposal.service_id,
        action: llmProposal.action,
        target_instances:
          llmProposal.target_instances != null
            ? llmProposal.target_instances
            : llmProposal.action === 'scale_up'
            ? computeScaleUpTarget(enrichedTarget)
            : llmProposal.action === 'scale_down'
            ? Math.max(enrichedTarget.min_instances, enrichedTarget.instances - 1)
            : llmProposal.action === 'stop_idle_service'
            ? 0
            : null,
        savings_per_hour:
          llmProposal.action === 'stop_idle_service'
            ? round(enrichedTarget.instances * enrichedTarget.cost_per_hour, 2)
            : 0,
        problem: llmProposal.problem || 'Proposed by the language model reasoning layer.',
        rationale: llmProposal.rationale || 'Proposed by the language model reasoning layer.'
      };
    }
  }

  step(
    ctx,
    'select',
    'done',
    `Proposed ${chosen.action} on ${chosen.service_id} (${decisionSource === 'llm' ? 'LLM' : 'demo'} reasoning).`,
    280
  );
  mark(ctx, 'Action proposed');

  // 8 — Safety, execution and verification, with one remediation pass for stale data.
  const attempts = [];
  let result = await attempt(ctx, chosen, attempts, opts);

  if (result.remediation_required) {
    const refreshed = {
      service_id: chosen.service_id,
      action: 'refresh_observation',
      target_instances: null,
      problem: result.safety.reason,
      rationale: 'Collecting a current observation before re-evaluating the request.'
    };
    mark(ctx, 'Fresh observation requested');
    await attempt(ctx, refreshed, attempts, opts, true);

    services = observation.enrichAll();
    const reEvaluated = buildCandidates(services, understanding);
    const next = reEvaluated[0] || noActionCandidate(understanding, services);
    step(ctx, 'select', 'done', `Re-evaluated after refresh: ${next.action} on ${next.service_id}.`, 260);
    mark(ctx, 'Re-evaluated on fresh metrics');
    result = await attempt(ctx, next, attempts, opts);
    chosen = next;
  }

  const costAfter = cost.summary();
  const finished = clock.nowIso();
  const primary = attempts[attempts.length - 1];
  const blockedAttempt = attempts.find((a) => a.safety && a.safety.decision === 'blocked');

  const deltaPerHour = round(costAfter.actual.per_hour - costBefore.actual.per_hour, 2);
  const savedPerHour = Math.max(0, -deltaPerHour);

  const runRecord = {
    run_id: ctx.run_id,
    status: 'completed',
    agent_mode: agentMode(),
    decision_source: decisionSource,
    prompt,
    intent: understanding.intent,
    intent_label: understanding.intent_label,
    scenario_id: opts.scenario_id || null,
    service_id: primary.proposal.service_id,
    problem: chosen.problem,
    decision: describeDecision(primary),
    action: primary.proposal.action,
    target_instances: primary.proposal.target_instances != null ? primary.proposal.target_instances : null,
    rationale: chosen.rationale,
    safety: primary.safety,
    execution: primary.execution,
    verification: primary.verification,
    attempts: attempts.map((a, index) => ({
      sequence: index + 1,
      action: a.proposal.action,
      service_id: a.proposal.service_id,
      target_instances: a.proposal.target_instances != null ? a.proposal.target_instances : null,
      problem: a.proposal.problem || null,
      rationale: a.proposal.rationale || null,
      safety: a.safety,
      safety_decision: a.safety.decision,
      safety_reason: a.safety.reason,
      execution: a.execution,
      execution_status: a.execution ? a.execution.status : 'not_executed',
      execution_error: a.execution ? a.execution.error : null,
      verification: a.verification,
      verification_status: a.verification ? a.verification.status : 'not_run'
    })),
    blocked: Boolean(blockedAttempt),
    blocked_message: blockedAttempt ? 'Optimization blocked until fresh metrics are available.' : null,
    blocked_reason: blockedAttempt ? blockedAttempt.safety.reason : null,
    cost_impact: {
      before_per_hour: costBefore.actual.per_hour,
      after_per_hour: costAfter.actual.per_hour,
      delta_per_hour: deltaPerHour,
      savings: cost.project(savedPerHour),
      projected_monthly_before: costBefore.actual.per_month,
      projected_monthly_after: costAfter.actual.per_month,
      overspend_percent_before: costBefore.overspend_percent,
      overspend_percent_after: costAfter.overspend_percent
    },
    steps: ctx.steps,
    tool_calls: ctx.tool_calls,
    timeline: ctx.timeline,
    notes: ctx.notes,
    outcome: outcomeOf(primary),
    savings_per_hour: savedPerHour,
    started_at: ctx.started_at,
    completed_at: finished,
    duration_ms: Math.max(1, new Date(finished) - new Date(ctx.started_at)),
    final_message: buildFinalMessage(primary, attempts, savedPerHour, services, understanding)
  };

  state.addRun(runRecord);
  state.addEvent({
    service_id: runRecord.service_id,
    severity: runRecord.outcome === 'failed' ? 'critical' : runRecord.blocked ? 'warning' : 'info',
    type: 'agent',
    message: `Agent run ${runRecord.run_id}: ${runRecord.action} on ${runRecord.service_id} — ${runRecord.outcome}.`
  });

  return runRecord;
}

async function attempt(ctx, proposal, attempts, opts, isRemediation) {
  const verdict = safety.evaluate(proposal);
  tool(
    ctx,
    'POST',
    '/api/safety/evaluate',
    `${proposal.action} ${verdict.decision}`,
    verdict.decision === 'approved' ? 'ok' : 'blocked'
  );
  step(
    ctx,
    'safety',
    verdict.decision === 'approved' ? 'done' : 'blocked',
    verdict.reason,
    260
  );
  mark(ctx, verdict.decision === 'approved' ? 'Safety validation passed' : 'Safety validation blocked action');

  const isFreshnessBlock =
    verdict.decision === 'blocked' && verdict.blocked_by === 'freshness_validation' && !isRemediation;

  if (verdict.decision !== 'approved') {
    step(ctx, 'execute', 'blocked', 'Execution skipped: the safety engine did not approve the proposal.', 200);
    step(ctx, 'verify', 'blocked', 'Nothing was changed, so there is nothing to verify.', 180);
    const record = { proposal, safety: verdict, execution: null, verification: null, remediation_required: isFreshnessBlock };
    attempts.push(record);
    return record;
  }

  const execution = simulation.execute(proposal, verdict, {
    run_id: ctx.run_id,
    source: 'agent'
  });
  tool(
    ctx,
    'POST',
    endpointFor(proposal.action),
    execution.status === 'success' ? 'Action accepted' : `${execution.status}: ${execution.error}`,
    execution.status === 'success' ? 'ok' : 'error'
  );
  step(
    ctx,
    'execute',
    execution.status === 'success' ? 'done' : 'failed',
    execution.status === 'success'
      ? `${proposal.action} applied to ${proposal.service_id}.`
      : `ACTION FAILED — ${execution.error}.`,
    320
  );
  mark(ctx, execution.status === 'success' ? 'Action executed' : `Action failed: ${execution.error}`);

  const expectation =
    proposal.action === 'stop_idle_service'
      ? { status: 'stopped', instances: 0 }
      : verdict.target_instances != null
      ? { instances: verdict.target_instances, status: 'running' }
      : {};

  let verification = null;
  if (execution.status === 'success') {
    verification = simulation.verify(proposal.service_id, expectation);
    tool(
      ctx,
      'GET',
      `/api/services/${proposal.service_id}/verify`,
      verification.status === 'passed' ? 'Verification passed' : 'Verification failed',
      verification.status === 'passed' ? 'ok' : 'error'
    );
    step(
      ctx,
      'verify',
      verification.status === 'passed' ? 'done' : 'failed',
      verification.summary,
      280
    );
    mark(ctx, verification.status === 'passed' ? 'Verification completed' : 'Verification failed');
  } else {
    verification = simulation.verify(proposal.service_id, {});
    verification.status = 'failed';
    verification.summary = `The action did not complete, so ${proposal.service_id} is unchanged and still under its original conditions.`;
    step(ctx, 'verify', 'failed', verification.summary, 240);
    mark(ctx, 'Post-failure state re-read');
  }

  const record = { proposal, safety: verdict, execution, verification, remediation_required: false };
  attempts.push(record);
  return record;
}

function endpointFor(action) {
  switch (action) {
    case 'scale_up':
    case 'scale_down':
      return '/api/actions/scale';
    case 'resize':
      return '/api/actions/resize';
    case 'stop_idle_service':
      return '/api/actions/stop';
    case 'delay_batch':
      return '/api/actions/delay-batch';
    default:
      return '/api/actions/observe';
  }
}

function describeDecision(record) {
  const map = {
    scale_up: 'Increase capacity',
    scale_down: 'Reduce capacity',
    stop_idle_service: 'Stop idle service',
    resize: 'Resize instances',
    delay_batch: 'Defer batch window',
    refresh_observation: 'Collect a fresh observation',
    no_action: 'Take no action'
  };
  return map[record.proposal.action] || record.proposal.action;
}

function outcomeOf(record) {
  if (!record.safety || record.safety.decision !== 'approved') return 'blocked';
  if (!record.execution) return 'blocked';
  if (record.execution.status !== 'success') return 'failed';
  if (record.verification && record.verification.status !== 'passed') return 'failed';
  return 'succeeded';
}

function buildFinalMessage(primary, attempts, savedPerHour, services, understanding) {
  const serviceId = primary.proposal.service_id;
  const outcome = outcomeOf(primary);
  const parts = [];
  const blocked = attempts.find((a) => a.safety.decision === 'blocked');

  if (blocked && blocked !== primary) {
    parts.push(
      `The first proposal for ${blocked.proposal.service_id} was blocked by the safety engine: ${blocked.safety.reason} A fresh observation was collected and the request was re-evaluated against current metrics.`
    );
  }

  if (outcome === 'blocked') {
    parts.push(
      `No change was made to ${serviceId}. The safety engine rejected the proposal because ${lowerFirst(primary.safety.reason)} Optimization stays blocked until that condition clears.`
    );
  } else if (outcome === 'failed') {
    if (primary.execution && primary.execution.status === 'failed') {
      parts.push(
        `The ${primary.proposal.action.replace(/_/g, ' ')} on ${serviceId} was approved by the safety engine but rejected by the cloud with "${primary.execution.error}". Nothing changed: ${serviceId} is still running ${primary.execution.before.instances} instances and remains under pressure at ${primary.execution.before.cpu_percent}% CPU and ${primary.execution.before.latency_ms} ms latency against its ${state.getService(serviceId).max_latency_ms} ms target. This needs a capacity increase in another availability zone or an instance-size change before it can be resolved.`
      );
    } else {
      parts.push(
        `The action on ${serviceId} completed but post-action verification failed: ${primary.verification.summary}`
      );
    }
  } else if (primary.proposal.action === 'no_action') {
    parts.push(
      `No safe optimization is available right now. Every service in scope is inside its latency, utilisation and capacity bounds, so holding the current shape is the correct decision.`
    );
  } else if (primary.proposal.action === 'stop_idle_service') {
    const saving = cost.project(savedPerHour);
    parts.push(
      `${serviceId} was idle: ${primary.execution.before.instances} instances serving zero requests on a non-critical batch workload. It was stopped after passing every safety check and verification confirmed the stopped state. That releases $${saving.per_hour}/hour, which is $${saving.per_day.toLocaleString('en-US')}/day and $${saving.per_month.toLocaleString('en-US')}/month.`
    );
  } else if (primary.proposal.action === 'scale_up') {
    parts.push(
      `${serviceId} was scaled from ${primary.execution.before.instances} to ${primary.execution.after.instances} instances. Latency moved from ${primary.execution.before.latency_ms} ms to ${primary.execution.after.latency_ms} ms against a ${state.getService(serviceId).max_latency_ms} ms target, and verification confirmed the new state.`
    );
  } else if (primary.proposal.action === 'scale_down') {
    const saving = cost.project(savedPerHour);
    parts.push(
      `${serviceId} was reduced from ${primary.execution.before.instances} to ${primary.execution.after.instances} instances, staying above its minimum of ${state.getService(serviceId).min_instances}. Latency is ${primary.execution.after.latency_ms} ms against a ${state.getService(serviceId).max_latency_ms} ms target. That saves $${saving.per_hour}/hour, or $${saving.per_month.toLocaleString('en-US')}/month.`
    );
  } else if (primary.proposal.action === 'refresh_observation') {
    parts.push(
      `A fresh observation was collected for ${serviceId}. No capacity change was made on the stale data.`
    );
  }

  const pressured = services.filter(
    (s) =>
      s.running &&
      s.service_id !== serviceId &&
      (s.latency_ms > s.max_latency_ms || s.cpu_percent >= config.cpuHighThreshold)
  );
  if (pressured.length && !understanding.service_id) {
    parts.push(
      `Separately, ${pressured.map((s) => s.service_id).join(' and ')} ${pressured.length > 1 ? 'are' : 'is'} above the utilisation or latency target and should be reviewed next.`
    );
  }

  return parts.join(' ');
}

function lowerFirst(text) {
  if (!text) return '';
  return text.charAt(0).toLowerCase() + text.slice(1);
}

module.exports = { run, understand, buildCandidates, computeScaleUpTarget, STEP_BLUEPRINT };
