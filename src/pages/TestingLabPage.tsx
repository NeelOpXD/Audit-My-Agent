import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Play } from 'lucide-react';
import { auditApi } from '../services/api';
import type {
  AgentRecord,
  EvaluationRunRecord,
  ExecutionLimits,
  TestResultRecord,
  TestSuiteRecord,
} from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

interface TestingLabPageProps {
  agents: AgentRecord[];
  suites: TestSuiteRecord[];
  selectedAgentId: number | null;
  onRefreshAll: () => Promise<void>;
  onInspectTrace: (executionId: string) => void;
}

export function TestingLabPage({
  agents,
  suites,
  selectedAgentId,
  onRefreshAll,
  onInspectTrace,
}: TestingLabPageProps) {
  const [agentId, setAgentId] = useState<number>(selectedAgentId || agents[0]?.id || 0);
  const [suiteId, setSuiteId] = useState<number>(suites[0]?.id || 0);
  const [trials, setTrials] = useState<number>(1);
  const [limits, setLimits] = useState<ExecutionLimits>({
    maxDurationMs: 5000,
    maxSteps: 12,
    maxToolCalls: 8,
    maxRepeatedCalls: 3,
    maxTokenBudget: 16000,
  });

  const [runs, setRuns] = useState<EvaluationRunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [results, setResults] = useState<TestResultRecord[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [liveProgress, setLiveProgress] = useState<{
    status: string;
    completedTests: number;
    totalTests: number;
    lastScenario?: string;
  } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAgentId) setAgentId(selectedAgentId);
    else if (!agentId && agents.length > 0) setAgentId(agents[0].id);
  }, [selectedAgentId, agents, agentId]);

  useEffect(() => {
    if (!suiteId && suites.length > 0) setSuiteId(suites[0].id);
  }, [suites, suiteId]);

  const loadRuns = async () => {
    const list = await auditApi.getEvaluations();
    setRuns(list);
    if (!activeRunId && list.length > 0) {
      setActiveRunId(list[0].id);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!activeRunId) return;
    void auditApi.getEvaluationResults(activeRunId).then(setResults);
  }, [activeRunId]);

  const handleStart = async () => {
    if (!agentId || !suiteId) {
      setError('Select both an enabled agent and a test suite.');
      return;
    }
    setError(null);
    setLaunching(true);
    try {
      const run = await auditApi.startEvaluation({
        agentId,
        suiteId,
        trials,
        runType: 'standard',
        limits,
      });
      setActiveRunId(run.id);
      setResults([]);
      setLiveProgress({ status: 'queued', completedTests: 0, totalTests: 0 });
      await loadRuns();

      const unsub = await auditApi.subscribeRunStream(run.id, (evt) => {
        setLiveProgress({
          status: String(evt.status || 'running'),
          completedTests: Number(evt.completedTests || 0),
          totalTests: Number(evt.totalTests || 0),
          lastScenario: typeof evt.lastScenario === 'string' ? evt.lastScenario : undefined,
        });
        void auditApi.getEvaluationResults(run.id).then(setResults);
        if (evt.status === 'completed' || evt.status === 'failed') {
          void loadRuns();
          void onRefreshAll();
          unsub();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch evaluation');
    } finally {
      setLaunching(false);
    }
  };

  const activeRun = runs.find((r) => r.id === activeRunId) || null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Evaluation Testing Lab
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Execute controlled evaluation suites across repeated trials, enforce workflow & loop
          budgets, and inspect Gemini-judged evidence.
        </p>
      </div>

      {/* Run Configuration Panel */}
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Target Agent</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
            >
              <option value={0}>Select agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Test Suite</label>
            <select
              value={suiteId}
              onChange={(e) => setSuiteId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
            >
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.scenarioCount} scenarios)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Repeated Trials (1–5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={trials}
              onChange={(e) => setTrials(Math.min(5, Math.max(1, Number(e.target.value))))}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              disabled={launching || agents.length === 0}
              onClick={() => void handleStart()}
              className="w-full py-2 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="w-4 h-4" />
              <span>{launching ? 'Starting Run...' : 'Start Evaluation'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-[#242B3D]">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Max Duration (ms)</label>
            <input
              type="number"
              value={limits.maxDurationMs}
              onChange={(e) => setLimits({ ...limits, maxDurationMs: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Max Steps</label>
            <input
              type="number"
              value={limits.maxSteps}
              onChange={(e) => setLimits({ ...limits, maxSteps: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Max Tool Calls</label>
            <input
              type="number"
              value={limits.maxToolCalls}
              onChange={(e) => setLimits({ ...limits, maxToolCalls: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Max Repeated Calls</label>
            <input
              type="number"
              value={limits.maxRepeatedCalls}
              onChange={(e) => setLimits({ ...limits, maxRepeatedCalls: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Token Budget</label>
            <input
              type="number"
              value={limits.maxTokenBudget}
              onChange={(e) => setLimits({ ...limits, maxTokenBudget: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-md bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
            />
          </div>
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        {liveProgress && liveProgress.status === 'running' && (
          <div className="pt-2 space-y-1.5">
            <div className="flex justify-between text-xs text-cyan-300 font-mono tabular-nums">
              <span>
                Executing {liveProgress.lastScenario ? `· ${liveProgress.lastScenario}` : '...'}
              </span>
              <span>
                {liveProgress.completedTests} / {liveProgress.totalTests || '?'}
              </span>
            </div>
            <div className="h-1.5 bg-[#0B0D12] rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-200"
                style={{
                  width:
                    liveProgress.totalTests > 0
                      ? `${Math.round((liveProgress.completedTests / liveProgress.totalTests) * 100)}%`
                      : '15%',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Run History Selector + Results Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 border border-[#242B3D] bg-[#121620] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Evaluation Runs</h2>
          {runs.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">No evaluation runs recorded yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[540px] overflow-y-auto">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveRunId(r.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                    r.id === activeRunId
                      ? 'border-violet-500/50 bg-violet-600/10'
                      : 'border-[#242B3D] bg-[#0B0D12] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-medium text-slate-200">
                      Run #{r.id}
                    </span>
                    <StatusIndicator status={r.status} />
                  </div>
                  <div className="text-xs text-slate-300 mt-1 truncate">
                    {r.agentName || `Agent ${r.agentId}`}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between font-mono tabular-nums">
                    <span>
                      {r.passedCount}P · {r.failedCount}F · {r.inconclusiveCount}I
                    </span>
                    <span>
                      {r.reliabilityScore !== null ? `${r.reliabilityScore}/100` : '—'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 border border-[#242B3D] bg-[#121620] rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#242B3D] mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {activeRun ? `Run #${activeRun.id} Test Results` : 'Test Results'}
              </h2>
              {activeRun && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {activeRun.agentName} · {activeRun.suiteName} · {activeRun.trialsPerScenario}{' '}
                  trial(s)/scenario
                </p>
              )}
            </div>
            {activeRun?.reliabilityScore !== null && activeRun?.reliabilityScore !== undefined && (
              <div className="text-right font-mono tabular-nums">
                <div className="text-[11px] text-slate-400">Reliability Score</div>
                <div className="text-lg font-semibold text-violet-300">
                  {activeRun.reliabilityScore} / 100
                </div>
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Select or run an evaluation to inspect test-level evidence and verdicts.
            </p>
          ) : (
            <div className="divide-y divide-[#242B3D]">
              {results.map((res) => {
                const isOpen = expandedId === res.id;
                return (
                  <div key={res.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : res.id)}
                        className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className="text-xs font-mono text-slate-400 shrink-0">
                          {res.scenarioCode} (T{res.trialIndex})
                        </span>
                        <span className="text-sm font-medium text-slate-100 truncate">
                          {res.scenarioName}
                        </span>
                      </button>

                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-xs font-mono text-slate-400 tabular-nums">
                          {res.latencyMs}ms
                        </span>
                        <StatusIndicator status={res.status} />
                        <button
                          type="button"
                          onClick={() => onInspectTrace(res.executionId)}
                          className="px-2.5 py-1 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-cyan-500/50 text-[11px] text-cyan-300 cursor-pointer flex items-center gap-1 whitespace-nowrap"
                        >
                          <GitBranch className="w-3 h-3" />
                          <span>Trace</span>
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3 ml-6 p-4 rounded-lg bg-[#0B0D12] border border-[#242B3D] space-y-3 text-xs">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-400">
                          <span>
                            Certainty:{' '}
                            <strong className="text-slate-200 font-medium">
                              {res.failureCertainty.replace(/_/g, ' ')}
                            </strong>
                          </span>
                          <span>
                            Failure Category:{' '}
                            <strong className="text-slate-200 font-mono">
                              {res.failureCategory || 'none'}
                            </strong>
                          </span>
                          <span>
                            Evaluator:{' '}
                            <strong className="text-slate-200 font-mono">
                              {res.evaluatorMeta?.evaluatorModel || 'deterministic'} (
                              {res.evaluatorMeta?.promptVersion || 'v1'})
                            </strong>
                          </span>
                          <span>
                            Confidence:{' '}
                            <strong className="text-slate-200 font-mono tabular-nums">
                              {res.evaluatorMeta?.confidence !== undefined
                                ? `${Math.round(res.evaluatorMeta.confidence * 100)}%`
                                : 'N/A'}
                            </strong>
                          </span>
                        </div>

                        <div>
                          <div className="text-slate-400 mb-1">Input Prompt</div>
                          <div className="p-2.5 rounded bg-[#121620] border border-[#242B3D] font-mono text-slate-200">
                            {res.input}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="text-slate-400 mb-1">Expected Behavior</div>
                            <div className="p-2.5 rounded bg-[#121620] border border-[#242B3D] text-slate-300">
                              {res.expectedBehavior}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 mb-1">Actual Agent Output</div>
                            <div className="p-2.5 rounded bg-[#121620] border border-[#242B3D] font-mono text-slate-200 max-h-32 overflow-y-auto">
                              {res.actualOutput || '(empty output)'}
                            </div>
                          </div>
                        </div>

                        {res.evaluatorMeta?.reasoningSummary && (
                          <div>
                            <div className="text-slate-400 mb-1">Evaluation Summary</div>
                            <div className="p-2.5 rounded bg-[#121620] border border-[#242B3D] text-slate-200">
                              {res.evaluatorMeta.reasoningSummary}
                            </div>
                          </div>
                        )}

                        {res.remediation && (
                          <div>
                            <div className="text-amber-400 mb-1">Recommended Remediation</div>
                            <div className="p-2.5 rounded bg-[#121620] border border-amber-500/30 text-slate-200">
                              {res.remediation}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
