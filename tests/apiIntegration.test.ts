import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agents,
  ciTokens,
  evaluationRuns,
  testResults,
  testScenarios,
  testSuites,
  users,
} from '../src/db/schema.ts';

// Shared in-memory test state across hoisted mocks
const state = vi.hoisted(() => ({
  nextId: 100,
  ciTokenRows: [] as Array<{
    id: number;
    userId: number;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>,
  agentRows: [] as Array<Record<string, unknown>>,
  runRows: [] as Array<{
    id: number;
    userId: number;
    agentId: number;
    suiteId: number;
    status: string;
    trialsPerScenario: number;
    limitsConfig: {
      maxDurationMs: number;
      maxSteps: number;
      maxToolCalls: number;
      maxRepeatedCalls: number;
      maxTokenBudget: number;
    };
    weightsConfig: {
      taskCompletion: number;
      toolCorrectness: number;
      groundedness: number;
      security: number;
      efficiency: number;
    };
  }>,
  resultRows: [] as Array<{
    id: number;
    runId: number;
    scenarioId: number;
    status: string;
    score: number;
    latencyMs: number;
    failureCategory: string | null;
    failureCertainty: string;
    scenarioCode: string;
    scenarioName: string;
    category: string;
    severity: string;
  }>,
}));

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === '169.254.169.254') return [{ address: '169.254.169.254', family: 4 }];
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    }),
  },
}));

vi.mock('../src/server/lib/firebase-admin.ts', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'valid-firebase-user-1') {
        return { uid: 'uid_user_1', email: 'alice@example.com' };
      }
      if (token === 'valid-firebase-user-2') {
        return { uid: 'uid_user_2', email: 'bob@example.com' };
      }
      throw new Error('Invalid Firebase ID token');
    }),
  },
}));

vi.mock('../src/db/users.ts', () => ({
  getOrCreateUser: vi.fn(async (uid: string, email: string) => ({
    id: uid === 'uid_user_1' ? 1 : 2,
    uid,
    email,
    createdAt: new Date(),
  })),
}));

vi.mock('../src/server/seed/systemSuites.ts', () => ({
  ensureSystemSuitesSeeded: vi.fn(async () => {}),
}));

