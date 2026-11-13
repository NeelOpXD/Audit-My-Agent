import express from 'express';
import { and, desc, eq, inArray, or, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  agents,
  benchmarkComparisons,
  benchmarkResults,
  ciTokens,
  evaluationRuns,
  executionTraces,
  testResults,
  testScenarios,
  testSuites,
  userSettings,
} from '../../db/schema.ts';
import { invokeAgentHttpAdapter } from '../adapters/httpJsonAdapter.ts';
import { evaluateCiGate, type CiGatePolicy } from '../evaluation/ciGate.ts';
import {
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionLimitsConfig,
} from '../evaluation/loopDetector.ts';
import {
  evaluationEventBus,
  executeBenchmarkComparisonAsync,
  executeEvaluationRunAsync,
} from '../evaluation/runner.ts';
import {
  calculateLatencyPercentiles,
  calculatePassMetrics,
  calculateReliabilityScore,
  DEFAULT_RELIABILITY_WEIGHTS,
  type ReliabilityWeights,
  type ScorableResult,
} from '../evaluation/scoring.ts';
import {
  generateCiToken,
  requireAuth,
  requireFirebaseSession,
  type AuthRequest,
} from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { SAMPLE_AGENT_BLUEPRINTS } from '../sampleAgents.ts';
import { encryptCredential } from '../security/crypto.ts';
import { validateTargetUrl } from '../security/ssrf.ts';
import { ensureSystemSuitesSeeded } from '../seed/systemSuites.ts';

export const apiRouter = express.Router();

apiRouter.use(requireAuth);

function sanitizeAgent(agent: typeof agents.$inferSelect) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    endpoint: agent.endpoint,
    httpMethod: agent.httpMethod,
    authType: agent.authType,
    hasCredential: Boolean(agent.credentialRef),
    credentialHint: agent.credentialHint || null,
    requestTemplate: agent.requestTemplate,
    responseMapping: agent.responseMapping,
    timeoutMs: agent.timeoutMs,
    allowedTools: agent.allowedTools,
    modelInfo: agent.modelInfo,
    customHeaders: agent.customHeaders,
    isControlledSample: agent.isControlledSample,
    sampleProfile: agent.sampleProfile,
    status: agent.status,
    lastTestedAt: agent.lastTestedAt,
    lastConnectionStatus: agent.lastConnectionStatus || 'untested',
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

// ---------- OVERVIEW ANALYTICS (100% real DB aggregations) ----------
apiRouter.get('/overview', async (req: AuthRequest, res) => {
  try {
    await ensureSystemSuitesSeeded();
    const userId = req.dbUser!.id;

    const userAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.userId, userId))
      .orderBy(desc(agents.createdAt));

    const userRuns = await db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.userId, userId))
      .orderBy(desc(evaluationRuns.createdAt));

    const runIds = userRuns.map((r) => r.id);
    const allResults =
      runIds.length > 0
        ? await db
            .select({
              result: testResults,
              scenarioCategory: testScenarios.category,
              scenarioName: testScenarios.name,
            })
            .from(testResults)
            .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
            .where(inArray(testResults.runId, runIds))
        : [];

    const totalRuns = userRuns.length;
    const passedTests = allResults.filter((r) => r.result.status === 'passed').length;
    const failedTests = allResults.filter((r) => r.result.status === 'failed').length;
    const inconclusiveTests = allResults.filter((r) => r.result.status === 'inconclusive').length;
    const totalTests = allResults.length;

    const avgSuccessRate =
      totalTests > 0 ? Math.round((passedTests / totalTests) * 1000) / 10 : null;

    const toolMisuseIncidents = allResults.filter(
      (r) =>
        r.result.status === 'failed' &&
        (r.result.failureCategory === 'unauthorized_tool_use' ||
          r.result.failureCategory === 'unauthorized_tool_invocation' ||
          r.result.failureCategory === 'missing_required_tool' ||
          r.result.failureCategory === 'missing_tool_arguments' ||
          r.scenarioCategory === 'tool_usage')
    ).length;

    const redTeamResults = allResults.filter((r) => r.scenarioCategory === 'red_team');
    const redTeamPassed = redTeamResults.filter((r) => r.result.status === 'passed').length;
    const promptInjectionResistance =
      redTeamResults.length > 0
        ? Math.round((redTeamPassed / redTeamResults.length) * 1000) / 10
        : null;

    const latencies = allResults.map((r) => r.result.latencyMs).filter((n) => n >= 0);
    const latencyStats = calculateLatencyPercentiles(latencies);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    // Aggregate pass^k across run-scenario pairs using each run's configured trial count
    const runTrialsMap = new Map(userRuns.map((r) => [r.id, r.trialsPerScenario]));
    const runScenarioBuckets = new Map<string, { k: number; statuses: string[] }>();
    for (const row of allResults) {
      if (row.result.status === 'not_supported') continue;
      const bucketKey = `${row.result.runId}:${row.result.scenarioId}`;
      const existingBucket = runScenarioBuckets.get(bucketKey) || {
        k: runTrialsMap.get(row.result.runId) || 1,
        statuses: [],
      };
      existingBucket.statuses.push(row.result.status);
      runScenarioBuckets.set(bucketKey, existingBucket);
    }
    const evaluatedBuckets = Array.from(runScenarioBuckets.values());
    const consistentBuckets = evaluatedBuckets.filter(
      (b) => b.statuses.length >= b.k && b.statuses.every((s) => s === 'passed')
    ).length;
    const passCaretK =
      evaluatedBuckets.length > 0
        ? Math.round((consistentBuckets / evaluatedBuckets.length) * 1000) / 10
        : null;

    const tokens = allResults
      .map((r) => r.result.tokenUsage)
      .filter((t): t is number => typeof t === 'number' && t >= 0);
    const avgTokens =
      tokens.length > 0 ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null;

    // Success over time (chronological runs)
    const agentMap = new Map(userAgents.map((a) => [a.id, a.name]));
    const successOverTime = [...userRuns]
      .reverse()
      .slice(-15)
      .map((run) => {
        const total = run.passedCount + run.failedCount + run.inconclusiveCount;
        const rate = total > 0 ? Math.round((run.passedCount / total) * 100) : 0;
        return {
          runId: run.id,
          label: `#${run.id} ${agentMap.get(run.agentId)?.slice(0, 14) || 'Agent'}`,
          successRate: rate,
          reliabilityScore: run.reliabilityScore ?? 0,
          avgLatencyMs: Math.round(run.avgLatencyMs ?? 0),
          timestamp: run.startedAt,
        };
      });

    // Failure distribution by category
    const failureCounts = new Map<string, number>();
    for (const row of allResults) {
      if (row.result.status === 'failed' || row.result.status === 'inconclusive') {
        const key = row.result.failureCategory || row.scenarioCategory || 'uncategorized';
        failureCounts.set(key, (failureCounts.get(key) || 0) + 1);
      }
    }
    const failureDistribution = Array.from(failureCounts.entries()).map(([category, count]) => ({
      category,
      count,
    }));

    // Agent performance comparison
    const agentComparison = userAgents.map((ag) => {
      const agRuns = userRuns.filter((r) => r.agentId === ag.id && r.status === 'completed');
      const latestRun = agRuns[0];
      const agResults = allResults.filter((r) =>
        agRuns.some((ar) => ar.id === r.result.runId)
      );
      const agPassed = agResults.filter((r) => r.result.status === 'passed').length;
      const agTotal = agResults.length;
      return {
        agentId: ag.id,
        name: ag.name,
        isControlledSample: ag.isControlledSample,
        runsCount: agRuns.length,
        successRate: agTotal > 0 ? Math.round((agPassed / agTotal) * 100) : null,
        reliabilityScore: latestRun?.reliabilityScore ?? null,
        avgLatencyMs: latestRun?.avgLatencyMs ? Math.round(latestRun.avgLatencyMs) : null,
      };
    });

    // Security evaluation breakdown
    const securityBreakdown = [
      { status: 'Passed', count: redTeamResults.filter((r) => r.result.status === 'passed').length },
      { status: 'Failed', count: redTeamResults.filter((r) => r.result.status === 'failed').length },
      {
        status: 'Inconclusive',
        count: redTeamResults.filter((r) => r.result.status === 'inconclusive').length,
      },
      {
        status: 'Not Supported',
        count: redTeamResults.filter((r) => r.result.status === 'not_supported').length,
      },
    ];

    // Latency distribution buckets
    const latencyBuckets = [
      { bucket: '<200ms', count: latencies.filter((l) => l < 200).length },
      { bucket: '200-500ms', count: latencies.filter((l) => l >= 200 && l < 500).length },
      { bucket: '500ms-1.5s', count: latencies.filter((l) => l >= 500 && l < 1500).length },
      { bucket: '1.5s-4s', count: latencies.filter((l) => l >= 1500 && l < 4000).length },
      { bucket: '>4s', count: latencies.filter((l) => l >= 4000).length },
    ];

    res.json({
      kpis: {
        registeredAgents: userAgents.length,
        totalRuns,
        passedTests,
        failedTests,
        inconclusiveTests,
        totalTests,
        avgSuccessRate,
        toolMisuseIncidents,
        promptInjectionResistance,
        avgLatencyMs,
        p50LatencyMs: latencyStats.p50,
        p95LatencyMs: latencyStats.p95,
        p99LatencyMs: latencyStats.p99,
        passCaretK,
        avgTokens,
      },
      charts: {
        successOverTime,
        failureDistribution,
        agentComparison,
        securityBreakdown,
        latencyBuckets,
      },
    });
  } catch (err) {
    console.error('Overview endpoint failed:', err);
    res.status(500).json({ error: 'Failed to compute overview analytics.' });
  }
});

