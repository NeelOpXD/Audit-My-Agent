import { auth } from '../lib/firebase';
import type {
  AgentRecord,
  CiGateVerdictPayload,
  CiTokenRecord,
  EvaluationRunRecord,
  ExecutionLimits,
  OverviewData,
  ReliabilityReportPayload,
  ReliabilityWeights,
  TestResultRecord,
  TestScenarioRecord,
  TestSuiteRecord,
  TraceStepRecord,
} from '../types/audit';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function authFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Authentication required', 401);
  }
  const token = await user.getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) msg = errBody.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiError(msg, res.status);
  }

  return res.json() as Promise<T>;
}

export const auditApi = {
  getOverview: () => authFetch<OverviewData>('/api/overview'),

  getAgents: () => authFetch<AgentRecord[]>('/api/agents'),
  deploySampleAgents: () =>
    authFetch<{ deployedCount: number; agents: AgentRecord[] }>('/api/agents/deploy-samples', {
      method: 'POST',
    }),
  createAgent: (payload: Record<string, unknown>) =>
    authFetch<AgentRecord>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAgent: (id: number, payload: Record<string, unknown>) =>
    authFetch<AgentRecord>(`/api/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteAgent: (id: number) =>
    authFetch<{ deleted: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  testConnection: (id: number) =>
    authFetch<{
      connected: boolean;
      httpStatus: number;
      latencyMs: number;
      answerPreview: string;
      toolCallsTelemetryAvailable: boolean;
      tokensTelemetryAvailable: boolean;
      error: string | null;
    }>(`/api/agents/${id}/test-connection`, { method: 'POST' }),
  getAgentDetail: (id: number) =>
    authFetch<{ agent: AgentRecord; runs: EvaluationRunRecord[] }>(`/api/agents/${id}`),

  getSuites: () => authFetch<TestSuiteRecord[]>('/api/suites'),
  createSuite: (payload: { name: string; description: string; category: string }) =>
    authFetch<TestSuiteRecord>('/api/suites', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScenarios: (category?: string) =>
    authFetch<TestScenarioRecord[]>(
      category && category !== 'all'
        ? `/api/scenarios?category=${encodeURIComponent(category)}`
        : '/api/scenarios'
    ),
  createScenario: (payload: Record<string, unknown>) =>
    authFetch<TestScenarioRecord>('/api/scenarios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateScenario: (id: number, payload: Record<string, unknown>) =>
    authFetch<TestScenarioRecord>(`/api/scenarios/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  cloneScenario: (id: number) =>
    authFetch<TestScenarioRecord>(`/api/scenarios/${id}/clone`, { method: 'POST' }),

  startEvaluation: (payload: {
    agentId: number;
    suiteId: number;
    trials: number;
    runType?: string;
    scenarioIds?: number[];
    limits?: ExecutionLimits;
    weights?: ReliabilityWeights;
  }) =>
    authFetch<EvaluationRunRecord>('/api/evaluations/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEvaluations: () => authFetch<EvaluationRunRecord[]>('/api/evaluations'),
  getEvaluationRun: (id: number) => authFetch<EvaluationRunRecord>(`/api/evaluations/${id}`),
  getEvaluationResults: (id: number) =>
    authFetch<TestResultRecord[]>(`/api/evaluations/${id}/results`),

  subscribeRunStream: async (
    runId: number,
    onEvent: (data: Record<string, unknown>) => void
  ): Promise<() => void> => {
    const user = auth.currentUser;
    if (!user) return () => {};
    const token = await user.getIdToken();
    const es = new EventSource(`/api/evaluations/${runId}/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (evt) => {
      try {
        onEvent(JSON.parse(evt.data));
      } catch {
        // ignore malformed event
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  },

  getTraces: () =>
    authFetch<
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
    >('/api/traces'),

  getTraceDetail: (executionId: string) =>
    authFetch<{
      executionId: string;
      agentName: string;
      modelInfo: Record<string, unknown>;
      scenario: TestScenarioRecord;
      result: TestResultRecord;
      steps: TraceStepRecord[];
    }>(`/api/traces/${encodeURIComponent(executionId)}`),

  getReport: (runId: number, weights?: ReliabilityWeights) => {
    const qs = weights
      ? `?wTask=${weights.taskCompletion}&wTool=${weights.toolCorrectness}&wGround=${weights.groundedness}&wSec=${weights.security}&wEff=${weights.efficiency}`
      : '';
    return authFetch<ReliabilityReportPayload>(`/api/reports/${runId}${qs}`);
  },

  downloadReport: async (runId: number, format: 'json' | 'markdown') => {
    const user = auth.currentUser;
    if (!user) throw new Error('Authentication required');
    const token = await user.getIdToken();
    const res = await fetch(`/api/reports/${runId}/export?format=${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-report-run-${runId}.${format === 'markdown' ? 'md' : 'json'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  startBenchmark: (payload: {
    name: string;
    suiteId: number;
    trials: number;
    agentIds: number[];
  }) =>
    authFetch<{ id: number }>('/api/benchmarks/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBenchmarks: () =>
    authFetch<
      Array<{
        id: number;
        name: string;
        suiteId: number;
        trials: number;
        status: string;
        createdAt: string;
        agents: Array<{
          agentId: number;
          agentName: string;
          modelInfo: Record<string, unknown>;
          runId: number;
          status: string;
          taskSuccessRate: number | null;
          passCaretK: number | null;
          reliabilityScore: number | null;
          avgLatencyMs: number | null;
          p95LatencyMs: number | null;
          avgTokens: number | null;
          scoreStdDev: number;
          estCostPerSuccessUsd: number | null;
          componentScores: Record<string, number>;
        }>;
      }>
    >('/api/benchmarks'),

  getSettings: () =>
    authFetch<{ defaultLimits: ExecutionLimits; defaultWeights: ReliabilityWeights }>(
      '/api/settings'
    ),
  saveSettings: (payload: { defaultLimits: ExecutionLimits; defaultWeights: ReliabilityWeights }) =>
    authFetch<{ defaultLimits: ExecutionLimits; defaultWeights: ReliabilityWeights }>(
      '/api/settings',
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  getCiTokens: () => authFetch<CiTokenRecord[]>('/api/ci-tokens'),
  createCiToken: (name: string) =>
    authFetch<CiTokenRecord>('/api/ci-tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeCiToken: (id: number) =>
    authFetch<{ revoked: boolean; id: number }>(`/api/ci-tokens/${id}`, {
      method: 'DELETE',
    }),
  getRunCiGate: (runId: number, params?: { minReliabilityScore?: number; minPassCaretK?: number; maxP95LatencyMs?: number | null }) => {
    const qs = new URLSearchParams();
    if (params?.minReliabilityScore !== undefined) {
      qs.set('minReliabilityScore', String(params.minReliabilityScore));
    }
    if (params?.minPassCaretK !== undefined) {
      qs.set('minPassCaretK', String(params.minPassCaretK));
    }
    if (params?.maxP95LatencyMs !== undefined) {
      qs.set('maxP95LatencyMs', params.maxP95LatencyMs === null ? 'null' : String(params.maxP95LatencyMs));
    }
    const q = qs.toString();
    return authFetch<CiGateVerdictPayload>(`/api/ci/gate/${runId}${q ? `?${q}` : ''}`);
  },
};
