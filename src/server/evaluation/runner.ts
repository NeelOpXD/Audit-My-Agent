import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  agents,
  benchmarkComparisons,
  benchmarkResults,
  evaluationRuns,
  executionTraces,
  testResults,
  testScenarios,
} from '../../db/schema.ts';
import { invokeAgentHttpAdapter } from '../adapters/httpJsonAdapter.ts';
import { evaluateScenarioResponse, type ScenarioForEval } from './judge.ts';
import { detectWorkflowAnomalies, type ExecutionLimitsConfig } from './loopDetector.ts';
import {
  calculateLatencyPercentiles,
  calculatePassMetrics,
  calculateReliabilityScore,
  type ReliabilityWeights,
  type ScorableResult,
} from './scoring.ts';

export const evaluationEventBus = new EventEmitter();
evaluationEventBus.setMaxListeners(100);

export function emitRunProgress(runId: number, payload: Record<string, unknown>) {
  evaluationEventBus.emit(`run:${runId}`, payload);
}

function buildTraceSteps(params: {
  runId: number;
  executionId: string;
  scenario: ScenarioForEval;
  agentName: string;
  modelName: string;
  answer: string;
  latencyMs: number;
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    response?: unknown;
    durationMs?: number;
    error?: string;
  }>;
  toolCallsTelemetryAvailable: boolean;
  allowedTools: string[];
  loopAnomaly: ReturnType<typeof detectWorkflowAnomalies>;
  error?: string;
}) {
  const {
    runId,
    executionId,
    scenario,
    agentName,
    modelName,
    answer,
    latencyMs,
    toolCalls,
    toolCallsTelemetryAvailable,
    allowedTools,
    loopAnomaly,
    error,
  } = params;

  const steps: Array<{
    runId: number;
    executionId: string;
    stepIndex: number;
    eventType: string;
    eventData: Record<string, unknown>;
    durationMs: number;
    isAnomaly: boolean;
    anomalyReason: string | null;
  }> = [];

  let idx = 0;
  steps.push({
    runId,
    executionId,
    stepIndex: idx++,
    eventType: 'user_request',
    eventData: {
      scenarioCode: scenario.scenarioCode,
      category: scenario.category,
      input: scenario.input,
      contextKeys: Object.keys(scenario.context || {}),
    },
    durationMs: 0,
    isAnomaly: false,
    anomalyReason: null,
  });

  steps.push({
    runId,
    executionId,
    stepIndex: idx++,
    eventType: 'agent_step',
    eventData: {
      agentName,
      model: modelName || 'Not exposed by agent',
      telemetryStatus: toolCallsTelemetryAvailable
        ? 'Tool telemetry exposed'
        : 'Tool telemetry not exposed by agent',
    },
    durationMs: Math.round(latencyMs * 0.2),
    isAnomaly: false,
    anomalyReason: null,
  });

  const seenSigs = new Map<string, number>();

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const sig = `${tc.name}::${JSON.stringify(tc.arguments || {})}`;
    const count = (seenSigs.get(sig) || 0) + 1;
    seenSigs.set(sig, count);

    const unauthorized =
      scenario.forbiddenTools.includes(tc.name) ||
      (allowedTools.length > 0 && !allowedTools.includes(tc.name));
    const repeated = count >= 2;
    const isAnomaly = unauthorized || repeated || Boolean(tc.error);
    const anomalyReason = unauthorized
      ? `Unauthorized tool call: ${tc.name}`
      : repeated
      ? `Repeated identical call (${count}x)`
      : tc.error
      ? `Tool execution error: ${tc.error}`
      : null;

    steps.push({
      runId,
      executionId,
      stepIndex: idx++,
      eventType: 'tool_call',
      eventData: {
        tool: tc.name,
        arguments: tc.arguments,
        callIndex: i + 1,
      },
      durationMs: tc.durationMs ?? Math.max(10, Math.round(latencyMs * 0.15)),
      isAnomaly,
      anomalyReason,
    });

    steps.push({
      runId,
      executionId,
      stepIndex: idx++,
      eventType: 'tool_response',
      eventData: {
        tool: tc.name,
        response: tc.response ?? 'Not exposed by agent',
        error: tc.error || null,
      },
      durationMs: 5,
      isAnomaly: Boolean(tc.error),
      anomalyReason: tc.error ? `Tool returned error: ${tc.error}` : null,
    });
  }

  if (loopAnomaly.triggered) {
    steps.push({
      runId,
      executionId,
      stepIndex: idx++,
      eventType: 'loop_trigger',
      eventData: {
        condition: loopAnomaly.condition,
        message: loopAnomaly.message,
        evidence: loopAnomaly.evidence,
      },
      durationMs: 0,
      isAnomaly: true,
      anomalyReason: loopAnomaly.message,
    });
  }

  if (error) {
    steps.push({
      runId,
      executionId,
      stepIndex: idx++,
      eventType: 'error',
      eventData: {
        error,
      },
      durationMs: latencyMs,
      isAnomaly: true,
      anomalyReason: error,
    });
  }

  steps.push({
    runId,
    executionId,
    stepIndex: idx++,
    eventType: 'final_response',
    eventData: {
      answerPreview: answer ? answer.slice(0, 1500) : '(no output)',
      totalLatencyMs: latencyMs,
    },
    durationMs: Math.max(1, Math.round(latencyMs * 0.15)),
    isAnomaly: Boolean(error || loopAnomaly.triggered),
    anomalyReason: error || (loopAnomaly.triggered ? loopAnomaly.message : null),
  });

  return steps;
}