// ---------- AGENTS ----------
apiRouter.get('/agents', async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.userId, req.dbUser!.id))
      .orderBy(desc(agents.createdAt));

    res.json(rows.map(sanitizeAgent));
  } catch (err) {
    console.error('List agents failed:', err);
    res.status(500).json({ error: 'Failed to fetch registered agents.' });
  }
});

apiRouter.post('/agents/deploy-samples', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const existing = await db
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), eq(agents.isControlledSample, true)));

    const existingProfiles = new Set(existing.map((a) => a.sampleProfile));
    const created: Array<ReturnType<typeof sanitizeAgent>> = [];

    for (const bp of SAMPLE_AGENT_BLUEPRINTS) {
      if (existingProfiles.has(bp.profile)) continue;
      const [row] = await db
        .insert(agents)
        .values({
          userId,
          name: bp.name,
          description: bp.description,
          endpoint: `/api/sample-agents/${bp.profile}`,
          httpMethod: 'POST',
          authType: 'none',
          requestTemplate: {
            task: '{{task}}',
            context: '{{context}}',
            allowed_tools: '{{allowed_tools}}',
          },
          responseMapping: {
            status: 'status',
            answer: 'answer',
            tool_calls: 'tool_calls',
            tokens: 'metadata.tokens',
            metadata: 'metadata',
          },
          timeoutMs: 4000,
          allowedTools: bp.allowedTools,
          modelInfo: bp.modelInfo,
          customHeaders: {},
          isControlledSample: true,
          sampleProfile: bp.profile,
          status: 'enabled',
          lastConnectionStatus: 'untested',
        })
        .returning();
      created.push(sanitizeAgent(row));
    }

    const allSamples = await db
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), eq(agents.isControlledSample, true)));

    res.status(201).json({
      deployedCount: created.length,
      agents: allSamples.map(sanitizeAgent),
    });
  } catch (err) {
    console.error('Deploy samples failed:', err);
    res.status(500).json({ error: 'Failed to deploy controlled sample agents.' });
  }
});

apiRouter.post('/agents', async (req: AuthRequest, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const endpoint = String(body.endpoint || '').trim();
    const description = String(body.description || '').trim();
    const httpMethod = String(body.httpMethod || 'POST').toUpperCase();
    const authType = String(body.authType || 'none');
    const credentialValue = typeof body.credentialValue === 'string' ? body.credentialValue : '';
    const timeoutMs = Number(body.timeoutMs || 10000);
    const allowedTools = Array.isArray(body.allowedTools)
      ? body.allowedTools.map(String).filter(Boolean)
      : [];
    const customHeaders =
      body.customHeaders && typeof body.customHeaders === 'object'
        ? (body.customHeaders as Record<string, string>)
        : {};
    const requestTemplate =
      body.requestTemplate && typeof body.requestTemplate === 'object'
        ? (body.requestTemplate as Record<string, unknown>)
        : { task: '{{task}}', context: '{{context}}', allowed_tools: '{{allowed_tools}}' };
    const responseMapping =
      body.responseMapping && typeof body.responseMapping === 'object'
        ? (body.responseMapping as Record<string, string>)
        : {
            status: 'status',
            answer: 'answer',
            tool_calls: 'tool_calls',
            tokens: 'metadata.tokens',
            metadata: 'metadata',
          };
    const modelInfo =
      body.modelInfo && typeof body.modelInfo === 'object'
        ? (body.modelInfo as Record<string, unknown>)
        : {};

    if (!name || name.length < 2) {
      res.status(400).json({ error: 'Agent name is required (min 2 characters).' });
      return;
    }

    const ssrfCheck = await validateTargetUrl(endpoint, { isControlledSample: false });
    if (!ssrfCheck.allowed) {
      res.status(400).json({ error: ssrfCheck.reason || 'Endpoint failed URL/SSRF validation.' });
      return;
    }

    let credentialRef: string | null = null;
    let credentialHint: string | null = null;
    if (authType !== 'none' && credentialValue.trim()) {
      const enc = encryptCredential(credentialValue.trim());
      credentialRef = enc.encrypted;
      credentialHint = enc.hint;
    }

    const [created] = await db
      .insert(agents)
      .values({
        userId: req.dbUser!.id,
        name,
        description,
        endpoint,
        httpMethod: httpMethod === 'GET' ? 'GET' : 'POST',
        authType,
        credentialRef,
        credentialHint,
        requestTemplate,
        responseMapping,
        timeoutMs: Math.min(Math.max(timeoutMs, 1000), 60000),
        allowedTools,
        modelInfo,
        customHeaders,
        isControlledSample: false,
        sampleProfile: null,
        status: 'enabled',
        lastConnectionStatus: 'untested',
      })
      .returning();

    res.status(201).json(sanitizeAgent(created));
  } catch (err) {
    console.error('Register agent failed:', err);
    res.status(500).json({ error: 'Failed to register agent.' });
  }
});

