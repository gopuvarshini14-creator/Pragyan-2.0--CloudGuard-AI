# CloudGuard AI

### Autonomous Cloud Cost Optimization Agent

An AI agent that investigates a simulated cloud estate, decides how to cut spend, and is stopped by a deterministic safety engine whenever that decision would be unsafe.

Runs entirely in Docker. No API key, no database, no host runtimes.

```bash
docker compose up --build
# then open http://localhost:3000
```

---

## Overview

CloudGuard AI is a working FinOps control plane for a simulated cloud account. It monitors four services, detects that spend is running 37% above plan, and lets an autonomous agent investigate and act — under guardrails it cannot bypass.

The interesting part is not that the agent saves money. It is that the agent is *not trusted* to save money. Every proposal it makes is evaluated by a separate deterministic policy engine, and only an approved proposal reaches the cloud simulation. When the agent is wrong, the system says so.

## Problem

Cloud cost tooling tends to fall into two camps. Dashboards show you the overspend and leave the work to a human. Autoscalers act on their own but have no judgment about *why* a service looks idle — and an agent that scales down a service because its metrics are two hours stale will take down production.

Three failure modes matter:

1. **Stale observations.** A metrics agent stops reporting. The last reading says 900 requests per minute. The service is actually serving 5,200. Scaling down on that reading is an outage.
2. **Unverified success.** An action is submitted, the API returns, and the tool reports success — without checking whether the cloud actually did anything.
3. **Unbounded authority.** An LLM that can call the cloud API directly can do anything the API permits, including stopping a critical payment service.

## Solution

An agent that investigates like an engineer, and a policy engine that has final say.

The agent inspects services, checks traffic trend, health and observation freshness, analyses cost, and proposes exactly one action. It then hands that proposal to a safety engine written as plain deterministic code. The engine approves or blocks. Only an approved proposal reaches the simulated cloud control plane, and every executed action is re-measured against the service's own targets before it is reported as successful.

## Architecture

```text
Browser (localhost:3000)
        │
        │  relative /api/* requests
        ▼
Frontend container — nginx serving the built React app
        │  proxy_pass /api/ → http://backend:5000
        ▼
Backend container — Express API :5000
        │
        ├── Agent orchestrator ──► proposes one action
        │                              │
        │                              ▼
        ├── Safety policy engine ──► APPROVED or BLOCKED
        │                              │
        │                              ▼  (approved only)
        ├── Cloud simulation ──────► mutates in-memory state
        │                              │
        │                              ▼
        └── Verification ──────────► re-reads state, checks targets
```

The control flow that matters:

```text
AI Agent → Action Proposal → Safety Engine → Approved / Blocked → Cloud Simulation API
```

`simulation.execute()` refuses to run without an approved verdict object. There is no code path from the agent to the cloud state that skips the policy engine, and the manual controls in the UI go through exactly the same path.

### Where things live

| Concern | File |
| --- | --- |
| Simulation state, seeding, live drift | `backend/src/core/state.js` |
| Freshness, traffic trend, latency model | `backend/src/core/observation.js` |
| **Deterministic policy engine** | `backend/src/core/safety.js` |
| Cloud control plane + verification | `backend/src/core/simulation.js` |
| Agent workflow orchestration | `backend/src/core/agent.js` |
| Optional LLM reasoning layer | `backend/src/core/llm.js` |
| Cost maths and opportunity detection | `backend/src/core/cost.js` |
| Scenario simulator | `backend/src/core/scenarios.js` |

## Features

- Autonomous agent with a visible 10-stage investigation workflow
- Deterministic safety engine with 10 policies the agent cannot bypass
- Stale-observation protection with a refresh-and-re-evaluate remediation path
- Post-action verification against each service's own latency, health and capacity targets
- Honest failure reporting — a cloud rejection is never shown as a success
- Live state: actions actually change instance counts, cost, charts, events and history
- Scenario simulator with four predefined cloud incidents
- Cost analysis with expected/actual/projected spend and per-service recoverable savings
- Full audit surfaces: agent runs, cloud actions, event log, policy dashboard
- Works with no API key; optional Anthropic or OpenAI reasoning layer
- One-command reset for repeated demonstrations

## Agent Workflow

