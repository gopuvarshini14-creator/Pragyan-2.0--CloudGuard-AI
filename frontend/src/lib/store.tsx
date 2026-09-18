import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import type {
  AgentRun,
  AgentRunSummary,
  CloudAction,
  CloudEvent,
  CostSummary,
  Health,
  Policy,
  Scenario,
  Service
} from './types';

export const STEP_BLUEPRINT = [
  { id: 'understand', label: 'Understanding request' },
  { id: 'inspect', label: 'Inspecting services' },
  { id: 'traffic', label: 'Checking traffic' },
  { id: 'health', label: 'Checking health' },
  { id: 'freshness', label: 'Checking freshness' },
  { id: 'cost', label: 'Evaluating cost' },
  { id: 'select', label: 'Selecting action' },
  { id: 'safety', label: 'Safety validation' },
  { id: 'execute', label: 'Executing' },
  { id: 'verify', label: 'Verifying' }
];

const STEP_DELAY_MS = 380;

export interface AgentPanelState {
  status: 'idle' | 'running' | 'done' | 'error';
  activeStep: number;
  run: AgentRun | null;
  scenario: Scenario | null;
  error: string | null;
}

interface StoreValue {
  services: Service[];
  cost: CostSummary | null;
  events: CloudEvent[];
  actions: CloudAction[];
  runs: AgentRunSummary[];
  scenarios: Scenario[];
  policies: Policy[];
  health: Health | null;
  loading: boolean;
  error: string | null;
  agent: AgentPanelState;
  panelOpen: boolean;
  resetting: boolean;
  openPanel: () => void;
  closePanel: () => void;
  refresh: () => Promise<void>;
  runAgent: (prompt?: string, focusService?: string) => Promise<void>;
  runScenario: (scenario: Scenario) => Promise<void>;
  openRun: (runId: string) => Promise<void>;
  resetSimulation: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

const IDLE_AGENT: AgentPanelState = {
  status: 'idle',
  activeStep: 0,
  run: null,
  scenario: null,
  error: null
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Service[]>([]);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [actions, setActions] = useState<CloudAction[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentPanelState>(IDLE_AGENT);
  const [panelOpen, setPanelOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [servicesRes, costRes, eventsRes, actionsRes, runsRes, healthRes] = await Promise.all([
        api.services(),
        api.cost(),
        api.events(),
        api.actions(),
        api.runs(),
        api.health()
      ]);
      setServices(servicesRes.services);
      setCost(costRes);
      setEvents(eventsRes.events);
      setActions(actionsRes.actions);
      setRuns(runsRes.runs);
      setHealth(healthRes);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The CloudGuard API is unreachable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      try {
        const [scenarioRes, policyRes] = await Promise.all([api.scenarios(), api.policies()]);
        if (cancelled) return;
        setScenarios(scenarioRes.scenarios);
        setPolicies(policyRes.policies);
      } catch (err) {
        // The dashboard still works without these; the pages show their own empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Live polling, paused while the agent is mid-run so the choreography is not disturbed.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busy.current) void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const choreograph = useCallback(
    async (work: () => Promise<{ run: AgentRun; scenario: Scenario | null }>) => {
      if (busy.current) return;
      busy.current = true;
      setPanelOpen(true);
      setAgent({ status: 'running', activeStep: 0, run: null, scenario: null, error: null });

      const started = Date.now();
      let cancelled = false;
      const ticker = window.setInterval(() => {
        if (cancelled) return;
        setAgent((prev) =>
          prev.status === 'running'
            ? { ...prev, activeStep: Math.min(prev.activeStep + 1, STEP_BLUEPRINT.length - 1) }
            : prev
        );
      }, STEP_DELAY_MS);

      try {
        const { run, scenario } = await work();
        const minimum = STEP_BLUEPRINT.length * STEP_DELAY_MS;
        const remaining = minimum - (Date.now() - started);
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        cancelled = true;
        window.clearInterval(ticker);
        setAgent({
          status: 'done',
          activeStep: STEP_BLUEPRINT.length,
          run,
          scenario,
          error: null
        });
        await refresh();
      } catch (err) {
        cancelled = true;
        window.clearInterval(ticker);
        setAgent({
          status: 'error',
          activeStep: 0,
          run: null,
          scenario: null,
          error:
            err instanceof ApiError
              ? err.message
              : 'The agent run could not be completed. Check that the backend container is healthy.'
        });
      } finally {
        busy.current = false;
      }
    },
    [refresh]
  );

  const runAgent = useCallback(
    async (prompt?: string, focusService?: string) => {
      await choreograph(async () => ({ run: await api.runAgent(prompt, focusService), scenario: null }));
    },
    [choreograph]
  );

  const runScenario = useCallback(
    async (scenario: Scenario) => {
      await choreograph(async () => {
        const result = await api.runScenario(scenario.id);
        return { run: result.run, scenario: result.scenario || scenario };
      });
    },
    [choreograph]
  );

  const openRun = useCallback(async (runId: string) => {
    try {
      const run = await api.run(runId);
      setAgent({ status: 'done', activeStep: STEP_BLUEPRINT.length, run, scenario: null, error: null });
      setPanelOpen(true);
    } catch (err) {
      setAgent({
        status: 'error',
        activeStep: 0,
        run: null,
        scenario: null,
        error: err instanceof ApiError ? err.message : 'That agent run could not be loaded.'
      });
      setPanelOpen(true);
    }
  }, []);

  const resetSimulation = useCallback(async () => {
    setResetting(true);
    try {
      await api.reset();
      setAgent(IDLE_AGENT);
      setPanelOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The simulation could not be reset.');
    } finally {
      setResetting(false);
    }
  }, [refresh]);

  const value = useMemo<StoreValue>(
    () => ({
      services,
      cost,
      events,
      actions,
      runs,
      scenarios,
      policies,
      health,
      loading,
      error,
      agent,
      panelOpen,
      resetting,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      refresh,
      runAgent,
      runScenario,
      openRun,
      resetSimulation
    }),
    [
      services,
      cost,
      events,
      actions,
      runs,
      scenarios,
      policies,
      health,
      loading,
      error,
      agent,
      panelOpen,
      resetting,
      refresh,
      runAgent,
      runScenario,
      openRun,
      resetSimulation
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside StoreProvider');
  return context;
}
