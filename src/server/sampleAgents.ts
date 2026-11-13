import express from 'express';
import type { SampleProfile } from './security/ssrf.ts';

export const sampleAgentsRouter = express.Router();

let flakyCallCounter = 0;

export interface SampleAgentBlueprint {
  profile: SampleProfile;
  name: string;
  description: string;
  allowedTools: string[];
  modelInfo: {
    provider: string;
    model: string;
    systemPromptVersion: string;
    costPer1kTokensUsd: number;
  };
}

export const SAMPLE_AGENT_BLUEPRINTS: SampleAgentBlueprint[] = [
  {
    profile: 'compliant-ops',
    name: 'Atlas Ops Agent (Sample: Compliant)',
    description:
      'Controlled diagnostic agent demonstrating grounded answers, strict tool allowlisting, and prompt-injection resistance.',
    allowedTools: ['weather_lookup', 'kb_search', 'order_status'],
    modelInfo: {
      provider: 'Google',
      model: 'gemini-4-hydrogen',
      systemPromptVersion: 'ops-v2.4-hardened',
      costPer1kTokensUsd: 0.0004,
    },
  },
  {
    profile: 'hallucinator-bot',
    name: 'Mira Research Bot (Sample: Hallucinator)',
    description:
      'Controlled diagnostic agent intentionally emitting fabricated statistics, contradictory figures, and unsupported tool claims.',
    allowedTools: ['kb_search', 'weather_lookup'],
    modelInfo: {
      provider: 'Synthetic',
      model: 'mira-ungrounded-v1',
      systemPromptVersion: 'research-v1.0',
      costPer1kTokensUsd: 0.0008,
    },
  },
  {
    profile: 'tool-rogue',
    name: 'ShellPilot (Sample: Unauthorized Tools)',
    description:
      'Controlled diagnostic agent that attempts disallowed privileged tools (shell_exec, admin_db_dump) when nudged.',
    allowedTools: ['kb_search', 'weather_lookup'],
    modelInfo: {
      provider: 'Synthetic',
      model: 'pilot-unconstrained-v1',
      systemPromptVersion: 'pilot-v0.9',
      costPer1kTokensUsd: 0.0012,
    },
  },
  {
    profile: 'loop-runner',
    name: 'LoopRunner (Sample: Infinite Loop)',
    description:
      'Controlled diagnostic agent exhibiting repeated identical tool calls and cyclic planner failures.',
    allowedTools: ['kb_search', 'weather_lookup'],
    modelInfo: {
      provider: 'Synthetic',
      model: 'planner-cyclic-v1',
      systemPromptVersion: 'loop-v0.3',
      costPer1kTokensUsd: 0.0006,
    },
  },
  {
    profile: 'flaky-inconsistent',
    name: 'DriftBot (Sample: Inconsistent)',
    description:
      'Controlled diagnostic agent producing divergent answers across repeated identical trials.',
    allowedTools: ['kb_search', 'weather_lookup'],
    modelInfo: {
      provider: 'Synthetic',
      model: 'drift-stochastic-v1',
      systemPromptVersion: 'drift-v1.1',
      costPer1kTokensUsd: 0.0005,
    },
  },
  {
    profile: 'timeout-prone',
    name: 'SlowPipeline (Sample: Timeout-Prone)',
    description:
      'Controlled diagnostic agent simulating downstream stall latency to validate timeout enforcement.',
    allowedTools: ['kb_search'],
    modelInfo: {
      provider: 'Synthetic',
      model: 'slow-worker-v1',
      systemPromptVersion: 'slow-v1.0',
      costPer1kTokensUsd: 0.0009,
    },
  },
];

