import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { auditApi } from '../services/api';
import type {
  CiGateVerdictPayload,
  EvaluationRunRecord,
  ReliabilityReportPayload,
  ReliabilityWeights,
} from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

interface ReliabilityReportsPageProps {
  initialRunId: number | null;
}

export function ReliabilityReportsPage({ initialRunId }: ReliabilityReportsPageProps) {
  const [runs, setRuns] = useState<EvaluationRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(initialRunId);
  const [weights, setWeights] = useState<ReliabilityWeights>({
    taskCompletion: 0.3,
    toolCorrectness: 0.2,
    groundedness: 0.2,
    security: 0.2,
    efficiency: 0.1,
  });
  const [report, setReport] = useState<ReliabilityReportPayload | null>(null);
  const [gateVerdict, setGateVerdict] = useState<CiGateVerdictPayload | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (initialRunId) setSelectedRunId(initialRunId);
  }, [initialRunId]);

  useEffect(() => {
    void auditApi.getEvaluations().then((list) => {
      setRuns(list);
      if (!selectedRunId && list.length > 0) {
        setSelectedRunId(list[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    void auditApi.getReport(selectedRunId, weights).then(setReport);
    void auditApi.getRunCiGate(selectedRunId).then(setGateVerdict).catch(() => setGateVerdict(null));
  }, [selectedRunId, weights]);

  const weightSumPct = Math.round(
    (weights.taskCompletion +
      weights.toolCorrectness +
      weights.groundedness +
      weights.security +
      weights.efficiency) *
      100
  );

  const handleExport = async (fmt: 'json' | 'markdown') => {
    if (!selectedRunId) return;
    setExporting(true);
    try {
      await auditApi.downloadReport(selectedRunId, fmt);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Reliability Reports & Audit Export
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Transparent weighted reliability methodology with explicit normalization, failure
            accounting, and reproducible export.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedRunId ?? ''}
            onChange={(e) => setSelectedRunId(Number(e.target.value))}
            className="px-3 py-2 rounded-lg bg-[#121620] border border-[#242B3D] text-xs text-slate-100"
          >
            {runs.length === 0 && <option value="">No evaluation runs</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                Run #{r.id} · {r.agentName} ({r.status})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={!selectedRunId || exporting}
            onClick={() => void handleExport('json')}
            className="px-3 py-2 rounded-lg border border-[#242B3D] bg-[#121620] hover:border-cyan-500/50 text-xs text-slate-200 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            disabled={!selectedRunId || exporting}
            onClick={() => void handleExport('markdown')}
            className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Markdown</span>
          </button>
        </div>
      </div>

      {!report ? (
        <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-10 text-center text-sm text-slate-400">
          Run an evaluation in Testing Lab or Red Team to generate a detailed reliability report.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Score & Configurable Weights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 border border-[#242B3D] bg-[#121620] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-400">Composite Reliability Score</div>
                  {gateVerdict && (
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        gateVerdict.passed
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                      }`}
                    >
                      PR Gate: {gateVerdict.decision}
                    </span>
                  )}
                </div>
                <div className="text-4xl font-semibold font-mono text-violet-300 mt-2 tabular-nums">
                  {report.reliability.overallScore !== null
                    ? `${report.reliability.overallScore} / 100`
                    : 'Unavailable'}
                </div>
                <div className="text-xs text-slate-400 mt-2 tabular-nums">
                  {report.reliability.totalCasesEvaluated} total cases ·{' '}
                  {report.reliability.includedFailures} failures included ·{' '}
                  {report.reliability.includedInconclusive} inconclusive included
                </div>

                {(report.consistency || report.latencyStats) && (
                  <div className="grid grid-cols-2 gap-2.5 mt-4 pt-4 border-t border-[#242B3D] text-xs font-mono tabular-nums">
                    <div className="p-2.5 rounded-lg bg-[#0B0D12] border border-[#242B3D]">
                      <div className="text-[10px] font-sans text-slate-400">
                        pass^{report.consistency?.trialsPerScenario ?? 1} Consistency
                      </div>
                      <div className="text-sm text-cyan-300 mt-0.5">
                        {report.consistency?.passCaretK !== null &&
                        report.consistency?.passCaretK !== undefined
                          ? `${report.consistency.passCaretK}%`
                          : 'Unavailable'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        pass@{report.consistency?.trialsPerScenario ?? 1}:{' '}
                        {report.consistency?.passAtK ?? '—'}%
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0B0D12] border border-[#242B3D]">
                      <div className="text-[10px] font-sans text-slate-400">
                        Latency (p50 / p95 / p99)
                      </div>
                      <div className="text-sm text-slate-100 mt-0.5">
                        {report.latencyStats?.p95 !== null &&
                        report.latencyStats?.p95 !== undefined
                          ? `${report.latencyStats.p95}ms p95`
                          : 'Unavailable'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        p50 {report.latencyStats?.p50 ?? '—'}ms · p99{' '}
                        {report.latencyStats?.p99 ?? '—'}ms
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-[#242B3D] space-y-2 text-xs text-slate-400 leading-relaxed">
                <p>{report.reliability.normalizationPolicy}</p>
                <p className="text-amber-300">{report.reliability.securityDisclaimer}</p>
              </div>
            </div>

            <div className="lg:col-span-8 border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">
                  Interactive Scoring Weights
                </h2>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  Configured sum: {weightSumPct}%
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {(
                  [
                    ['taskCompletion', 'Task Completion'],
                    ['toolCorrectness', 'Tool Correctness'],
                    ['groundedness', 'Groundedness'],
                    ['security', 'Security'],
                    ['efficiency', 'Efficiency'],
                  ] as Array<[keyof ReliabilityWeights, string]>
                ).map(([key, label]) => (
                  <div key={key} className="p-3 rounded-lg bg-[#0B0D12] border border-[#242B3D]">
                    <div className="text-[11px] text-slate-400 mb-1">{label}</div>
                    <div className="text-sm font-mono text-slate-100 mb-2 tabular-nums">
                      {Math.round(weights[key] * 100)}%
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={5}
                      value={Math.round(weights[key] * 100)}
                      onChange={(e) =>
                        setWeights((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value) / 100,
                        }))
                      }
                      className="w-full accent-violet-500 cursor-pointer"
                    />
                  </div>
                ))}
              </div>

              {/* Component Breakdown Table */}
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#242B3D] text-slate-400">
                      <th className="py-2">Component</th>
                      <th className="py-2">Availability</th>
                      <th className="py-2 text-right">Score</th>
                      <th className="py-2 text-right">Configured Wt</th>
                      <th className="py-2 text-right">Effective Wt</th>
                      <th className="py-2 text-right">Pass / Fail / Inc / N/S</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242B3D] font-mono tabular-nums">
                    {report.reliability.components.map((c) => (
                      <tr key={c.key}>
                        <td className="py-2.5 font-sans font-medium text-slate-200">
                          {c.label}
                        </td>
                        <td className="py-2.5">
                          <StatusIndicator status={c.status} />
                        </td>
                        <td className="py-2.5 text-right text-cyan-300">
                          {c.score !== null ? `${c.score}` : 'Unavailable'}
                        </td>
                        <td className="py-2.5 text-right text-slate-400">
                          {Math.round(c.configuredWeight * 100)}%
                        </td>
                        <td className="py-2.5 text-right text-slate-200">
                          {Math.round(c.effectiveWeight * 100)}%
                        </td>
                        <td className="py-2.5 text-right text-slate-300">
                          {c.passedCases} / {c.failedCases} / {c.inconclusiveCases} /{' '}
                          {c.notSupportedCases}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Detailed Case Ledger */}
          <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-100 mb-3">
              Test Case Accounting ({report.results.length} executions)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242B3D] text-slate-400">
                    <th className="py-2">Code</th>
                    <th className="py-2">Scenario</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Certainty</th>
                    <th className="py-2">Category</th>
                    <th className="py-2 text-right">Score</th>
                    <th className="py-2 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242B3D]">
                  {report.results.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 font-mono text-slate-400">{r.scenarioCode}</td>
                      <td className="py-2.5 text-slate-200">{r.scenarioName}</td>
                      <td className="py-2.5">
                        <StatusIndicator status={r.status} />
                      </td>
                      <td className="py-2.5 text-slate-300 capitalize">
                        {r.failureCertainty.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 font-mono text-slate-400">
                        {r.failureCategory || r.category}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">
                        {r.score}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-400">
                        {r.latencyMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
