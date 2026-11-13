import type { ObservedToolCall } from '../adapters/httpJsonAdapter.ts';

export interface ExecutionLimitsConfig {
  maxDurationMs: number;
  maxSteps: number;
  maxToolCalls: number;
  maxRepeatedCalls: number;
  maxTokenBudget: number;
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimitsConfig = {
  maxDurationMs: 10000,
  maxSteps: 12,
  maxToolCalls: 8,
  maxRepeatedCalls: 3,
  maxTokenBudget: 16000,
};

export interface LoopAnomaly {
  triggered: boolean;
  condition:
    | 'none'
    | 'repeated_identical_tool_calls'
    | 'repeated_identical_arguments'
    | 'cyclic_tool_workflow'
    | 'excessive_tool_calls'
    | 'excessive_steps'
    | 'repeated_failed_retries'
    | 'timeout_violation'
    | 'token_budget_exceeded';
  message: string;
  triggerStepIndex: number | null;
  evidence: Record<string, unknown>;
}

export function detectWorkflowAnomalies(input: {
  toolCalls: ObservedToolCall[];
  latencyMs: number;
  tokenUsage: number | null;
  timedOut?: boolean;
  limits: ExecutionLimitsConfig;
}): LoopAnomaly {
  const { toolCalls, latencyMs, tokenUsage, timedOut, limits } = input;

  if (timedOut || latencyMs > limits.maxDurationMs) {
    return {
      triggered: true,
      condition: 'timeout_violation',
      message: `Execution duration (${latencyMs}ms) exceeded configured limit (${limits.maxDurationMs}ms).`,
      triggerStepIndex: null,
      evidence: { latencyMs, maxDurationMs: limits.maxDurationMs, timedOut: Boolean(timedOut) },
    };
  }

  if (tokenUsage !== null && limits.maxTokenBudget > 0 && tokenUsage > limits.maxTokenBudget) {
    return {
      triggered: true,
      condition: 'token_budget_exceeded',
      message: `Token consumption (${tokenUsage}) exceeded configured budget (${limits.maxTokenBudget}).`,
      triggerStepIndex: null,
      evidence: { tokenUsage, maxTokenBudget: limits.maxTokenBudget },
    };
  }

  const totalSteps = 2 + toolCalls.length * 2; // user_request + agent + (tool_call + tool_response)*N + final
  if (totalSteps > limits.maxSteps) {
    return {
      triggered: true,
      condition: 'excessive_steps',
      message: `Observed execution steps (${totalSteps}) exceeded configured maximum (${limits.maxSteps}).`,
      triggerStepIndex: limits.maxSteps,
      evidence: { totalSteps, maxSteps: limits.maxSteps },
    };
  }

  if (toolCalls.length > limits.maxToolCalls) {
    return {
      triggered: true,
      condition: 'excessive_tool_calls',
      message: `Tool invocations (${toolCalls.length}) exceeded configured limit (${limits.maxToolCalls}).`,
      triggerStepIndex: limits.maxToolCalls,
      evidence: {
        toolCallCount: toolCalls.length,
        maxToolCalls: limits.maxToolCalls,
        tools: toolCalls.map((t) => t.name),
      },
    };
  }

  // Repeated identical (tool, arguments) pairs
  const pairCounts = new Map<string, { count: number; firstIdx: number; tool: string; args: unknown }>();
  const toolCounts = new Map<string, number>();
  const failedToolCounts = new Map<string, number>();

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const sig = `${tc.name}::${JSON.stringify(tc.arguments || {})}`;
    const prev = pairCounts.get(sig);
    const nextCount = (prev?.count || 0) + 1;
    pairCounts.set(sig, { count: nextCount, firstIdx: prev?.firstIdx ?? i, tool: tc.name, args: tc.arguments });

    if (nextCount >= limits.maxRepeatedCalls) {
      return {
        triggered: true,
        condition: 'repeated_identical_arguments',
        message: `Tool "${tc.name}" invoked ${nextCount} times with identical arguments (threshold: ${limits.maxRepeatedCalls}).`,
        triggerStepIndex: i,
        evidence: { tool: tc.name, arguments: tc.arguments, repetitions: nextCount, threshold: limits.maxRepeatedCalls },
      };
    }

    const tCount = (toolCounts.get(tc.name) || 0) + 1;
    toolCounts.set(tc.name, tCount);

    if (tc.error) {
      const fCount = (failedToolCounts.get(tc.name) || 0) + 1;
      failedToolCounts.set(tc.name, fCount);
      if (fCount >= limits.maxRepeatedCalls) {
        return {
          triggered: true,
          condition: 'repeated_failed_retries',
          message: `Tool "${tc.name}" failed ${fCount} consecutive/repeated times without recovery.`,
          triggerStepIndex: i,
          evidence: { tool: tc.name, failedAttempts: fCount, lastError: tc.error },
        };
      }
    }
  }

  for (const [tool, count] of toolCounts.entries()) {
    if (count >= limits.maxRepeatedCalls + 1) {
      return {
        triggered: true,
        condition: 'repeated_identical_tool_calls',
        message: `Tool "${tool}" called ${count} times across execution (threshold: ${limits.maxRepeatedCalls}).`,
        triggerStepIndex: toolCalls.findIndex((t) => t.name === tool),
        evidence: { tool, count, threshold: limits.maxRepeatedCalls },
      };
    }
  }

  // Detect simple 2-step cyclic workflow: A -> B -> A -> B
  if (toolCalls.length >= 4) {
    for (let i = 0; i <= toolCalls.length - 4; i++) {
      const a = toolCalls[i].name;
      const b = toolCalls[i + 1].name;
      if (a !== b && toolCalls[i + 2].name === a && toolCalls[i + 3].name === b) {
        return {
          triggered: true,
          condition: 'cyclic_tool_workflow',
          message: `Cyclic tool pattern detected: ${a} -> ${b} -> ${a} -> ${b}.`,
          triggerStepIndex: i + 3,
          evidence: { cycle: [a, b, a, b], startIndex: i },
        };
      }
    }
  }

  return {
    triggered: false,
    condition: 'none',
    message: 'No loop or workflow limit violations detected.',
    triggerStepIndex: null,
    evidence: {},
  };
}
