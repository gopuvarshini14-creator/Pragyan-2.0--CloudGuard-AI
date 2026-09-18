'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const clock = require('./clock');

const HISTORY_POINTS = 36;
const HISTORY_INTERVAL_MINUTES = 5;
const HISTORY_MAX = 72;

const FALLBACK_SERVICES = [
  {
    service_id: 'orders-api',
    display_name: 'Orders API',
    cpu_percent: 22,
    memory_percent: 41,
    requests_per_minute: 1200,
    previous_requests_per_minute: 1150,
    latency_ms: 180,
    instances: 6,
    cost_per_hour: 18.5,
    min_instances: 2,
    max_instances: 8,
    max_latency_ms: 300,
    healthy: true,
    critical: true,
    workload_type: 'api',
    size: 'medium',
    status: 'running',
    capacity_limit: 8,
    observation_frozen: false,
    timestamp: '2026-09-17T10:30:00Z'
  },
  {
    service_id: 'reports-worker',
    display_name: 'Reports Worker',
    cpu_percent: 9,
    memory_percent: 15,
    requests_per_minute: 0,
    previous_requests_per_minute: 0,
    latency_ms: 0,
    instances: 4,
    cost_per_hour: 11,
    min_instances: 1,
    max_instances: 6,
    max_latency_ms: 900,
    healthy: true,
    critical: false,
    workload_type: 'batch',
    size: 'large',
    status: 'running',
    capacity_limit: 6,
    observation_frozen: false,
    timestamp: '2026-09-17T10:30:00Z'
  },
  {
    service_id: 'checkout-api',
    display_name: 'Checkout API',
    cpu_percent: 24,
    memory_percent: 39,
    requests_per_minute: 900,
    previous_requests_per_minute: 880,
    latency_ms: 170,
    instances: 5,
    cost_per_hour: 20,
    min_instances: 2,
    max_instances: 8,
    max_latency_ms: 250,
    healthy: true,
    critical: true,
    workload_type: 'api',
    size: 'medium',
    status: 'running',
    capacity_limit: 8,
    observation_frozen: true,
    live_observation: {
      cpu_percent: 71,
      memory_percent: 63,
      requests_per_minute: 5200,
      latency_ms: 238,
      healthy: true
    },
    timestamp: '2026-09-17T08:00:00Z'
  },
  {
    service_id: 'payment-api',
    display_name: 'Payment API',
    cpu_percent: 91,
    memory_percent: 82,
    requests_per_minute: 6400,
    previous_requests_per_minute: 5100,
    latency_ms: 410,
    instances: 3,
    cost_per_hour: 22,
    min_instances: 2,
    max_instances: 8,
    max_latency_ms: 300,
    healthy: true,
    critical: true,
    workload_type: 'api',
    size: 'medium',
    status: 'running',
    capacity_limit: 4,
    observation_frozen: false,
    timestamp: '2026-09-17T10:30:00Z'
  }
];

const TRAFFIC_PROFILES = {
  'orders-api': 'steady',
  'reports-worker': 'idle_decline',
  'checkout-api': 'ramp',
  'payment-api': 'ramp'
};

