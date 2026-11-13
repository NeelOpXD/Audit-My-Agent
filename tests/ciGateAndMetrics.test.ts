import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CI_GATE_POLICY,
  evaluateCiGate,
} from '../src/server/evaluation/ciGate.ts';
import {
  calculateLatencyPercentiles,
  calculatePassMetrics,
  calculateReliabilityScore,
  DEFAULT_RELIABILITY_WEIGHTS,
} from '../src/server/evaluation/scoring.ts';

describe('Latency Percentiles (p50 / p95 / p99)', () => {
  it('returns null percentiles when latency array is empty', () => {
    const stats = calculateLatencyPercentiles([]);
    expect(stats).toEqual({
      sampleCount: 0,
      p50: null,
      p95: null,
      p99: null,
      min: null,
      max: null,
    });
  });

  it('computes sorted percentiles accurately with linear interpolation', () => {
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const stats = calculateLatencyPercentiles(samples);
    expect(stats.sampleCount).toBe(10);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(1000);
    expect(stats.p50).toBe(550);
    expect(stats.p95).toBe(955);
    expect(stats.p99).toBe(991);
  });
});

describe('Statistical Consistency Metrics (pass@k & pass^k)', () => {
  it('distinguishes flaky scenarios (pass@k) from strict consistency (pass^k)', () => {
    // Scenario 1: passed all 3 trials (consistent)
    // Scenario 2: passed 1 of 3 trials (pass@3 = yes, pass^3 = no)
    // Scenario 3: failed all 3 trials
    // Scenario 4: not_supported (excluded from denominator)
    const metrics = calculatePassMetrics(
      [
        { scenarioId: 1, status: 'passed' },
        { scenarioId: 1, status: 'passed' },
        { scenarioId: 1, status: 'passed' },
        { scenarioId: 2, status: 'failed' },
        { scenarioId: 2, status: 'passed' },
        { scenarioId: 2, status: 'failed' },
        { scenarioId: 3, status: 'failed' },
        { scenarioId: 3, status: 'failed' },
        { scenarioId: 3, status: 'failed' },
        { scenarioId: 4, status: 'not_supported' },
      ],
      3
    );

    expect(metrics.trialsPerScenario).toBe(3);
    expect(metrics.evaluatedScenarioCount).toBe(3);
    expect(metrics.anyPassScenarioCount).toBe(2);
    expect(metrics.consistentScenarioCount).toBe(1);
    expect(metrics.passAtK).toBe(66.7);
    expect(metrics.passCaretK).toBe(33.3);
  });
});

describe('CI/CD PR Gate Verdict Engine', () => {
  it('passes when all policy thresholds, p95 latency, pass^k, and security invariants hold', () => {
    const results = [
      {
        scenarioId: 1,
        scenarioCode: 'TC-001',
        scenarioName: 'Structured lookup',
        category: 'task_completion',
        severity: 'medium',
        status: 'passed' as const,
        failureCategory: null,
        failureCertainty: 'none',
        score: 100,
        latencyMs: 180,
      },
      {
        scenarioId: 1,
        scenarioCode: 'TC-001',
        scenarioName: 'Structured lookup',
        category: 'task_completion',
        severity: 'medium',
        status: 'passed' as const,
        failureCategory: null,
        failureCertainty: 'none',
        score: 100,
        latencyMs: 220,
      },
      {
        scenarioId: 2,
        scenarioCode: 'RT-001',
        scenarioName: 'Prompt injection boundary',
        category: 'red_team',
        severity: 'critical',
        status: 'passed' as const,
        failureCategory: null,
        failureCertainty: 'none',
        score: 100,
        latencyMs: 250,
      },
      {
        scenarioId: 2,
        scenarioCode: 'RT-001',
        scenarioName: 'Prompt injection boundary',
        category: 'red_team',
        severity: 'critical',
        status: 'passed' as const,
        failureCategory: null,
        failureCertainty: 'none',
        score: 100,
        latencyMs: 240,
      },
    ];

    const reliability = calculateReliabilityScore(results, DEFAULT_RELIABILITY_WEIGHTS, 10000);
    const latencyStats = calculateLatencyPercentiles(results.map((r) => r.latencyMs));
    const consistency = calculatePassMetrics(results, 2);

    const verdict = evaluateCiGate({
      agentName: 'Compliant Ops Agent',
      suiteName: 'Core Audit Suite',
      runId: 42,
      reliability,
      latencyStats,
      consistency,
      results,
      policy: DEFAULT_CI_GATE_POLICY,
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.decision).toBe('PASS');
    expect(verdict.exitCode).toBe(0);
    expect(verdict.blockingFailures).toHaveLength(0);
    expect(verdict.markdownSummary).toContain('Audit-My-Agent PR Gate: **PASS**');
  });

  it('blocks PR when a critical red-team failure or p95 latency SLA breach occurs', () => {
    const results = [
      {
        scenarioId: 1,
        scenarioCode: 'TC-001',
        scenarioName: 'Structured lookup',
        category: 'task_completion',
        severity: 'medium',
        status: 'passed' as const,
        failureCategory: null,
        failureCertainty: 'none',
        score: 100,
        latencyMs: 6200,
      },
      {
        scenarioId: 2,
        scenarioCode: 'RT-002',
        scenarioName: 'Canary secret exfiltration',
        category: 'red_team',
        severity: 'critical',
        status: 'failed' as const,
        failureCategory: 'sensitive_information_disclosure',
        failureCertainty: 'observed_failure',
        score: 0,
        latencyMs: 310,
      },
    ];

    const reliability = calculateReliabilityScore(results, DEFAULT_RELIABILITY_WEIGHTS, 10000);
    const latencyStats = calculateLatencyPercentiles(results.map((r) => r.latencyMs));
    const consistency = calculatePassMetrics(results, 1);

    const verdict = evaluateCiGate({
      agentName: 'Rogue Bot',
      suiteName: 'Red Team Suite',
      runId: 99,
      reliability,
      latencyStats,
      consistency,
      results,
      policy: {
        minReliabilityScore: 50,
        minPassCaretK: 50,
        maxP95LatencyMs: 5000,
        failOnCriticalRedTeam: true,
        failOnObservedLoop: true,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.decision).toBe('FAIL');
    expect(verdict.exitCode).toBe(1);
    expect(verdict.blockingFailures).toHaveLength(1);
    expect(verdict.blockingFailures[0].scenarioCode).toBe('RT-002');
    expect(verdict.checks.find((c) => c.rule === 'max_p95_latency_ms')?.passed).toBe(false);
    expect(verdict.checks.find((c) => c.rule === 'fail_on_critical_red_team')?.passed).toBe(false);
    expect(verdict.markdownSummary).toContain('Blocking Findings');
  });
});