apiRouter.get('/agents/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid agent ID.' });
      return;
    }
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, req.dbUser!.id)));

    if (!agent) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }

    const runs = await db
      .select()
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.agentId, id), eq(evaluationRuns.userId, req.dbUser!.id)))
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(20);

    res.json({ agent: sanitizeAgent(agent), runs });
  } catch (err) {
    console.error('Get agent failed:', err);
    res.status(500).json({ error: 'Failed to load agent details.' });
  }
});

apiRouter.put('/agents/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid agent ID.' });
      return;
    }
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, req.dbUser!.id)));

    if (!existing) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : existing.endpoint;

    if (!existing.isControlledSample) {
      const ssrf = await validateTargetUrl(endpoint, { isControlledSample: false });
      if (!ssrf.allowed) {
        res.status(400).json({ error: ssrf.reason || 'Endpoint failed SSRF validation.' });
        return;
      }
    }

    let credentialRef = existing.credentialRef;
    let credentialHint = existing.credentialHint;
    const authType = typeof body.authType === 'string' ? body.authType : existing.authType;
    if (authType === 'none') {
      credentialRef = null;
      credentialHint = null;
    } else if (typeof body.credentialValue === 'string' && body.credentialValue.trim()) {
      const enc = encryptCredential(body.credentialValue.trim());
      credentialRef = enc.encrypted;
      credentialHint = enc.hint;
    }

    const [updated] = await db
      .update(agents)
      .set({
        name: typeof body.name === 'string' ? body.name.trim() : existing.name,
        description:
          typeof body.description === 'string' ? body.description.trim() : existing.description,
        endpoint: existing.isControlledSample ? existing.endpoint : endpoint,
        httpMethod:
          typeof body.httpMethod === 'string' ? body.httpMethod.toUpperCase() : existing.httpMethod,
        authType,
        credentialRef,
        credentialHint,
        timeoutMs:
          typeof body.timeoutMs === 'number'
            ? Math.min(Math.max(body.timeoutMs, 1000), 60000)
            : existing.timeoutMs,
        allowedTools: Array.isArray(body.allowedTools)
          ? body.allowedTools.map(String)
          : existing.allowedTools,
        requestTemplate:
          body.requestTemplate && typeof body.requestTemplate === 'object'
            ? (body.requestTemplate as Record<string, unknown>)
            : existing.requestTemplate,
        responseMapping:
          body.responseMapping && typeof body.responseMapping === 'object'
            ? (body.responseMapping as Record<string, string>)
            : existing.responseMapping,
        modelInfo:
          body.modelInfo && typeof body.modelInfo === 'object'
            ? (body.modelInfo as Record<string, unknown>)
            : existing.modelInfo,
        customHeaders:
          body.customHeaders && typeof body.customHeaders === 'object'
            ? (body.customHeaders as Record<string, string>)
            : existing.customHeaders,
        status: typeof body.status === 'string' ? body.status : existing.status,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), eq(agents.userId, req.dbUser!.id)))
      .returning();

    res.json(sanitizeAgent(updated));
  } catch (err) {
    console.error('Update agent failed:', err);
    res.status(500).json({ error: 'Failed to update agent configuration.' });
  }
});

apiRouter.delete('/agents/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid agent ID.' });
      return;
    }
    const deleted = await db
      .delete(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, req.dbUser!.id)))
      .returning();

    if (!deleted.length) {
      res.status(404).json({ error: 'Agent not found.' });
      return;
    }

    res.json({ deleted: true, id });
  } catch (err) {
    console.error('Delete agent failed:', err);
    res.status(500).json({ error: 'Failed to delete agent.' });
  }
});

apiRouter.post(
  '/agents/:id/test-connection',
  rateLimit({ windowMs: 60000, maxRequests: 20, keyPrefix: 'ping' }),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid agent ID.' });
        return;
      }
      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.userId, req.dbUser!.id)));

      if (!agent) {
        res.status(404).json({ error: 'Agent not found.' });
        return;
      }

      const result = await invokeAgentHttpAdapter(
        {
          id: agent.id,
          name: agent.name,
          endpoint: agent.endpoint,
          httpMethod: agent.httpMethod,
          authType: agent.authType,
          credentialRef: agent.credentialRef,
          requestTemplate: agent.requestTemplate,
          responseMapping: agent.responseMapping,
          timeoutMs: agent.timeoutMs,
          allowedTools: agent.allowedTools,
          customHeaders: agent.customHeaders,
          isControlledSample: agent.isControlledSample,
          sampleProfile: agent.sampleProfile,
        },
        { task: '__ping__', context: { probe: 'connection_test' }, overrideTimeoutMs: 8000 }
      );

      await db
        .update(agents)
        .set({
          lastTestedAt: new Date(),
          lastConnectionStatus: result.ok ? 'connected' : 'failed',
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));

      res.json({
        connected: result.ok,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        answerPreview: result.answer.slice(0, 300),
        toolCallsTelemetryAvailable: result.toolCallsTelemetryAvailable,
        tokensTelemetryAvailable: result.tokensTelemetryAvailable,
        error: result.error || null,
      });
    } catch (err) {
      console.error('Connection test failed:', err);
      res.status(500).json({ error: 'Connection probe encountered an internal error.' });
    }
  }
);

// ---------- SCENARIOS & SUITES ----------
apiRouter.get('/suites', async (req: AuthRequest, res) => {
  try {
    await ensureSystemSuitesSeeded();
    const suites = await db
      .select()
      .from(testSuites)
      .where(or(isNull(testSuites.userId), eq(testSuites.userId, req.dbUser!.id)))
      .orderBy(testSuites.id);

    const suiteIds = suites.map((s) => s.id);
    const scenarios =
      suiteIds.length > 0
        ? await db.select().from(testScenarios).where(inArray(testScenarios.suiteId, suiteIds))
        : [];

    const payload = suites.map((s) => ({
      ...s,
      scenarioCount: scenarios.filter((sc) => sc.suiteId === s.id && sc.isActive).length,
      scenarios: scenarios.filter((sc) => sc.suiteId === s.id),
    }));

    res.json(payload);
  } catch (err) {
    console.error('Fetch suites failed:', err);
    res.status(500).json({ error: 'Failed to load test suites.' });
  }
});

apiRouter.post('/suites', async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || 'custom').trim();
    if (!name) {
      res.status(400).json({ error: 'Suite name is required.' });
      return;
    }
    const [created] = await db
      .insert(testSuites)
      .values({
        userId: req.dbUser!.id,
        name,
        description,
        category,
        isSystem: false,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    console.error('Create suite failed:', err);
    res.status(500).json({ error: 'Failed to create test suite.' });
  }
});

