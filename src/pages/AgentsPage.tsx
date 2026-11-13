import React, { useState } from 'react';
import { FlaskConical, Play, Plus, Power, Trash2, Wrench, X } from 'lucide-react';
import { ApiError, auditApi } from '../services/api';
import type { AgentRecord, EvaluationRunRecord } from '../types/audit';
import { StatusIndicator } from '../components/StatusIndicator';

interface AgentsPageProps {
  agents: AgentRecord[];
  onRefresh: () => Promise<void>;
  onDeploySamples: () => Promise<void>;
  onRunAgentTest: (agentId: number) => void;
}

const DEFAULT_REQ_TEMPLATE = JSON.stringify(
  {
    task: '{{task}}',
    context: '{{context}}',
    allowed_tools: '{{allowed_tools}}',
  },
  null,
  2
);

const DEFAULT_RESP_MAPPING = JSON.stringify(
  {
    status: 'status',
    answer: 'answer',
    tool_calls: 'tool_calls',
    tokens: 'metadata.tokens',
    metadata: 'metadata',
  },
  null,
  2
);

export function AgentsPage({
  agents,
  onRefresh,
  onDeploySamples,
  onRunAgentTest,
}: AgentsPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const [probeResult, setProbeResult] = useState<Record<number, string>>({});
  const [probingId, setProbingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [historyAgent, setHistoryAgent] = useState<{
    agent: AgentRecord;
    runs: EvaluationRunRecord[];
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [httpMethod, setHttpMethod] = useState('POST');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'api_key' | 'custom_header'>('none');
  const [credentialValue, setCredentialValue] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [allowedToolsText, setAllowedToolsText] = useState('weather_lookup, kb_search');
  const [provider, setProvider] = useState('Google');
  const [modelName, setModelName] = useState('gemini-4-hydrogen');
  const [systemPromptVersion, setSystemPromptVersion] = useState('v1.0');
  const [costPer1k, setCostPer1k] = useState('0.0005');
  const [customHeadersText, setCustomHeadersText] = useState('{}');
  const [reqTemplateText, setReqTemplateText] = useState(DEFAULT_REQ_TEMPLATE);
  const [respMappingText, setRespMappingText] = useState(DEFAULT_RESP_MAPPING);

  const openCreateModal = () => {
    setEditingAgent(null);
    setName('');
    setDescription('');
    setEndpoint('');
    setHttpMethod('POST');
    setAuthType('none');
    setCredentialValue('');
    setTimeoutMs(10000);
    setAllowedToolsText('weather_lookup, kb_search');
    setProvider('Google');
    setModelName('gemini-4-hydrogen');
    setSystemPromptVersion('v1.0');
    setCostPer1k('0.0005');
    setCustomHeadersText('{}');
    setReqTemplateText(DEFAULT_REQ_TEMPLATE);
    setRespMappingText(DEFAULT_RESP_MAPPING);
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (ag: AgentRecord) => {
    setEditingAgent(ag);
    setName(ag.name);
    setDescription(ag.description);
    setEndpoint(ag.endpoint);
    setHttpMethod(ag.httpMethod);
    setAuthType(ag.authType);
    setCredentialValue('');
    setTimeoutMs(ag.timeoutMs);
    setAllowedToolsText((ag.allowedTools || []).join(', '));
    setProvider(ag.modelInfo?.provider || '');
    setModelName(ag.modelInfo?.model || '');
    setSystemPromptVersion(ag.modelInfo?.systemPromptVersion || '');
    setCostPer1k(
      ag.modelInfo?.costPer1kTokensUsd !== undefined
        ? String(ag.modelInfo.costPer1kTokensUsd)
        : ''
    );
    setCustomHeadersText(JSON.stringify(ag.customHeaders || {}, null, 2));
    setReqTemplateText(JSON.stringify(ag.requestTemplate || {}, null, 2));
    setRespMappingText(JSON.stringify(ag.responseMapping || {}, null, 2));
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    let customHeaders: Record<string, string> = {};
    let requestTemplate: Record<string, unknown> = {};
    let responseMapping: Record<string, string> = {};

    try {
      customHeaders = JSON.parse(customHeadersText || '{}');
      requestTemplate = JSON.parse(reqTemplateText || '{}');
      responseMapping = JSON.parse(respMappingText || '{}');
    } catch {
      setFormError('Custom headers, request template, and response mapping must be valid JSON.');
      return;
    }

    const allowedTools = allowedToolsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      name,
      description,
      endpoint,
      httpMethod,
      authType,
      credentialValue: credentialValue.trim() || undefined,
      timeoutMs: Number(timeoutMs),
      allowedTools,
      customHeaders,
      requestTemplate,
      responseMapping,
      modelInfo: {
        provider: provider.trim() || undefined,
        model: modelName.trim() || undefined,
        systemPromptVersion: systemPromptVersion.trim() || undefined,
        costPer1kTokensUsd: costPer1k ? Number(costPer1k) : undefined,
      },
    };

    setSaving(true);
    try {
      if (editingAgent) {
        await auditApi.updateAgent(editingAgent.id, payload);
      } else {
        await auditApi.createAgent(payload);
      }
      await onRefresh();
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async (id: number) => {
    setProbingId(id);
    try {
      const res = await auditApi.testConnection(id);
      setProbeResult((prev) => ({
        ...prev,
        [id]: res.connected
          ? `HTTP ${res.httpStatus} · ${res.latencyMs}ms · Tools telemetry: ${
              res.toolCallsTelemetryAvailable ? 'exposed' : 'unavailable'
            }`
          : `Failed: ${res.error || `HTTP ${res.httpStatus}`}`,
      }));
      await onRefresh();
    } catch (err) {
      setProbeResult((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Probe error',
      }));
    } finally {
      setProbingId(null);
    }
  };

  const handleToggleStatus = async (ag: AgentRecord) => {
    if (togglingId === ag.id || deletingId === ag.id) return;
    setActionError(null);
    setTogglingId(ag.id);
    try {
      const nextStatus = ag.status === 'enabled' ? 'disabled' : 'enabled';
      await auditApi.updateAgent(ag.id, { status: nextStatus });
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await onRefresh();
        return;
      }
      setActionError(err instanceof Error ? err.message : 'Failed to update agent status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (deletingId === id) return;
    setActionError(null);
    setDeletingId(id);
    try {
      await auditApi.deleteAgent(id);
      await onRefresh();
    } catch (err) {
      if (
        (err instanceof ApiError && err.status === 404) ||
        (err instanceof Error && err.message.toLowerCase().includes('not found'))
      ) {
        // Row was already removed on the server; synchronize local list cleanly
        await onRefresh();
        return;
      }
      setActionError(err instanceof Error ? err.message : 'Failed to delete agent.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewHistory = async (id: number) => {
    setActionError(null);
    try {
      const detail = await auditApi.getAgentDetail(id);
      setHistoryAgent(detail);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await onRefresh();
        return;
      }
      setActionError(err instanceof Error ? err.message : 'Failed to load agent history.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Agent Registry & Adapters
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Register external HTTP JSON agents with SSRF validation and encrypted credential storage,
            or deploy controlled diagnostic sample agents.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={deploying}
            onClick={async () => {
              setDeploying(true);
              try {
                await onDeploySamples();
              } finally {
                setDeploying(false);
              }
            }}
            className="px-3.5 py-2 rounded-lg border border-[#242B3D] bg-[#121620] hover:border-cyan-500/50 text-slate-200 text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap"
          >
            <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
            <span>{deploying ? 'Deploying...' : 'Deploy Sample Agents'}</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Agent</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-xs text-rose-300">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-200 hover:text-white cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-10 text-center">
          <p className="text-sm text-slate-300 mb-4">
            No agents registered. Register a custom HTTPS agent endpoint or deploy the 6 controlled
            sample agents to test the evaluation engine immediately.
          </p>
        </div>
      ) : (
        <div className="border border-[#242B3D] bg-[#121620] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#242B3D] text-xs font-medium text-slate-400">
                  <th className="py-3 px-4">Agent</th>
                  <th className="py-3 px-4">Model / Adapter</th>
                  <th className="py-3 px-4">Allowed Tools</th>
                  <th className="py-3 px-4">Connection</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#242B3D] text-sm">
                {agents.map((ag) => (
                  <tr key={ag.id} className="hover:bg-[#171C28]/60 transition-colors">
                    <td className="py-3.5 px-4 align-top max-w-xs">
                      <div className="font-medium text-slate-100">{ag.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                        {ag.description || 'No description provided'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                        {ag.httpMethod} {ag.endpoint}
                        {ag.isControlledSample ? ' · Controlled Sample' : ''}
                      </div>
                      {probeResult[ag.id] && (
                        <div className="text-[11px] font-mono text-cyan-300 mt-1">
                          {probeResult[ag.id]}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-top text-xs text-slate-300 font-mono">
                      <div>
                        {ag.modelInfo?.provider || 'Custom'} /{' '}
                        {ag.modelInfo?.model || 'Not specified'}
                      </div>
                      <div className="text-slate-500 mt-1 tabular-nums">
                        Timeout: {ag.timeoutMs}ms · Auth: {ag.authType}
                        {ag.credentialHint ? ` (${ag.credentialHint})` : ''}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-top text-xs font-mono text-slate-300">
                      {ag.allowedTools.length > 0 ? ag.allowedTools.join(', ') : 'None declared'}
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <StatusIndicator status={ag.lastConnectionStatus || 'untested'} />
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <StatusIndicator status={ag.status} />
                    </td>
                    <td className="py-3.5 px-4 align-top text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={probingId === ag.id}
                          onClick={() => void handleProbe(ag.id)}
                          className="px-2.5 py-1 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-cyan-500/50 text-xs text-slate-200 cursor-pointer whitespace-nowrap"
                        >
                          {probingId === ag.id ? 'Probing...' : 'Test Connection'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRunAgentTest(ag.id)}
                          title="Evaluate in Testing Lab"
                          className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-violet-500/50 text-violet-300 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(ag)}
                          title="Edit adapter configuration"
                          className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-slate-500 text-slate-300 cursor-pointer"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleViewHistory(ag.id)}
                          className="px-2 py-1 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-slate-500 text-xs text-slate-300 cursor-pointer whitespace-nowrap"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          disabled={togglingId === ag.id || deletingId === ag.id}
                          onClick={() => void handleToggleStatus(ag)}
                          title={ag.status === 'enabled' ? 'Disable agent' : 'Enable agent'}
                          className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-amber-500/50 text-slate-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === ag.id}
                          onClick={() => void handleDelete(ag.id)}
                          title="Delete agent"
                          className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-rose-500/50 text-rose-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Register / Edit Agent Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-[#242B3D] bg-[#121620] rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#242B3D] mb-5">
              <h2 className="text-lg font-semibold text-slate-100">
                {editingAgent ? `Configure ${editingAgent.name}` : 'Register External AI Agent'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Agent Name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Production Support Agent"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">HTTP Method</label>
                  <select
                    value={httpMethod}
                    onChange={(e) => setHttpMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Endpoint URL (Public HTTPS/HTTP — SSRF-protected)
                </label>
                <input
                  required
                  disabled={Boolean(editingAgent?.isControlledSample)}
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://api.yourdomain.com/v1/agent/invoke"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Customer support retrieval & ticket triage agent"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Auth Type</label>
                  <select
                    value={authType}
                    onChange={(e) =>
                      setAuthType(
                        e.target.value as 'none' | 'bearer' | 'api_key' | 'custom_header'
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="api_key">X-API-Key Header</option>
                    <option value="custom_header">Custom Header (Name:Value)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Credential Secret (Encrypted)
                  </label>
                  <input
                    type="password"
                    disabled={authType === 'none'}
                    value={credentialValue}
                    onChange={(e) => setCredentialValue(e.target.value)}
                    placeholder={
                      editingAgent?.hasCredential ? 'Leave blank to keep existing' : 'Secret token'
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100 disabled:opacity-40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Timeout (ms)</label>
                  <input
                    type="number"
                    min={1000}
                    max={60000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Allowed Tools (comma-separated)
                </label>
                <input
                  value={allowedToolsText}
                  onChange={(e) => setAllowedToolsText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Provider</label>
                  <input
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Model</label>
                  <input
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Prompt Version</label>
                  <input
                    value={systemPromptVersion}
                    onChange={(e) => setSystemPromptVersion(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">USD / 1k Tokens</label>
                  <input
                    value={costPer1k}
                    onChange={(e) => setCostPer1k(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Request Payload Template (JSON)
                  </label>
                  <textarea
                    rows={5}
                    value={reqTemplateText}
                    onChange={(e) => setReqTemplateText(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Response JSON Path Mapping
                  </label>
                  <textarea
                    rows={5}
                    value={respMappingText}
                    onChange={(e) => setRespMappingText(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Optional Custom Headers (JSON)
                </label>
                <textarea
                  rows={2}
                  value={customHeadersText}
                  onChange={(e) => setCustomHeadersText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-200"
                />
              </div>

              {formError && <p className="text-xs text-rose-400">{formError}</p>}

              <div className="flex justify-end gap-3 pt-3 border-t border-[#242B3D]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-[#242B3D] text-xs text-slate-300 hover:text-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingAgent ? 'Update Adapter' : 'Register Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Agent Evaluation History Modal */}
      {historyAgent && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl border border-[#242B3D] bg-[#121620] rounded-xl p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#242B3D] mb-4">
              <h3 className="text-base font-semibold text-slate-100">
                Evaluation History — {historyAgent.agent.name}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryAgent(null)}
                className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {historyAgent.runs.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                No previous evaluations recorded for this agent.
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242B3D] text-slate-400">
                    <th className="py-2">Run</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Pass / Fail / Inc</th>
                    <th className="py-2 text-right">Reliability</th>
                    <th className="py-2 text-right">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242B3D] font-mono tabular-nums">
                  {historyAgent.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 text-slate-200">#{r.id}</td>
                      <td className="py-2.5">
                        <StatusIndicator status={r.status} />
                      </td>
                      <td className="py-2.5 text-slate-300">
                        {r.passedCount} / {r.failedCount} / {r.inconclusiveCount}
                      </td>
                      <td className="py-2.5 text-right text-violet-300">
                        {r.reliabilityScore !== null ? `${r.reliabilityScore}` : 'N/A'}
                      </td>
                      <td className="py-2.5 text-right text-slate-300">
                        {r.avgLatencyMs !== null ? `${Math.round(r.avgLatencyMs)}ms` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