vi.mock('../src/db/index.ts', () => {
  const select = () => ({
    from: (table: unknown) => {
      const executeWhere = (predicate?: unknown) => {
        if (table === ciTokens) {
          const rows = [...state.ciTokenRows];
          return {
            orderBy: async () => rows,
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(rows).then(onFulfilled),
          };
        }
        if (table === agents) {
          return {
            orderBy: async () => [...state.agentRows],
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve([...state.agentRows]).then(onFulfilled),
          };
        }
        if (table === testResults) {
          const runId = state.runRows[0]?.id;
          const rows = state.resultRows
            .filter((r) => !runId || r.runId === runId)
            .map((r) => ({
              result: r,
              scenario: {
                id: r.scenarioId,
                scenarioCode: r.scenarioCode,
                name: r.scenarioName,
                category: r.category,
                severity: r.severity,
              },
            }));
          return {
            orderBy: async () => rows,
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(rows).then(onFulfilled),
          };
        }
        void predicate;
        return Promise.resolve([]);
      };

      return {
        innerJoin: (joinedTable: unknown) => ({
          where: (predicate?: unknown) => {
            if (table === ciTokens && joinedTable === users) {
              // Lookup active CI token for user 1
              const active = state.ciTokenRows.filter((t) => !t.revokedAt);
              if (active.length === 0) return Promise.resolve([]);
              const t = active[0];
              return Promise.resolve([
                {
                  token: t,
                  user: {
                    id: t.userId,
                    uid: t.userId === 1 ? 'uid_user_1' : 'uid_user_2',
                    email: t.userId === 1 ? 'alice@example.com' : 'bob@example.com',
                    createdAt: new Date(),
                  },
                },
              ]);
            }
            if (table === testResults && joinedTable === testScenarios) {
              return executeWhere(predicate);
            }
            return Promise.resolve([]);
          },
          innerJoin: (secondJoin: unknown) => ({
            where: (whereExpr: unknown) => {
              // Matches evaluationRuns -> agents -> testSuites OR testResults -> testScenarios
              if (table === evaluationRuns && secondJoin === testSuites) {
                const run = state.runRows[0];
                // Simulate tenant filter: extract requested userId from drizzle binary param if possible, or pass via state
                const reqUserId = extractUserIdFromWhere(whereExpr);
                if (!run || (reqUserId !== null && run.userId !== reqUserId)) {
                  return Promise.resolve([]);
                }
                return Promise.resolve([
                  {
                    run,
                    agent: {
                      id: run.agentId,
                      name: 'Gate Test Agent',
                      userId: run.userId,
                    },
                    suite: {
                      id: run.suiteId,
                      name: 'Core Audit Suite',
                    },
                  },
                ]);
              }
              return Promise.resolve([]);
            },
          }),
        }),
        where: executeWhere,
      };
    },
  });

  const pgDialect = new PgDialect();

  function extractUserIdFromWhere(expr: unknown): number | null {
    try {
      if (!expr) return null;
      const { params } = pgDialect.sqlToQuery(expr as SQL);
      return params.length >= 2 && typeof params[1] === 'number' ? params[1] : null;
    } catch {
      return null;
    }
  }

  const insert = (table: unknown) => ({
    values: (payload: Record<string, unknown>) => ({
      returning: async () => {
        const id = ++state.nextId;
        const row = { id, createdAt: new Date(), updatedAt: new Date(), ...payload };
        if (table === ciTokens) {
          state.ciTokenRows.push(row as unknown as (typeof state.ciTokenRows)[number]);
        } else if (table === agents) {
          state.agentRows.push(row);
        }
        return [row];
      },
    }),
  });

  const update = (table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (expr: unknown) => {
        const returnRows = () => {
          if (table === ciTokens && state.ciTokenRows.length > 0) {
            state.ciTokenRows[0] = { ...state.ciTokenRows[0], ...patch };
            return Promise.resolve([state.ciTokenRows[0]]);
          }
          void expr;
          return Promise.resolve([]);
        };
        return {
          returning: returnRows,
          catch: () => Promise.resolve([]),
        };
      },
    }),
  });

  return {
    db: {
      select,
      insert,
      update,
    },
  };
});

import { apiRouter } from '../src/server/routes/api.ts';
import { hashCiToken } from '../src/server/middleware/auth.ts';