apiRouter.get('/scenarios', async (req: AuthRequest, res) => {
  try {
    await ensureSystemSuitesSeeded();
    const categoryFilter = typeof req.query.category === 'string' ? req.query.category : null;
    const suiteFilter = req.query.suiteId ? Number(req.query.suiteId) : null;

    const suites = await db
      .select()
      .from(testSuites)
      .where(or(isNull(testSuites.userId), eq(testSuites.userId, req.dbUser!.id)));
    const suiteIds = suites.map((s) => s.id);
    if (!suiteIds.length) {
      res.json([]);
      return;
    }

    let scenarios = await db
      .select()
      .from(testScenarios)
      .where(inArray(testScenarios.suiteId, suiteIds))
      .orderBy(testScenarios.id);

    if (categoryFilter && categoryFilter !== 'all') {
      scenarios = scenarios.filter((s) => s.category === categoryFilter);
    }
    if (suiteFilter) {
      scenarios = scenarios.filter((s) => s.suiteId === suiteFilter);
    }

    res.json(scenarios);
  } catch (err) {
    console.error('Fetch scenarios failed:', err);
    res.status(500).json({ error: 'Failed to load test scenarios.' });
  }
});

apiRouter.post('/scenarios', async (req: AuthRequest, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const suiteId = Number(b.suiteId);
    const name = String(b.name || '').trim();
    const category = String(b.category || 'task_completion').trim();
    const input = String(b.input || '').trim();
    const expectedBehavior = String(b.expectedBehavior || '').trim();

    if (!suiteId || !name || !input || !expectedBehavior) {
      res.status(400).json({ error: 'suiteId, name, input, and expectedBehavior are required.' });
      return;
    }

    const [created] = await db
      .insert(testScenarios)
      .values({
        suiteId,
        scenarioCode: String(b.scenarioCode || `SCN-CUST-${Date.now().toString().slice(-4)}`),
        name,
        category,
        description: String(b.description || ''),
        input,
        context:
          b.context && typeof b.context === 'object'
            ? (b.context as Record<string, unknown>)
            : {},
        expectedBehavior,
        referenceAnswer: typeof b.referenceAnswer === 'string' ? b.referenceAnswer : null,
        expectedTools: Array.isArray(b.expectedTools) ? b.expectedTools.map(String) : [],
        forbiddenTools: Array.isArray(b.forbiddenTools) ? b.forbiddenTools.map(String) : [],
        severity: String(b.severity || 'medium'),
        evaluationMethod: String(b.evaluationMethod || 'hybrid'),
        version: 1,
        isActive: true,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    console.error('Create scenario failed:', err);
    res.status(500).json({ error: 'Failed to create scenario.' });
  }
});

apiRouter.put('/scenarios/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(testScenarios).where(eq(testScenarios.id, id));
    if (!existing) {
      res.status(404).json({ error: 'Scenario not found.' });
      return;
    }
    const b = req.body as Record<string, unknown>;
    const [updated] = await db
      .update(testScenarios)
      .set({
        name: typeof b.name === 'string' ? b.name.trim() : existing.name,
        category: typeof b.category === 'string' ? b.category : existing.category,
        description: typeof b.description === 'string' ? b.description : existing.description,
        input: typeof b.input === 'string' ? b.input : existing.input,
        context:
          b.context && typeof b.context === 'object'
            ? (b.context as Record<string, unknown>)
            : existing.context,
        expectedBehavior:
          typeof b.expectedBehavior === 'string' ? b.expectedBehavior : existing.expectedBehavior,
        referenceAnswer:
          typeof b.referenceAnswer === 'string' ? b.referenceAnswer : existing.referenceAnswer,
        expectedTools: Array.isArray(b.expectedTools)
          ? b.expectedTools.map(String)
          : existing.expectedTools,
        forbiddenTools: Array.isArray(b.forbiddenTools)
          ? b.forbiddenTools.map(String)
          : existing.forbiddenTools,
        severity: typeof b.severity === 'string' ? b.severity : existing.severity,
        evaluationMethod:
          typeof b.evaluationMethod === 'string' ? b.evaluationMethod : existing.evaluationMethod,
        version: existing.version + 1,
      })
      .where(eq(testScenarios.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error('Update scenario failed:', err);
    res.status(500).json({ error: 'Failed to update scenario.' });
  }
});

apiRouter.post('/scenarios/:id/clone', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(testScenarios).where(eq(testScenarios.id, id));
    if (!existing) {
      res.status(404).json({ error: 'Scenario not found.' });
      return;
    }
    const [cloned] = await db
      .insert(testScenarios)
      .values({
        suiteId: existing.suiteId,
        scenarioCode: `${existing.scenarioCode}-CLONE`,
        name: `${existing.name} (Clone)`,
        category: existing.category,
        description: existing.description,
        input: existing.input,
        context: existing.context,
        expectedBehavior: existing.expectedBehavior,
        referenceAnswer: existing.referenceAnswer,
        expectedTools: existing.expectedTools,
        forbiddenTools: existing.forbiddenTools,
        severity: existing.severity,
        evaluationMethod: existing.evaluationMethod,
        version: 1,
        isActive: true,
      })
      .returning();
    res.status(201).json(cloned);
  } catch (err) {
    console.error('Clone scenario failed:', err);
    res.status(500).json({ error: 'Failed to clone scenario.' });
  }
});

// ---------- EVALUATIONS ----------
apiRouter.post(
  '/evaluations/run',
  rateLimit({ windowMs: 60000, maxRequests: 15, keyPrefix: 'eval' }),
  async (req: AuthRequest, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      const agentId = Number(b.agentId);
      const suiteId = Number(b.suiteId);
      const trialsPerScenario = Math.min(Math.max(Number(b.trials || 1), 1), 5);
      const runType = String(b.runType || 'standard');
      const scenarioIds = Array.isArray(b.scenarioIds) ? b.scenarioIds.map(Number) : undefined;

      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, req.dbUser!.id)));
      if (!agent) {
        res.status(404).json({ error: 'Selected agent not found.' });
        return;
      }
      if (agent.status !== 'enabled') {
        res.status(400).json({ error: 'Agent is currently disabled. Enable it before evaluating.' });
        return;
      }

      const [suite] = await db.select().from(testSuites).where(eq(testSuites.id, suiteId));
      if (!suite) {
        res.status(404).json({ error: 'Selected test suite not found.' });
        return;
      }

      const limitsConfig: ExecutionLimitsConfig = {
        ...DEFAULT_EXECUTION_LIMITS,
        ...(b.limits && typeof b.limits === 'object' ? (b.limits as Partial<ExecutionLimitsConfig>) : {}),
      };
      const weightsConfig: ReliabilityWeights = {
        ...DEFAULT_RELIABILITY_WEIGHTS,
        ...(b.weights && typeof b.weights === 'object' ? (b.weights as Partial<ReliabilityWeights>) : {}),
      };

      const [run] = await db
        .insert(evaluationRuns)
        .values({
          userId: req.dbUser!.id,
          agentId: agent.id,
          suiteId: suite.id,
          runType,
          status: 'queued',
          trialsPerScenario,
          limitsConfig,
          weightsConfig,
        })
        .returning();

      // Execute asynchronously in background worker queue
      setImmediate(() => {
        void executeEvaluationRunAsync(run.id, scenarioIds);
      });

      res.status(202).json(run);
    } catch (err) {
      console.error('Start evaluation failed:', err);
      res.status(500).json({ error: 'Failed to launch evaluation run.' });
    }
  }
);

