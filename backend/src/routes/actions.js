'use strict';

const express = require('express');
const state = require('../core/state');
const safety = require('../core/safety');
const simulation = require('../core/simulation');

const router = express.Router();

/**
 * Every write goes through the same path: build a proposal, ask the safety
 * engine, and only then touch the simulated cloud. There is no bypass.
 */
function submit(proposal, res, source) {
  if (!proposal.service_id) {
    return res.status(400).json({ error: 'service_id_required', message: 'A service_id is required.' });
  }
  if (!state.getService(proposal.service_id)) {
    return res
      .status(404)
      .json({ error: 'service_not_found', message: `No service with id "${proposal.service_id}".` });
  }

  const verdict = safety.evaluate(proposal);
  const action = simulation.execute(proposal, verdict, { source: source || 'api' });
  const status = verdict.decision === 'blocked' ? 403 : action.status === 'failed' ? 409 : 200;

  return res.status(status).json({
    action,
    safety: verdict,
    verification:
      action.status === 'success' && proposal.action !== 'no_action'
        ? simulation.verify(proposal.service_id, {
            instances: verdict.target_instances != null ? verdict.target_instances : undefined,
            status: proposal.action === 'stop_idle_service' ? 'stopped' : 'running'
          })
        : null
  });
}

router.post('/actions/scale', (req, res) => {
  const { service_id: serviceId, target_instances: targetInstances } = req.body || {};
  const service = state.getService(serviceId);
  if (!service) {
    return res.status(404).json({ error: 'service_not_found', message: `No service with id "${serviceId}".` });
  }
  if (targetInstances == null || Number.isNaN(Number(targetInstances))) {
    return res
      .status(400)
      .json({ error: 'target_instances_required', message: 'target_instances must be a number.' });
  }
  const target = Number(targetInstances);
  const action = target >= service.instances ? 'scale_up' : 'scale_down';
  return submit({ service_id: serviceId, action, target_instances: target }, res);
});

router.post('/actions/resize', (req, res) => {
  const { service_id: serviceId, target_size: targetSize } = req.body || {};
  if (!targetSize || !simulation.SIZE_TIERS[targetSize]) {
    return res.status(400).json({
      error: 'invalid_size',
      message: `target_size must be one of ${Object.keys(simulation.SIZE_TIERS).join(', ')}.`
    });
  }
  return submit({ service_id: serviceId, action: 'resize', target_size: targetSize }, res);
});

router.post('/actions/stop', (req, res) => {
  const { service_id: serviceId } = req.body || {};
  return submit({ service_id: serviceId, action: 'stop_idle_service', target_instances: 0 }, res);
});

router.post('/actions/delay-batch', (req, res) => {
  const { service_id: serviceId } = req.body || {};
  return submit({ service_id: serviceId, action: 'delay_batch' }, res);
});

router.post('/actions/refresh', (req, res) => {
  const { service_id: serviceId } = req.body || {};
  return submit({ service_id: serviceId, action: 'refresh_observation' }, res);
});

router.get('/actions', (req, res) => {
  res.json({ actions: state.listActions() });
});

router.get('/actions/:id', (req, res) => {
  const action = state.getAction(req.params.id);
  if (!action) {
    return res.status(404).json({ error: 'action_not_found', message: `No action with id "${req.params.id}".` });
  }
  return res.json({ action });
});

module.exports = router;
