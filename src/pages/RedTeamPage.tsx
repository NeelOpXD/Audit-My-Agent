import { useEffect, useState } from 'react';
import { GitBranch, ShieldAlert } from 'lucide-react';
import { auditApi } from '../services/api';
import type {
  AgentRecord,
  EvaluationRunRecord,
  TestResultRecord,
  TestSuiteRecord,
} from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

const ATTACK_TAXONOMY = [
  'Direct prompt injection',
  'Indirect prompt injection via untrusted documents',
  'System instruction override attempts',
  'Unauthorized tool invocation',
  'Sensitive information disclosure',
  'Unsafe tool argument generation',
  'Malicious instruction following',
  'Insecure handling of untrusted input',
];

interface RedTeamPageProps {
  agents: AgentRecord[];
  suites: TestSuiteRecord[];
  selectedAgentId: number | null;
  onRefreshAll: () => Promise<void>;
  onInspectTrace: (executionId: string) => void;
}

export function RedTeamPage({
  agents,
  suites,
  selectedAgentId,
  onRefreshAll,
  onInspectTrace,
}: RedTeamPageProps) {
  const redTeamSuite =
    suites.find((s) => s.category === 'red_team') || suites[0] || null;
  const [agentId, setAgentId] = useState<number>(selectedAgentId || agents[0]?.id || 0);
  const [runs, setRuns] = useState<EvaluationRunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [results, setResults] = useState<TestResultRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAgentId) setAgentId(selectedAgentId);
    else if (!agentId && agents.length > 0) setAgentId(agents[0].id);
  }, [selectedAgentId, agents, agentId]);

  const loadRuns = async () => {
    const all = await auditApi.getEvaluations();
    const rtRuns = all.filter(
      (r) => r.runType === 'red_team' || r.suiteId === redTeamSuite?.id
    );
    setRuns(rtRuns);
    if (!activeRunId && rtRuns.length > 0) setActiveRunId(rtRuns[0].id);
  };

  useEffect(() => {
    void loadRuns();
  }, [redTeamSuite?.id]);

  useEffect(() => {
    if (!activeRunId) return;
    void auditApi.getEvaluationResults(activeRunId).then(setResults);
  }, [activeRunId]);

  const handleLaunchRedTeam = async () => {
    if (!agentId || !redTeamSuite) {
      setError('Select a registered agent first.');
      return;
    }
    setError(null);
    setRunning(true);
    try {
      const run = await auditApi.startEvaluation({
        agentId,
        suiteId: redTeamSuite.id,
        trials: 1,
        runType: 'red_team',
      });
      setActiveRunId(run.id);
      setResults([]);
      const unsub = await auditApi.subscribeRunStream(run.id, (evt) => {
        void auditApi.getEvaluationResults(run.id).then(setResults);
        if (evt.status === 'completed' || evt.status === 'failed') {
          void loadRuns();
          void onRefreshAll();
          setRunning(false);
          unsub();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Red team launch failed');
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Red Team Adversarial Engine
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Controlled synthetic attack scenarios evaluating security boundary integrity—never
            equating a refusal string alone with safety.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={agentId}
            onChange={(e) => setAgentId(Number(e.target.value))}
            className="px-3 py-2 rounded-lg bg-[#121620] border border-[#242B3D] text-xs text-slate-100"
          >
            <option value={0}>Select agent...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={running || !agentId || !redTeamSuite}
            onClick={() => void handleLaunchRedTeam()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{running ? 'Running Red Team...' : 'Run Security Suite'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-rose-500/30 bg-[#121620] rounded-lg p-3 text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* Controlled Attack Coverage Matrix */}
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">
          Covered Adversarial Attack Vectors (Harmless Synthetic Payloads)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-slate-300">
          {ATTACK_TAXONOMY.map((vec, i) => (
            <div key={vec} className="p-3 rounded-lg bg-[#0B0D12] border border-[#242B3D]">
              <span className="font-mono text-slate-500 mr-1.5">0{i + 1}.</span>
              <span>{vec}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Results Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 border border-[#242B3D] bg-[#121620] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Security Audit Runs</h2>
          {runs.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">No red team runs executed yet.</p>
          ) : (
            <div className="space-y-1.5">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveRunId(r.id)}
                  className={`w-full text-left p-3 rounded-lg border cursor-pointer ${
                    r.id === activeRunId
                      ? 'border-violet-500/50 bg-violet-600/10'
                      : 'border-[#242B3D] bg-[#0B0D12]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-200">Run #{r.id}</span>
                    <StatusIndicator status={r.status} />
                  </div>
                  <div className="text-xs text-slate-300 mt-1 truncate">{r.agentName}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                    Passed: {r.passedCount} · Failed: {r.failedCount} · Inc: {r.inconclusiveCount} ·
                    N/S: {r.notSupportedCount}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 border border-[#242B3D] bg-[#121620] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">
            Boundary Integrity Findings
          </h2>
          {results.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Launch a security suite run to inspect injection resistance, unauthorized tool
              attempts, and remediation guidance.
            </p>
          ) : (
            <div className="space-y-3">
              {results.map((res) => (
                <div
                  key={res.id}
                  className="p-4 rounded-lg bg-[#0B0D12] border border-[#242B3D] space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-mono text-slate-500 mr-2">
                        {res.scenarioCode}
                      </span>
                      <span className="text-sm font-medium text-slate-100">
                        {res.scenarioName}
                      </span>
                      <span className="text-xs text-slate-400 ml-2">
                        · Severity: <span className="capitalize text-slate-200">{res.severity}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusIndicator status={res.status} />
                      <button
                        type="button"
                        onClick={() => onInspectTrace(res.executionId)}
                        className="px-2 py-1 rounded border border-[#242B3D] text-[11px] text-cyan-300 hover:border-cyan-500/50 cursor-pointer flex items-center gap-1"
                      >
                        <GitBranch className="w-3 h-3" />
                        <span>Trace</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {res.evaluatorMeta?.reasoningSummary || res.actualOutput}
                  </p>

                  {res.remediation && (
                    <div className="text-xs text-amber-300 pt-1 border-t border-[#242B3D]">
                      Remediation: {res.remediation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
