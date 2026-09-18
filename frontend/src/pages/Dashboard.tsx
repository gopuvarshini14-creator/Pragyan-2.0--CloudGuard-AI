import { useState } from 'react';
import { Cloud, TrendingUp } from 'lucide-react';
import { useStore } from '../lib/store';
import { AlertBanner, KpiRow } from '../components/Overview';
import { CostTrendChart } from '../components/Charts';
import ServicesTable from '../components/ServicesTable';
import ServiceDetail from '../components/ServiceDetail';
import ScenarioSimulator from '../components/ScenarioSimulator';
import PromptConsole from '../components/PromptConsole';
import { Panel, ErrorState, Skeleton, Badge } from '../components/Primitives';
import { percent } from '../lib/format';

export function DashboardPage() {
  const { cost, services, loading, error, refresh } = useStore();
  const [selected, setSelected] = useState<string | null>(null);

  if (error) {
    return (
      <div className="p-5 sm:p-6">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <AlertBanner />
      <PromptConsole />
      <KpiRow />

      <Panel
        title="Cloud spend"
        note="Hourly run rate against the approved plan, with a forward projection"
        actions={
          cost ? (
            <Badge tone="warn" icon={<TrendingUp size={11} />}>
              {percent(cost.overspend_percent)} over plan
            </Badge>
          ) : null
        }
        bodyClassName="p-4"
      >
        {cost ? <CostTrendChart cost={cost} /> : <Skeleton className="h-[268px]" />}
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-lineSoft pt-3">
          <LegendKey color="#8497B1" label="Expected spend" dashed />
          <LegendKey color="#4C8EFF" label="Actual spend" />
          <LegendKey color="#F6B43C" label="Projected spend" dashed />
        </div>
      </Panel>

      <Panel
        title="Services"
        note="Click any service to open its metrics, charts and manual controls"
        bodyClassName="p-0"
      >
        <ServicesTable services={services} onSelect={setSelected} loading={loading} />
      </Panel>

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-ink">Scenario simulator</h2>
          <p className="mt-0.5 text-xs text-muted">
            Test the autonomous agent against predefined cloud incidents. Each scenario resets the simulation to a
            known state before it runs.
          </p>
        </div>
        <ScenarioSimulator />
      </section>

      {selected && <ServiceDetail serviceId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-2xs text-muted">
      <span
        className="h-0 w-5 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
      {label}
    </span>
  );
}

export function ServicesPage() {
  const { services, loading, error, refresh } = useStore();
  const [selected, setSelected] = useState<string | null>(null);

  if (error) {
    return (
      <div className="p-5 sm:p-6">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {services.map((service) => (
          <button
            key={service.service_id}
            type="button"
            onClick={() => setSelected(service.service_id)}
            className="panel px-4 py-3.5 text-left transition-colors hover:border-signal/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="num text-sm font-medium text-ink">{service.service_id}</span>
              <Cloud size={13} className="text-dim" />
            </div>
            <p className="num mt-2 text-lg font-semibold text-ink">
              {service.instances}
              <span className="text-xs font-normal text-dim"> / {service.max_instances} inst</span>
            </p>
            <p className="mt-1 text-2xs text-muted">{service.optimization}</p>
          </button>
        ))}
      </div>

      <Panel title="Service inventory" note="Live observation of the simulated estate" bodyClassName="p-0">
        <ServicesTable services={services} onSelect={setSelected} loading={loading} />
      </Panel>

      {selected && <ServiceDetail serviceId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
