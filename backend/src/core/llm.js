'use strict';

const { config, agentMode } = require('./config');

const ALLOWED_ACTIONS = [
  'scale_up',
  'scale_down',
  'resize',
  'stop_idle_service',
  'delay_batch',
  'no_action',
  'refresh_observation'
];

const SYSTEM_PROMPT = [
  'You are the reasoning layer of CloudGuard AI, a cloud cost optimisation agent.',
  'You receive a snapshot of a simulated cloud estate and a request from an operator.',
  'You propose exactly one action. You never execute anything: a separate deterministic',
  'safety engine decides whether your proposal is allowed, and it can overrule you.',
  '',
  'Rules you must respect when proposing:',
  '- Never reduce capacity based on an observation flagged as stale. Propose refresh_observation instead.',
  '- Never stop a service marked critical, and never stop a service serving traffic.',
  '- Protecting the latency target outranks saving money.',
  '',
  `Allowed actions: ${ALLOWED_ACTIONS.join(', ')}.`,
  '',
  'Reply with JSON only, no prose and no markdown fences, in this shape:',
  '{"service_id":"...","action":"...","target_instances":null,"problem":"one sentence","rationale":"one sentence"}'
].join('\n');

function buildUserPrompt(prompt, services, opportunities) {
  const compact = services.map((s) => ({
    service_id: s.service_id,
    cpu_percent: s.cpu_percent,
    memory_percent: s.memory_percent,
    requests_per_minute: s.requests_per_minute,
    latency_ms: s.latency_ms,
    max_latency_ms: s.max_latency_ms,
    instances: s.instances,
    min_instances: s.min_instances,
    max_instances: s.max_instances,
    cost_per_hour_per_instance: s.cost_per_hour,
    healthy: s.healthy,
    critical: s.critical,
    workload_type: s.workload_type,
    status: s.status,
    observation_stale: s.freshness.stale,
    observation_age_minutes: Math.round(s.freshness.age_minutes),
    traffic_trend: s.traffic_trend.direction,
    traffic_change_percent: s.traffic_trend.change_percent
  }));
  return [
    `Operator request: ${prompt}`,
    '',
    'Cloud estate:',
    JSON.stringify(compact, null, 2),
    '',
    'Detected opportunities:',
    JSON.stringify(opportunities, null, 2)
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

async function callAnthropic(userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.aiApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.aiModel || 'claude-sonnet-4-5',
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    }),
    signal: AbortSignal.timeout(config.aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`Anthropic API responded ${response.status}`);
  const data = await response.json();
  const text = (data.content || [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
  return extractJson(text);
}

async function callOpenAI(userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.aiApiKey}`
    },
    body: JSON.stringify({
      model: config.aiModel || 'gpt-4o-mini',
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(config.aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`OpenAI API responded ${response.status}`);
  const data = await response.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return extractJson(text);
}

/**
 * Returns a validated proposal, or null. Any failure — missing key, network
 * error, malformed output, unknown action — falls back to the demo agent.
 */
async function propose(prompt, services, opportunities) {
  if (agentMode() !== 'LLM') return null;
  const userPrompt = buildUserPrompt(prompt, services, opportunities);
  try {
    const raw =
      config.aiProvider === 'openai' ? await callOpenAI(userPrompt) : await callAnthropic(userPrompt);
    if (!raw || typeof raw !== 'object') return null;
    if (!ALLOWED_ACTIONS.includes(raw.action)) return null;
    if (!services.some((s) => s.service_id === raw.service_id)) return null;
    return {
      service_id: raw.service_id,
      action: raw.action,
      target_instances:
        raw.target_instances === null || raw.target_instances === undefined
          ? null
          : Number(raw.target_instances),
      problem: typeof raw.problem === 'string' ? raw.problem : null,
      rationale: typeof raw.rationale === 'string' ? raw.rationale : null,
      source: 'llm'
    };
  } catch (err) {
    return null;
  }
}

module.exports = { propose, ALLOWED_ACTIONS, SYSTEM_PROMPT };
