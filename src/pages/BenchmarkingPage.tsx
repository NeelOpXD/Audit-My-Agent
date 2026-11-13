import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { auditApi } from '../services/api';
import type { AgentRecord, TestSuiteRecord } from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

interface BenchmarkingPageProps {
  agents: AgentRecord[];
  suites: TestSuiteRecord[];
}

export function BenchmarkingPage({ agents, suites }: BenchmarkingPageProps) {
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[]>([]);
  const [suiteId, setSuiteId] = useState<number>(suites[0]?.id || 0);
  const [trials, setTrials] = useState<number>(2);
  const [benchName, setBenchName] = useState('Cross-Agent Reliability Benchmark');
  const [benchmarks, setBenchmarks] = useState<
    Awaited<ReturnType<typeof auditApi.getBenchmarks>>
  >([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!suiteId && suites.length > 0) setSuiteId(suites[0].id);
  }, [suites, suiteId]);

  useEffect(() => {
    if (selectedAgentIds.length === 0 && agents.length >= 2) {
      setSelectedAgentIds(agents.slice(0, 3).map((a) => a.id));
    }
  }, [agents, selectedAgentIds.length]);

  const loadBenchmarks = async () => {
    const data = await auditApi.getBenchmarks();
    setBenchmarks(data);
  };

  useEffect(() => {
    void loadBenchmarks();
  }, []);

  // Poll while any benchmark is running
  useEffect(() => {
    const hasRunning = benchmarks.some((b) => b.status === 'running');
    if (!hasRunning) return;
    const id = setInterval(() => void loadBenchmarks(), 2500);
    return () => clearInterval(id);
  }, [benchmarks]);

  const toggleAgent = (id: number) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleLaunch = async () => {
    if (selectedAgentIds.length < 2) {
      setError('Select at least 2 agents to compare.');
      return;
    }
    setError(null);
    setLaunching(true);
    try {
      await auditApi.startBenchmark({
        name: benchName,
        suiteId,
        trials,
        agentIds: selectedAgentIds,
      });
      await loadBenchmarks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start benchmark');
    } finally {
      setLaunching(false);
    }
  };

  const latest = benchmarks[0] || null;
  const chartData =
    latest?.agents.map((a) => ({
      name: a.agentName.slice(0, 18),
      reliabilityScore: a.reliabilityScore ?? 0,
      taskSuccessRate: a.taskSuccessRate ?? 0,
      toolCorrectness: a.componentScores.toolCorrectness ?? 0,
      groundedness: a.componentScores.groundedness ?? 0,
      security: a.componentScores.security ?? 0,
    })) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Model & Agent Benchmarking
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Compare multiple agents or model configurations across identical test scenarios and
          repeated trials with variability reporting.
        </p>
      </div>

      {/* Benchmark Launcher */}
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Benchmark Name</label>
            <input
              value={benchName}
              onChange={(e) => setBenchName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Shared Suite</label>
            <select
              value={suiteId}
              onChange={(e) => setSuiteId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
            >
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Trials per Scenario</label>
            <input
              type="number"
              min={1}
              max={5}
              value={trials}
              onChange={(e) => setTrials(Math.min(5, Math.max(1, Number(e.target.value))))}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-400 mb-2">Select Agents to Compare (min 2)</div>
          <div className="flex flex-wrap gap-2">
            {agents.map((ag) => {
              const active = selectedAgentIds.includes(ag.id);
              return (
                <button
                  key={ag.id}
                  type="button"
                  onClick={() => toggleAgent(ag.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                    active
                      ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                      : 'border-[#242B3D] bg-[#0B0D12] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {ag.name}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={launching || selectedAgentIds.length < 2}
            onClick={() => void handleLaunch()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{launching ? 'Launching Benchmark...' : 'Run Comparison Benchmark'}</span>
          </button>
        </div>
      </div>

      {benchmarks.length === 0 ? (
        <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-8 text-center text-xs text-slate-400">
          No comparison benchmarks executed yet. Select 2 or more agents above and run a comparison.
        </div>
      ) : (
        <div className="space-y-6">
          {chartData.length > 0 && (
            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-100 mb-1">
                {latest.name} — Multi-Dimensional Comparison
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                Side-by-side Reliability, Task Success Rate, Groundedness, and Security scores
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid stroke="#1E2433" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} />
                    <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0D12',
                        border: '1px solid #242B3D',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="reliabilityScore" name="Reliability" fill="#8B5CF6" />
                    <Bar dataKey="taskSuccessRate" name="Task Success %" fill="#06B6D4" />
                    <Bar dataKey="groundedness" name="Groundedness" fill="#10B981" />
                    <Bar dataKey="security" name="Security" fill="#F59E0B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {benchmarks.map((cmp) => (
            <div key={cmp.id} className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">{cmp.name}</h3>
                  <p className="text-xs text-slate-400">
                    {cmp.trials} repeated trial(s) per scenario
                  </p>
                </div>
                <StatusIndicator status={cmp.status} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#242B3D] text-slate-400">
                      <th className="py-2">Agent</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Reliability</th>
                      <th className="py-2 text-right">Success Rate</th>
                      <th className="py-2 text-right">pass^k</th>
                      <th className="py-2 text-right">Variability (σ)</th>
                      <th className="py-2 text-right">Avg / p95 Latency</th>
                      <th className="py-2 text-right">Avg Tokens</th>
                      <th className="py-2 text-right">Est. Cost / Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242B3D] font-mono tabular-nums">
                    {cmp.agents.map((ag) => (
                      <tr key={ag.agentId}>
                        <td className="py-2.5 font-sans font-medium text-slate-100">
                          {ag.agentName}
                        </td>
                        <td className="py-2.5">
                          <StatusIndicator status={ag.status} />
                        </td>
                        <td className="py-2.5 text-right text-violet-300">
                          {ag.reliabilityScore !== null ? `${ag.reliabilityScore}` : '—'}
                        </td>
                        <td className="py-2.5 text-right text-cyan-300">
                          {ag.taskSuccessRate !== null ? `${ag.taskSuccessRate}%` : '—'}
                        </td>
                        <td className="py-2.5 text-right text-emerald-300">
                          {ag.passCaretK !== null && ag.passCaretK !== undefined
                            ? `${ag.passCaretK}%`
                            : '—'}
                        </td>
                        <td className="py-2.5 text-right text-slate-300">±{ag.scoreStdDev}</td>
                        <td className="py-2.5 text-right text-slate-300">
                          {ag.avgLatencyMs !== null
                            ? `${Math.round(ag.avgLatencyMs)}ms / ${ag.p95LatencyMs ?? Math.round(ag.avgLatencyMs)}ms`
                            : '—'}
                        </td>
                        <td className="py-2.5 text-right text-slate-300">
                          {ag.avgTokens !== null ? ag.avgTokens : 'Unavailable'}
                        </td>
                        <td className="py-2.5 text-right text-slate-300">
                          {ag.estCostPerSuccessUsd !== null
                            ? `$${ag.estCostPerSuccessUsd.toFixed(4)}`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
