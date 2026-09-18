'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const clock = require('./clock');
const state = require('./state');
const agent = require('./agent');

const FALLBACK = [
  {
    id: 'scenario-a',
    letter: 'A',
    title: 'Cost Optimization',
    subtitle: 'Idle reports worker',
    description: 'A batch worker is running four instances with no traffic.',
    prompt:
      'Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.',
    focus_service: 'reports-worker',
    expected: { service_id: 'reports-worker', action: 'stop_idle_service', safety: 'approved' },
    setup: []
  }
];

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(config.dataDir, 'scenarios.json'), 'utf8');
    const parsed = JSON.parse(raw);
    cached = Array.isArray(parsed) && parsed.length ? parsed : FALLBACK;
  } catch (err) {
    cached = FALLBACK;
  }
  return cached;
}

function list() {
  return load().map((scenario) => ({
    id: scenario.id,
    letter: scenario.letter,
    title: scenario.title,
    subtitle: scenario.subtitle,
    description: scenario.description,
    prompt: scenario.prompt,
    focus_service: scenario.focus_service,
    expected: scenario.expected
  }));
}

function get(id) {
  return load().find((scenario) => scenario.id === id) || null;
}

/**
 * Each scenario starts from a clean simulation so it can be demonstrated
 * repeatedly and always produces the same conditions.
 */
function prepare(scenario) {
  state.reset();
  (scenario.setup || []).forEach((entry) => {
    const service = state.getService(entry.service_id);
    if (!service) return;
    const patch = { ...entry.patch };
    const ageMinutes = patch.observation_age_minutes;
    delete patch.observation_age_minutes;
    Object.assign(service, patch);
    service.timestamp = ageMinutes != null ? clock.isoMinutesAgo(ageMinutes) : clock.nowIso();
    state.store.history[service.service_id] = state.buildHistory(service);
  });
  state.addEvent({
    service_id: scenario.focus_service || null,
    severity: 'info',
    type: 'scenario',
    message: `Scenario ${scenario.letter} prepared: ${scenario.title}.`
  });
}

async function run(id) {
  const scenario = get(id);
  if (!scenario) return null;
  prepare(scenario);
  const result = await agent.run({
    prompt: scenario.prompt,
    focus_service: scenario.focus_service,
    scenario_id: scenario.id
  });
  return {
    scenario: {
      id: scenario.id,
      letter: scenario.letter,
      title: scenario.title,
      subtitle: scenario.subtitle,
      prompt: scenario.prompt,
      expected: scenario.expected
    },
    run: result
  };
}

module.exports = { list, get, run, prepare };
