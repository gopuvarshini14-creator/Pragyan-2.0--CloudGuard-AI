'use strict';
process.env.DATA_DIR = process.env.DATA_DIR || require('path').resolve(__dirname, '../data/scenarios');

const state = require('./src/core/state');
const cost = require('./src/core/cost');
const observation = require('./src/core/observation');
const scenarios = require('./src/core/scenarios');
const agent = require('./src/core/agent');
const safety = require('./src/core/safety');
const simulation = require('./src/core/simulation');

let pass = 0;
let fail = 0;

function assert(label, condition, extra) {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 200) : ''}`);
  }
}

async function main() {
  console.log('--- background ticker ---');
  state.reset();
  assert('state.tick is exported', typeof state.tick === 'function');

  const before = cost.summary().actual.per_hour;
  for (let i = 0; i < 200; i += 1) state.tick();
  const after = cost.summary().actual.per_hour;
  assert('200 ticks do not throw', true);
  assert('ticking does not change cost', before === after, { before, after });

  const enriched = observation.enrichAll();
  assert(
    'non-frozen services stay fresh after ticking',
    enriched.filter((s) => s.service_id !== 'checkout-api').every((s) => !s.freshness.stale),
    enriched.map((s) => [s.service_id, s.freshness.stale])
  );
  assert(
    'checkout-api stays stale after ticking',
    enriched.find((s) => s.service_id === 'checkout-api').freshness.stale
  );
  assert(
    'metrics stay inside sane bounds',
    enriched.every(
      (s) =>
        s.cpu_percent >= 0 && s.cpu_percent <= 100 && s.memory_percent >= 0 && s.memory_percent <= 100
    ),
    enriched.map((s) => [s.service_id, s.cpu_percent, s.memory_percent])
  );
  assert(
    'history is capped',
    Object.values(state.store.history).every((points) => points.length <= 72)
  );
  assert(
    'payment-api still reads as saturated after drift',
    observation.enrich(state.getService('payment-api')).health_state === 'degraded'
  );

  console.log('\n--- scenarios survive a ticking clock ---');
  for (const id of ['scenario-a', 'scenario-b', 'scenario-c', 'scenario-d']) {
    state.reset();
    for (let i = 0; i < 40; i += 1) state.tick();
    const out = await scenarios.run(id);
    const r = out.run;
    const expectations = {
      'scenario-a': r.action === 'stop_idle_service' && r.outcome === 'succeeded' && r.cost_impact.savings.per_month === 31680,
      'scenario-b': r.action === 'scale_up' && r.target_instances === 5 && r.outcome === 'succeeded',
      'scenario-c': r.blocked === true && r.blocked_message === 'Optimization blocked until fresh metrics are available.',
      'scenario-d': r.outcome === 'failed' && r.execution.error === 'capacity_unavailable'
    };
    assert(`${id} after ticking`, expectations[id], { action: r.action, outcome: r.outcome, blocked: r.blocked });
  }

  console.log('\n--- stopped service is stable ---');
  state.reset();
  await agent.run({});
  const stopped = state.getService('reports-worker');
  assert('reports-worker stopped', stopped.status === 'stopped' && stopped.instances === 0);
  for (let i = 0; i < 60; i += 1) state.tick();
  assert('stopped service stays stopped through ticks', stopped.status === 'stopped' && stopped.instances === 0);
  assert('stopped service costs nothing', observation.enrich(stopped).cost_per_hour_total === 0);

  console.log('\n--- repeated agent runs never throw ---');
  state.reset();
  for (let i = 0; i < 12; i += 1) {
    state.tick();
    const r = await agent.run({});
    if (!['succeeded', 'failed', 'blocked'].includes(r.outcome)) {
      assert(`run ${i + 1} outcome valid`, false, r.outcome);
    }
  }
  assert('12 consecutive agent runs completed', true);
  const finalCost = cost.summary();
  assert('cost never goes negative', finalCost.actual.per_hour >= 0, finalCost.actual);
  assert(
    'no service below its minimum',
    state.listServices().every((s) => s.status !== 'running' || s.instances >= s.min_instances),
    state.listServices().map((s) => [s.service_id, s.instances, s.min_instances])
  );
  assert(
    'no service above its maximum',
    state.listServices().every((s) => s.instances <= s.max_instances)
  );

  console.log('\n--- every action type against every service ---');
  state.reset();
  const actions = ['scale_up', 'scale_down', 'resize', 'stop_idle_service', 'delay_batch', 'no_action', 'refresh_observation'];
  let combos = 0;
  for (const service of state.listServices().map((s) => s.service_id)) {
    for (const action of actions) {
      const proposal = { service_id: service, action, target_size: 'small' };
      const verdict = safety.evaluate(proposal);
      const result = simulation.execute(proposal, verdict);
      if (!['success', 'failed', 'blocked'].includes(result.status)) {
        assert(`${service}/${action}`, false, result.status);
      }
      combos += 1;
    }
  }
  assert(`${combos} action/service combinations resolved cleanly`, true);
  assert(
    'unknown service is rejected, not crashed',
    safety.evaluate({ service_id: 'ghost', action: 'scale_up' }).decision === 'blocked'
  );
  assert(
    'unknown action is rejected',
    safety.evaluate({ service_id: 'orders-api', action: 'delete_everything' }).decision === 'blocked'
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(1);
});