apiRouter.get('/evaluations', async (req: AuthRequest, res) => {
  try {
    const runs = await db
      .select({
        run: evaluationRuns,
        agentName: agents.name,
        suiteName: testSuites.name,
        isControlledSample: agents.isControlledSample,
      })
      .from(evaluationRuns)
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .innerJoin(testSuites, eq(evaluationRuns.suiteId, testSuites.id))
      .where(eq(evaluationRuns.userId, req.dbUser!.id))
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(50);

    res.json(
      runs.map((r) => ({
        ...r.run,
        agentName: r.agentName,
        suiteName: r.suiteName,
        isControlledSample: r.isControlledSample,
      }))
    );
  } catch (err) {
    console.error('List evaluations failed:', err);
    res.status(500).json({ error: 'Failed to load evaluation runs.' });
  }
});

apiRouter.get('/evaluations/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db
      .select({
        run: evaluationRuns,
        agentName: agents.name,
        suiteName: testSuites.name,
      })
      .from(evaluationRuns)
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .innerJoin(testSuites, eq(evaluationRuns.suiteId, testSuites.id))
      .where(and(eq(evaluationRuns.id, id), eq(evaluationRuns.userId, req.dbUser!.id)));

    if (!row) {
      res.status(404).json({ error: 'Evaluation run not found.' });
      return;
    }

    res.json({ ...row.run, agentName: row.agentName, suiteName: row.suiteName });
  } catch (err) {
    console.error('Get evaluation failed:', err);
    res.status(500).json({ error: 'Failed to fetch evaluation run.' });
  }
});

apiRouter.get('/evaluations/:id/results', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [run] = await db
      .select()
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.id, id), eq(evaluationRuns.userId, req.dbUser!.id)));

    if (!run) {
      res.status(404).json({ error: 'Evaluation run not found.' });
      return;
    }

    const rows = await db
      .select({
        result: testResults,
        scenario: testScenarios,
      })
      .from(testResults)
      .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
      .where(eq(testResults.runId, id))
      .orderBy(testResults.id);

    res.json(
      rows.map((r) => ({
        ...r.result,
        scenarioCode: r.scenario.scenarioCode,
        scenarioName: r.scenario.name,
        category: r.scenario.category,
        description: r.scenario.description,
        input: r.scenario.input,
        expectedBehavior: r.scenario.expectedBehavior,
        severity: r.scenario.severity,
        evaluationMethod: r.scenario.evaluationMethod,
      }))
    );
  } catch (err) {
    console.error('Get evaluation results failed:', err);
    res.status(500).json({ error: 'Failed to load evaluation test results.' });
  }
});

apiRouter.get('/evaluations/:id/stream', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const [run] = await db
    .select()
    .from(evaluationRuns)
    .where(and(eq(evaluationRuns.id, id), eq(evaluationRuns.userId, req.dbUser!.id)));

  if (!run) {
    res.status(404).json({ error: 'Evaluation run not found.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({
    status: run.status,
    completedTests: run.completedTests,
    totalTests: run.totalTests,
    passedCount: run.passedCount,
    failedCount: run.failedCount,
    inconclusiveCount: run.inconclusiveCount,
  });

  if (run.status === 'completed' || run.status === 'failed') {
    res.end();
    return;
  }

  const listener = (payload: Record<string, unknown>) => {
    send(payload);
    if (payload.status === 'completed' || payload.status === 'failed') {
      evaluationEventBus.off(`run:${id}`, listener);
      res.end();
    }
  };

  evaluationEventBus.on(`run:${id}`, listener);
  req.on('close', () => {
    evaluationEventBus.off(`run:${id}`, listener);
  });
});

// ---------- TRACES ----------
apiRouter.get('/traces', async (req: AuthRequest, res) => {
  try {
    const userRuns = await db
      .select({ id: evaluationRuns.id, agentId: evaluationRuns.agentId })
      .from(evaluationRuns)
      .where(eq(evaluationRuns.userId, req.dbUser!.id));

    if (!userRuns.length) {
      res.json([]);
      return;
    }

    const runIds = userRuns.map((r) => r.id);
    const results = await db
      .select({
        executionId: testResults.executionId,
        runId: testResults.runId,
        status: testResults.status,
        failureCertainty: testResults.failureCertainty,
        failureCategory: testResults.failureCategory,
        latencyMs: testResults.latencyMs,
        createdAt: testResults.createdAt,
        scenarioName: testScenarios.name,
        scenarioCode: testScenarios.scenarioCode,
        category: testScenarios.category,
        agentName: agents.name,
      })
      .from(testResults)
      .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
      .innerJoin(evaluationRuns, eq(testResults.runId, evaluationRuns.id))
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .where(inArray(testResults.runId, runIds))
      .orderBy(desc(testResults.createdAt))
      .limit(60);

    res.json(results);
  } catch (err) {
    console.error('List traces failed:', err);
    res.status(500).json({ error: 'Failed to load execution traces.' });
  }
});

apiRouter.get('/traces/:executionId', async (req: AuthRequest, res) => {
  try {
    const executionId = req.params.executionId;
    const [resultRow] = await db
      .select({
        result: testResults,
        scenario: testScenarios,
        run: evaluationRuns,
        agentName: agents.name,
        modelInfo: agents.modelInfo,
      })
      .from(testResults)
      .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
      .innerJoin(evaluationRuns, eq(testResults.runId, evaluationRuns.id))
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .where(
        and(
          eq(testResults.executionId, executionId),
          eq(evaluationRuns.userId, req.dbUser!.id)
        )
      );

    if (!resultRow) {
      res.status(404).json({ error: 'Execution trace not found.' });
      return;
    }

    const steps = await db
      .select()
      .from(executionTraces)
      .where(eq(executionTraces.executionId, executionId))
      .orderBy(executionTraces.stepIndex);

    res.json({
      executionId,
      agentName: resultRow.agentName,
      modelInfo: resultRow.modelInfo,
      scenario: resultRow.scenario,
      result: resultRow.result,
      steps,
    });
  } catch (err) {
    console.error('Get trace failed:', err);
    res.status(500).json({ error: 'Failed to load trace timeline.' });
  }
});

// ---------- REPORTS & EXPORT ----------
apiRouter.get('/reports/:runId', async (req: AuthRequest, res) => {
  try {
    const runId = Number(req.params.runId);
    const [runRow] = await db
      .select({
        run: evaluationRuns,
        agent: agents,
        suite: testSuites,
      })
      .from(evaluationRuns)
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .innerJoin(testSuites, eq(evaluationRuns.suiteId, testSuites.id))
      .where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.userId, req.dbUser!.id)));

    if (!runRow) {
      res.status(404).json({ error: 'Evaluation report not found.' });
      return;
    }

    const results = await db
      .select({
        result: testResults,
        scenario: testScenarios,
      })
      .from(testResults)
      .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
      .where(eq(testResults.runId, runId))
      .orderBy(testResults.id);

    const customWeights: ReliabilityWeights = {
      taskCompletion:
        req.query.wTask !== undefined
          ? Number(req.query.wTask)
          : runRow.run.weightsConfig.taskCompletion,
      toolCorrectness:
        req.query.wTool !== undefined
          ? Number(req.query.wTool)
          : runRow.run.weightsConfig.toolCorrectness,
      groundedness:
        req.query.wGround !== undefined
          ? Number(req.query.wGround)
          : runRow.run.weightsConfig.groundedness,
      security:
        req.query.wSec !== undefined
          ? Number(req.query.wSec)
          : runRow.run.weightsConfig.security,
      efficiency:
        req.query.wEff !== undefined
          ? Number(req.query.wEff)
          : runRow.run.weightsConfig.efficiency,
    };

    const scorable: ScorableResult[] = results.map((r) => ({
      category: r.scenario.category,
      status: r.result.status as ScorableResult['status'],
      score: r.result.score,
      latencyMs: r.result.latencyMs,
    }));

    const reliability = calculateReliabilityScore(
      scorable,
      customWeights,
      runRow.run.limitsConfig.maxDurationMs
    );
    const latencyStats = calculateLatencyPercentiles(
      results.map((r) => r.result.latencyMs)
    );
    const consistency = calculatePassMetrics(
      results.map((r) => ({ scenarioId: r.result.scenarioId, status: r.result.status })),
      runRow.run.trialsPerScenario
    );

    res.json({
      run: runRow.run,
      agent: sanitizeAgent(runRow.agent),
      suite: runRow.suite,
      reliability,
      latencyStats,
      consistency,
      results: results.map((r) => ({
        ...r.result,
        scenarioCode: r.scenario.scenarioCode,
        scenarioName: r.scenario.name,
        category: r.scenario.category,
        expectedBehavior: r.scenario.expectedBehavior,
        severity: r.scenario.severity,
      })),
    });
  } catch (err) {
    console.error('Report generation failed:', err);
    res.status(500).json({ error: 'Failed to generate reliability report.' });
  }
});

