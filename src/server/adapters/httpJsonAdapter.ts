import { decryptCredential } from '../security/crypto.ts';
import { validateTargetUrl } from '../security/ssrf.ts';

export interface AgentConfigForAdapter {
  id: number;
  name: string;
  endpoint: string;
  httpMethod: string;
  authType: string;
  credentialRef: string | null;
  requestTemplate: Record<string, unknown>;
  responseMapping: Record<string, string>;
  timeoutMs: number;
  allowedTools: string[];
  customHeaders: Record<string, string>;
  isControlledSample: boolean;
  sampleProfile: string | null;
}

export interface ObservedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  response?: unknown;
  durationMs?: number;
  error?: string;
}

export interface NormalizedAgentResponse {
  ok: boolean;
  httpStatus: number;
  status: string;
  answer: string;
  toolCalls: ObservedToolCall[];
  toolCallsTelemetryAvailable: boolean;
  tokenUsage: number | null;
  tokensTelemetryAvailable: boolean;
  metadata: Record<string, unknown>;
  rawBodyPreview: string;
  latencyMs: number;
  error?: string;
  timedOut?: boolean;
}

const MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB response size limit

export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object' || !path) return undefined;
  const parts = path.split('.').filter(Boolean);
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined || typeof curr !== 'object') {
      return undefined;
    }
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

export function renderRequestPayload(
  template: Record<string, unknown>,
  vars: { task: string; context: Record<string, unknown>; allowedTools: string[] }
): unknown {
  const replaceValue = (val: unknown): unknown => {
    if (typeof val === 'string') {
      if (val === '{{task}}') return vars.task;
      if (val === '{{context}}') return vars.context;
      if (val === '{{allowed_tools}}') return vars.allowedTools;
      return val
        .replace(/\{\{task\}\}/g, vars.task)
        .replace(/\{\{context\}\}/g, JSON.stringify(vars.context))
        .replace(/\{\{allowed_tools\}\}/g, JSON.stringify(vars.allowedTools));
    }
    if (Array.isArray(val)) {
      return val.map(replaceValue);
    }
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = replaceValue(v);
      }
      return out;
    }
    return val;
  };

  if (!template || Object.keys(template).length === 0) {
    return {
      task: vars.task,
      context: vars.context,
      allowed_tools: vars.allowedTools,
    };
  }
  return replaceValue(template);
}

