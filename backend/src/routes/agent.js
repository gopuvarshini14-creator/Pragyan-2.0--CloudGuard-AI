'use strict';

const express = require('express');
const { config, agentMode } = require('../core/config');
const state = require('../core/state');
const agent = require('../core/agent');
const scenarios = require('../core/scenarios');
const safety = require('../core/safety');
const ingest = require('../core/ingest');

const router = express.Router();

let running = false;

router.post('/agent/run', async (req, res, next) => {
  if (running) {
    return res.status(429).json({ error: 'agent_busy', message: 'An agent run is already in progress.' });
  }
  running = true;
  try {
    const body = req.body || {};
    const run = await agent.run({
      prompt: body.prompt,
      focus_service: body.focus_service || body.service_id || null
    });
    return res.json(run);
  } catch (err) {
    return next(err);
  } finally {
    running = false;
  }
});

/**
 * Accepts a natural-language request together with caller-supplied
 * service/environment data — a "services" array, a single "service", a
 * stale "metric" plus a fresher "latest_traffic" reading, or a "service"
 * plus the "action_result" of a previously attempted action — and runs the
 * full inspect -> decide -> validate -> execute -> verify pipeline against
 * that data instead of the seeded demo fleet. This is the endpoint to call
 * with raw environment JSON rather than a pre-registered scenario id.
 */
router.post('/agent/analyze', async (req, res, next) => {
  if (running) {
    return res.status(429).json({ error: 'agent_busy', message: 'An agent run is already in progress.' });
  }
  const body = req.body || {};
  const ingested = ingest.fromRequest(body);
  if (ingested.error) {
    return res.status(400).json({ error: 'invalid_payload', message: ingested.error });
  }
  running = true;
  try {
    ingest.load(ingested.services);
    const run = await agent.run({
      prompt: body.prompt,
      focus_service: body.focus_service || ingested.focus_service || null
    });
    return res.json(run);
  } catch (err) {
    return next(err);
  } finally {
    running = false;
  }
});

router.get('/agent/runs', (req, res) => {
  res.json({
    runs: state.listRuns().map((run) => ({
      run_id: run.run_id,
      prompt: run.prompt,
      service_id: run.service_id,
      action: run.action,
      status: run.status,
      outcome: run.outcome,
      blocked: run.blocked,
      agent_mode: run.agent_mode,
      scenario_id: run.scenario_id,
      savings_per_hour: run.savings_per_hour,
      savings_per_month: run.cost_impact.savings.per_month,
      duration_ms: run.duration_ms,
      started_at: run.started_at,
      completed_at: run.completed_at
    }))
  });
});

router.get('/agent/runs/:id', (req, res) => {
  const run = state.getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: 'run_not_found', message: `No agent run with id "${req.params.id}".` });
  }
  return res.json(run);
});

router.get('/scenarios', (req, res) => {
  res.json({ scenarios: scenarios.list() });
});

router.post('/scenarios/:id/run', async (req, res, next) => {
  if (running) {
    return res.status(429).json({ error: 'agent_busy', message: 'An agent run is already in progress.' });
  }
  running = true;
  try {
    const result = await scenarios.run(req.params.id);
    if (!result) {
      return res
        .status(404)
        .json({ error: 'scenario_not_found', message: `No scenario with id "${req.params.id}".` });
    }
    return res.json(result);
  } catch (err) {
    return next(err);
  } finally {
    running = false;
  }
});

router.get('/policies', (req, res) => {
  res.json({
    policies: safety.listPolicies(),
    thresholds: {
      data_freshness_minutes: config.dataFreshnessThresholdMinutes,
      traffic_surge_percent: config.trafficSurgeThresholdPercent,
      latency_headroom_percent: config.latencyHeadroomPercent,
      cpu_high_percent: config.cpuHighThreshold,
      memory_high_percent: config.memoryHighThreshold,
      cpu_low_percent: config.cpuLowThreshold,
      memory_low_percent: config.memoryLowThreshold
    },
    allowed_actions: [
      'scale_up',
      'scale_down',
      'resize',
      'stop_idle_service',
      'delay_batch',
      'no_action',
      'refresh_observation'
    ]
  });
});

router.post('/reset', (req, res) => {
  state.reset();
  res.json({
    status: 'reset',
    message: 'Simulation restored to its seeded state.',
    services: state.listServices().length,
    reset_at: state.store.lastReset
  });
});

router.get('/settings', (req, res) => {
  res.json({
    agent_mode: agentMode(),
    ai_provider: config.aiProvider,
    ai_model: config.aiModel || null,
    data_freshness_threshold_minutes: config.dataFreshnessThresholdMinutes,
    expected_spend_ratio: config.expectedSpendRatio,
    simulation: 'in-memory, no cloud account is contacted',
    last_reset: state.store.lastReset
  });
});

module.exports = router;
