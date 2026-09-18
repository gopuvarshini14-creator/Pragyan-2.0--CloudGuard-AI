'use strict';
// Respect the container's DATA_DIR; fall back to the repo layout when run locally.
process.env.DATA_DIR =
  process.env.DATA_DIR || require('path').resolve(__dirname, '../data/scenarios');
process.env.PORT = '5098';

require('./src/server');

const BASE = 'http://127.0.0.1:5098';
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
    console.log(`  FAIL  ${label}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  }
}

async function main() {
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n--- Test Input A: cost optimization across a fleet ---');
  let r = await call('POST', '/api/agent/analyze', {
    prompt: 'Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.',
    services: [
      {
        service_id: 'orders-api',
        cpu_percent: 22,
        memory_percent: 41,
        requests_per_minute: 1200,
        latency_ms: 180,
        instances: 6,
        cost_per_hour: 18.5,
        min_instances: 2,
        max_instances: 8,
        max_latency_ms: 300,
        healthy: true,
        timestamp: '2026-09-17T10:30:00Z'
      },
      {
        service_id: 'reports-worker',
        cpu_percent: 9,
        memory_percent: 15,
        requests_per_minute: 0,
        latency_ms: 0,
        instances: 4,
        cost_per_hour: 11.0,
        min_instances: 1,
        max_instances: 6,
        max_latency_ms: 900,
        healthy: true,
        timestamp: '2026-09-17T10:30:00Z'
      }
    ]
  });
  assert('A: request accepted', r.status === 200, r.json);
  assert(
    'A: idle worker stopped, orders left alone',
    r.json && r.json.action === 'stop_idle_service' && r.json.service_id === 'reports-worker',
    r.json && { action: r.json.action, service_id: r.json.service_id }
  );
  assert('A: verification passed', r.json && r.json.verification && r.json.verification.status === 'passed', r.json && r.json.verification);
  assert('A: savings realized', r.json && r.json.savings_per_hour === 44, r.json && r.json.savings_per_hour);

  console.log('\n--- Test Input B: rising traffic, protect latency ---');
  r = await call('POST', '/api/agent/analyze', {
    prompt: 'Orders traffic is increasing. Keep the service within its latency target.',
    service: {
      service_id: 'orders-api',
      cpu_percent: 28,
      memory_percent: 48,
      requests_per_minute: 4200,
      previous_requests_per_minute: 2100,
      latency_ms: 260,
      instances: 4,
      cost_per_hour: 18.5,
      min_instances: 2,
      max_instances: 8,
      max_latency_ms: 300,
      healthy: true,
      timestamp: '2026-09-17T10:30:00Z'
    }
  });
  assert('B: request accepted', r.status === 200, r.json);
  assert(
    'B: capacity increased on orders-api',
    r.json && r.json.action === 'scale_up' && r.json.service_id === 'orders-api',
    r.json && { action: r.json.action, service_id: r.json.service_id }
  );
  assert(
    'B: post-action latency inside target',
    r.json && r.json.execution && r.json.execution.after.latency_ms <= 300,
    r.json && r.json.execution
  );
  assert('B: verification passed', r.json && r.json.verification && r.json.verification.status === 'passed', r.json && r.json.verification);

  console.log('\n--- Test Input C: stale observation vs. fresher traffic ---');
  r = await call('POST', '/api/agent/analyze', {
    prompt: 'Reduce cost if it is safe.',
    metric: {
      service_id: 'checkout-api',
      cpu_percent: 24,
      memory_percent: 39,
      requests_per_minute: 900,
      latency_ms: 170,
      instances: 5,
      cost_per_hour: 20.0,
      min_instances: 2,
      max_instances: 8,
      max_latency_ms: 250,
      healthy: true,
      timestamp: '2026-09-17T08:00:00Z'
    },
    latest_traffic: {
      service_id: 'checkout-api',
      requests_per_minute: 5200,
      timestamp: '2026-09-17T10:30:00Z'
    }
  });
  assert('C: request accepted', r.status === 200, r.json);
  assert(
    'C: stale data blocked a capacity cut',
    r.json && r.json.blocked === true,
    r.json && { blocked: r.json.blocked, blocked_reason: r.json.blocked_reason }
  );
  assert(
    'C: no instances were removed from checkout-api',
    r.json && !(r.json.action === 'scale_down' && r.json.outcome === 'succeeded'),
    r.json && { action: r.json.action, outcome: r.json.outcome }
  );

  console.log('\n--- Test Input D: scale attempt rejected by the cloud ---');
  r = await call('POST', '/api/agent/analyze', {
    prompt: 'Scale the payment service only if the current state requires it.',
    service: {
      service_id: 'payment-api',
      cpu_percent: 91,
      memory_percent: 82,
      requests_per_minute: 6400,
      latency_ms: 410,
      instances: 3,
      cost_per_hour: 22.0,
      min_instances: 2,
      max_instances: 8,
      max_latency_ms: 300,
      healthy: true,
      timestamp: '2026-09-17T10:30:00Z'
    },
    action_result: {
      action_id: 'act-784',
      action: 'scale_up',
      requested_instances: 5,
      status: 'failed',
      error: 'capacity_unavailable'
    }
  });
  assert('D: request accepted', r.status === 200, r.json);
  assert(
    'D: safety approved, cloud rejected honestly',
    r.json && r.json.safety.decision === 'approved' && r.json.outcome === 'failed',
    r.json && { safety: r.json.safety && r.json.safety.decision, outcome: r.json.outcome }
  );
  assert(
    'D: execution error surfaced as capacity_unavailable',
    r.json && r.json.execution && r.json.execution.error === 'capacity_unavailable',
    r.json && r.json.execution
  );
  assert(
    'D: final message reports the failure, not a false success',
    r.json && /capacity_unavailable/.test(r.json.final_message || ''),
    r.json && r.json.final_message
  );

  console.log('\n--- validation ---');
  r = await call('POST', '/api/agent/analyze', { prompt: 'Reduce cost.' });
  assert('missing payload -> 400', r.status === 400 && r.json.error === 'invalid_payload', r.json);

  r = await call('POST', '/api/agent/analyze', { prompt: 'Reduce cost.', service: { service_id: 'x' } });
  assert('incomplete service -> 400', r.status === 400 && r.json.error === 'invalid_payload', r.json);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
