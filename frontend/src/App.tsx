import { useEffect, useState } from 'react';
import Sidebar, { NAV_ITEMS } from './components/Sidebar';
import Topbar from './components/Topbar';
import AgentPanel from './components/AgentPanel';
import { DashboardPage, ServicesPage } from './pages/Dashboard';
import {
  ActionsPage,
  AgentRunsPage,
  CostAnalysisPage,
  EventsPage,
  PoliciesPage,
  SettingsPage
} from './pages/Pages';

const VALID = new Set(NAV_ITEMS.map((item) => item.id));

function readHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return VALID.has(raw) ? raw : 'dashboard';
}

export default function App() {
  const [page, setPage] = useState<string>(readHash);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => setPage(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (id: string) => {
    window.location.hash = `/${id}`;
    setPage(id);
  };

  return (
    <div className="min-h-screen">
      <Sidebar
        active={page}
        onNavigate={navigate}
        mobileOpen={navOpen}
        onCloseMobile={() => setNavOpen(false)}
      />

      <div className="lg:pl-[228px]">
        <Topbar page={page} onOpenNav={() => setNavOpen(true)} />
        <main className="mx-auto max-w-[1520px] animate-riseIn">
          {page === 'dashboard' && <DashboardPage />}
          {page === 'services' && <ServicesPage />}
          {page === 'cost' && <CostAnalysisPage />}
          {page === 'runs' && <AgentRunsPage />}
          {page === 'actions' && <ActionsPage />}
          {page === 'events' && <EventsPage />}
          {page === 'policies' && <PoliciesPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>

      <AgentPanel />
    </div>
  );
}
