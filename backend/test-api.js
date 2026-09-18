'use strict';
// Respect the container's DATA_DIR; fall back to the repo layout when run locally.
process.env.DATA_DIR =
  process.env.DATA_DIR || require('path').resolve(__dirname, '../data/scenarios');
process.env.PORT = '5099';

require('./src/server');

const BASE = 'http://127.0.0.1:5099';
let pass = 0;
let fail = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch (err) {
    json = null;
  }
  return { status: res.status, json };
}

function assert(label, condition, extra) {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 220) : ''}`);
  }
}

async function main() {
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n--- read endpoints ---');
  let r = await call('GET', '/api/health');
  assert('GET /api/health', r.status === 200 && r.json.status === 'ok', r.json);
  assert('health reports agent mode', r.json && ['DEMO', 'LLM'].includes(r.json.agent_mode), r.json);

  r = await call('GET', '/api/services');
  assert('GET /api/services returns 4', r.status === 200 && r.json.services.length === 4, r.json && r.json.count);

  r = await call('GET', '/api/services/orders-api');
  assert('GET /api/services/:id', r.status === 200 && r.json.service.service_id === 'orders-api');
  assert('service detail includes history', r.json.history && r.json.history.length > 10);

  r = await call('GET', '/api/services/does-not-exist');
  assert('unknown service -> 404', r.status === 404 && r.json.error === 'service_not_found', r.json);

  r = await call('GET', '/api/services/orders-api/traffic');
  assert('GET /api/services/:id/traffic', r.status === 200 && r.json.points.length > 10);

  r = await call('GET', '/api/services/checkout-api/events');
  assert('GET /api/services/:id/events', r.status === 200 && Array.isArray(r.json.events));

  r = await call('GET', '/api/services/orders-api/verify');
  assert('GET /api/services/:id/verify', r.status === 200 && ['passed', 'failed'].includes(r.json.status), r.json);

  r = await call('GET', '/api/cost');
  assert('GET /api/cost overspend 37%', r.status === 200 && r.json.overspend_percent === 37, r.json && r.json.overspend_percent);
  assert('cost trend has points', r.json.trend && r.json.trend.length > 5);

  r = await call('GET', '/api/policies');
  assert('GET /api/policies', r.status === 200 && r.json.policies.length >= 8);

  r = await call('GET', '/api/scenarios');
  assert('GET /api/scenarios returns 4', r.status === 200 && r.json.scenarios.length === 4);

  r = await call('GET', '/api/events');
  assert('GET /api/events', r.status === 200 && r.json.events.length > 0);

  console.log('\n--- action endpoints ---');
  r = await call('POST', '/api/actions/stop', { service_id: 'orders-api' });
  assert('stop critical api -> 403 blocked', r.status === 403 && r.json.safety.decision === 'blocked', r.json && r.json.safety && r.json.safety.reason);

  r = await call('POST', '/api/actions/scale', { service_id: 'orders-api', target_instances: 1 });
  assert('scale below min -> 403', r.status === 403 && r.json.safety.blocked_by === 'min_capacity', r.json && r.json.safety);

  r = await call('POST', '/api/actions/scale', { service_id: 'checkout-api', target_instances: 4 });
  assert('stale scale-down -> 403 freshness', r.status === 403 && r.json.safety.blocked_by === 'freshness_validation', r.json && r.json.safety);

  r = await call('POST', '/api/actions/scale', { service_id: 'payment-api', target_instances: 6 });
  assert('capacity_unavailable -> 409 failed', r.status === 409 && r.json.action.error === 'capacity_unavailable', r.json && r.json.action);

  r = await call('POST', '/api/actions/scale', { service_id: 'orders-api', target_instances: 5 });
  assert('valid scale-down -> 200 success', r.status === 200 && r.json.action.status === 'success', r.json && r.json.action);
  assert('scale-down verified', r.json.verification && r.json.verification.status === 'passed', r.json && r.json.verification);
  const actionId = r.json.action.action_id;

  r = await call('GET', `/api/actions/${actionId}`);
  assert('GET /api/actions/:id', r.status === 200 && r.json.action.action_id === actionId);

  r = await call('GET', '/api/actions');
  assert('GET /api/actions list', r.status === 200 && r.json.actions.length >= 5);

  r = await call('POST', '/api/actions/stop', { service_id: 'reports-worker' });
  assert('stop idle worker -> 200', r.status === 200 && r.json.action.status === 'success', r.json && r.json.action);

  r = await call('POST', '/api/actions/delay-batch', { service_id: 'orders-api' });
  assert('delay batch on api -> 403', r.status === 403 && r.json.safety.blocked_by === 'workload_guard', r.json && r.json.safety);

  r = await call('POST', '/api/actions/resize', { service_id: 'orders-api', target_size: 'small' });
  assert('resize -> resolved', [200, 403, 409].includes(r.status), r.json);

  r = await call('POST', '/api/actions/resize', { service_id: 'orders-api', target_size: 'gigantic' });
  assert('invalid size -> 400', r.status === 400 && r.json.error === 'invalid_size', r.json);

  console.log('\n--- reset + agent ---');
  r = await call('POST', '/api/reset');
  assert('POST /api/reset', r.status === 200 && r.json.status === 'reset');

  r = await call('GET', '/api/cost');
  assert('reset restores $321/hr', r.json.actual.per_hour === 321, r.json && r.json.actual);

  r = await call('POST', '/api/agent/run', { prompt: 'Review the current services and reduce unnecessary cost.' });
  assert('POST /api/agent/run', r.status === 200 && r.json.status === 'completed', r.json && r.json.error);
  assert('agent stopped the idle worker', r.json.action === 'stop_idle_service' && r.json.service_id === 'reports-worker', r.json && r.json.action);
  assert('agent has 10 workflow steps', r.json.steps.length === 10, r.json && r.json.steps && r.json.steps.length);
  assert('agent logged tool calls', r.json.tool_calls.length >= 5);
  assert('agent timeline populated', r.json.timeline.length >= 6);
  assert('savings $44/hr', r.json.cost_impact.savings.per_hour === 44, r.json && r.json.cost_impact);
  assert('savings $31,680/month', r.json.cost_impact.savings.per_month === 31680, r.json && r.json.cost_impact);
  const runId = r.json.run_id;

  r = await call('GET', '/api/agent/runs');
  assert('GET /api/agent/runs', r.status === 200 && r.json.runs.length >= 1);

  r = await call('GET', `/api/agent/runs/${runId}`);
  assert('GET /api/agent/runs/:id', r.status === 200 && r.json.run_id === runId);

  r = await call('GET', '/api/agent/runs/run-999');
  assert('unknown run -> 404', r.status === 404);

  console.log('\n--- scenarios ---');
  const expectations = {
    'scenario-a': (j) => j.run.action === 'stop_idle_service' && j.run.outcome === 'succeeded',
    'scenario-b': (j) => j.run.action === 'scale_up' && j.run.target_instances === 5 && j.run.outcome === 'succeeded',
    'scenario-c': (j) => j.run.blocked === true && j.run.blocked_message === 'Optimization blocked until fresh metrics are available.',
    'scenario-d': (j) => j.run.outcome === 'failed' && j.run.execution.error === 'capacity_unavailable'
  };
  for (const id of Object.keys(expectations)) {
    r = await call('POST', `/api/scenarios/${id}/run`);
    assert(`POST /api/scenarios/${id}/run`, r.status === 200 && expectations[id](r.json), r.json && r.json.run && {
      action: r.json.run.action,
      outcome: r.json.run.outcome,
      blocked: r.json.run.blocked
    });
  }

  r = await call('POST', '/api/scenarios/scenario-z/run');
  assert('unknown scenario -> 404', r.status === 404);

  r = await call('GET', '/api/nope');
  assert('unknown api route -> 404', r.status === 404 && r.json.error === 'not_found', r.json);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