```text
USER REQUEST
     ↓
UNDERSTAND INTENT          intent + optional target service from free text
     ↓
INSPECT CLOUD STATE        GET /api/services
     ↓
CHECK METRICS              CPU, memory, latency per service
     ↓
CHECK TRAFFIC              GET /api/services/:id/traffic — trend over the window
     ↓
CHECK HEALTH               health state and degradation signals
     ↓
CHECK DATA FRESHNESS       observation age vs DATA_FRESHNESS_THRESHOLD
     ↓
ANALYZE COST               GET /api/cost — run rate vs plan
     ↓
GENERATE CANDIDATE ACTION  ranked candidates scoped by intent
     ↓
AGENT DECISION             exactly one proposal
     ↓
SAFETY POLICY ENGINE       approved / blocked, with per-policy detail
     ↓
EXECUTE SIMULATED ACTION   only if approved
     ↓
GET NEW METRICS            re-read the service
     ↓
VERIFY RESULT              instance count, status, latency, health, utilisation, freshness
     ↓
FINAL RESPONSE
```

The UI replays this in the **AI Optimization Agent** panel with live status indicators, the tool calls the agent made, the safety verdict, the timeline and the final response. Only tool calls and short decision summaries are shown — no hidden chain-of-thought is exposed.

The agent's action vocabulary is fixed:

```text
scale_up   scale_down   resize   stop_idle_service   delay_batch   no_action   refresh_observation
```

Anything outside this list is rejected before evaluation.

## Safety Architecture

The safety engine is a pure function of current state and the proposal. The agent cannot influence it except through the proposal itself.

| Policy | Rule |
| --- | --- |
| Stale data protection | Observations older than the threshold cannot drive a capacity decision. Checked **first**. |
| Health checks | Capacity is never reduced on an unhealthy service. |
| Minimum instances | `target_instances >= min_instances` |
| Maximum instances | `target_instances <= max_instances` |
| Latency protection | Predicted latency after the change must stay `<= max_latency_ms` |
| Availability protection | Capacity is never reduced while traffic is rising; a critical service is never stopped automatically. |
| Workload guard | `stop_idle_service` requires `requests_per_minute == 0` **and** non-critical. `delay_batch` requires a batch or background workload. |
| Scale-up justification | Extra capacity requires high CPU, high memory, breached latency, latency inside the headroom band, or substantial traffic growth. |
| Post-action verification | Every executed action is re-measured before being reported as successful. |
| Failure handling | A rejected cloud operation is always reported as failed. |

**Scale down** is allowed only when all of these hold: `target_instances >= min_instances`, the service is healthy, traffic is not rapidly increasing, and predicted latency `<= max_latency_ms`.

**Scale up** is allowed when CPU is high, memory is high, latency is above target, or traffic increased substantially — and always subject to `target_instances <= max_instances`.

**Stop idle service** is allowed only when `requests_per_minute == 0` and the service is non-critical. A critical API is never stopped automatically.

**Delay batch** is allowed only for background or batch workloads.

## Stale Data Protection

`DATA_FRESHNESS_THRESHOLD_MINUTES` defaults to 15. Each service carries the timestamp of its last observation. When the age exceeds the threshold:

```text
STALE DATA DETECTED
```

The safety engine blocks any state-changing proposal for that service and the UI shows:

```text
Optimization blocked until fresh metrics are available.
```

The agent's remediation path is to request a fresh observation, then re-evaluate against current metrics. It will not scale down on a stale reading — see Scenario C.

The simulation deliberately keeps the checkout API's observation frozen at 08:00 while its live traffic feed climbs to 5,200 RPM, so the conflict is real rather than narrated.

## API Documentation

