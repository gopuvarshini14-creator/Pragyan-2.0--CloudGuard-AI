'use strict';
// Respect the container's DATA_DIR; fall back to the repo layout when run locally.
process.env.DATA_DIR =
  process.env.DATA_DIR || require('path').resolve(__dirname, '../data/scenarios');

const state = require('./src/core/state');
const cost = require('./src/core/cost');
const scenarios = require('./src/core/scenarios');
const agent = require('./src/core/agent');

function line(label, value) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

async function main() {
  state.reset();
  const s = cost.summary();
  console.log('=== BASELINE COST ===');
  line('actual/hr', s.actual.per_hour);
  line('expected/hr', s.expected.per_hour);
  line('overspend %', s.overspend_percent);
  line('monthly', s.actual.per_month);
  line('potential savings/hr', s.potential_savings.per_hour);
  line('opportunities', s.opportunities.map((o) => `${o.service_id}:${o.action}`).join(', '));

  for (const id of ['scenario-a', 'scenario-b', 'scenario-c', 'scenario-d']) {
    const out = await scenarios.run(id);
    const r = out.run;
    console.log(`\n=== ${out.scenario.letter} — ${out.scenario.title} ===`);
    line('service', r.service_id);
    line('action', r.action);
    line('safety', r.safety.decision + ' / ' + r.safety.blocked_by);
    line('execution', r.execution ? r.execution.status + (r.execution.error ? ':' + r.execution.error : '') : 'none');
    line('verification', r.verification ? r.verification.status : 'none');
    line('outcome', r.outcome);
    line('blocked_message', r.blocked_message || '-');
    line('savings/hr', r.cost_impact.savings.per_hour);
    line('savings/day', r.cost_impact.savings.per_day);
    line('savings/month', r.cost_impact.savings.per_month);
    line('attempts', r.attempts.map((a) => `${a.action}:${a.safety_decision}/${a.execution_status}`).join(' | '));
    line('target_instances', r.target_instances);
    console.log('  final:', r.final_message);
  }

  console.log('\n=== ESTATE-WIDE RUNS ===');
  state.reset();
  for (let i = 0; i < 3; i += 1) {
    const r = await agent.run({});
    line(`run ${i + 1}`, `${r.action} ${r.service_id} -> ${r.outcome} (saved $${r.savings_per_hour}/hr)`);
  }
  const after = cost.summary();
  line('cost after', after.actual.per_hour);

  console.log('\n=== BLOCK CHECKS ===');
  state.reset();
  const safety = require('./src/core/safety');
  line(
    'stop critical orders-api',
    JSON.stringify(safety.evaluate({ service_id: 'orders-api', action: 'stop_idle_service' }).reason)
  );
  line(
    'scale below min',
    JSON.stringify(safety.evaluate({ service_id: 'orders-api', action: 'scale_down', target_instances: 1 }).reason)
  );
  line(
    'scale above max',
    JSON.stringify(safety.evaluate({ service_id: 'orders-api', action: 'scale_up', target_instances: 12 }).reason)
  );
  line(
    'stale checkout scale_down',
    JSON.stringify(safety.evaluate({ service_id: 'checkout-api', action: 'scale_down', target_instances: 4 }).reason)
  );
  line(
    'delay_batch on api',
    JSON.stringify(safety.evaluate({ service_id: 'orders-api', action: 'delay_batch' }).reason)
  );
  line(
    'unjustified scale_up',
    JSON.stringify(safety.evaluate({ service_id: 'orders-api', action: 'scale_up', target_instances: 7 }).reason)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