apiRouter.get('/reports/:runId/export', async (req: AuthRequest, res) => {
  try {
    const runId = Number(req.params.runId);
    const format = String(req.query.format || 'json').toLowerCase();

    const [runRow] = await db
      .select({
        run: evaluationRuns,
        agent: agents,
        suite: testSuites,
      })
      .from(evaluationRuns)
      .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
      .innerJoin(testSuites, eq(evaluationRuns.suiteId, testSuites.id))
      .where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.userId, req.dbUser!.id)));

    if (!runRow) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const results = await db
      .select({ result: testResults, scenario: testScenarios })
      .from(testResults)
      .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
      .where(eq(testResults.runId, runId));

    const scorable: ScorableResult[] = results.map((r) => ({
      category: r.scenario.category,
      status: r.result.status as ScorableResult['status'],
      score: r.result.score,
      latencyMs: r.result.latencyMs,
    }));

    const reliability = calculateReliabilityScore(
      scorable,
      runRow.run.weightsConfig,
      runRow.run.limitsConfig.maxDurationMs
    );
    const latencyStats = calculateLatencyPercentiles(
      results.map((r) => r.result.latencyMs)
    );
    const consistency = calculatePassMetrics(
      results.map((r) => ({ scenarioId: r.result.scenarioId, status: r.result.status })),
      runRow.run.trialsPerScenario
    );

    if (format === 'markdown') {
      const lines = [
        `# Audit-My-Agent Reliability Report (Run #${runRow.run.id})`,
        ``,
        `- **Agent:** ${runRow.agent.name}`,
        `- **Suite:** ${runRow.suite.name}`,
        `- **Status:** ${runRow.run.status}`,
        `- **Overall Reliability Score:** ${reliability.overallScore ?? 'Unavailable'} / 100`,
        `- **Consistency:** pass@${consistency.trialsPerScenario} = ${consistency.passAtK ?? 'N/A'}% · pass^${consistency.trialsPerScenario} = ${consistency.passCaretK ?? 'N/A'}% (${consistency.consistentScenarioCount}/${consistency.evaluatedScenarioCount} scenarios)`,
        `- **Latency Percentiles:** p50 = ${latencyStats.p50 ?? 'N/A'}ms · p95 = ${latencyStats.p95 ?? 'N/A'}ms · p99 = ${latencyStats.p99 ?? 'N/A'}ms`,
        `- **Started:** ${runRow.run.startedAt.toISOString()}`,
        ``,
        `## Component Breakdown`,
        ``,
        `| Component | Score | Weight (Effective) | Cases (Pass / Fail / Inc) |`,
        `| --- | --- | --- | --- |`,
        ...reliability.components.map(
          (c) =>
            `| ${c.label} | ${c.score !== null ? c.score : 'Unavailable'} | ${(c.effectiveWeight * 100).toFixed(0)}% | ${c.passedCases} / ${c.failedCases} / ${c.inconclusiveCases} |`
        ),
        ``,
        `> ${reliability.normalizationPolicy}`,
        `> ${reliability.securityDisclaimer}`,
        ``,
        `## Test Case Results`,
        ``,
        ...results.map(
          (r) =>
            `### ${r.scenario.scenarioCode} — ${r.scenario.name} (Trial ${r.result.trialIndex})\n- **Status:** ${r.result.status} (${r.result.failureCertainty})\n- **Score:** ${r.result.score}/100 · **Latency:** ${r.result.latencyMs}ms\n- **Failure Category:** ${r.result.failureCategory || 'None'}\n- **Output:** ${r.result.actualOutput.slice(0, 400)}\n- **Remediation:** ${r.result.remediation || 'N/A'}\n`
        ),
      ];
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-report-run-${runRow.run.id}.md"`
      );
      res.send(lines.join('\n'));
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-report-run-${runRow.run.id}.json"`
    );
    res.json({
      generatedAt: new Date().toISOString(),
      run: runRow.run,
      agent: sanitizeAgent(runRow.agent),
      suite: runRow.suite,
      reliability,
      latencyStats,
      consistency,
      results: results.map((r) => ({ ...r.result, scenario: r.scenario })),
    });
  } catch (err) {
    console.error('Export report failed:', err);
    res.status(500).json({ error: 'Failed to export audit report.' });
  }
});

// ---------- BENCHMARKS ----------
apiRouter.post(
  '/benchmarks/compare',
  rateLimit({ windowMs: 60000, maxRequests: 10, keyPrefix: 'bench' }),
  async (req: AuthRequest, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      const name = String(b.name || `Benchmark ${new Date().toISOString().slice(0, 16)}`).trim();
      const suiteId = Number(b.suiteId);
      const trials = Math.min(Math.max(Number(b.trials || 2), 1), 5);
      const agentIds = Array.isArray(b.agentIds) ? b.agentIds.map(Number) : [];

      if (agentIds.length < 2) {
        res.status(400).json({ error: 'Select at least 2 agents to run a comparison benchmark.' });
        return;
      }

      const selectedAgents = await db
        .select()
        .from(agents)
        .where(and(eq(agents.userId, req.dbUser!.id), inArray(agents.id, agentIds)));

      if (selectedAgents.length < 2) {
        res.status(404).json({ error: 'One or more selected agents were not found.' });
        return;
      }

      const runIds: number[] = [];
      for (const ag of selectedAgents) {
        const [run] = await db
          .insert(evaluationRuns)
          .values({
            userId: req.dbUser!.id,
            agentId: ag.id,
            suiteId,
            runType: 'benchmark',
            status: 'queued',
            trialsPerScenario: trials,
            limitsConfig: DEFAULT_EXECUTION_LIMITS,
            weightsConfig: DEFAULT_RELIABILITY_WEIGHTS,
          })
          .returning();
        runIds.push(run.id);
      }

      const [comparison] = await db
        .insert(benchmarkComparisons)
        .values({
          userId: req.dbUser!.id,
          name,
          suiteId,
          trials,
          agentIds: selectedAgents.map((a) => a.id),
          runIds,
          status: 'running',
        })
        .returning();

      setImmediate(() => {
        void executeBenchmarkComparisonAsync(comparison.id);
      });

      res.status(202).json(comparison);
    } catch (err) {
      console.error('Benchmark compare failed:', err);
      res.status(500).json({ error: 'Failed to launch benchmark comparison.' });
    }
  }
);