Base path `/api`. The browser always calls a relative path; nginx proxies it to the backend container by service name.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness, agent mode, freshness threshold, simulated time |
| GET | `/api/services` | All services with derived signals |
| GET | `/api/services/:id` | One service with history and events |
| GET | `/api/services/:id/traffic` | Traffic feed and trend |
| GET | `/api/services/:id/events` | Events for one service |
| GET | `/api/services/:id/verify` | Post-action verification |
| POST | `/api/agent/run` | Run the agent against the seeded/simulated fleet — `{ "prompt": "...", "focus_service": "..." }` |
| POST | `/api/agent/analyze` | Run the agent against **caller-supplied** service/environment JSON — see below |
| GET | `/api/agent/runs` | Run history |
| GET | `/api/agent/runs/:id` | Full run record |
| POST | `/api/actions/scale` | `{ "service_id": "...", "target_instances": 5 }` |
| POST | `/api/actions/resize` | `{ "service_id": "...", "target_size": "small\|medium\|large" }` |
| POST | `/api/actions/stop` | `{ "service_id": "..." }` |
| POST | `/api/actions/delay-batch` | `{ "service_id": "..." }` |
| POST | `/api/actions/refresh` | Collect a fresh observation |
| GET | `/api/actions` | All submitted actions |
| GET | `/api/actions/:id` | One action record |
| GET | `/api/scenarios` | Scenario catalogue |
| POST | `/api/scenarios/:id/run` | Prepare and run a scenario |
| GET | `/api/cost` | Cost summary, opportunities and trend |
| GET | `/api/events` | Full event log |
| GET | `/api/policies` | Policy dashboard data |
| GET | `/api/settings` | Runtime configuration |
| POST | `/api/reset` | Restore the seeded state |

### Status codes

- `200` — action applied, or agent run completed
- `403` — the safety engine blocked the proposal (body carries the full verdict)
- `409` — the cloud rejected the action (body carries the failure, e.g. `capacity_unavailable`)
- `404` — unknown service, action, run or scenario

### `POST /api/agent/run`

Request:

```json
{
  "prompt": "Review the current services and reduce unnecessary cost without breaking the latency or availability requirements."
}
```

Response (abridged):

```json
{
  "run_id": "run-001",
  "status": "completed",
  "agent_mode": "DEMO",
  "service_id": "reports-worker",
  "problem": "Idle workload consuming unnecessary capacity.",
  "decision": "Stop idle service",
  "action": "stop_idle_service",
  "safety": { "decision": "approved", "checks": [], "reason": "..." },
  "execution": { "action_id": "act-001", "status": "success", "before": {}, "after": {} },
  "verification": { "status": "passed", "checks": [], "summary": "..." },
  "cost_impact": { "savings": { "per_hour": 44, "per_day": 1056, "per_month": 31680 } },
  "steps": [],
  "tool_calls": [],
  "timeline": [],
  "outcome": "succeeded",
  "final_message": "..."
}
```

### `POST /api/agent/analyze`

The agent normally reasons over its own simulated fleet. This endpoint is the same pipeline — inspect, check traffic/health/freshness/cost, choose an action, validate it against every safety policy, execute it, verify it — pointed at whatever service/environment data the caller supplies instead. It accepts exactly the shapes an external system would send:

**A single services array** (fleet-wide review):

```json
{
  "prompt": "Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.",
  "services": [
    { "service_id": "orders-api", "cpu_percent": 22, "memory_percent": 41, "requests_per_minute": 1200, "latency_ms": 180, "instances": 6, "cost_per_hour": 18.5, "min_instances": 2, "max_instances": 8, "max_latency_ms": 300, "healthy": true, "timestamp": "2026-09-17T10:30:00Z" },
    { "service_id": "reports-worker", "cpu_percent": 9, "memory_percent": 15, "requests_per_minute": 0, "latency_ms": 0, "instances": 4, "cost_per_hour": 11.0, "min_instances": 1, "max_instances": 6, "max_latency_ms": 900, "healthy": true, "timestamp": "2026-09-17T10:30:00Z" }
  ]
}
```

**A single service** (scoped request, e.g. rising traffic):

```json
{
  "prompt": "Orders traffic is increasing. Keep the service within its latency target.",
  "service": { "service_id": "orders-api", "cpu_percent": 28, "memory_percent": 48, "requests_per_minute": 4200, "previous_requests_per_minute": 2100, "latency_ms": 260, "instances": 4, "cost_per_hour": 18.5, "min_instances": 2, "max_instances": 8, "max_latency_ms": 300, "healthy": true, "timestamp": "2026-09-17T10:30:00Z" }
}
```

**A stale `metric` plus a fresher `latest_traffic` reading** (the agent must refuse to act on the stale one):