export async function executeEvaluationRunAsync(
  runId: number,
  scenarioIdsFilter?: number[]
): Promise<void> {
  try {
    const [run] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId));
    if (!run) return;

    const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId));
    if (!agent) {
      await db
        .update(evaluationRuns)
        .set({ status: 'failed', errorMessage: 'Target agent not found.', completedAt: new Date() })
        .where(eq(evaluationRuns.id, runId));
      return;
    }

    let scenarios = await db
      .select()
      .from(testScenarios)
      .where(eq(testScenarios.suiteId, run.suiteId));

    if (scenarioIdsFilter && scenarioIdsFilter.length > 0) {
      const allowedSet = new Set(scenarioIdsFilter);
      scenarios = scenarios.filter((s) => allowedSet.has(s.id));
    } else {
      scenarios = scenarios.filter((s) => s.isActive);
    }

    const totalTests = scenarios.length * run.trialsPerScenario;
    await db
      .update(evaluationRuns)
      .set({ status: 'running', totalTests, completedTests: 0 })
      .where(eq(evaluationRuns.id, runId));

    emitRunProgress(runId, { status: 'running', completedTests: 0, totalTests });

    const limits = run.limitsConfig as ExecutionLimitsConfig;
    const weights = run.weightsConfig as ReliabilityWeights;

    let completedTests = 0;
    let passedCount = 0;
    let failedCount = 0;
    let inconclusiveCount = 0;
    let notSupportedCount = 0;
    let totalLatency = 0;
    const observedLatencies: number[] = [];
    const observedTokens: number[] = [];
    const scorableResults: ScorableResult[] = [];
    const scenarioOutcomeRecords: Array<{ scenarioId: number; status: string }> = [];

    for (const rawScenario of scenarios) {
      const scenario: ScenarioForEval = {
        id: rawScenario.id,
        scenarioCode: rawScenario.scenarioCode,
        name: rawScenario.name,
        category: rawScenario.category,
        description: rawScenario.description,
        input: rawScenario.input,
        context: rawScenario.context || {},
        expectedBehavior: rawScenario.expectedBehavior,
        referenceAnswer: rawScenario.referenceAnswer,
        expectedTools: rawScenario.expectedTools || [],
        forbiddenTools: rawScenario.forbiddenTools || [],
        severity: rawScenario.severity,
        evaluationMethod: rawScenario.evaluationMethod,
      };

      const trialOutputs: string[] = [];
      const trialResultIds: Array<{ id: number; status: string; score: number }> = [];

      for (let trial = 1; trial <= run.trialsPerScenario; trial++) {
        const executionId = `exec_${runId}_${scenario.id}_t${trial}_${crypto.randomBytes(3).toString('hex')}`;

        const agentResponse = await invokeAgentHttpAdapter(
          {
            id: agent.id,
            name: agent.name,
            endpoint: agent.endpoint,
            httpMethod: agent.httpMethod,
            authType: agent.authType,
            credentialRef: agent.credentialRef,
            requestTemplate: agent.requestTemplate,
            responseMapping: agent.responseMapping,
            timeoutMs: Math.min(agent.timeoutMs, limits.maxDurationMs),
            allowedTools: agent.allowedTools,
            customHeaders: agent.customHeaders,
            isControlledSample: agent.isControlledSample,
            sampleProfile: agent.sampleProfile,
          },
          {
            task: scenario.input,
            context: scenario.context,
            overrideTimeoutMs: limits.maxDurationMs,
          }
        );

        const loopAnomaly = detectWorkflowAnomalies({
          toolCalls: agentResponse.toolCalls,
          latencyMs: agentResponse.latencyMs,
          tokenUsage: agentResponse.tokenUsage,
          timedOut: agentResponse.timedOut,
          limits,
        });

        const verdict = await evaluateScenarioResponse({
          scenario,
          allowedTools: agent.allowedTools,
          agentResponse,
          loopAnomaly,
        });

        const [insertedResult] = await db
          .insert(testResults)
          .values({
            runId,
            scenarioId: scenario.id,
            scenarioVersion: rawScenario.version,
            trialIndex: trial,
            executionId,
            status: verdict.status,
            failureCertainty: verdict.failureCertainty,
            failureCategory: verdict.failureCategory,
            score: verdict.score,
            latencyMs: agentResponse.latencyMs,
            tokenUsage: agentResponse.tokenUsage,
            actualOutput: agentResponse.answer || agentResponse.error || '',
            toolCallsObserved: agentResponse.toolCalls,
            evidence: {
              ...verdict.evidence,
              toolCallsTelemetryAvailable: agentResponse.toolCallsTelemetryAvailable,
              tokensTelemetryAvailable: agentResponse.tokensTelemetryAvailable,
              httpStatus: agentResponse.httpStatus,
            },
            evaluatorMeta: verdict.evaluatorMeta,
            remediation: verdict.remediation,
          })
          .returning();

        const traceRows = buildTraceSteps({
          runId,
          executionId,
          scenario,
          agentName: agent.name,
          modelName: agent.modelInfo?.model || 'Not exposed by agent',
          answer: agentResponse.answer,
          latencyMs: agentResponse.latencyMs,
          toolCalls: agentResponse.toolCalls,
          toolCallsTelemetryAvailable: agentResponse.toolCallsTelemetryAvailable,
          allowedTools: agent.allowedTools,
          loopAnomaly,
          error: agentResponse.error,
        });

        if (traceRows.length > 0) {
          await db.insert(executionTraces).values(traceRows);
        }

        trialOutputs.push((agentResponse.answer || '').trim().toLowerCase());
        trialResultIds.push({ id: insertedResult.id, status: verdict.status, score: verdict.score });

        completedTests++;
        totalLatency += agentResponse.latencyMs;
        observedLatencies.push(agentResponse.latencyMs);
        if (agentResponse.tokenUsage !== null) {
          observedTokens.push(agentResponse.tokenUsage);
        }

        if (verdict.status === 'passed') passedCount++;
        else if (verdict.status === 'failed') failedCount++;
        else if (verdict.status === 'inconclusive') inconclusiveCount++;
        else if (verdict.status === 'not_supported') notSupportedCount++;

        scorableResults.push({
          category: scenario.category,
          status: verdict.status,
          score: verdict.score,
          latencyMs: agentResponse.latencyMs,
        });
        scenarioOutcomeRecords.push({
          scenarioId: scenario.id,
          status: verdict.status,
        });

        await db
          .update(evaluationRuns)
          .set({
            completedTests,
            passedCount,
            failedCount,
            inconclusiveCount,
            notSupportedCount,
          })
          .where(eq(evaluationRuns.id, runId));

        emitRunProgress(runId, {
          status: 'running',
          completedTests,
          totalTests,
          passedCount,
          failedCount,
          inconclusiveCount,
          lastScenario: scenario.name,
        });
      }

      // Cross-trial consistency check for reliability scenarios when trials >= 2
      if (run.trialsPerScenario >= 2 && trialOutputs.length >= 2) {
        const nonEmpty = trialOutputs.filter(Boolean);
        const uniqueOutputs = new Set(nonEmpty);
        if (uniqueOutputs.size > 1 && scenario.category === 'reliability') {
          // Flag divergence across trials on the last trial if it had previously passed
          const lastTrial = trialResultIds[trialResultIds.length - 1];
          if (lastTrial && lastTrial.status === 'passed') {
            passedCount = Math.max(0, passedCount - 1);
            failedCount++;
            await db
              .update(testResults)
              .set({
                status: 'failed',
                failureCertainty: 'observed_failure',
                failureCategory: 'inconsistent_outputs',
                score: 30,
                remediation:
                  'Stabilize system prompt constraints, lower sampling randomness, and enforce deterministic tool formatting.',
                evidence: {
                  crossTrialDivergence: true,
                  distinctOutputsObserved: uniqueOutputs.size,
                  trialsExecuted: run.trialsPerScenario,
                },
              })
              .where(eq(testResults.id, lastTrial.id));

            // Update scorable result to reflect observed inconsistency
            const idx = scorableResults.length - 1;
            if (idx >= 0) {
              scorableResults[idx] = {
                ...scorableResults[idx],
                status: 'failed',
                score: 30,
              };
            }
            const outcomeIdx = scenarioOutcomeRecords.length - 1;
            if (outcomeIdx >= 0) {
              scenarioOutcomeRecords[outcomeIdx] = {
                ...scenarioOutcomeRecords[outcomeIdx],
                status: 'failed',
              };
            }
          }
        }
      }
    }

    const summary = calculateReliabilityScore(scorableResults, weights, limits.maxDurationMs);
    const latencyStats = calculateLatencyPercentiles(observedLatencies);
    const consistency = calculatePassMetrics(scenarioOutcomeRecords, run.trialsPerScenario);
    const avgLatencyMs =
      completedTests > 0 ? Math.round((totalLatency / completedTests) * 10) / 10 : null;
    const avgTokens =
      observedTokens.length > 0
        ? Math.round(
            (observedTokens.reduce((a, b) => a + b, 0) / observedTokens.length) * 10
          ) / 10
        : null;

    await db
      .update(evaluationRuns)
      .set({
        status: 'completed',
        completedTests,
        passedCount,
        failedCount,
        inconclusiveCount,
        notSupportedCount,
        reliabilityScore: summary.overallScore,
        componentScores: summary as unknown as Record<string, unknown>,
        avgLatencyMs,
        avgTokens,
        completedAt: new Date(),
      })
      .where(eq(evaluationRuns.id, runId));

    // Persist benchmark metric snapshots for this run
    const metricEntries: Array<{ runId: number; metricName: string; metricValue: number; sampleSize: number }> = [];
    if (summary.overallScore !== null) {
      metricEntries.push({
        runId,
        metricName: 'reliability_score',
        metricValue: summary.overallScore,
        sampleSize: completedTests,
      });
    }
    for (const comp of summary.components) {
      if (comp.score !== null) {
        metricEntries.push({
          runId,
          metricName: comp.key,
          metricValue: comp.score,
          sampleSize: comp.totalCases,
        });
      }
    }
    if (avgLatencyMs !== null) {
      metricEntries.push({
        runId,
        metricName: 'avg_latency_ms',
        metricValue: avgLatencyMs,
        sampleSize: completedTests,
      });
    }
    if (latencyStats.p50 !== null) {
      metricEntries.push({
        runId,
        metricName: 'p50_latency_ms',
        metricValue: latencyStats.p50,
        sampleSize: latencyStats.sampleCount,
      });
    }
    if (latencyStats.p95 !== null) {
      metricEntries.push({
        runId,
        metricName: 'p95_latency_ms',
        metricValue: latencyStats.p95,
        sampleSize: latencyStats.sampleCount,
      });
    }
    if (latencyStats.p99 !== null) {
      metricEntries.push({
        runId,
        metricName: 'p99_latency_ms',
        metricValue: latencyStats.p99,
        sampleSize: latencyStats.sampleCount,
      });
    }
    if (consistency.passAtK !== null) {
      metricEntries.push({
        runId,
        metricName: 'pass_at_k',
        metricValue: consistency.passAtK,
        sampleSize: consistency.evaluatedScenarioCount,
      });
    }
    if (consistency.passCaretK !== null) {
      metricEntries.push({
        runId,
        metricName: 'pass_caret_k',
        metricValue: consistency.passCaretK,
        sampleSize: consistency.evaluatedScenarioCount,
      });
    }
    if (avgTokens !== null) {
      metricEntries.push({
        runId,
        metricName: 'avg_tokens',
        metricValue: avgTokens,
        sampleSize: observedTokens.length,
      });
    }
    if (metricEntries.length > 0) {
      await db.insert(benchmarkResults).values(metricEntries);
    }

    emitRunProgress(runId, {
      status: 'completed',
      completedTests,
      totalTests,
      passedCount,
      failedCount,
      inconclusiveCount,
      reliabilityScore: summary.overallScore,
      p95LatencyMs: latencyStats.p95,
      passCaretK: consistency.passCaretK,
    });
  } catch (err) {
    console.error(`Evaluation run ${runId} crashed:`, err);
    await db
      .update(evaluationRuns)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Unexpected evaluation engine failure',
        completedAt: new Date(),
      })
      .where(eq(evaluationRuns.id, runId));

    emitRunProgress(runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unexpected failure',
    });
  }
}

export async function executeBenchmarkComparisonAsync(comparisonId: number): Promise<void> {
  try {
    const [comparison] = await db
      .select()
      .from(benchmarkComparisons)
      .where(eq(benchmarkComparisons.id, comparisonId));
    if (!comparison) return;

    const runIds = comparison.runIds || [];
    for (const rId of runIds) {
      await executeEvaluationRunAsync(rId);
    }

    const runs = await db
      .select()
      .from(evaluationRuns)
      .where(inArray(evaluationRuns.id, runIds));
    const allCompleted = runs.every((r) => r.status === 'completed');

    await db
      .update(benchmarkComparisons)
      .set({ status: allCompleted ? 'completed' : 'completed_with_errors' })
      .where(eq(benchmarkComparisons.id, comparisonId));
  } catch (err) {
    console.error(`Benchmark comparison ${comparisonId} failed:`, err);
    await db
      .update(benchmarkComparisons)
      .set({ status: 'failed' })
      .where(eq(benchmarkComparisons.id, comparisonId));
  }
}
