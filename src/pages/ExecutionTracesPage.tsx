import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { auditApi } from '../services/api';
import type { TestResultRecord, TestScenarioRecord, TraceStepRecord } from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

interface ExecutionTracesPageProps {
  initialExecutionId: string | null;
}

export function ExecutionTracesPage({ initialExecutionId }: ExecutionTracesPageProps) {
  const [traceList, setTraceList] = useState<
    Array<{
      executionId: string;
      runId: number;
      status: string;
      failureCertainty: string;
      failureCategory: string | null;
      latencyMs: number;
      createdAt: string;
      scenarioName: string;
      scenarioCode: string;
      category: string;
      agentName: string;
    }>
  >([]);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(initialExecutionId);
  const [detail, setDetail] = useState<{
    executionId: string;
    agentName: string;
    modelInfo: Record<string, unknown>;
    scenario: TestScenarioRecord;
    result: TestResultRecord;
    steps: TraceStepRecord[];
  } | null>(null);
  const [selectedStep, setSelectedStep] = useState<TraceStepRecord | null>(null);

  useEffect(() => {
    if (initialExecutionId) setSelectedExecId(initialExecutionId);
  }, [initialExecutionId]);

  useEffect(() => {
    void auditApi.getTraces().then((rows) => {
      setTraceList(rows);
      if (!selectedExecId && rows.length > 0) {
        setSelectedExecId(rows[0].executionId);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedExecId) return;
    void auditApi.getTraceDetail(selectedExecId).then((d) => {
      setDetail(d);
      setSelectedStep(d.steps[0] || null);
    });
  }, [selectedExecId]);

  const { nodes, edges } = useMemo(() => {
    if (!detail) return { nodes: [] as Node[], edges: [] as Edge[] };

    const gNodes: Node[] = detail.steps.map((step, i) => {
      const borderColor = step.isAnomaly
        ? '#EF4444'
        : step.eventType === 'tool_call' || step.eventType === 'tool_response'
        ? '#06B6D4'
        : step.eventType === 'final_response'
        ? '#8B5CF6'
        : '#334155';

      const titleMap: Record<string, string> = {
        user_request: 'User Request',
        agent_step: 'Agent Step',
        tool_call: `Tool Call: ${String(step.eventData.tool || '')}`,
        tool_response: `Tool Response: ${String(step.eventData.tool || '')}`,
        loop_trigger: 'Loop / Limit Trigger',
        error: 'Execution Error',
        final_response: 'Final Response',
      };

      return {
        id: String(step.id),
        position: { x: i * 230, y: step.isAnomaly ? 20 : 80 },
        data: {
          label: (
            <div className="text-left px-1 py-0.5">
              <div className="text-[11px] font-semibold text-slate-100 truncate max-w-[175px]">
                {titleMap[step.eventType] || step.eventType}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                Step #{step.stepIndex} · {step.durationMs}ms
              </div>
              {step.anomalyReason && (
                <div className="text-[10px] text-rose-400 mt-0.5 truncate max-w-[175px]">
                  {step.anomalyReason}
                </div>
              )}
            </div>
          ),
        },
        style: {
          background: '#121620',
          color: '#E2E8F0',
          border: `1.5px solid ${borderColor}`,
          borderRadius: '8px',
          width: 200,
          padding: '8px',
        },
      };
    });

    const gEdges: Edge[] = detail.steps.slice(0, -1).map((step, i) => {
      const next = detail.steps[i + 1];
      return {
        id: `e-${step.id}-${next.id}`,
        source: String(step.id),
        target: String(next.id),
        animated: next.isAnomaly,
        style: { stroke: next.isAnomaly ? '#EF4444' : '#475569', strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: next.isAnomaly ? '#EF4444' : '#475569',
        },
      };
    });

    return { nodes: gNodes, edges: gEdges };
  }, [detail]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Execution Trace Analyzer
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Observable agent execution graphs and step-level telemetry. Fields not exposed by the
          target agent are explicitly marked unavailable—never fabricated.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trace List */}
        <div className="lg:col-span-4 border border-[#242B3D] bg-[#121620] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Recorded Executions</h2>
          {traceList.length === 0 ? (
            <p className="text-xs text-slate-400 py-6">
              No execution traces recorded yet. Run an evaluation in Testing Lab first.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[640px] overflow-y-auto">
              {traceList.map((t) => (
                <button
                  key={t.executionId}
                  type="button"
                  onClick={() => setSelectedExecId(t.executionId)}
                  className={`w-full text-left p-3 rounded-lg border cursor-pointer transition-colors ${
                    t.executionId === selectedExecId
                      ? 'border-violet-500/50 bg-violet-600/10'
                      : 'border-[#242B3D] bg-[#0B0D12] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-slate-400 truncate">
                      {t.scenarioCode} · Run #{t.runId}
                    </span>
                    <StatusIndicator status={t.status} />
                  </div>
                  <div className="text-xs font-medium text-slate-200 mt-1 truncate">
                    {t.scenarioName}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex justify-between font-mono tabular-nums">
                    <span className="truncate mr-2">{t.agentName}</span>
                    <span>{t.latencyMs}ms</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Graph + Event Inspector */}
        <div className="lg:col-span-8 space-y-6">
          {!detail ? (
            <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-10 text-center text-xs text-slate-400">
              Select an execution trace to render its step DAG and inspect observable events.
            </div>
          ) : (
            <>
              <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#242B3D] mb-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {detail.agentName} — {detail.scenario.name}
                    </div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5 tabular-nums">
                      Execution ID: {detail.executionId} · Latency: {detail.result.latencyMs}ms ·
                      Tokens:{' '}
                      {detail.result.tokenUsage !== null
                        ? detail.result.tokenUsage
                        : 'Not exposed by agent'}
                    </div>
                  </div>
                  <StatusIndicator status={detail.result.status} />
                </div>

                {/* React Flow Graph */}
                <div className="h-64 rounded-lg border border-[#242B3D] bg-[#0B0D12] overflow-hidden">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    fitView
                    onNodeClick={(_, node) => {
                      const found = detail.steps.find((s) => String(s.id) === node.id);
                      if (found) setSelectedStep(found);
                    }}
                  >
                    <Background color="#1E2433" gap={18} />
                    <Controls />
                  </ReactFlow>
                </div>
              </div>

              {/* Timeline + Inspector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-slate-200 mb-3">
                    Execution Timeline ({detail.steps.length} events)
                  </h3>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {detail.steps.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStep(s)}
                        className={`w-full text-left p-2.5 rounded-lg border text-xs cursor-pointer ${
                          selectedStep?.id === s.id
                            ? 'border-cyan-500/50 bg-cyan-500/10'
                            : s.isAnomaly
                            ? 'border-rose-500/40 bg-rose-950/20'
                            : 'border-[#242B3D] bg-[#0B0D12]'
                        }`}
                      >
                        <div className="flex justify-between font-mono tabular-nums">
                          <span className="text-slate-200">
                            #{s.stepIndex} {s.eventType}
                          </span>
                          <span className="text-slate-400">{s.durationMs}ms</span>
                        </div>
                        {s.anomalyReason && (
                          <div className="text-[11px] text-rose-400 mt-1">{s.anomalyReason}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-slate-200 mb-3">
                    Observable Event Inspector
                  </h3>
                  {selectedStep ? (
                    <div className="space-y-2 text-xs">
                      <div className="font-mono text-cyan-300">
                        {selectedStep.eventType} (step {selectedStep.stepIndex})
                      </div>
                      <pre className="p-3 rounded-lg bg-[#0B0D12] border border-[#242B3D] font-mono text-[11px] text-slate-200 overflow-x-auto max-h-60">
                        {JSON.stringify(selectedStep.eventData, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Select any step to inspect payload.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