```json
{
  "prompt": "Reduce cost if it is safe.",
  "metric": { "service_id": "checkout-api", "cpu_percent": 24, "memory_percent": 39, "requests_per_minute": 900, "latency_ms": 170, "instances": 5, "cost_per_hour": 20.0, "min_instances": 2, "max_instances": 8, "max_latency_ms": 250, "healthy": true, "timestamp": "2026-09-17T08:00:00Z" },
  "latest_traffic": { "service_id": "checkout-api", "requests_per_minute": 5200, "timestamp": "2026-09-17T10:30:00Z" }
}
```

**A `service` plus the `action_result` of a previously attempted action** (the agent must not silently repeat, and must report honestly):

```json
{
  "prompt": "Scale the payment service only if the current state requires it.",
  "service": { "service_id": "payment-api", "cpu_percent": 91, "memory_percent": 82, "requests_per_minute": 6400, "latency_ms": 410, "instances": 3, "cost_per_hour": 22.0, "min_instances": 2, "max_instances": 8, "max_latency_ms": 300, "healthy": true, "timestamp": "2026-09-17T10:30:00Z" },
  "action_result": { "action_id": "act-784", "action": "scale_up", "requested_instances": 5, "status": "failed", "error": "capacity_unavailable" }
}
```

Only `service_id`, `cpu_percent`, `memory_percent`, `requests_per_minute`, `latency_ms`, `instances`, `cost_per_hour`, `min_instances`, `max_instances` and `max_latency_ms` are required per service; everything else (`display_name`, `workload_type`, `critical`, `size`, `capacity_limit`, `traffic_profile`, `healthy`, `timestamp`) is inferred with a sensible default and can be overridden. The response is the identical run record shape documented above for `/api/agent/run` (steps, tool calls, timeline, safety verdict, execution, verification, `final_message`). A malformed or incomplete payload returns `400 invalid_payload` rather than guessing. Loading custom data replaces the live simulation state until the next `POST /api/reset`.

Run `npm run test:ingest` inside `backend/` to execute all four payloads above against a live instance and check the agent's decisions.

### CLI — give it a query and JSON, get output directly (no server, no curl)

If you just want to hand the agent a query plus a JSON file and read back the result, use `backend/analyze-cli.js`. It runs the exact same pipeline in-process — no `docker compose up`, no HTTP call needed.

**One combined file** (prompt + data together):

```bash
cd backend
npm install          # first time only
node analyze-cli.js examples/test-input-a.json
```

**Query and data as separate files** — point it straight at files named the way they arrived (`services.json`, `service.json`, `metric.json` + `latest_traffic.json`, `service.json` + `action_result.json`):

```bash
node analyze-cli.js --prompt "Review the current services and reduce unnecessary cost without breaking the latency or availability requirements." --services services.json

node analyze-cli.js --prompt "Orders traffic is increasing. Keep the service within its latency target." --service service.json

node analyze-cli.js --prompt "Reduce cost if it is safe." --metric metric.json --latest_traffic latest_traffic.json

node analyze-cli.js --prompt "Scale the payment service only if the current state requires it." --service service.json --action_result action_result.json
```

Add `--out result.json` to also save the full run record, or `--quiet` to skip the raw JSON dump and only print the problem/decision/outcome/final message. All four of your original test inputs are bundled ready-to-run:

```bash
node analyze-cli.js examples/test-input-a.json   # cost optimization across a fleet
node analyze-cli.js examples/test-input-b.json   # rising traffic, protect latency
node analyze-cli.js examples/test-input-c.json   # stale observation vs. fresher traffic
node analyze-cli.js examples/test-input-d.json   # scale attempt rejected by the cloud
```

`examples/a/`, `examples/b/`, `examples/c/`, `examples/d/` also hold the same data split into the individually named files (`services.json`, `service.json`, `metric.json`, `latest_traffic.json`, `action_result.json`) for the `--services`/`--service`/`--metric`/`--action_result` flag style above.

## Scenario Testing

Four scenarios are on the dashboard, each with a **Run scenario** button. Each one resets the simulation to a known state first, so they can be demonstrated repeatedly and always behave identically.

### Scenario A — Cost Optimization

> Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.

The agent finds `reports-worker`: 0 RPM, 4 instances, $11/hour each, healthy, non-critical, batch. It proposes `stop_idle_service`. The safety engine approves. The action executes and verification passes.

```text
4 × $11 = $44/hour
$44 × 24 = $1,056/day
$44 × 24 × 30 = $31,680/month
```

### Scenario B — Rising Traffic

> Orders traffic is increasing. Keep the service within its latency target.

