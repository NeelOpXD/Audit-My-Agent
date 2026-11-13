import React, { useEffect, useState } from 'react';
import { Copy, Edit3, Play, Plus, Search, X } from 'lucide-react';
import { auditApi } from '../services/api';
import type { AgentRecord, TestScenarioRecord, TestSuiteRecord } from '../types/audit';

interface TestScenariosPageProps {
  agents: AgentRecord[];
  suites: TestSuiteRecord[];
  onRefreshSuites: () => Promise<void>;
  onScenarioRunStarted: () => void;
}

const CATEGORIES = [
  'all',
  'task_completion',
  'tool_usage',
  'reliability',
  'hallucination',
  'red_team',
  'loop_detection',
];

export function TestScenariosPage({
  agents,
  suites,
  onRefreshSuites,
  onScenarioRunStarted,
}: TestScenariosPageProps) {
  const [scenarios, setScenarios] = useState<TestScenarioRecord[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TestScenarioRecord | null>(null);
  const [runAgentId, setRunAgentId] = useState<number>(agents[0]?.id || 0);
  const [notice, setNotice] = useState<string | null>(null);

  // Form fields
  const [suiteId, setSuiteId] = useState<number>(suites[0]?.id || 0);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('task_completion');
  const [description, setDescription] = useState('');
  const [input, setInput] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [evalMethod, setEvalMethod] = useState('hybrid');
  const [forbiddenToolsText, setForbiddenToolsText] = useState('');

  useEffect(() => {
    if (!runAgentId && agents.length > 0) setRunAgentId(agents[0].id);
  }, [agents, runAgentId]);

  useEffect(() => {
    if (!suiteId && suites.length > 0) setSuiteId(suites[0].id);
  }, [suites, suiteId]);

  const loadScenarios = async () => {
    const data = await auditApi.getScenarios(categoryFilter);
    setScenarios(data);
  };

  useEffect(() => {
    void loadScenarios();
  }, [categoryFilter]);

  const filtered = scenarios.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.scenarioCode.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });

  const openCreate = () => {
    setEditing(null);
    setSuiteId(suites[0]?.id || 0);
    setName('');
    setCategory('task_completion');
    setDescription('');
    setInput('');
    setExpectedBehavior('');
    setSeverity('medium');
    setEvalMethod('hybrid');
    setForbiddenToolsText('');
    setShowModal(true);
  };

  const openEdit = (sc: TestScenarioRecord) => {
    setEditing(sc);
    setSuiteId(sc.suiteId);
    setName(sc.name);
    setCategory(sc.category);
    setDescription(sc.description);
    setInput(sc.input);
    setExpectedBehavior(sc.expectedBehavior);
    setSeverity(sc.severity);
    setEvalMethod(sc.evaluationMethod);
    setForbiddenToolsText((sc.forbiddenTools || []).join(', '));
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const forbiddenTools = forbiddenToolsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (editing) {
      await auditApi.updateScenario(editing.id, {
        name,
        category,
        description,
        input,
        expectedBehavior,
        severity,
        evaluationMethod: evalMethod,
        forbiddenTools,
      });
    } else {
      await auditApi.createScenario({
        suiteId,
        name,
        category,
        description,
        input,
        expectedBehavior,
        severity,
        evaluationMethod: evalMethod,
        forbiddenTools,
      });
    }
    setShowModal(false);
    await loadScenarios();
    await onRefreshSuites();
  };

  const handleClone = async (id: number) => {
    await auditApi.cloneScenario(id);
    await loadScenarios();
    await onRefreshSuites();
  };

  const handleRunSingle = async (sc: TestScenarioRecord) => {
    if (!runAgentId) {
      setNotice('Register or select an agent first to run a single scenario.');
      return;
    }
    const run = await auditApi.startEvaluation({
      agentId: runAgentId,
      suiteId: sc.suiteId,
      trials: 1,
      runType: 'single_scenario',
      scenarioIds: [sc.id],
    });
    setNotice(`Started Run #${run.id} for scenario ${sc.scenarioCode}. Opening Testing Lab...`);
    setTimeout(() => onScenarioRunStarted(), 600);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Versioned Test Scenario Library
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse, clone, edit, and run versioned evaluation scenarios across reliability, tool
            governance, hallucination, and adversarial security categories.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer flex items-center gap-2 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Scenario</span>
        </button>
      </div>

      {/* Filters & Quick-Run Target */}
      <div className="border border-[#242B3D] bg-[#121620] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#0B0D12] text-slate-400 hover:text-slate-100 border border-[#242B3D]'
              }`}
            >
              {cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter scenarios..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-200"
            />
          </div>

          <select
            aria-label="Agent for quick single-scenario run"
            value={runAgentId}
            onChange={(e) => setRunAgentId(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-200"
          >
            {agents.length === 0 && <option value={0}>No agents</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                Run on: {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && (
        <div className="border border-cyan-500/30 bg-[#121620] rounded-lg p-3 text-xs text-cyan-300">
          {notice}
        </div>
      )}

      {/* Scenario Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((sc) => (
          <div
            key={sc.id}
            className="border border-[#242B3D] bg-[#121620] rounded-xl p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-1.5">
                <span className="font-mono">
                  {sc.scenarioCode} · v{sc.version} · {sc.category.replace(/_/g, ' ')}
                </span>
                <span className="capitalize">Severity: {sc.severity}</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{sc.name}</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{sc.description}</p>
              <div className="mt-3 p-2.5 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-[11px] font-mono text-slate-300 line-clamp-2">
                {sc.input}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#242B3D] text-xs">
              <span className="font-mono text-slate-500">{sc.evaluationMethod}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(sc)}
                  title="Edit scenario (creates new version)"
                  className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-slate-500 text-slate-300 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleClone(sc.id)}
                  title="Clone scenario"
                  className="p-1.5 rounded-md border border-[#242B3D] bg-[#0B0D12] hover:border-slate-500 text-slate-300 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunSingle(sc)}
                  className="px-2.5 py-1 rounded-md bg-violet-600/20 border border-violet-500/40 hover:bg-violet-600/30 text-violet-200 cursor-pointer flex items-center gap-1"
                >
                  <Play className="w-3 h-3" />
                  <span>Run</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Scenario Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl border border-[#242B3D] bg-[#121620] rounded-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#242B3D] mb-4">
              <h2 className="text-base font-semibold text-slate-100">
                {editing ? `Edit Scenario (v${editing.version} → v${editing.version + 1})` : 'Create Custom Scenario'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="space-y-3.5">
              {!editing && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Test Suite</label>
                  <select
                    value={suiteId}
                    onChange={(e) => setSuiteId(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                  >
                    {suites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Scenario Name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  >
                    {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Method</label>
                  <select
                    value={evalMethod}
                    onChange={(e) => setEvalMethod(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                  >
                    <option value="hybrid">hybrid</option>
                    <option value="gemini_judge">gemini_judge</option>
                    <option value="tool_event_validation">tool_event_validation</option>
                    <option value="loop_check">loop_check</option>
                    <option value="deterministic">deterministic</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Test Input Prompt</label>
                <textarea
                  required
                  rows={3}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Expected Behavior</label>
                <textarea
                  required
                  rows={2}
                  value={expectedBehavior}
                  onChange={(e) => setExpectedBehavior(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Forbidden Tools (comma-separated)
                </label>
                <input
                  value={forbiddenToolsText}
                  onChange={(e) => setForbiddenToolsText(e.target.value)}
                  placeholder="shell_exec, admin_db_dump"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D12] border border-[#242B3D] text-xs font-mono text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#242B3D]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-[#242B3D] text-xs text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer"
                >
                  {editing ? 'Save New Version' : 'Create Scenario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
