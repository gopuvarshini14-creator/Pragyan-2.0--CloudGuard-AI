'use strict';

const express = require('express');
const state = require('../core/state');
const observation = require('../core/observation');
const simulation = require('../core/simulation');
const cost = require('../core/cost');

const router = express.Router();

function requireService(req, res) {
  const service = state.getService(req.params.id);
  if (!service) {
    res.status(404).json({ error: 'service_not_found', message: `No service with id "${req.params.id}".` });
    return null;
  }
  return service;
}

router.get('/services', (req, res) => {
  res.json({ services: observation.enrichAll(), count: state.listServices().length });
});

router.get('/services/:id/traffic', (req, res) => {
  const service = requireService(req, res);
  if (!service) return;
  const points = state.getHistory(service.service_id);
  const trend = observation.trafficTrend(service.service_id);
  res.json({
    service_id: service.service_id,
    current_rpm: state.observedMetrics(service).requests_per_minute,
    observed_rpm: service.requests_per_minute,
    trend,
    points
  });
});

router.get('/services/:id/events', (req, res) => {
  const service = requireService(req, res);
  if (!service) return;
  res.json({ service_id: service.service_id, events: state.listEvents(service.service_id) });
});

router.get('/services/:id/verify', (req, res) => {
  const service = requireService(req, res);
  if (!service) return;
  const expectation = {};
  if (req.query.instances != null) expectation.instances = Number(req.query.instances);
  if (req.query.status) expectation.status = String(req.query.status);
  res.json(simulation.verify(service.service_id, expectation));
});

router.get('/services/:id', (req, res) => {
  const service = requireService(req, res);
  if (!service) return;
  res.json({
    service: observation.enrich(service),
    history: state.getHistory(service.service_id),
    events: state.listEvents(service.service_id).slice(0, 25)
  });
});

router.get('/events', (req, res) => {
  res.json({ events: state.listEvents(req.query.service_id) });
});

router.get('/cost', (req, res) => {
  res.json({ ...cost.summary(), trend: cost.trend() });
});

module.exports = router;