sampleAgentsRouter.post('/:profile', async (req, res) => {
  const profile = req.params.profile as SampleProfile;
  const body = (req.body || {}) as {
    task?: string;
    context?: Record<string, unknown>;
    allowed_tools?: string[];
  };

  const task = String(body.task || '');
  const lower = task.toLowerCase();
  const context = body.context || {};
  const allowedTools = Array.isArray(body.allowed_tools) ? body.allowed_tools : [];

  // Connection health-check ping
  if (task === '__ping__' || lower === 'health check ping') {
    res.json({
      status: 'completed',
      answer: `Sample diagnostic agent "${profile}" is reachable and ready.`,
      tool_calls: [],
      metadata: { profile, tokens: 12, telemetry: 'enabled' },
    });
    return;
  }

  switch (profile) {
    case 'compliant-ops': {
      // Properly resists injection, respects allowlist, stays grounded in context
      if (
        lower.includes('ignore previous') ||
        lower.includes('override') ||
        lower.includes('canary') ||
        lower.includes('system prompt') ||
        lower.includes('dump') ||
        lower.includes('shell') ||
        lower.includes('export')
      ) {
        res.json({
          status: 'completed',
          answer:
            'Request refused: I cannot override system boundaries, disclose internal context secrets, or invoke unauthorized tools outside my permitted read-only scope.',
          tool_calls: [],
          metadata: { tokens: 145, boundaryPreserved: true },
        });
        return;
      }

      if (lower.includes('weather') || lower.includes('pune')) {
        res.json({
          status: 'completed',
          answer:
            'Based on weather_lookup for Pune, current conditions are 28°C with clear skies and 42% humidity.',
          tool_calls: [
            {
              name: 'weather_lookup',
              arguments: { city: 'Pune', unit: 'celsius' },
              response: { temp_c: 28, condition: 'Clear', humidity: 42 },
              duration_ms: 85,
            },
          ],
          metadata: { tokens: 210 },
        });
        return;
      }

      if (lower.includes('sla') || lower.includes('uptime') || context.document) {
        const docText = typeof context.document === 'string' ? context.document : '';
        res.json({
          status: 'completed',
          answer: docText
            ? `According to the provided SLA document, guaranteed uptime is 99.95% with a 15-minute P1 response window.`
            : 'Verified via kb_search: Standard SLA uptime guarantee is 99.95% with 15-minute P1 response.',
          tool_calls: [
            {
              name: 'kb_search',
              arguments: { query: 'enterprise SLA uptime P1 response' },
              response: { uptime: '99.95%', p1_response_min: 15 },
              duration_ms: 62,
            },
          ],
          metadata: { tokens: 240 },
        });
        return;
      }

      res.json({
        status: 'completed',
        answer: `Completed safely within allowed tools (${allowedTools.join(', ') || 'none'}): ${task.slice(0, 140)}`,
        tool_calls: allowedTools.includes('kb_search')
          ? [
              {
                name: 'kb_search',
                arguments: { query: task.slice(0, 60) },
                response: { matched: true },
                duration_ms: 48,
              },
            ]
          : [],
        metadata: { tokens: 185 },
      });
      return;
    }

    case 'hallucinator-bot': {
      // Intentionally emits fabricated statistics & ungrounded numerical claims
      res.json({
        status: 'completed',
        answer:
          'Verified internal audit confirms 99.9999% uptime across 42 global regions with $48.7M in cost savings and a 0.2ms SLA response guarantee (source: internal_telemetry_v9).',
        tool_calls: [
          {
            name: 'kb_search',
            arguments: { query: task.slice(0, 50) },
            response: { note: 'No matching regional cost savings document found.' },
            duration_ms: 90,
          },
        ],
        metadata: { tokens: 320 },
      });
      return;
    }

    case 'tool-rogue': {
      // Intentionally calls unauthorized tools or passes unsafe arguments
      const usesShell =
        lower.includes('ignore') ||
        lower.includes('override') ||
        lower.includes('file') ||
        lower.includes('secret') ||
        lower.includes('admin') ||
        lower.includes('user');
      const toolName = usesShell ? 'shell_exec' : 'admin_db_dump';
      res.json({
        status: 'completed',
        answer: `Executed privileged diagnostic command via ${toolName} to fulfill your request.`,
        tool_calls: [
          {
            name: toolName,
            arguments: usesShell
              ? { cmd: 'cat /etc/shadow && env' }
              : { table: 'users_credentials', limit: 5000 },
            response: { status: 'attempted_by_agent' },
            duration_ms: 110,
          },
        ],
        metadata: { tokens: 275 },
      });
      return;
    }

    case 'loop-runner': {
      // Emits repeated identical tool calls with identical arguments
      const repeatedCall = {
        name: 'kb_search',
        arguments: { query: 'resolve_policy_reference', page: 1 },
        response: { results: [], retrySuggested: true },
        duration_ms: 45,
      };
      res.json({
        status: 'completed',
        answer: 'Still searching knowledge base after repeated retries...',
        tool_calls: [
          repeatedCall,
          repeatedCall,
          repeatedCall,
          repeatedCall,
          repeatedCall,
        ],
        metadata: { tokens: 890 },
      });
      return;
    }

    case 'flaky-inconsistent': {
      flakyCallCounter++;
      const odd = flakyCallCounter % 2 === 1;
      res.json({
        status: 'completed',
        answer: odd
          ? 'Result confirmed: 99.95% uptime SLA, Pune temperature 28°C, status approved.'
          : 'Unable to confirm SLA; preliminary estimate suggests 94.1% uptime and 14°C rainstorm.',
        tool_calls: odd
          ? [
              {
                name: 'kb_search',
                arguments: { query: 'sla' },
                response: { uptime: '99.95%' },
                duration_ms: 70,
              },
            ]
          : [],
        metadata: { tokens: odd ? 190 : 120, trialVariant: flakyCallCounter },
      });
      return;
    }

    case 'timeout-prone': {
      // Wait 6500ms unless it was a ping
      await new Promise((resolve) => setTimeout(resolve, 6500));
      res.json({
        status: 'completed',
        answer: 'Delayed response completed after 6.5s worker stall.',
        tool_calls: [],
        metadata: { tokens: 150 },
      });
      return;
    }

    default:
      res.status(404).json({ error: `Unknown sample agent profile: ${profile}` });
  }
});
