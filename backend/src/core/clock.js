'use strict';

const { config } = require('./config');

/**
 * The simulation runs on its own clock so the seeded observation timestamps stay
 * meaningful. The clock is anchored to SIMULATION_ANCHOR at process start and
 * then advances in real time.
 */
let anchorSim = new Date(config.simulationAnchor).getTime();
let anchorReal = Date.now();

function now() {
  return new Date(anchorSim + (Date.now() - anchorReal));
}

function nowIso() {
  return now().toISOString();
}

function resetClock() {
  anchorSim = new Date(config.simulationAnchor).getTime();
  anchorReal = Date.now();
}

function minutesSince(isoTimestamp) {
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (now().getTime() - then) / 60000;
}

function isoMinutesAgo(minutes) {
  return new Date(now().getTime() - minutes * 60000).toISOString();
}

function clockTime(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

module.exports = { now, nowIso, resetClock, minutesSince, isoMinutesAgo, clockTime };
