import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const agents = pgTable(
  'agents',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    endpoint: text('endpoint').notNull(),
    httpMethod: text('http_method').default('POST').notNull(),
    authType: text('auth_type').default('none').notNull(), // 'none' | 'bearer' | 'api_key' | 'custom_header'
    credentialRef: text('credential_ref'), // Encrypted JSON stored server-side, never returned in API responses
    credentialHint: text('credential_hint'), // Masked preview e.g. ••••1234
    requestTemplate: jsonb('request_template').$type<Record<string, unknown>>().notNull(),
    responseMapping: jsonb('response_mapping').$type<Record<string, string>>().notNull(),
    timeoutMs: integer('timeout_ms').default(10000).notNull(),
    allowedTools: jsonb('allowed_tools').$type<string[]>().default([]).notNull(),
    modelInfo: jsonb('model_info')
      .$type<{
        provider?: string;
        model?: string;
        systemPromptVersion?: string;
        costPer1kTokensUsd?: number;
      }>()
      .default({})
      .notNull(),
    customHeaders: jsonb('custom_headers').$type<Record<string, string>>().default({}).notNull(),
    isControlledSample: boolean('is_controlled_sample').default(false).notNull(),
    sampleProfile: text('sample_profile'),
    status: text('status').default('enabled').notNull(), // 'enabled' | 'disabled'
    lastTestedAt: timestamp('last_tested_at'),
    lastConnectionStatus: text('last_connection_status'), // 'connected' | 'failed' | 'untested'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agents_user_id').on(table.userId),
    index('idx_agents_status').on(table.status),
  ]
);

export const testSuites = pgTable(
  'test_suites',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    category: text('category').default('comprehensive').notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_test_suites_user_id').on(table.userId)]
);

export const testScenarios = pgTable(
  'test_scenarios',
  {
    id: serial('id').primaryKey(),
    suiteId: integer('suite_id')
      .references(() => testSuites.id, { onDelete: 'cascade' })
      .notNull(),
    scenarioCode: text('scenario_code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(), // 'task_completion' | 'tool_usage' | 'reliability' | 'hallucination' | 'red_team' | 'loop_detection'
    description: text('description').default('').notNull(),
    input: text('input').notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().default({}).notNull(),
    expectedBehavior: text('expected_behavior').notNull(),
    referenceAnswer: text('reference_answer'),
    expectedTools: jsonb('expected_tools').$type<string[]>().default([]).notNull(),
    forbiddenTools: jsonb('forbidden_tools').$type<string[]>().default([]).notNull(),
    severity: text('severity').default('medium').notNull(), // 'low' | 'medium' | 'high' | 'critical'
    evaluationMethod: text('evaluation_method').default('hybrid').notNull(), // 'deterministic' | 'tool_event_validation' | 'gemini_judge' | 'hybrid' | 'loop_check'
    version: integer('version').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_scenarios_suite_id').on(table.suiteId),
    index('idx_scenarios_category').on(table.category),
  ]
);

export const evaluationRuns = pgTable(
  'evaluation_runs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: integer('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    suiteId: integer('suite_id')
      .references(() => testSuites.id, { onDelete: 'cascade' })
      .notNull(),
    runType: text('run_type').default('standard').notNull(), // 'standard' | 'red_team' | 'benchmark' | 'single_scenario'
    status: text('status').default('queued').notNull(), // 'queued' | 'running' | 'completed' | 'failed' | 'aborted_limit'
    trialsPerScenario: integer('trials_per_scenario').default(1).notNull(),
    limitsConfig: jsonb('limits_config')
      .$type<{
        maxDurationMs: number;
        maxSteps: number;
        maxToolCalls: number;
        maxRepeatedCalls: number;
        maxTokenBudget: number;
      }>()
      .notNull(),
    weightsConfig: jsonb('weights_config')
      .$type<{
        taskCompletion: number;
        toolCorrectness: number;
        groundedness: number;
        security: number;
        efficiency: number;
      }>()
      .notNull(),
    totalTests: integer('total_tests').default(0).notNull(),
    completedTests: integer('completed_tests').default(0).notNull(),
    passedCount: integer('passed_count').default(0).notNull(),
    failedCount: integer('failed_count').default(0).notNull(),
    inconclusiveCount: integer('inconclusive_count').default(0).notNull(),
    notSupportedCount: integer('not_supported_count').default(0).notNull(),
    reliabilityScore: real('reliability_score'),
    componentScores: jsonb('component_scores').$type<Record<string, unknown>>(),
    avgLatencyMs: real('avg_latency_ms'),
    avgTokens: real('avg_tokens'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_runs_user_id').on(table.userId),
    index('idx_runs_agent_id').on(table.agentId),
    index('idx_runs_status').on(table.status),
  ]
);

export const testResults = pgTable(
  'test_results',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .references(() => evaluationRuns.id, { onDelete: 'cascade' })
      .notNull(),
    scenarioId: integer('scenario_id')
      .references(() => testScenarios.id, { onDelete: 'cascade' })
      .notNull(),
    scenarioVersion: integer('scenario_version').default(1).notNull(),
    trialIndex: integer('trial_index').default(1).notNull(),
    executionId: text('execution_id').notNull(),
    status: text('status').notNull(), // 'passed' | 'failed' | 'inconclusive' | 'not_supported'
    failureCertainty: text('failure_certainty').default('none').notNull(), // 'none' | 'observed_failure' | 'suspected_failure' | 'evaluator_uncertainty'
    failureCategory: text('failure_category'),
    score: real('score').default(0).notNull(),
    latencyMs: integer('latency_ms').default(0).notNull(),
    tokenUsage: integer('token_usage'),
    actualOutput: text('actual_output').default('').notNull(),
    toolCallsObserved: jsonb('tool_calls_observed').$type<unknown[]>().default([]).notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().default({}).notNull(),
    evaluatorMeta: jsonb('evaluator_meta').$type<Record<string, unknown>>().default({}).notNull(),
    remediation: text('remediation'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_results_run_id').on(table.runId),
    uniqueIndex('idx_results_execution_id').on(table.executionId),
  ]
);

export const executionTraces = pgTable(
  'execution_traces',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .references(() => evaluationRuns.id, { onDelete: 'cascade' })
      .notNull(),
    executionId: text('execution_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    eventType: text('event_type').notNull(), // 'user_request' | 'agent_step' | 'tool_call' | 'tool_response' | 'error' | 'loop_trigger' | 'final_response'
    eventData: jsonb('event_data').$type<Record<string, unknown>>().notNull(),
    durationMs: integer('duration_ms').default(0).notNull(),
    isAnomaly: boolean('is_anomaly').default(false).notNull(),
    anomalyReason: text('anomaly_reason'),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
  },
  (table) => [
    index('idx_traces_execution_id').on(table.executionId),
    index('idx_traces_run_id').on(table.runId),
  ]
);

export const benchmarkComparisons = pgTable(
  'benchmark_comparisons',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    suiteId: integer('suite_id')
      .references(() => testSuites.id, { onDelete: 'cascade' })
      .notNull(),
    trials: integer('trials').default(2).notNull(),
    agentIds: jsonb('agent_ids').$type<number[]>().notNull(),
    runIds: jsonb('run_ids').$type<number[]>().notNull(),
    status: text('status').default('running').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_benchmarks_user_id').on(table.userId)]
);

export const benchmarkResults = pgTable(
  'benchmark_results',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .references(() => evaluationRuns.id, { onDelete: 'cascade' })
      .notNull(),
    comparisonId: integer('comparison_id').references(() => benchmarkComparisons.id, {
      onDelete: 'cascade',
    }),
    metricName: text('metric_name').notNull(),
    metricValue: real('metric_value').notNull(),
    stdDev: real('std_dev'),
    sampleSize: integer('sample_size').default(1).notNull(),
  },
  (table) => [index('idx_benchmark_results_run_id').on(table.runId)]
);