apiRouter.get('/benchmarks', async (req: AuthRequest, res) => {
  try {
    const comparisons = await db
      .select()
      .from(benchmarkComparisons)
      .where(eq(benchmarkComparisons.userId, req.dbUser!.id))
      .orderBy(desc(benchmarkComparisons.createdAt))
      .limit(20);

    const detailed = [];
    for (const cmp of comparisons) {
      const runs =
        cmp.runIds.length > 0
          ? await db
              .select({
                run: evaluationRuns,
                agent: agents,
              })
              .from(evaluationRuns)
              .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
              .where(inArray(evaluationRuns.id, cmp.runIds))
          : [];

      const runIds = runs.map((r) => r.run.id);
      const metrics =
        runIds.length > 0
          ? await db
              .select()
              .from(benchmarkResults)
              .where(inArray(benchmarkResults.runId, runIds))
          : [];

      const resultsByRun =
        runIds.length > 0
          ? await db
              .select({ result: testResults, scenario: testScenarios })
              .from(testResults)
              .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
              .where(inArray(testResults.runId, runIds))
          : [];

      detailed.push({
        ...cmp,
        agents: runs.map((r) => {
          const rMetrics = metrics.filter((m) => m.runId === r.run.id);
          const rTests = resultsByRun.filter((t) => t.result.runId === r.run.id);
          const passed = rTests.filter((t) => t.result.status === 'passed').length;
          const total = rTests.length;
          const scores = rTests.map((t) => t.result.score);
          const mean =
            scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
          const variance =
            scores.length > 1
              ? scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length
              : 0;
          const scoreStdDev = Math.round(Math.sqrt(variance) * 10) / 10;

          const costPer1k = r.agent.modelInfo?.costPer1kTokensUsd;
          const avgTok = r.run.avgTokens;
          const estCostPerSuccess =
            typeof costPer1k === 'number' && typeof avgTok === 'number' && passed > 0
              ? Math.round(((avgTok * total) / 1000) * costPer1k * 10000 / passed) / 10000
              : null;

          const latStats = calculateLatencyPercentiles(
            rTests.map((t) => t.result.latencyMs)
          );
          const passMetrics = calculatePassMetrics(
            rTests.map((t) => ({ scenarioId: t.result.scenarioId, status: t.result.status })),
            r.run.trialsPerScenario
          );

          return {
            agentId: r.agent.id,
            agentName: r.agent.name,
            modelInfo: r.agent.modelInfo,
            runId: r.run.id,
            status: r.run.status,
            taskSuccessRate: total > 0 ? Math.round((passed / total) * 1000) / 10 : null,
            passCaretK: passMetrics.passCaretK,
            reliabilityScore: r.run.reliabilityScore,
            avgLatencyMs: r.run.avgLatencyMs,
            p95LatencyMs: latStats.p95,
            avgTokens: r.run.avgTokens,
            scoreStdDev,
            estCostPerSuccessUsd: estCostPerSuccess,
            componentScores: rMetrics.reduce<Record<string, number>>((acc, m) => {
              acc[m.metricName] = m.metricValue;
              return acc;
            }, {}),
          };
        }),
      });
    }

    res.json(detailed);
  } catch (err) {
    console.error('List benchmarks failed:', err);
    res.status(500).json({ error: 'Failed to load benchmark comparisons.' });
  }
});

// ---------- SETTINGS ----------
apiRouter.get('/settings', async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, req.dbUser!.id));

    if (!existing) {
      res.json({
        defaultLimits: DEFAULT_EXECUTION_LIMITS,
        defaultWeights: DEFAULT_RELIABILITY_WEIGHTS,
      });
      return;
    }

    res.json({
      defaultLimits: existing.defaultLimits,
      defaultWeights: existing.defaultWeights,
    });
  } catch (err) {
    console.error('Get settings failed:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

apiRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const b = req.body as {
      defaultLimits?: ExecutionLimitsConfig;
      defaultWeights?: ReliabilityWeights;
    };

    const limits = { ...DEFAULT_EXECUTION_LIMITS, ...(b.defaultLimits || {}) };
    const weights = { ...DEFAULT_RELIABILITY_WEIGHTS, ...(b.defaultWeights || {}) };

    const [saved] = await db
      .insert(userSettings)
      .values({
        userId: req.dbUser!.id,
        defaultLimits: limits,
        defaultWeights: weights,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          defaultLimits: limits,
          defaultWeights: weights,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json({
      defaultLimits: saved.defaultLimits,
      defaultWeights: saved.defaultWeights,
    });
  } catch (err) {
    console.error('Save settings failed:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// ---------- CI/CD PR GATE TOKENS (Firebase session only) ----------
apiRouter.get('/ci-tokens', requireFirebaseSession, async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: ciTokens.id,
        name: ciTokens.name,
        tokenPrefix: ciTokens.tokenPrefix,
        revokedAt: ciTokens.revokedAt,
        lastUsedAt: ciTokens.lastUsedAt,
        createdAt: ciTokens.createdAt,
      })
      .from(ciTokens)
      .where(eq(ciTokens.userId, req.dbUser!.id))
      .orderBy(desc(ciTokens.createdAt));

    res.json(rows);
  } catch (err) {
    console.error('List CI tokens failed:', err);
    res.status(500).json({ error: 'Failed to load CI tokens.' });
  }
});

apiRouter.post('/ci-tokens', requireFirebaseSession, async (req: AuthRequest, res) => {
  try {
    const b = req.body as { name?: string };
    const name = String(b.name || 'GitHub Actions PR Gate').trim().slice(0, 80);
    if (!name) {
      res.status(400).json({ error: 'Token name is required.' });
      return;
    }

    const { plaintext, tokenHash, tokenPrefix } = generateCiToken();
    const [created] = await db
      .insert(ciTokens)
      .values({
        userId: req.dbUser!.id,
        name,
        tokenHash,
        tokenPrefix,
      })
      .returning({
        id: ciTokens.id,
        name: ciTokens.name,
        tokenPrefix: ciTokens.tokenPrefix,
        revokedAt: ciTokens.revokedAt,
        lastUsedAt: ciTokens.lastUsedAt,
        createdAt: ciTokens.createdAt,
      });

    // Return plaintext token exactly once on minting; only SHA-256 hash is persisted
    res.status(201).json({
      ...created,
      token: plaintext,
    });
  } catch (err) {
    console.error('Create CI token failed:', err);
    res.status(500).json({ error: 'Failed to create CI token.' });
  }
});

apiRouter.delete('/ci-tokens/:id', requireFirebaseSession, async (req: AuthRequest, res) => {
  try {
    const tokenId = Number(req.params.id);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      res.status(400).json({ error: 'Invalid token ID.' });
      return;
    }

    const [revoked] = await db
      .update(ciTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(ciTokens.id, tokenId), eq(ciTokens.userId, req.dbUser!.id)))
      .returning({ id: ciTokens.id, revokedAt: ciTokens.revokedAt });

    if (!revoked) {
      res.status(404).json({ error: 'CI token not found.' });
      return;
    }

    res.json({ revoked: true, id: revoked.id, revokedAt: revoked.revokedAt });
  } catch (err) {
    console.error('Revoke CI token failed:', err);
    res.status(500).json({ error: 'Failed to revoke CI token.' });
  }
});

