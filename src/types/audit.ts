export interface AgentModelInfo {
  provider?: string;
  model?: string;
  systemPromptVersion?: string;
  costPer1kTokensUsd?: number;
}

export interface AgentRecord {
  id: number;
  name: string;
  description: string;
  endpoint: string;
  httpMethod: string;
  authType: 'none' | 'bearer' | 'api_key' | 'custom_header';
  hasCredential: boolean;
  credentialHint: string | null;
  requestTemplate: Record<string, unknown>;
  responseMapping: Record<string, string>;
  timeoutMs: number;
  allowedTools: string[];
  modelInfo: AgentModelInfo;
  customHeaders: Record<string, string>;
  isControlledSample: boolean;
  sampleProfile: string | null;
  status: 'enabled' | 'disabled';
  lastTestedAt: string | null;
  lastConnectionStatus: 'connected' | 'failed' | 'untested';
  createdAt: string;
  updatedAt: string;
}

export interface TestScenarioRecord {
  id: number;
  suiteId: number;
  scenarioCode: string;
  name: string;
  category:
    | 'task_completion'
    | 'tool_usage'
    | 'reliability'
    | 'hallucination'
    | 'red_team'
    | 'loop_detection';
  description: string;
  input: string;
  context: Record<string, unknown>;
  expectedBehavior: string;
  referenceAnswer: string | null;
  expectedTools: string[];
  forbiddenTools: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  evaluationMethod: string;
  version: number;
  isActive: boolean;
}

export interface TestSuiteRecord {
  id: number;
  name: string;
  description: string;
  category: string;
  isSystem: boolean;
  scenarioCount: number;
  scenarios: TestScenarioRecord[];
}

export interface ExecutionLimits {
  maxDurationMs: number;
  maxSteps: number;
  maxToolCalls: number;
  maxRepeatedCalls: number;
  maxTokenBudget: number;
}

export interface ReliabilityWeights {
  taskCompletion: number;
  toolCorrectness: number;
  groundedness: number;
  security: number;
  efficiency: number;
}

export interface EvaluationRunRecord {
  id: number;
  agentId: number;
  agentName?: string;
  suiteId: number;
  suiteName?: string;
  isControlledSample?: boolean;
  runType: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted_limit';
  trialsPerScenario: number;
  limitsConfig: ExecutionLimits;
  weightsConfig: ReliabilityWeights;
  totalTests: number;
  completedTests: number;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  notSupportedCount: number;
  reliabilityScore: number | null;
  avgLatencyMs: number | null;
  avgTokens: number | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface TestResultRecord {
  id: number;
  runId: number;
  scenarioId: number;
  scenarioVersion: number;
  trialIndex: number;
  executionId: string;
  status: 'passed' | 'failed' | 'inconclusive' | 'not_supported';
  failureCertainty:
    | 'none'
    | 'observed_failure'
    | 'suspected_failure'
    | 'evaluator_uncertainty';
  failureCategory: string | null;
  score: number;
  latencyMs: number;
  tokenUsage: number | null;
  actualOutput: string;
  toolCallsObserved: Array<{
    name: string;
    arguments: Record<string, unknown>;
    response?: unknown;
    durationMs?: number;
    error?: string;
  }>;
  evidence: Record<string, unknown>;
  evaluatorMeta: {
    evaluatorModel?: string;
    promptVersion?: string;
    criteria?: string;
    supportingEvidence?: string[];
    confidence?: number;
    reasoningSummary?: string;
  };
  remediation: string | null;
  scenarioCode: string;
  scenarioName: string;
  category: string;
  description?: string;
  input?: string;
  expectedBehavior?: string;
  severity: string;
  evaluationMethod?: string;
}

export interface TraceStepRecord {
  id: number;
  runId: number;
  executionId: string;
  stepIndex: number;
  eventType:
    | 'user_request'
    | 'agent_step'
    | 'tool_call'
    | 'tool_response'
    | 'error'
    | 'loop_trigger'
    | 'final_response';
  eventData: Record<string, unknown>;
  durationMs: number;
  isAnomaly: boolean;
  anomalyReason: string | null;
  timestamp: string;
}

export interface LatencyPercentileStats {
  sampleCount: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
}

export interface ConsistencyMetrics {
  trialsPerScenario: number;
  evaluatedScenarioCount: number;
  consistentScenarioCount: number;
  anyPassScenarioCount: number;
  passAtK: number | null;
  passCaretK: number | null;
}

export interface OverviewData {
  kpis: {
    registeredAgents: number;
    totalRuns: number;
    passedTests: number;
    failedTests: number;
    inconclusiveTests: number;
    totalTests: number;
    avgSuccessRate: number | null;
    toolMisuseIncidents: number;
    promptInjectionResistance: number | null;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    passCaretK: number | null;
    avgTokens: number | null;
  };
  charts: {
    successOverTime: Array<{
      runId: number;
      label: string;
      successRate: number;
      reliabilityScore: number;
      avgLatencyMs: number;
    }>;
    failureDistribution: Array<{ category: string; count: number }>;
    agentComparison: Array<{
      agentId: number;
      name: string;
      isControlledSample: boolean;
      runsCount: number;
      successRate: number | null;
      reliabilityScore: number | null;
      avgLatencyMs: number | null;
    }>;
    securityBreakdown: Array<{ status: string; count: number }>;
    latencyBuckets: Array<{ bucket: string; count: number }>;
  };
}

export interface ComponentScoreDetail {
  key: keyof ReliabilityWeights;
  label: string;
  configuredWeight: number;
  effectiveWeight: number;
  score: number | null;
  status: 'available' | 'unavailable';
  totalCases: number;
  passedCases: number;
  failedCases: number;
  inconclusiveCases: number;
  notSupportedCases: number;
}

export interface CiTokenRecord {
  id: number;
  name: string;
  tokenPrefix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  token?: string;
}

export interface CiGateVerdictPayload {
  runId: number;
  status: string;
  agentId: number;
  agentName: string;
  suiteId: number;
  suiteName: string;
  reliabilityScore: number | null;
  latencyStats: LatencyPercentileStats;
  consistency: ConsistencyMetrics;
  passed: boolean;
  decision: 'PASS' | 'FAIL';
  exitCode: 0 | 1;
  checks: Array<{
    name: string;
    rule: string;
    actual: string;
    threshold: string;
    passed: boolean;
  }>;
  blockingFailures: Array<{
    scenarioCode: string;
    scenarioName: string;
    category: string;
    severity: string;
    failureCategory: string | null;
    failureCertainty: string;
  }>;
  markdownSummary: string;
}

export interface ReliabilityReportPayload {
  run: EvaluationRunRecord;
  agent: AgentRecord;
  suite: TestSuiteRecord;
  reliability: {
    overallScore: number | null;
    components: ComponentScoreDetail[];
    normalizationPolicy: string;
    securityDisclaimer: string;
    totalCasesEvaluated: number;
    includedFailures: number;
    includedInconclusive: number;
  };
  latencyStats?: LatencyPercentileStats;
  consistency?: ConsistencyMetrics;
  results: TestResultRecord[];
}
