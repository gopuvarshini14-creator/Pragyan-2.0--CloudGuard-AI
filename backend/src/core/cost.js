'use strict';

const { config } = require('./config');
const state = require('./state');
const observation = require('./observation');

const round = state.round;

const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;

function project(perHour) {
  return {
    per_hour: round(perHour, 2),
    per_day: round(perHour * HOURS_PER_DAY, 2),
    per_month: round(perHour * HOURS_PER_DAY * DAYS_PER_MONTH, 2)
  };
}

/**
 * Opportunities are detected deterministically from the current state. The agent
 * uses them as candidates; it never invents a saving that is not listed here.
 */
function findOpportunities(services) {
  const items = [];
  services.forEach((service) => {
    if (!service.running) return;
    if (service.freshness.stale) {
      items.push({
        service_id: service.service_id,
        type: 'refresh_required',
        action: 'refresh_observation',
        savings_per_hour: 0,
        confidence: 'blocked',
        description: `Observation is ${Math.round(service.freshness.age_minutes)} minutes old. Fresh metrics are required before any capacity decision.`
      });
      return;
    }
    if (service.idle && !service.critical && service.healthy) {
      items.push({
        service_id: service.service_id,
        type: 'idle_workload',
        action: 'stop_idle_service',
        savings_per_hour: round(service.instances * service.cost_per_hour, 2),
        target_instances: 0,
        confidence: 'high',
        description: `${service.instances} instances are running with zero requests on a non-critical ${service.workload_type} workload.`
      });
      return;
    }
    if (
      service.instances > service.min_instances &&
      service.cpu_percent < config.cpuLowThreshold &&
      service.memory_percent < config.memoryLowThreshold &&
      service.traffic_trend.direction !== 'rising' &&
      service.latency_ms <= service.max_latency_ms
    ) {
      const target = Math.max(service.min_instances, service.instances - 1);
      items.push({
        service_id: service.service_id,
        type: 'over_provisioned',
        action: 'scale_down',
        savings_per_hour: round((service.instances - target) * service.cost_per_hour, 2),
        target_instances: target,
        confidence: 'medium',
        description: `CPU at ${service.cpu_percent}% and memory at ${service.memory_percent}% across ${service.instances} instances with flat traffic.`
      });
    }
    if (service.cpu_percent >= config.cpuHighThreshold || service.latency_ms > service.max_latency_ms) {
      items.push({
        service_id: service.service_id,
        type: 'under_provisioned',
        action: 'scale_up',
        savings_per_hour: 0,
        target_instances: Math.min(service.max_instances, service.instances + 2),
        confidence: 'high',
        description: `Latency ${service.latency_ms} ms against a ${service.max_latency_ms} ms target with CPU at ${service.cpu_percent}%.`
      });
    }
  });
  return items;
}

function summary() {
  const services = observation.enrichAll();
  const actualHourly = services.reduce((total, s) => total + s.cost_per_hour_total, 0);
  const expectedHourly = state.store.expectedHourly || round(actualHourly / config.expectedSpendRatio, 2);
  const overspendPercent = expectedHourly > 0 ? ((actualHourly - expectedHourly) / expectedHourly) * 100 : 0;
  const opportunities = findOpportunities(services);
  const savingsHourly = opportunities.reduce((total, o) => total + o.savings_per_hour, 0);

  const byService = services.map((s) => ({
    service_id: s.service_id,
    display_name: s.display_name,
    cost_per_hour: s.cost_per_hour_total,
    projected_monthly: s.projected_monthly_cost,
    instances: s.instances,
    share_percent: actualHourly > 0 ? round((s.cost_per_hour_total / actualHourly) * 100, 1) : 0,
    savings_per_hour: round(
      opportunities
        .filter((o) => o.service_id === s.service_id)
        .reduce((total, o) => total + o.savings_per_hour, 0),
      2
    )
  }));

  return {
    actual: project(actualHourly),
    expected: project(expectedHourly),
    projected_after_optimization: project(Math.max(0, actualHourly - savingsHourly)),
    potential_savings: project(savingsHourly),
    overspend_percent: round(overspendPercent, 1),
    overspend: project(Math.max(0, actualHourly - expectedHourly)),
    high_confidence_opportunities: opportunities.filter((o) => o.confidence === 'high' && o.savings_per_hour > 0)
      .length,
    services_monitored: services.length,
    services_healthy: services.filter((s) => s.health_state === 'healthy').length,
    services_attention: services.filter((s) => ['degraded', 'unhealthy', 'unknown'].includes(s.health_state))
      .length,
    opportunities,
    by_service: byService
  };
}

/** Cost trend for the dashboard chart: expected line, actual line, projection forward. */
function trend() {
  const services = observation.enrichAll();
  const actualHourly = services.reduce((total, s) => total + s.cost_per_hour_total, 0);
  const expectedHourly = state.store.expectedHourly || round(actualHourly / config.expectedSpendRatio, 2);
  const history = services.map((s) => state.getHistory(s.service_id));
  const length = history.reduce((max, points) => Math.max(max, points.length), 0);
  const rows = [];
  const step = Math.max(1, Math.floor(length / 18));

  for (let i = 0; i < length; i += step) {
    let hourly = 0;
    let timestamp = null;
    history.forEach((points) => {
      const point = points[i] || points[points.length - 1];
      if (!point) return;
      hourly += point.cost_per_hour;
      if (!timestamp) timestamp = point.timestamp;
    });
    rows.push({
      timestamp,
      expected: round(expectedHourly, 2),
      actual: round(hourly, 2),
      projected: null
    });
  }
  if (rows.length) {
    rows[rows.length - 1].projected = rows[rows.length - 1].actual;
    const last = rows[rows.length - 1];
    for (let i = 1; i <= 6; i += 1) {
      rows.push({
        timestamp: new Date(new Date(last.timestamp).getTime() + i * 15 * 60000).toISOString(),
        expected: round(expectedHourly, 2),
        actual: null,
        projected: round(actualHourly * (1 + i * 0.004), 2)
      });
    }
  }
  return rows;
}

function savingsBreakdown(perHour) {
  return project(perHour);
}

module.exports = { summary, trend, findOpportunities, project, savingsBreakdown };