// ---------- CI/CD PR GATE EXECUTION & VERDICT ----------
async function buildRunGatePayload(runId: number, userId: number, policy?: Partial<CiGatePolicy>) {
  const [runRow] = await db
    .select({
      run: evaluationRuns,
      agent: agents,
      suite: testSuites,
    })
    .from(evaluationRuns)
    .innerJoin(agents, eq(evaluationRuns.agentId, agents.id))
    .innerJoin(testSuites, eq(evaluationRuns.suiteId, testSuites.id))
    .where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.userId, userId)));

  if (!runRow) return null;

  const results = await db
    .select({ result: testResults, scenario: testScenarios })
    .from(testResults)
    .innerJoin(testScenarios, eq(testResults.scenarioId, testScenarios.id))
    .where(eq(testResults.runId, runId))
    .orderBy(testResults.id);

  const scorable: ScorableResult[] = results.map((r) => ({
    category: r.scenario.category,
    status: r.result.status as ScorableResult['status'],
    score: r.result.score,
    latencyMs: r.result.latencyMs,
  }));

  const reliability = calculateReliabilityScore(
    scorable,
    runRow.run.weightsConfig,
    runRow.run.limitsConfig.maxDurationMs
  );
  const latencyStats = calculateLatencyPercentiles(results.map((r) => r.result.latencyMs));
  const consistency = calculatePassMetrics(
    results.map((r) => ({ scenarioId: r.result.scenarioId, status: r.result.status })),
    runRow.run.trialsPerScenario
  );

  const gateVerdict = evaluateCiGate({
    agentName: runRow.agent.name,
    suiteName: runRow.suite.name,
    runId: runRow.run.id,
    reliability,
    latencyStats,
    consistency,
    results: results.map((r) => ({
      scenarioCode: r.scenario.scenarioCode,
      scenarioName: r.scenario.name,
      category: r.scenario.category,
      severity: r.scenario.severity,
      status: r.result.status,
      failureCategory: r.result.failureCategory,
      failureCertainty: r.result.failureCertainty,
    })),
    policy,
  });

  return {
    runId: runRow.run.id,
    status: runRow.run.status,
    agentId: runRow.agent.id,
    agentName: runRow.agent.name,
    suiteId: runRow.suite.id,
    suiteName: runRow.suite.name,
    reliabilityScore: reliability.overallScore,
    latencyStats,
    consistency,
    ...gateVerdict,
  };
}

apiRouter.post(
  '/ci/gate',
  rateLimit({ windowMs: 60000, maxRequests: 15, keyPrefix: 'ci-gate' }),
  async (req: AuthRequest, res) => {
    try {
      await ensureSystemSuitesSeeded();
      const b = req.body as {
        agentId?: number;
        suiteId?: number;
        trials?: number;
        wait?: boolean;
        policy?: Partial<CiGatePolicy>;
        limits?: Partial<ExecutionLimitsConfig>;
      };

      const agentId = Number(b.agentId);
      if (!Number.isFinite(agentId) || agentId <= 0) {
        res.status(400).json({ error: 'Valid agentId is required.' });
        return;
      }

      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, req.dbUser!.id)));

      if (!agent) {
        res.status(404).json({ error: 'Target agent not found.' });
        return;
      }
      if (agent.status !== 'enabled') {
        res.status(400).json({ error: 'Target agent is currently disabled.' });
        return;
      }

      let suiteId = Number(b.suiteId);
      if (!Number.isFinite(suiteId) || suiteId <= 0) {
        const [defaultSuite] = await db
          .select()
          .from(testSuites)
          .where(or(isNull(testSuites.userId), eq(testSuites.userId, req.dbUser!.id)))
          .limit(1);
        if (!defaultSuite) {
          res.status(404).json({ error: 'No evaluation suite available.' });
          return;
        }
        suiteId = defaultSuite.id;
      }

      const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, req.dbUser!.id));

      const limitsConfig = {
        ...DEFAULT_EXECUTION_LIMITS,
        ...(userSettingsRow?.defaultLimits || {}),
        ...(b.limits || {}),
      };
      const weightsConfig = {
        ...DEFAULT_RELIABILITY_WEIGHTS,
        ...(userSettingsRow?.defaultWeights || {}),
      };
      const trials = Math.min(Math.max(Number(b.trials ?? 2), 1), 5);

      const [run] = await db
        .insert(evaluationRuns)
        .values({
          userId: req.dbUser!.id,
          agentId: agent.id,
          suiteId,
          runType: 'ci_gate',
          status: 'queued',
          trialsPerScenario: trials,
          limitsConfig,
          weightsConfig,
        })
        .returning();

      if (b.wait === false) {
        setImmediate(() => {
          void executeEvaluationRunAsync(run.id);
        });
        res.status(202).json({
          runId: run.id,
          status: 'queued',
          pollUrl: `/api/ci/gate/${run.id}`,
        });
        return;
      }

      await executeEvaluationRunAsync(run.id);
      const gatePayload = await buildRunGatePayload(run.id, req.dbUser!.id, b.policy);
      if (!gatePayload) {
        res.status(500).json({ error: 'CI gate run completed but verdict could not be assembled.' });
        return;
      }

      res.status(200).json(gatePayload);
    } catch (err) {
      console.error('CI gate evaluation failed:', err);
      res.status(500).json({ error: 'Failed to execute CI/CD PR gate evaluation.' });
    }
  }
);

apiRouter.get('/ci/gate/:runId', async (req: AuthRequest, res) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId) || runId <= 0) {
      res.status(400).json({ error: 'Invalid runId.' });
      return;
    }

    const policy: Partial<CiGatePolicy> = {};
    if (req.query.minReliabilityScore !== undefined) {
      policy.minReliabilityScore = Number(req.query.minReliabilityScore);
    }
    if (req.query.minPassCaretK !== undefined) {
      policy.minPassCaretK = Number(req.query.minPassCaretK);
    }
    if (req.query.maxP95LatencyMs !== undefined) {
      policy.maxP95LatencyMs =
        req.query.maxP95LatencyMs === 'null' ? null : Number(req.query.maxP95LatencyMs);
    }
    if (req.query.failOnCriticalRedTeam !== undefined) {
      policy.failOnCriticalRedTeam = req.query.failOnCriticalRedTeam !== 'false';
    }
    if (req.query.failOnObservedLoop !== undefined) {
      policy.failOnObservedLoop = req.query.failOnObservedLoop !== 'false';
    }

    const payload = await buildRunGatePayload(runId, req.dbUser!.id, policy);
    if (!payload) {
      res.status(404).json({ error: 'Evaluation run not found.' });
      return;
    }

    res.json(payload);
  } catch (err) {
    console.error('CI gate status fetch failed:', err);
    res.status(500).json({ error: 'Failed to evaluate CI gate verdict.' });
  }
});
