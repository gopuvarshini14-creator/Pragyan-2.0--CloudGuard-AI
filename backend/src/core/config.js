'use strict';

const path = require('path');

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: num(process.env.PORT, 5000),
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '../../../data/scenarios'),

  // Agent
  aiProvider: (process.env.AI_PROVIDER || 'demo').toLowerCase(),
  aiApiKey: (process.env.AI_API_KEY || '').trim(),
  aiModel: process.env.AI_MODEL || '',
  aiTimeoutMs: num(process.env.AI_TIMEOUT_MS, 12000),

  // Safety policy thresholds
  dataFreshnessThresholdMinutes: num(process.env.DATA_FRESHNESS_THRESHOLD_MINUTES, 15),
  trafficSurgeThresholdPercent: num(process.env.TRAFFIC_SURGE_THRESHOLD_PERCENT, 25),
  latencyHeadroomPercent: num(process.env.LATENCY_HEADROOM_PERCENT, 85),
  cpuHighThreshold: num(process.env.CPU_HIGH_THRESHOLD, 75),
  memoryHighThreshold: num(process.env.MEMORY_HIGH_THRESHOLD, 75),
  cpuLowThreshold: num(process.env.CPU_LOW_THRESHOLD, 35),
  memoryLowThreshold: num(process.env.MEMORY_LOW_THRESHOLD, 50),

  // Simulation
  simulationAnchor: process.env.SIMULATION_ANCHOR || '2026-09-17T10:35:00Z',
  tickIntervalMs: num(process.env.TICK_INTERVAL_MS, 20000),
  expectedSpendRatio: num(process.env.EXPECTED_SPEND_RATIO, 1.37)
};

/**
 * The agent runs on a real LLM only when a provider and a key are both present.
 * Everything in the product works without either of them.
 */
function agentMode() {
  const hasKey = config.aiApiKey.length > 0;
  const provider = config.aiProvider;
  if (hasKey && (provider === 'anthropic' || provider === 'openai')) return 'LLM';
  return 'DEMO';
}

module.exports = { config, agentMode };
