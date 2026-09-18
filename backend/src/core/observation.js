'use strict';

const { config } = require('./config');
const clock = require('./clock');
const state = require('./state');

const round = state.round;
const clamp = state.clamp;

/**
 * Latency model for the simulated cloud. Latency responds to load per instance
 * with a sub-linear exponent, and never drops below a fixed floor.
 */
function predictLatency(service, targetInstances, rpmOverride) {
  if (targetInstances <= 0) return 0;
  const rpm = rpmOverride != null ? rpmOverride : service.requests_per_minute;
  if (rpm <= 0) return 0;
  const currentInstances = Math.max(1, service.instances);
  const floor = Math.max(20, service.latency_ms * 0.45);
  const ratio = currentInstances / targetInstances;
  const predicted = service.latency_ms * Math.pow(ratio, 0.85);
  return Math.round(clamp(predicted, floor, 20000));
}

function predictCpu(service, targetInstances) {
  if (targetInstances <= 0) return 0;
  const ratio = Math.max(1, service.instances) / targetInstances;
  return round(clamp(service.cpu_percent * Math.pow(ratio, 0.95), 1, 100), 1);
}

function trafficTrend(serviceId) {
  const points = state.getHistory(serviceId);
  if (points.length < 6) return { change_percent: 0, direction: 'flat', recent_rpm: 0, previous_rpm: 0 };
  const window = Math.min(6, Math.floor(points.length / 2));
  const recent = points.slice(-window);
  const previous = points.slice(-window * 2, -window);
  const avg = (arr) => arr.reduce((t, p) => t + p.requests_per_minute, 0) / Math.max(1, arr.length);
  const recentAvg = avg(recent);
  const previousAvg = avg(previous);
  let changePercent = 0;
  if (previousAvg > 0) changePercent = ((recentAvg - previousAvg) / previousAvg) * 100;
  else if (recentAvg > 0) changePercent = 100;
  let direction = 'flat';
  if (changePercent > config.trafficSurgeThresholdPercent) direction = 'rising';
  else if (changePercent < -config.trafficSurgeThresholdPercent) direction = 'falling';
  return {
    change_percent: round(changePercent, 1),
    direction,
    recent_rpm: Math.round(recentAvg),
    previous_rpm: Math.round(previousAvg)
  };
}

function freshness(service) {
  const ageMinutes = clock.minutesSince(service.timestamp);
  const threshold = config.dataFreshnessThresholdMinutes;
  return {
    observed_at: service.timestamp,
    age_minutes: round(ageMinutes, 1),
    threshold_minutes: threshold,
    stale: ageMinutes > threshold
  };
}

/**
 * The public view of a service: stored observation plus everything derived from it.
 */
function enrich(service) {
  const fresh = freshness(service);
  const trend = trafficTrend(service.service_id);
  const running = service.status === 'running';
  const costPerHour = running ? round(service.instances * service.cost_per_hour, 2) : 0;
  const trafficFeedRpm = state.observedMetrics(service).requests_per_minute;

  const signals = [];
  if (fresh.stale) signals.push('stale_observation');
  if (!service.healthy) signals.push('unhealthy');
  if (running && service.requests_per_minute === 0 && service.workload_type !== 'api') signals.push('idle');
  if (running && service.requests_per_minute === 0 && service.workload_type === 'api') signals.push('no_traffic');
  if (service.latency_ms > service.max_latency_ms) signals.push('latency_exceeded');
  if (service.cpu_percent >= config.cpuHighThreshold) signals.push('cpu_high');
  if (service.memory_percent >= config.memoryHighThreshold) signals.push('memory_high');
  if (trend.direction === 'rising') signals.push('traffic_rising');
  if (!running) signals.push('stopped');

  let optimization = 'Stable';
  if (!running) optimization = 'Stopped';
  else if (fresh.stale) optimization = 'Stale data';
  else if (signals.includes('latency_exceeded') || signals.includes('cpu_high')) optimization = 'Latency exceeded';
  else if (signals.includes('idle')) optimization = 'Optimization candidate';
  else if (signals.includes('traffic_rising')) optimization = 'Traffic rising';
  else if (
    running &&
    service.instances > service.min_instances &&
    service.cpu_percent < config.cpuLowThreshold &&
    service.memory_percent < config.memoryLowThreshold &&
    trend.direction !== 'rising'
  ) {
    optimization = 'Over-provisioned';
  }

  let health = 'healthy';
  if (!running) health = 'stopped';
  else if (!service.healthy) health = 'unhealthy';
  else if (signals.includes('latency_exceeded') || signals.includes('cpu_high')) health = 'degraded';
  else if (fresh.stale) health = 'unknown';

  return {
    ...service,
    running,
    cost_per_hour_total: costPerHour,
    cost_per_hour_per_instance: service.cost_per_hour,
    projected_monthly_cost: round(costPerHour * 24 * 30, 2),
    traffic_feed_rpm: trafficFeedRpm,
    traffic_trend: trend,
    freshness: fresh,
    signals,
    optimization,
    health_state: health,
    idle: running && service.requests_per_minute === 0,
    headroom_instances: service.max_instances - service.instances
  };
}

function enrichAll() {
  return state.listServices().map(enrich);
}

module.exports = { enrich, enrichAll, freshness, trafficTrend, predictLatency, predictCpu };
