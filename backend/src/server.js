'use strict';

const express = require('express');
const cors = require('cors');

const { config, agentMode } = require('./core/config');
const clock = require('./core/clock');
const state = require('./core/state');
const servicesRoutes = require('./routes/services');
const actionsRoutes = require('./routes/actions');
const agentRoutes = require('./routes/agent');

const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cloudguard-api',
    version: '1.0.0',
    agent_mode: agentMode(),
    ai_provider: config.aiProvider,
    simulated_time: clock.nowIso(),
    services_loaded: state.listServices().length,
    data_freshness_threshold_minutes: config.dataFreshnessThresholdMinutes,
    uptime_seconds: Math.round(process.uptime())
  });
});

app.use('/api', servicesRoutes);
app.use('/api', actionsRoutes);
app.use('/api', agentRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.originalUrl}.` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[cloudguard] unhandled error:', err);
  res.status(500).json({
    error: 'internal_error',
    message: 'The simulation engine failed to complete the request.',
    detail: err && err.message ? err.message : undefined
  });
});

state.reset();
setInterval(() => {
  try {
    state.tick();
  } catch (err) {
    console.error('[cloudguard] tick failed:', err.message);
  }
}, config.tickIntervalMs).unref();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[cloudguard] API listening on :${config.port}`);
  console.log(`[cloudguard] agent mode: ${agentMode()}`);
  console.log(`[cloudguard] data directory: ${config.dataDir}`);
  console.log(`[cloudguard] simulated time anchored at ${config.simulationAnchor}`);
});

function shutdown(signal) {
  console.log(`[cloudguard] ${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
