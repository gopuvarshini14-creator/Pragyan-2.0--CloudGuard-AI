import {
  Activity,
  Cloud,
  DollarSign,
  Home,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  X,
  Zap
} from 'lucide-react';
import { useStore } from '../lib/store';

export interface NavItem {
  id: string;
  label: string;
  icon: typeof Home;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'services', label: 'Services', icon: Cloud },
  { id: 'cost', label: 'Cost Analysis', icon: DollarSign },
  { id: 'runs', label: 'Agent Runs', icon: Sparkles },
  { id: 'actions', label: 'Actions', icon: Zap },
  { id: 'events', label: 'Events', icon: ScrollText },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export default function Sidebar({
  active,
  onNavigate,
  mobileOpen,
  onCloseMobile
}: {
  active: string;
  onNavigate: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { health, cost, runs } = useStore();
  const mode = health?.agent_mode ?? 'DEMO';

  const badges: Record<string, number> = {
    runs: runs.length,
    services: cost?.services_monitored ?? 0
  };

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[228px] flex-col border-r border-line bg-panel/95 backdrop-blur transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-signal/35 bg-signal/10">
              <Shield size={15} className="text-signal" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-ink">CloudGuard AI</p>
              <p className="text-2xs text-dim">FinOps control plane</p>
            </div>
          </div>
          <button
            type="button"
            className="text-muted hover:text-ink lg:hidden"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      onCloseMobile();
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                      isActive
                        ? 'bg-signal/12 text-ink'
                        : 'text-muted hover:bg-raised/70 hover:text-ink'
                    }`}
                  >
                    <span
                      className={`h-4 w-[2px] rounded-full transition-colors ${
                        isActive ? 'bg-signal' : 'bg-transparent'
                      }`}
                    />
                    <Icon size={15} className={isActive ? 'text-signal' : 'text-dim group-hover:text-muted'} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {badges[item.id] > 0 && (
                      <span className="num rounded bg-raised px-1.5 py-0.5 text-2xs text-muted">
                        {badges[item.id]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-lineSoft px-5 py-4">
          <div className="flex items-center gap-2">
            <Cloud size={13} className="text-dim" />
            <p className="text-2xs font-medium text-muted">Simulated cloud</p>
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-dim">
            No cloud account is contacted. All state is in memory.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-raised/70 px-2.5 py-1.5">
            <Activity size={12} className={mode === 'LLM' ? 'text-agent' : 'text-signal'} />
            <span className="text-2xs text-muted">Agent Mode:</span>
            <span className={`num text-2xs font-semibold ${mode === 'LLM' ? 'text-agent' : 'text-signal'}`}>
              {mode}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