export const userSettings = pgTable('user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  defaultLimits: jsonb('default_limits')
    .$type<{
      maxDurationMs: number;
      maxSteps: number;
      maxToolCalls: number;
      maxRepeatedCalls: number;
      maxTokenBudget: number;
    }>()
    .notNull(),
  defaultWeights: jsonb('default_weights')
    .$type<{
      taskCompletion: number;
      toolCorrectness: number;
      groundedness: number;
      security: number;
      efficiency: number;
    }>()
    .notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ciTokens = pgTable(
  'ci_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    revokedAt: timestamp('revoked_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_ci_tokens_user_id').on(table.userId),
    uniqueIndex('idx_ci_tokens_hash').on(table.tokenHash),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  agents: many(agents),
  evaluationRuns: many(evaluationRuns),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  evaluationRuns: many(evaluationRuns),
}));

export const testSuitesRelations = relations(testSuites, ({ many }) => ({
  scenarios: many(testScenarios),
  evaluationRuns: many(evaluationRuns),
}));

export const testScenariosRelations = relations(testScenarios, ({ one }) => ({
  suite: one(testSuites, { fields: [testScenarios.suiteId], references: [testSuites.id] }),
}));

export const evaluationRunsRelations = relations(evaluationRuns, ({ one, many }) => ({
  agent: one(agents, { fields: [evaluationRuns.agentId], references: [agents.id] }),
  suite: one(testSuites, { fields: [evaluationRuns.suiteId], references: [testSuites.id] }),
  results: many(testResults),
  traces: many(executionTraces),
  benchmarkResults: many(benchmarkResults),
}));

export const testResultsRelations = relations(testResults, ({ one }) => ({
  run: one(evaluationRuns, { fields: [testResults.runId], references: [evaluationRuns.id] }),
  scenario: one(testScenarios, {
    fields: [testResults.scenarioId],
    references: [testScenarios.id],
  }),
}));

export const executionTracesRelations = relations(executionTraces, ({ one }) => ({
  run: one(evaluationRuns, { fields: [executionTraces.runId], references: [evaluationRuns.id] }),
}));