function readJson(file, fallback) {
  try {
    const full = path.join(config.dataDir, file);
    const raw = fs.readFileSync(full, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals) {
  const factor = Math.pow(10, decimals || 0);
  return Math.round(value * factor) / factor;
}

/** Deterministic pseudo random so charts look identical on every reset. */
function seededNoise(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function seedFromString(text) {
  let hash = 7;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  return hash;
}

/**
 * Derives CPU / memory / latency from a request rate, anchored so the newest
 * generated point lines up with the service's real observation.
 */
function deriveMetrics(service, rpm, instances, observed) {
  const refRpm = observed.requests_per_minute;
  const refInstances = Math.max(1, service.instances);
  if (rpm <= 0 || refRpm <= 0) {
    return {
      cpu_percent: round(clamp(observed.cpu_percent * 0.85, 4, 100), 1),
      memory_percent: round(clamp(observed.memory_percent * 0.92, 5, 100), 1),
      latency_ms: rpm <= 0 ? 0 : observed.latency_ms
    };
  }
  const refLoad = refRpm / refInstances;
  const load = rpm / Math.max(1, instances);
  const ratio = load / refLoad;
  return {
    cpu_percent: round(clamp(observed.cpu_percent * Math.pow(ratio, 0.85), 3, 99), 1),
    memory_percent: round(clamp(observed.memory_percent * Math.pow(ratio, 0.45), 5, 99), 1),
    latency_ms: round(clamp(observed.latency_ms * Math.pow(ratio, 0.75), 20, 5000), 0)
  };
}

function profileRpm(profile, fraction, endRpm, startRpm, noise) {
  const wobble = 1 + (noise() - 0.5) * 0.06;
  if (profile === 'idle_decline') {
    if (fraction >= 0.45) return 0;
    const decay = 1 - fraction / 0.45;
    return Math.max(0, Math.round(720 * decay * wobble));
  }
  if (profile === 'ramp') {
    const value = startRpm + (endRpm - startRpm) * Math.pow(fraction, 1.7);
    return Math.max(0, Math.round(value * wobble));
  }
  const value = endRpm * (0.9 + fraction * 0.1);
  return Math.max(0, Math.round(value * wobble));
}

function buildHistory(service) {
  const observed = observedMetrics(service);
  const profile = service.traffic_profile || TRAFFIC_PROFILES[service.service_id] || 'steady';
  const noise = seededNoise(seedFromString(service.service_id));
  const endRpm = observed.requests_per_minute;
  const seededStart =
    service.previous_requests_per_minute != null && service.previous_requests_per_minute < endRpm
      ? service.previous_requests_per_minute * 0.5
      : endRpm * 0.17;
  const startRpm = profile === 'ramp' ? Math.round(seededStart) : endRpm;
  const points = [];
  for (let i = 0; i < HISTORY_POINTS; i += 1) {
    const fraction = i / (HISTORY_POINTS - 1);
    const minutesAgo = (HISTORY_POINTS - 1 - i) * HISTORY_INTERVAL_MINUTES;
    const rpm = i === HISTORY_POINTS - 1 ? endRpm : profileRpm(profile, fraction, endRpm, startRpm, noise);
    const metrics = deriveMetrics(service, rpm, service.instances, observed);
    points.push({
      timestamp: clock.isoMinutesAgo(minutesAgo),
      requests_per_minute: rpm,
      cpu_percent: i === HISTORY_POINTS - 1 ? observed.cpu_percent : metrics.cpu_percent,
      memory_percent: i === HISTORY_POINTS - 1 ? observed.memory_percent : metrics.memory_percent,
      latency_ms: i === HISTORY_POINTS - 1 ? observed.latency_ms : metrics.latency_ms,
      instances: service.instances,
      cost_per_hour: round(service.instances * service.cost_per_hour, 2)
    });
  }
  return points;
}

/** What the live cloud is actually doing right now, independent of the stored observation. */
function observedMetrics(service) {
  const live = service.live_observation;
  return {
    cpu_percent: live ? live.cpu_percent : service.cpu_percent,
    memory_percent: live ? live.memory_percent : service.memory_percent,
    requests_per_minute: live ? live.requests_per_minute : service.requests_per_minute,
    latency_ms: live ? live.latency_ms : service.latency_ms,
    healthy: live ? live.healthy : service.healthy
  };
}

const store = {
  services: [],
  history: {},
  events: [],
  actions: [],
  runs: [],
  counters: { action: 0, run: 0, event: 0 },
  expectedHourly: 0,
  lastReset: null
};

function seedEvents() {
  const add = (serviceId, severity, message, minutesAgo) =>
    store.events.push({
      event_id: `evt-${String(store.counters.event += 1).padStart(3, '0')}`,
      service_id: serviceId,
      severity,
      type: 'observation',
      message,
      timestamp: clock.isoMinutesAgo(minutesAgo)
    });

  add('reports-worker', 'info', 'Nightly report batch completed. Worker pool left running.', 168);
  add('reports-worker', 'warning', 'Request rate has been zero for 80 minutes across 4 instances.', 80);
  add('checkout-api', 'warning', 'Metrics agent stopped reporting. Last observation is from 08:00.', 152);
  add('checkout-api', 'info', 'Traffic feed shows sustained growth while the observation is frozen.', 34);
  add('payment-api', 'critical', 'Latency 410 ms exceeded the 300 ms target for 12 consecutive minutes.', 14);
  add('payment-api', 'warning', 'CPU saturation at 91% across 3 instances.', 11);
  add('orders-api', 'info', 'Autoscaling group stable at 6 instances.', 45);
  add(null, 'warning', 'Monthly cloud spend is tracking 37% above the approved plan.', 5);
}

function reset() {
  clock.resetClock();
  const seeded = readJson('services.seed.json', FALLBACK_SERVICES);
  store.services = clone(Array.isArray(seeded) && seeded.length ? seeded : FALLBACK_SERVICES).map((service) => ({
    ...service,
    display_name: service.display_name || service.service_id,
    status: service.status || 'running',
    size: service.size || 'medium',
    capacity_limit: service.capacity_limit != null ? service.capacity_limit : service.max_instances,
    previous_requests_per_minute:
      service.previous_requests_per_minute != null
        ? service.previous_requests_per_minute
        : service.requests_per_minute,
    timestamp: service.observation_frozen ? service.timestamp : clock.nowIso()
  }));
  store.history = {};
  store.services.forEach((service) => {
    store.history[service.service_id] = buildHistory(service);
  });
  store.events = [];
  store.actions = [];
  store.runs = [];
  store.counters = { action: 0, run: 0, event: 0 };
  seedEvents();
  const seededHourly = store.services.reduce(
    (total, s) => total + (s.status === 'running' ? s.instances * s.cost_per_hour : 0),
    0
  );
  // The plan of record: what finance approved before the overspend appeared.
  store.expectedHourly = round(seededHourly / config.expectedSpendRatio, 2);
  store.lastReset = clock.nowIso();
  return store;
}

/**
 * Loads an arbitrary, caller-supplied set of services as the live simulation
 * state, replacing whatever was seeded or run before. This is how the agent
 * accepts real-world-shaped input (see core/ingest.js) instead of only ever
 * reasoning about the built-in demo fleet. Every downstream module (safety,
 * observation, simulation) reads through state.getService()/listServices(),
 * so nothing else needs to know the data did not come from the seed file.
 */
function loadCustom(rawServices) {
  clock.resetClock();
  store.services = clone(rawServices).map((service) => ({
    ...service,
    display_name: service.display_name || service.service_id,
    status: service.status || 'running',
    size: service.size || 'medium',
    capacity_limit: service.capacity_limit != null ? service.capacity_limit : service.max_instances,
    previous_requests_per_minute:
      service.previous_requests_per_minute != null
        ? service.previous_requests_per_minute
        : service.requests_per_minute,
    timestamp: service.timestamp || clock.nowIso()
  }));
  store.history = {};
  store.services.forEach((service) => {
    store.history[service.service_id] = buildHistory(service);
  });
  store.events = [];
  store.actions = [];
  store.runs = [];
  store.counters = { action: 0, run: 0, event: 0 };
  const hourly = store.services.reduce(
    (total, s) => total + (s.status === 'running' ? s.instances * s.cost_per_hour : 0),
    0
  );
  store.expectedHourly = round(hourly / config.expectedSpendRatio, 2);
  store.lastReset = clock.nowIso();
  store.custom = true;
  return store;
}

function listServices() {
  return store.services;
}

function getService(serviceId) {
  return store.services.find((s) => s.service_id === serviceId) || null;
}

function getHistory(serviceId) {
  return store.history[serviceId] || [];
}

function pushHistoryPoint(serviceId) {
  const service = getService(serviceId);
  if (!service) return;
  const observed = observedMetrics(service);
  const points = store.history[serviceId] || [];
  points.push({
    timestamp: clock.nowIso(),
    requests_per_minute: service.status === 'stopped' ? 0 : observed.requests_per_minute,
    cpu_percent: service.status === 'stopped' ? 0 : observed.cpu_percent,
    memory_percent: service.status === 'stopped' ? 0 : observed.memory_percent,
    latency_ms: service.status === 'stopped' ? 0 : observed.latency_ms,
    instances: service.status === 'stopped' ? 0 : service.instances,
    cost_per_hour: round(service.status === 'stopped' ? 0 : service.instances * service.cost_per_hour, 2)
  });
  while (points.length > HISTORY_MAX) points.shift();
  store.history[serviceId] = points;
}

function addEvent(event) {
  const record = {
    event_id: `evt-${String((store.counters.event += 1)).padStart(3, '0')}`,
    service_id: event.service_id || null,
    severity: event.severity || 'info',
    type: event.type || 'system',
    message: event.message,
    timestamp: event.timestamp || clock.nowIso()
  };
  store.events.unshift(record);
  return record;
}

function listEvents(serviceId) {
  const sorted = [...store.events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (!serviceId) return sorted;
  return sorted.filter((e) => e.service_id === serviceId);
}

function nextActionId() {
  return `act-${String((store.counters.action += 1)).padStart(3, '0')}`;
}

function nextRunId() {
  return `run-${String((store.counters.run += 1)).padStart(3, '0')}`;
}

function addAction(action) {
  store.actions.unshift(action);
  return action;
}

function getAction(actionId) {
  return store.actions.find((a) => a.action_id === actionId) || null;
}

function listActions() {
  return store.actions;
}

function addRun(run) {
  store.runs.unshift(run);
  return run;
}

function getRun(runId) {
  return store.runs.find((r) => r.run_id === runId) || null;
}

function listRuns() {
  return store.runs;
}

/** Small periodic drift so the dashboard feels live without changing any decision. */
function tick() {
  store.services.forEach((service) => {
    if (service.status !== 'running') return;
    if (!service.observation_frozen) {
      const jitter = (base, spread, min, max) =>
        round(clamp(base + (Math.random() - 0.5) * spread, min, max), 1);
      if (service.requests_per_minute > 0) {
        service.previous_requests_per_minute = service.requests_per_minute;
        service.requests_per_minute = Math.round(
          clamp(service.requests_per_minute * (1 + (Math.random() - 0.5) * 0.04), 1, 100000)
        );
        service.latency_ms = Math.round(jitter(service.latency_ms, service.latency_ms * 0.05, 5, 5000));
      }
      service.cpu_percent = jitter(service.cpu_percent, 2.5, 2, 99);
      service.memory_percent = jitter(service.memory_percent, 2, 4, 99);
      service.timestamp = clock.nowIso();
    }
    pushHistoryPoint(service.service_id);
  });
}

module.exports = {
  store,
  reset,
  loadCustom,
  tick,
  listServices,
  getService,
  getHistory,
  pushHistoryPoint,
  addEvent,
  listEvents,
  addAction,
  getAction,
  listActions,
  addRun,
  getRun,
  listRuns,
  nextActionId,
  nextRunId,
  observedMetrics,
  buildHistory,
  round,
  clamp,
  clone
};
