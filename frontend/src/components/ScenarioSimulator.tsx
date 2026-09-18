import { Loader2, Play } from 'lucide-react';
import { useStore } from '../lib/store';
import { Skeleton } from './Primitives';

const ACCENTS: Record<string, { ring: string; text: string; bg: string }> = {
  A: { ring: 'border-ok/30', text: 'text-ok', bg: 'bg-ok/10' },
  B: { ring: 'border-signal/30', text: 'text-signal', bg: 'bg-signal/10' },
  C: { ring: 'border-warn/30', text: 'text-warn', bg: 'bg-warn/10' },
  D: { ring: 'border-danger/30', text: 'text-danger', bg: 'bg-danger/10' }
};

export default function ScenarioSimulator() {
  const { scenarios, runScenario, agent } = useStore();
  const running = agent.status === 'running';

  if (!scenarios.length) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {scenarios.map((scenario) => {
        const accent = ACCENTS[scenario.letter] ?? ACCENTS.A;
        const active = agent.scenario?.id === scenario.id && running;
        return (
          <article
            key={scenario.id}
            className={`flex flex-col rounded-lg border bg-panel p-4 shadow-panel transition-colors ${
              active ? accent.ring : 'border-line'
            }`}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className={`num grid h-7 w-7 place-items-center rounded-md border text-xs font-semibold ${accent.ring} ${accent.bg} ${accent.text}`}
              >
                {scenario.letter}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{scenario.title}</p>
                <p className="truncate text-2xs text-dim">{scenario.subtitle}</p>
              </div>
            </div>

            <p className="flex-1 text-2xs leading-relaxed text-muted">{scenario.description}</p>

            <p className="num mt-3 rounded border border-lineSoft bg-raised/50 px-2.5 py-1.5 text-2xs text-dim">
              expects {scenario.expected.action} · safety {scenario.expected.safety}
            </p>

            <button
              type="button"
              className="btn-ghost mt-3 w-full"
              disabled={running}
              onClick={() => void runScenario(scenario)}
            >
              {active ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run scenario
            </button>
          </article>
        );
      })}
    </div>
  );
}