`orders-api` traffic doubles from 2,100 to 4,200 RPM on 4 instances. Latency sits at 260 ms against a 300 ms target. The agent recognises the service needs capacity and scales to **5 instances**. Latency drops to 215 ms and verification passes.

### Scenario C — Stale Observation

> Reduce cost if it is safe.

The stored observation for `checkout-api` is from 08:00 — 900 RPM on 5 instances, low utilisation. It looks over-provisioned, so the agent proposes a scale-down. The live traffic feed says 5,200 RPM.

```text
STALE → BLOCKED → REFRESH → RE-EVALUATE → SAFE DECISION
```

The safety engine blocks the scale-down on freshness. The UI shows *Optimization blocked until fresh metrics are available.* The agent refreshes the observation, re-evaluates against the real numbers, and scales **up** to 6 instances instead. Both attempts are shown in the panel.

### Scenario D — Failed Action

> Scale the payment service only if the current state requires it.

`payment-api` is at 91% CPU, 82% memory, 6,400 RPM and 410 ms against a 300 ms target on 3 instances. Scaling is required. The agent proposes 3 → 5 instances and the safety engine approves — but the simulated region cannot allocate them:

```json
{ "action": "scale_up", "requested_instances": 5, "status": "failed", "error": "capacity_unavailable" }
```

The UI shows **ACTION FAILED — capacity_unavailable**. Nothing changed. The final response states plainly that the service remains under pressure and needs capacity elsewhere or a size change. This is never presented as a success.

## Docker Setup

Two services, defined in `docker-compose.yml`.

**`backend`** — `node:20-alpine`, installs production dependencies, runs the Express API on port 5000 as a non-root user. Build context is the repository root so the seeded data under `data/scenarios/` is baked into the image. A `HEALTHCHECK` polls `GET /api/health`.

**`frontend`** — multi-stage. Stage one builds the React app with Vite. Stage two copies the built assets into `nginx:1.27-alpine` and serves them on port 80, published as `3000` on the host. `nginx.conf` proxies `/api/` to `http://backend:5000` and falls back to `index.html` for client-side routes.

The frontend never contains a machine-specific address. It calls relative `/api/...` paths, which nginx resolves to the backend by Docker service name. `depends_on: condition: service_healthy` means the frontend only starts once the backend health check passes.

> **On lockfiles:** this project pins exact dependency versions in both `package.json` files and uses `npm install` in the Dockerfiles. `npm ci` and a committed `package-lock.json` are the right choice for a long-lived repository; generate one with `npm install` in each of `backend/` and `frontend/` if you want to commit it.

## Environment Variables

Everything is optional. Copy `.env.example` to `.env` only if you want to override something — the application runs correctly with no `.env` file at all.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `demo` | `demo`, `anthropic` or `openai` |
| `AI_API_KEY` | *(empty)* | Leave empty. The demo must never break for a missing key. |
| `AI_MODEL` | *(empty)* | Optional model override |
| `PORT` | `5000` | Backend port inside the container |
| `FRONTEND_PORT` | `3000` | Host port the dashboard is published on |
| `BACKEND_PORT` | `5000` | Host port the API is published on |
| `DATA_FRESHNESS_THRESHOLD_MINUTES` | `15` | Stale-observation threshold |

### Agent modes

The sidebar and header always show which mode is active.

**`Agent Mode: DEMO`** — the default. The reasoning layer is a deterministic rule engine running the full workflow. No key, no network call, no cost, identical output every time.

**`Agent Mode: LLM`** — active only when `AI_PROVIDER` is `anthropic` or `openai` *and* `AI_API_KEY` is set. The model proposes one action as JSON. That proposal is validated against the allowed action list and the known service inventory, and then goes through the same safety engine. A malformed response, an unknown action, a network error or a timeout falls back to the demo agent silently. The model never gains authority the demo agent does not have.

## Running the Project

```bash
git clone <repository>
cd cloudguard-ai

docker compose up --build
```

Then open:

```text
http://localhost:3000
```

Stopping:

```bash
docker compose down
```

Resetting:

```bash
docker compose down -v
docker compose up --build
```

The backend API is also published on `http://localhost:5000` if you want to call it directly:

```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/services
curl -X POST http://localhost:5000/api/agent/run \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reduce cost if it is safe."}'
```

