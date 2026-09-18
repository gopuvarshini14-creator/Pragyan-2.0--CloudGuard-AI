import { useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store';

const EXAMPLES = [
  'Review the current services and reduce unnecessary cost without breaking the latency or availability requirements.',
  'Orders traffic is increasing. Keep the service within its latency target.',
  'Reduce cost if it is safe.',
  'Scale the payment service only if the current state requires it.'
];

export default function PromptConsole() {
  const { services, agent, runAgent } = useStore();
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState('');
  const running = agent.status === 'running';

  const submit = () => {
    const text = prompt.trim();
    if (!text || running) return;
    void runAgent(text, scope || undefined);
  };

  return (
    <div className="panel px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-agent/35 bg-agent/10">
          <Sparkles size={13} className="text-agent" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Ask the agent</p>
          <p className="text-2xs text-muted">
            Type a request in plain English. The agent investigates, proposes one action, and the safety engine
            decides whether it runs.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="sr-only">Request for the agent</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. Reduce cost if it is safe."
            rows={2}
            disabled={running}
            className="w-full resize-none rounded-md border border-line bg-raised/60 px-3 py-2 text-sm text-ink placeholder:text-dim focus:border-signal/50 disabled:opacity-60"
          />
        </label>

        <div className="flex shrink-0 gap-2 sm:flex-col">
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            disabled={running}
            className="rounded-md border border-line bg-raised/60 px-2.5 py-2 text-xs text-muted focus:border-signal/50 disabled:opacity-60 sm:w-[168px]"
            title="Optionally scope the investigation to one service"
          >
            <option value="">All services</option>
            {services.map((service) => (
              <option key={service.service_id} value={service.service_id}>
                {service.service_id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-agent sm:w-[168px]"
            onClick={submit}
            disabled={running || !prompt.trim()}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Run agent
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={running}
            onClick={() => setPrompt(example)}
            className="rounded border border-lineSoft bg-raised/40 px-2.5 py-1 text-2xs text-muted transition-colors hover:border-line hover:text-ink disabled:opacity-50"
          >
            {example.length > 58 ? `${example.slice(0, 58)}…` : example}
          </button>
        ))}
      </div>
    </div>
  );
}