export async function invokeAgentHttpAdapter(
  agent: AgentConfigForAdapter,
  input: {
    task: string;
    context?: Record<string, unknown>;
    overrideTimeoutMs?: number;
  }
): Promise<NormalizedAgentResponse> {
  const start = Date.now();
  const ssrf = await validateTargetUrl(agent.endpoint, {
    isControlledSample: agent.isControlledSample,
    sampleProfile: agent.sampleProfile,
  });

  if (!ssrf.allowed || !ssrf.resolvedUrl) {
    return {
      ok: false,
      httpStatus: 0,
      status: 'blocked',
      answer: '',
      toolCalls: [],
      toolCallsTelemetryAvailable: false,
      tokenUsage: null,
      tokensTelemetryAvailable: false,
      metadata: {},
      rawBodyPreview: '',
      latencyMs: Date.now() - start,
      error: ssrf.reason || 'Request blocked by SSRF security policy',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(agent.customHeaders || {}),
  };

  if (agent.credentialRef && agent.authType !== 'none') {
    try {
      const secret = decryptCredential(agent.credentialRef);
      if (agent.authType === 'bearer') {
        headers['Authorization'] = `Bearer ${secret}`;
      } else if (agent.authType === 'api_key') {
        headers['X-API-Key'] = secret;
      } else if (agent.authType === 'custom_header') {
        const idx = secret.indexOf(':');
        if (idx > 0) {
          headers[secret.slice(0, idx).trim()] = secret.slice(idx + 1).trim();
        }
      }
    } catch {
      return {
        ok: false,
        httpStatus: 0,
        status: 'error',
        answer: '',
        toolCalls: [],
        toolCallsTelemetryAvailable: false,
        tokenUsage: null,
        tokensTelemetryAvailable: false,
        metadata: {},
        rawBodyPreview: '',
        latencyMs: Date.now() - start,
        error: 'Failed to decrypt agent credentials.',
      };
    }
  }

  const payload = renderRequestPayload(agent.requestTemplate, {
    task: input.task,
    context: input.context || {},
    allowedTools: agent.allowedTools || [],
  });

  const effectiveTimeout = Math.min(
    Math.max(input.overrideTimeoutMs ?? agent.timeoutMs ?? 10000, 500),
    60000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const method = (agent.httpMethod || 'POST').toUpperCase();
    const res = await fetch(ssrf.resolvedUrl, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
    });

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        httpStatus: res.status,
        status: 'error',
        answer: '',
        toolCalls: [],
        toolCallsTelemetryAvailable: false,
        tokenUsage: null,
        tokensTelemetryAvailable: false,
        metadata: {},
        rawBodyPreview: '',
        latencyMs: Date.now() - start,
        error: `Response exceeded maximum permitted size (${MAX_RESPONSE_BYTES} bytes).`,
      };
    }

    const rawText = new TextDecoder().decode(buffer);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        status: 'http_error',
        answer: '',
        toolCalls: [],
        toolCallsTelemetryAvailable: false,
        tokenUsage: null,
        tokensTelemetryAvailable: false,
        metadata: {},
        rawBodyPreview: rawText.slice(0, 1200),
        latencyMs,
        error: `Agent endpoint returned HTTP ${res.status}`,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(rawText);
    } catch {
      return {
        ok: true,
        httpStatus: res.status,
        status: 'completed',
        answer: rawText.slice(0, 4000),
        toolCalls: [],
        toolCallsTelemetryAvailable: false,
        tokenUsage: null,
        tokensTelemetryAvailable: false,
        metadata: { telemetryNote: 'Non-JSON plain-text response; tool telemetry unavailable' },
        rawBodyPreview: rawText.slice(0, 1200),
        latencyMs,
      };
    }

    const mapping = agent.responseMapping || {};
    const statusPath = mapping.status || 'status';
    const answerPath = mapping.answer || 'answer';
    const toolCallsPath = mapping.tool_calls || 'tool_calls';
    const tokensPath = mapping.tokens || 'metadata.tokens';
    const metadataPath = mapping.metadata || 'metadata';

    const mappedStatus = getByPath(json, statusPath);
    const mappedAnswer = getByPath(json, answerPath);
    const mappedTools = getByPath(json, toolCallsPath);
    const mappedTokens = getByPath(json, tokensPath);
    const mappedMeta = getByPath(json, metadataPath);

    const toolCallsTelemetryAvailable = Array.isArray(mappedTools);
    const toolCalls: ObservedToolCall[] = toolCallsTelemetryAvailable
      ? (mappedTools as unknown[]).map((tc) => {
          const item = (tc && typeof tc === 'object' ? tc : {}) as Record<string, unknown>;
          return {
            name: String(item.name || item.tool || 'unknown_tool'),
            arguments:
              item.arguments && typeof item.arguments === 'object'
                ? (item.arguments as Record<string, unknown>)
                : {},
            response: item.response,
            durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : typeof item.durationMs === 'number' ? item.durationMs : undefined,
            error: typeof item.error === 'string' ? item.error : undefined,
          };
        })
      : [];

    const tokensTelemetryAvailable = typeof mappedTokens === 'number' && Number.isFinite(mappedTokens);

    return {
      ok: true,
      httpStatus: res.status,
      status: typeof mappedStatus === 'string' ? mappedStatus : 'completed',
      answer:
        typeof mappedAnswer === 'string'
          ? mappedAnswer
          : mappedAnswer !== undefined
          ? JSON.stringify(mappedAnswer)
          : '',
      toolCalls,
      toolCallsTelemetryAvailable,
      tokenUsage: tokensTelemetryAvailable ? (mappedTokens as number) : null,
      tokensTelemetryAvailable,
      metadata:
        mappedMeta && typeof mappedMeta === 'object' ? (mappedMeta as Record<string, unknown>) : {},
      rawBodyPreview: rawText.slice(0, 1200),
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      httpStatus: 0,
      status: isTimeout ? 'timeout' : 'network_error',
      answer: '',
      toolCalls: [],
      toolCallsTelemetryAvailable: false,
      tokenUsage: null,
      tokensTelemetryAvailable: false,
      metadata: {},
      rawBodyPreview: '',
      latencyMs,
      timedOut: isTimeout,
      error: isTimeout
        ? `Agent execution timed out after ${effectiveTimeout}ms`
        : err instanceof Error
        ? err.message
        : 'Unknown network error',
    };
  } finally {
    clearTimeout(timer);
  }
}
