import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import { auditApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { CiTokenRecord, ExecutionLimits, ReliabilityWeights } from '../types/audit';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const [limits, setLimits] = useState<ExecutionLimits>({
    maxDurationMs: 10000,
    maxSteps: 12,
    maxToolCalls: 8,
    maxRepeatedCalls: 3,
    maxTokenBudget: 16000,
  });
  const [weights, setWeights] = useState<ReliabilityWeights>({
    taskCompletion: 0.3,
    toolCorrectness: 0.2,
    groundedness: 0.2,
    security: 0.2,
    efficiency: 0.1,
  });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [ciTokens, setCiTokens] = useState<CiTokenRecord[]>([]);
  const [newTokenName, setNewTokenName] = useState('GitHub Actions PR Gate');
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    void auditApi.getSettings().then((s) => {
      setLimits(s.defaultLimits);
      setWeights(s.defaultWeights);
    });
    void auditApi.getCiTokens().then(setCiTokens).catch(() => {});
  }, []);

  const handleSave = async () => {
    await auditApi.saveSettings({ defaultLimits: limits, defaultWeights: weights });
    setSavedMsg('Default execution limits and scoring weights saved to PostgreSQL.');
    setTimeout(() => setSavedMsg(null), 3500);
  };

  const handleMintToken = async () => {
    const created = await auditApi.createCiToken(newTokenName || 'GitHub Actions PR Gate');
    if (created.token) {
      setMintedToken(created.token);
      setCopiedToken(false);
    }
    const updated = await auditApi.getCiTokens();
    setCiTokens(updated);
  };

  const handleRevokeToken = async (id: number) => {
    await auditApi.revokeCiToken(id);
    const updated = await auditApi.getCiTokens();
    setCiTokens(updated);
  };

  const handleCopyToken = async () => {
    if (!mintedToken) return;
    await navigator.clipboard.writeText(mintedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Platform Settings & Guardrails
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure default loop-detection limits, reliability scoring weights, CI/CD PR gate
          tokens, and security policies.
        </p>
      </div>

      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">
          Default Loop & Budget Limits
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Duration (ms)</label>
            <input
              type="number"
              value={limits.maxDurationMs}
              onChange={(e) => setLimits({ ...limits, maxDurationMs: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Steps</label>
            <input
              type="number"
              value={limits.maxSteps}
              onChange={(e) => setLimits({ ...limits, maxSteps: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Tool Calls</label>
            <input
              type="number"
              value={limits.maxToolCalls}
              onChange={(e) => setLimits({ ...limits, maxToolCalls: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Repeated Calls</label>
            <input
              type="number"
              value={limits.maxRepeatedCalls}
              onChange={(e) => setLimits({ ...limits, maxRepeatedCalls: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Token Budget</label>
            <input
              type="number"
              value={limits.maxTokenBudget}
              onChange={(e) => setLimits({ ...limits, maxTokenBudget: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
            />
          </div>
        </div>
      </div>

      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">
          Default Reliability Weighting Policy
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {(
            [
              ['taskCompletion', 'Task Completion'],
              ['toolCorrectness', 'Tool Correctness'],
              ['groundedness', 'Groundedness'],
              ['security', 'Security'],
              ['efficiency', 'Efficiency'],
            ] as Array<[keyof ReliabilityWeights, string]>
          ).map(([k, label]) => (
            <div key={k}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={weights[k]}
                onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm font-mono text-slate-100"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[#242B3D]">
          {savedMsg ? (
            <span className="text-xs text-emerald-400">{savedMsg}</span>
          ) : (
            <span className="text-xs text-slate-500">
              SSRF protection blocks loopback, RFC1918 private networks, and cloud metadata IPs for
              external agent URLs.
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Defaults</span>
          </button>
        </div>
      </div>

      {/* CI/CD PR Gate Tokens */}
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span>CI/CD PR Gate API Tokens</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Scoped tokens hashed with SHA-256 at rest for automated GitHub Actions quality gates (
              <code className="text-cyan-300">POST /api/ci/gate</code>).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder="Token label (e.g. GitHub Actions PR Gate)"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => void handleMintToken()}
            className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate CI Token</span>
          </button>
        </div>

        {mintedToken && (
          <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 space-y-2">
            <div className="text-xs text-emerald-300 font-medium">
              Copy this token now — it is hashed before storage and cannot be displayed again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2.5 py-1.5 rounded bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-100 overflow-x-auto">
                {mintedToken}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyToken()}
                className="px-2.5 py-1.5 rounded border border-[#242B3D] bg-[#0B0D12] text-xs text-slate-200 cursor-pointer flex items-center gap-1"
              >
                {copiedToken ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{copiedToken ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {ciTokens.length > 0 && (
          <div className="divide-y divide-[#242B3D] border border-[#242B3D] rounded-lg bg-[#0B0D12]">
            {ciTokens.map((tok) => (
              <div
                key={tok.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-medium text-slate-200">{tok.name}</div>
                  <div className="font-mono text-[11px] text-slate-400">
                    {tok.tokenPrefix} · Created {new Date(tok.createdAt).toLocaleDateString()}
                    {tok.lastUsedAt
                      ? ` · Last used ${new Date(tok.lastUsedAt).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                {tok.revokedAt ? (
                  <span className="text-[11px] font-mono text-rose-400">Revoked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRevokeToken(tok.id)}
                    className="px-2.5 py-1 rounded border border-[#242B3D] hover:border-rose-500/50 text-rose-400 cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Revoke</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <pre className="p-3 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Run PR quality gate from CI (GitHub Actions / CLI):
AUDIT_API_URL="${window.location.origin}" \\
AUDIT_CI_TOKEN="$AUDIT_CI_TOKEN" \\
AUDIT_AGENT_ID="<agent_id>" \\
npm run ci:gate`}
        </pre>
      </div>

      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-100">Authenticated Session</div>
          <div className="text-xs text-slate-400 mt-0.5">{user?.email}</div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="px-3.5 py-2 rounded-lg border border-[#242B3D] hover:border-rose-500/50 text-xs text-rose-400 cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
