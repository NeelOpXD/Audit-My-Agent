import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Search,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AgentRecord, EvaluationRunRecord } from '../types/audit';

export type NavSection =
  | 'overview'
  | 'agents'
  | 'testing-lab'
  | 'red-team'
  | 'traces'
  | 'benchmarking'
  | 'reports'
  | 'scenarios'
  | 'settings';

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'testing-lab', label: 'Testing Lab', icon: FlaskConical },
  { id: 'red-team', label: 'Red Team', icon: ShieldAlert },
  { id: 'traces', label: 'Execution Traces', icon: GitBranch },
  { id: 'benchmarking', label: 'Benchmarking', icon: BarChart3 },
  { id: 'reports', label: 'Reliability Reports', icon: FileSpreadsheet },
  { id: 'scenarios', label: 'Test Scenarios', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface AppShellProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  agents: AgentRecord[];
  selectedAgentId: number | null;
  onSelectAgent: (id: number | null) => void;
  recentRuns: EvaluationRunRecord[];
  onQuickSearchNavigate: (section: NavSection, payload?: { runId?: number; agentId?: number }) => void;
  children: React.ReactNode;
}

export function AppShell({
  activeSection,
  onNavigate,
  agents,
  selectedAgentId,
  onSelectAgent,
  recentRuns,
  onQuickSearchNavigate,
  children,
}: AppShellProps) {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label || 'Overview';

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const items: Array<{ label: string; meta: string; section: NavSection; agentId?: number; runId?: number }> = [];

    for (const nav of NAV_ITEMS) {
      if (nav.label.toLowerCase().includes(q)) {
        items.push({ label: nav.label, meta: 'Workspace Section', section: nav.id });
      }
    }
    for (const ag of agents) {
      if (ag.name.toLowerCase().includes(q) || ag.endpoint.toLowerCase().includes(q)) {
        items.push({
          label: ag.name,
          meta: `Agent · ${ag.status}`,
          section: 'agents',
          agentId: ag.id,
        });
      }
    }
    for (const r of recentRuns.slice(0, 15)) {
      const label = `Run #${r.id} (${r.agentName || 'Agent'})`;
      if (label.toLowerCase().includes(q) || (r.suiteName || '').toLowerCase().includes(q)) {
        items.push({
          label,
          meta: `Evaluation · ${r.status}`,
          section: 'reports',
          runId: r.id,
        });
      }
    }
    return items.slice(0, 7);
  }, [searchQuery, agents, recentRuns]);

  const notifications = useMemo(
    () =>
      recentRuns.slice(0, 6).map((r) => ({
        id: r.id,
        title: `Run #${r.id} · ${r.agentName || `Agent ${r.agentId}`}`,
        detail: `${r.status} · ${r.passedCount} passed, ${r.failedCount} failed`,
        isFailure: r.failedCount > 0 || r.status === 'failed',
      })),
    [recentRuns]
  );

  return (
    <div className="min-h-screen bg-[#0B0D12] text-slate-100 flex">
      {/* Collapsible Sidebar */}
      <aside
        className={`${
          collapsed ? 'w-[68px]' : 'w-[248px]'
        } shrink-0 border-r border-[#242B3D] bg-[#121620] flex flex-col transition-all duration-150`}
      >
        <div className="h-14 px-4 border-b border-[#242B3D] flex items-center justify-between gap-2">
          {!collapsed && (
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className="text-left min-w-0 cursor-pointer"
            >
              <div className="font-display text-sm font-bold tracking-tight text-slate-100 truncate">
                Audit-My-Agent
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Test. Break. Measure. Improve.
              </div>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1A2030] transition-colors cursor-pointer shrink-0"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-violet-600/15 text-violet-300 border border-violet-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-[#171C28] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-violet-400' : 'text-slate-400'}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#242B3D]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-xs font-semibold text-violet-300 shrink-0">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200 truncate">
                    {user?.displayName || 'Evaluator'}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                onClick={() => void logout()}
                title="Sign out"
                className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-[#1A2030] transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 px-6 border-b border-[#242B3D] bg-[#121620] flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 whitespace-nowrap">Audit-My-Agent</span>
            <span className="text-slate-600">/</span>
            <span className="font-medium text-slate-100 whitespace-nowrap truncate">
              {activeLabel}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Global Search */}
            <div className="relative hidden md:block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents, runs, views..."
                className="w-56 pl-8 pr-3 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              {searchResults.length > 0 && (
                <div className="absolute right-0 mt-1.5 w-72 rounded-lg border border-[#242B3D] bg-[#121620] shadow-xl z-40 py-1">
                  {searchResults.map((res, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        onQuickSearchNavigate(res.section, {
                          agentId: res.agentId,
                          runId: res.runId,
                        });
                        setSearchQuery('');
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-[#171C28] flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="text-xs font-medium text-slate-200 truncate">
                        {res.label}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0">{res.meta}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active Agent Selector */}
            <select
              aria-label="Active target agent"
              value={selectedAgentId ?? ''}
              onChange={(e) => onSelectAgent(e.target.value ? Number(e.target.value) : null)}
              className="max-w-[200px] px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-200 focus:outline-none focus:border-violet-500"
            >
              <option value="">All Agents ({agents.length})</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>

            {/* Real Evaluation Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifications((v) => !v)}
                aria-label="Recent evaluation events"
                className="p-2 rounded-lg border border-[#242B3D] bg-[#0B0D12] text-slate-300 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
              </button>
              {showNotifications && (
                <div className="absolute right-0 mt-1.5 w-80 rounded-lg border border-[#242B3D] bg-[#121620] shadow-xl z-40 p-3">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#242B3D]">
                    <span className="text-xs font-semibold text-slate-200">
                      Recent Audit Activity
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNotifications(false)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3">
                      No evaluation runs recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            onQuickSearchNavigate('reports', { runId: n.id });
                            setShowNotifications(false);
                          }}
                          className="w-full text-left p-2 rounded-md hover:bg-[#171C28] transition-colors cursor-pointer"
                        >
                          <div className="text-xs font-medium text-slate-200 truncate">
                            {n.title}
                          </div>
                          <div
                            className={`text-[11px] mt-0.5 tabular-nums ${
                              n.isFailure ? 'text-amber-400' : 'text-cyan-400'
                            }`}
                          >
                            {n.detail}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onNavigate('testing-lab')}
              className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Run Audit</span>
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-[1360px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