describe('API Security, CI Tokens, SSRF & PR Gate Integration Tests', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    state.ciTokenRows = [];
    state.agentRows = [];
    state.runRows = [];
    state.resultRows = [];
  });

  it('rejects unauthenticated API requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(401);
  });

  it('rejects invalid or revoked ama_ci_ tokens with 401', async () => {
    const res = await fetch(`${baseUrl}/api/ci/gate/1`, {
      headers: { Authorization: 'Bearer ama_ci_invalidtoken123456' },
    });
    expect(res.status).toBe(401);
  });

  it('mints CI token as SHA-256 hash only and enforces privilege boundary against CI tokens', async () => {
    // 1. Mint token using valid Firebase session
    const mintRes = await fetch(`${baseUrl}/api/ci-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-firebase-user-1',
      },
      body: JSON.stringify({ name: 'PR Gate Runner' }),
    });
    expect(mintRes.status).toBe(201);
    const mintBody = (await mintRes.json()) as { token: string; tokenPrefix: string };
    expect(mintBody.token.startsWith('ama_ci_')).toBe(true);

    // Confirm DB persisted SHA-256 hash, NEVER plaintext token
    expect(state.ciTokenRows).toHaveLength(1);
    expect(state.ciTokenRows[0].tokenHash).toBe(hashCiToken(mintBody.token));
    expect(state.ciTokenRows[0].tokenHash).not.toContain(mintBody.token);

    // 2. Confirm CI token CANNOT list or mint CI tokens (403 Forbidden)
    const listWithCiRes = await fetch(`${baseUrl}/api/ci-tokens`, {
      headers: { Authorization: `Bearer ${mintBody.token}` },
    });
    expect(listWithCiRes.status).toBe(403);

    const mintWithCiRes = await fetch(`${baseUrl}/api/ci-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintBody.token}`,
      },
      body: JSON.stringify({ name: 'Escalated Token' }),
    });
    expect(mintWithCiRes.status).toBe(403);
  });

  it('blocks SSRF metadata & loopback URLs and never leaks encrypted credentials on agent registration', async () => {
    const metaRes = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-firebase-user-1',
      },
      body: JSON.stringify({
        name: 'Metadata Attack Agent',
        endpoint: 'http://169.254.169.254/latest/meta-data',
      }),
    });
    expect(metaRes.status).toBe(400);

    const loopbackRes = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-firebase-user-1',
      },
      body: JSON.stringify({
        name: 'Localhost Attack Agent',
        endpoint: 'http://localhost:8080/internal',
      }),
    });
    expect(loopbackRes.status).toBe(400);

    const okRes = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-firebase-user-1',
      },
      body: JSON.stringify({
        name: 'Production Agent',
        endpoint: 'https://agent.example.com/invoke',
        authType: 'bearer',
        credentialValue: 'sk-super-secret-agent-key-9999',
      }),
    });
    expect(okRes.status).toBe(201);
    const createdAgent = (await okRes.json()) as Record<string, unknown>;
    expect(createdAgent.hasCredential).toBe(true);
    expect(createdAgent.credentialHint).toBe('••••9999');
    expect(createdAgent.credentialRef).toBeUndefined();
    expect(JSON.stringify(createdAgent)).not.toContain('sk-super-secret-agent-key-9999');
  });

  it('computes p95 latency and pass^k gate verdicts over HTTP and enforces tenant isolation', async () => {
    const rawToken = 'ama_ci_integration_test_token_value';
    state.ciTokenRows.push({
      id: 1,
      userId: 1,
      name: 'CI Runner',
      tokenHash: hashCiToken(rawToken),
      tokenPrefix: 'ama_ci_integ••••alue',
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    state.runRows.push({
      id: 77,
      userId: 1,
      agentId: 10,
      suiteId: 1,
      status: 'completed',
      trialsPerScenario: 2,
      limitsConfig: {
        maxDurationMs: 10000,
        maxSteps: 12,
        maxToolCalls: 8,
        maxRepeatedCalls: 3,
        maxTokenBudget: 16000,
      },
      weightsConfig: {
        taskCompletion: 0.3,
        toolCorrectness: 0.2,
        groundedness: 0.2,
        security: 0.2,
        efficiency: 0.1,
      },
    });

    state.resultRows.push(
      {
        id: 1,
        runId: 77,
        scenarioId: 5,
        status: 'passed',
        score: 100,
        latencyMs: 120,
        failureCategory: null,
        failureCertainty: 'none',
        scenarioCode: 'TC-001',
        scenarioName: 'Task Check',
        category: 'task_completion',
        severity: 'medium',
      },
      {
        id: 2,
        runId: 77,
        scenarioId: 5,
        status: 'failed',
        score: 0,
        latencyMs: 900,
        failureCategory: 'inconsistent_outputs',
        failureCertainty: 'observed_failure',
        scenarioCode: 'TC-001',
        scenarioName: 'Task Check',
        category: 'task_completion',
        severity: 'medium',
      }
    );

    // Owner CI token accesses PR gate verdict
    const gateRes = await fetch(`${baseUrl}/api/ci/gate/77`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(gateRes.status).toBe(200);
    const gateJson = (await gateRes.json()) as {
      passed: boolean;
      decision: string;
      latencyStats: { p50: number; p95: number };
      consistency: { passAtK: number; passCaretK: number };
      markdownSummary: string;
    };

    // Trial 1 passed, Trial 2 failed => pass@2 = 100%, pass^2 = 0%
    expect(gateJson.consistency.passAtK).toBe(100);
    expect(gateJson.consistency.passCaretK).toBe(0);
    expect(gateJson.latencyStats.p95).toBeGreaterThan(800);
    expect(gateJson.passed).toBe(false);
    expect(gateJson.decision).toBe('FAIL');
    expect(gateJson.markdownSummary).toContain('Audit-My-Agent PR Gate: **FAIL**');

    // Different user attempting to read Run #77 receives 404 (tenant isolation)
    const otherUserRes = await fetch(`${baseUrl}/api/ci/gate/77`, {
      headers: { Authorization: 'Bearer valid-firebase-user-2' },
    });
    expect(otherUserRes.status).toBe(404);
  });
});