### Running the test suites

Both suites run inside the backend container with no extra dependencies:

```bash
docker compose exec backend npm run test:engine
docker compose exec backend npm run test:api
docker compose exec backend npm run test:runtime
```

`test:engine` exercises the simulation, safety engine, agent and all four scenarios. `test:api` starts the server on port 5099 and asserts every endpoint, including the blocked and failed paths. `test:runtime` drives the background ticker hard, replays the scenarios on a drifted clock, runs the agent twelve times in a row, and fires every action type at every service to prove nothing throws and no invariant breaks.

## Troubleshooting

**`Bind for 0.0.0.0:3000 failed: port is already allocated`**

Something else on your machine already owns that port. Either stop it, or publish on different host ports — create a `.env` file next to `docker-compose.yml`:

```env
FRONTEND_PORT=3080
BACKEND_PORT=5050
```

Then `docker compose up --build` and open `http://localhost:3080`. Only the host side changes; the containers still talk to each other on their internal ports, so nothing else needs editing.

To find what is holding the port:

```bash
# Windows (PowerShell)
netstat -ano | findstr :3000

# macOS / Linux
lsof -i :3000
```

A previous run of this project is a common culprit — `docker compose down` clears it.

**Containers start but the dashboard shows "Cannot reach the simulation engine"**

Check the backend is healthy with `docker compose ps`. If it is not, read its logs with `docker compose logs backend`.

**A rebuild does not seem to pick up changes**

```bash
docker compose down -v
docker compose build --no-cache
docker compose up
```

## Demo Instructions

A five-minute walkthrough:

1. **Open `http://localhost:3000`.** The banner reports spend 37% above plan across 4 services with 1 high-confidence opportunity. KPI cards show $321.00/hour and $231,120 projected monthly.
2. **Read the services table.** `orders-api` stable, `reports-worker` an optimization candidate, `checkout-api` flagged stale data, `payment-api` latency exceeded.
3. **Click "Investigate with AI."** The agent panel opens and walks the ten workflow stages, then shows its tool calls, the decision card, every safety check, the timeline and the final response. Watch the KPI cards and the cost chart change behind it.
4. **Run Scenario C.** This is the one to spend time on. The agent proposes a scale-down, the safety engine blocks it on freshness, the observation is refreshed, and the re-evaluation produces the opposite decision. Both attempts and both sets of policy checks are visible.
5. **Run Scenario D.** Safety approves, the cloud rejects with `capacity_unavailable`, and the run is reported as FAILED with the service still under pressure.
6. **Open Actions.** Every submission is listed with SUCCESS, FAILED or BLOCKED — including the ones that never touched the cloud.
7. **Open Policies** to show the guardrails, then **Reset simulation** from the header to start over.

## Project Structure

```text
cloudguard-ai/
├── docker-compose.yml
├── README.md
├── .env.example
├── .gitignore
├── .dockerignore
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── lib/          api client, types, formatters, global store
│       ├── components/   sidebar, topbar, charts, tables, agent panel
│       └── pages/        dashboard, services, cost, runs, actions, events, policies, settings
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── test-engine.js
│   ├── test-api.js
│   ├── test-runtime.js
│   └── src/
│       ├── server.js
│       ├── core/         config, clock, state, observation, safety, simulation, agent, llm, cost, scenarios
│       └── routes/       services, actions, agent
│
└── data/
    └── scenarios/
        ├── services.seed.json
        └── scenarios.json
```

## Future Enhancements

- Replace the in-memory store with a real time-series backend so history survives a restart
- Read-only adapters for AWS Cost Explorer, CloudWatch and Azure Monitor, keeping the same safety engine in front of any write
- Automatic rollback: capture a pre-action snapshot and restore it when verification fails
- Policy authoring in the UI with a dry-run mode that shows what a proposed rule would have blocked historically
- Multi-action plans with dependency ordering, evaluated as a unit rather than one action at a time
- Approval workflows for high-blast-radius actions, with the agent preparing the change and a human approving it
- Confidence calibration: track how often each opportunity type verifies successfully and weight future proposals accordingly

---

**Nothing in this project touches a real cloud account.** All state is in memory inside the backend container, seeded from `data/scenarios/`, and restored by `POST /api/reset`. No AWS, Azure or GCP credentials are read, requested or used.
