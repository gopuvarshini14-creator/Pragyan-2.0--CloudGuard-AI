import { Loader2, Menu, Play, RotateCcw } from 'lucide-react';
import { useStore } from '../lib/store';
import { NAV_ITEMS } from './Sidebar';

const SUBTITLES: Record<string, string> = {
  dashboard: 'Autonomous cloud cost optimization',
  services: 'Live inventory of the simulated estate',
  cost: 'Where the money is going and what can be recovered',
  runs: 'Every investigation the agent has carried out',
  actions: 'Every change submitted to the cloud control plane',
  events: 'Observation, action and agent activity log',
  policies: 'The guardrails the agent cannot bypass',
  settings: 'Runtime configuration and simulation controls'
};

export default function Topbar({ page, onOpenNav }: { page: string; onOpenNav: () => void }) {
  const { health, agent, runAgent, resetSimulation, resetting } = useStore();
  const running = agent.status === 'running';
  const title = page === 'dashboard' ? 'CloudGuard AI' : NAV_ITEMS.find((n) => n.id === page)?.label ?? 'CloudGuard AI';

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-base/85 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
        <button
          type="button"
          className="text-muted hover:text-ink lg:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h1>
          <p className="truncate text-xs text-muted">{SUBTITLES[page]}</p>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span className="chip border-line bg-raised text-muted">Production simulation</span>
          <span
            className={`chip ${
              running ? 'border-agent/40 bg-agent/10 text-agent' : 'border-ok/30 bg-ok/10 text-ok'
            }`}
          >
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-agent' : 'bg-ok'}`} />
              <span
                className={`absolute inset-0 rounded-full ${running ? 'bg-agent/60' : 'bg-ok/60'} animate-pulseRing`}
              />
            </span>
            {running ? 'Agent working' : 'Agent active'}
          </span>
          {health && (
            <span className="chip border-line bg-raised text-muted">
              <span className="num">{health.agent_mode}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void resetSimulation()}
            disabled={resetting || running}
            title="Restore all services, actions and runs to their seeded state"
          >
            {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            <span className="hidden sm:inline">Reset simulation</span>
          </button>
          <button type="button" className="btn-primary" onClick={() => void runAgent()} disabled={running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run optimization
          </button>
        </div>
      </div>
    </header>
  );
}
