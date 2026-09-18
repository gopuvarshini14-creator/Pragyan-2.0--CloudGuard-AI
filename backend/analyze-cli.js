#!/usr/bin/env node
'use strict';

/**
 * Give it a natural-language query plus structured service/environment data,
 * get back the full agent run (problem, action, safety verdict, execution,
 * verification, final message) — printed to the terminal and optionally
 * written to a file. No server, no curl, no Docker needed for this part.
 *
 * Usage
 * -----
 *   node analyze-cli.js <input.json>
 *       <input.json> is one file containing BOTH the prompt and the data,
 *       in any of the shapes /api/agent/analyze accepts:
 *         { "prompt": "...", "services": [ {...}, {...} ] }
 *         { "prompt": "...", "service": {...} }
 *         { "prompt": "...", "metric": {...}, "latest_traffic": {...} }
 *         { "prompt": "...", "service": {...}, "action_result": {...} }
 *
 *   node analyze-cli.js --prompt "..." --data <data.json>
 *       The query and the data live in separate files/strings.
 *
 *   node analyze-cli.js --prompt "..." --services <services.json>
 *   node analyze-cli.js --prompt "..." --service <service.json>
 *   node analyze-cli.js --prompt "..." --metric <metric.json> --latest_traffic <latest_traffic.json>
 *   node analyze-cli.js --prompt "..." --service <service.json> --action_result <action_result.json>
 *       Point directly at the individually named files, exactly as they were
 *       supplied (services.json, service.json, metric.json, latest_traffic.json,
 *       action_result.json) — no need to merge them into one file first.
 *
 * Flags
 * -----
 *   --out <file>     also write the full run JSON to this file
 *   --quiet          suppress the full JSON dump, print only the final message
 *
 * Examples for all four sample test inputs are in backend/examples/.
 * Try:  node analyze-cli.js examples/test-input-a.json
 */

const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data/scenarios');

const state = require('./src/core/state');
const ingest = require('./src/core/ingest');
const agent = require('./src/core/agent');

function readJsonFile(file) {
  const full = path.resolve(process.cwd(), file);
  const raw = fs.readFileSync(full, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`"${file}" is not valid JSON: ${err.message}`);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const hasValue = i + 1 < argv.length && !argv[i + 1].startsWith('--');
      args[key] = hasValue ? argv[++i] : true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printUsageAndExit() {
  console.error(
    [
      'Usage:',
      '  node analyze-cli.js <input.json>',
      '  node analyze-cli.js --prompt "..." --data <data.json>',
      '  node analyze-cli.js --prompt "..." --services <services.json>',
      '  node analyze-cli.js --prompt "..." --service <service.json>',
      '  node analyze-cli.js --prompt "..." --metric <metric.json> --latest_traffic <latest_traffic.json>',
      '  node analyze-cli.js --prompt "..." --service <service.json> --action_result <action_result.json>',
      '',
      'Try one of the bundled examples:',
      '  node analyze-cli.js examples/test-input-a.json',
      '  node analyze-cli.js examples/test-input-b.json',
      '  node analyze-cli.js examples/test-input-c.json',
      '  node analyze-cli.js examples/test-input-d.json'
    ].join('\n')
  );
  process.exit(1);
}

function buildBody(args) {
  // Single combined file: node analyze-cli.js input.json
  if (args._[0] && !args.prompt && !args.data && !args.services && !args.service && !args.metric) {
    return readJsonFile(args._[0]);
  }

  const body = {};
  if (typeof args.prompt === 'string') body.prompt = args.prompt;
  if (args.data) Object.assign(body, readJsonFile(args.data));
  if (args.services) body.services = readJsonFile(args.services);
  if (args.service) body.service = readJsonFile(args.service);
  if (args.metric) body.metric = readJsonFile(args.metric);
  if (args.latest_traffic) body.latest_traffic = readJsonFile(args.latest_traffic);
  if (args.action_result) body.action_result = readJsonFile(args.action_result);
  if (typeof args.focus_service === 'string') body.focus_service = args.focus_service;
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._.length && !args.prompt && !args.data) printUsageAndExit();

  const body = buildBody(args);

  if (!body.prompt) {
    console.error('Missing "prompt". Pass --prompt "..." or include "prompt" in the input JSON.');
    process.exit(1);
    return;
  }

  const ingested = ingest.fromRequest(body);
  if (ingested.error) {
    console.error('Invalid payload:', ingested.error);
    process.exit(1);
    return;
  }

  ingest.load(ingested.services);

  const run = await agent.run({
    prompt: body.prompt,
    focus_service: body.focus_service || ingested.focus_service || null
  });

  if (!args.quiet) {
    console.log(JSON.stringify(run, null, 2));
  }

  console.log('\n--- Problem ---\n' + run.problem);
  console.log('\n--- Decision ---\n' + run.decision + (run.target_instances != null ? ` (target: ${run.target_instances} instances)` : ''));
  console.log('\n--- Outcome ---\n' + run.outcome);
  console.log('\n--- Final message ---\n' + run.final_message + '\n');

  if (args.out) {
    fs.writeFileSync(path.resolve(process.cwd(), args.out), JSON.stringify(run, null, 2));
    console.log(`(full run written to ${args.out})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
