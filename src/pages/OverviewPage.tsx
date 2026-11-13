import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bot, FlaskConical, Plus } from 'lucide-react';
import { auditApi } from '../services/api';
import type { OverviewData } from '../types/audit';
import type { NavSection } from '../components/AppShell';

interface OverviewPageProps {
  onNavigate: (section: NavSection) => void;
  onDeploySamples: () => Promise<void>;
  refreshSignal: number;
}

const CHART_COLORS = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'];

export function OverviewPage({
  onNavigate,
  onDeploySamples,
  refreshSignal,
}: OverviewPageProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    auditApi
      .getOverview()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load overview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-[#121620] border border-[#242B3D] rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-[#121620] border border-[#242B3D] rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-rose-500/30 bg-[#121620] rounded-xl p-6 text-sm text-rose-400">
        {error}
      </div>
    );
  }

  if (!data || data.kpis.registeredAgents === 0) {
    return (
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-10 text-center max-w-2xl mx-auto mt-8">
        <div className="w-12 h-12 rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-400 flex items-center justify-center mx-auto mb-4">
          <Bot className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-slate-100 mb-2">
          No Agents Registered Yet
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          Analytics in Audit-My-Agent reflect exclusively stored PostgreSQL evaluation runs.
          Register your own HTTP agent endpoint or deploy the 6 controlled sample diagnostic agents
          to evaluate reliability, tool governance, hallucinations, and prompt injection defense.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('agents')}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Register Custom Agent</span>
          </button>
          <button
            type="button"
            disabled={deploying}
            onClick={async () => {
              setDeploying(true);
              try {
                await onDeploySamples();
              } finally {
                setDeploying(false);
              }
            }}
            className="px-4 py-2 rounded-lg border border-[#242B3D] bg-[#171C28] hover:border-cyan-500/50 text-slate-200 text-sm font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
          >
            <FlaskConical className="w-4 h-4 text-cyan-400" />
            <span>{deploying ? 'Deploying Sample Agents...' : 'Deploy Controlled Sample Agents'}</span>
          </button>
        </div>
      </div>
    );
  }

  const { kpis, charts } = data;
  const hasRuns = kpis.totalRuns > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Platform Reliability Overview
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Live metrics computed strictly from stored PostgreSQL evaluation runs and execution traces.
          </p>
        </div>
        {!hasRuns && (
          <button
            type="button"
            onClick={() => onNavigate('testing-lab')}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            Launch First Evaluation
          </button>
        )}
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Registered Agents" value={String(kpis.registeredAgents)} />
        <KpiCard
          label="Total Evaluation Runs"
          value={String(kpis.totalRuns)}
          sub={`${kpis.totalTests} test executions`}
        />
        <KpiCard
          label="Task Success / pass^k"
          value={kpis.avgSuccessRate !== null ? `${kpis.avgSuccessRate}%` : 'No runs'}
          sub={
            kpis.passCaretK !== null
              ? `pass^k ${kpis.passCaretK}% · ${kpis.passedTests}/${kpis.totalTests} passed`
              : `${kpis.passedTests} passed · ${kpis.failedTests} failed`
          }
          accent="cyan"
        />
        <KpiCard
          label="Injection Resistance"
          value={
            kpis.promptInjectionResistance !== null
              ? `${kpis.promptInjectionResistance}%`
              : 'Untested'
          }
          sub={`${kpis.toolMisuseIncidents} tool misuse incidents`}
          accent="violet"
        />
        <KpiCard
          label="Latency (Avg / p95)"
          value={
            kpis.avgLatencyMs !== null
              ? `${kpis.avgLatencyMs}ms / ${kpis.p95LatencyMs ?? kpis.avgLatencyMs}ms`
              : 'Unavailable'
          }
          sub={
            kpis.avgTokens !== null
              ? `${kpis.avgTokens} avg tokens · p50 ${kpis.p50LatencyMs ?? '—'}ms`
              : 'Token telemetry not exposed'
          }
        />
      </div>

      {!hasRuns ? (
        <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-8 text-center">
          <p className="text-sm text-slate-300 mb-4">
            You have {kpis.registeredAgents} registered agent(s), but zero evaluation runs executed yet.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('testing-lab')}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Open Testing Lab
          </button>
        </div>
      ) : (
        <>
          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-100">
                  Evaluation Success & Reliability Over Time
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Chronological pass rate (%) and weighted reliability score across completed runs
                </p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts.successOverTime}>
                    <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0D12',
                        border: '1px solid #242B3D',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="successRate"
                      name="Pass Rate %"
                      stroke="#06B6D4"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="reliabilityScore"
                      name="Reliability Score"
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-100">
                  Failure Distribution by Category
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Observed failures and uncertain outcomes grouped by root failure taxonomy
                </p>
              </div>
              {charts.failureDistribution.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-400">
                  Zero failures recorded across executed tests.
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts.failureDistribution} layout="vertical">
                      <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                      <XAxis type="number" stroke="#64748B" fontSize={11} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="category"
                        stroke="#94A3B8"
                        fontSize={11}
                        width={150}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B0D12',
                          border: '1px solid #242B3D',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="count" name="Incidents" radius={[0, 4, 4, 0]}>
                        {charts.failureDistribution.map((_, idx) => (
                          <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Agent Reliability Comparison
              </h2>
              <p className="text-xs text-slate-400 mb-4">Latest completed reliability score</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.agentComparison.filter((a) => a.reliabilityScore !== null)}>
                    <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#64748B" fontSize={10} />
                    <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0D12',
                        border: '1px solid #242B3D',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="reliabilityScore" name="Reliability" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Security Evaluation Results
              </h2>
              <p className="text-xs text-slate-400 mb-4">Red Team test verdicts</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.securityBreakdown}>
                    <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                    <XAxis dataKey="status" stroke="#64748B" fontSize={11} />
                    <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0D12',
                        border: '1px solid #242B3D',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" name="Scenarios" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                Execution Latency Distribution
              </h2>
              <p className="text-xs text-slate-400 mb-4">Response duration buckets</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.latencyBuckets}>
                    <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" stroke="#64748B" fontSize={10} />
                    <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0D12',
                        border: '1px solid #242B3D',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" name="Executions" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'violet' | 'cyan';
}) {
  const valueColor =
    accent === 'violet'
      ? 'text-violet-300'
      : accent === 'cyan'
      ? 'text-cyan-300'
      : 'text-slate-100';
  return (
    <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold mt-1 font-mono tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1 tabular-nums">{sub}</div>}
    </div>
  );
}
