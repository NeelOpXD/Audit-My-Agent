import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { AppShell, type NavSection } from './components/AppShell';
import { auditApi } from './services/api';
import type { AgentRecord, EvaluationRunRecord, TestSuiteRecord } from './types/audit';
import { OverviewPage } from './pages/OverviewPage';
import { AgentsPage } from './pages/AgentsPage';
import { TestingLabPage } from './pages/TestingLabPage';
import { RedTeamPage } from './pages/RedTeamPage';
import { ExecutionTracesPage } from './pages/ExecutionTracesPage';
import { BenchmarkingPage } from './pages/BenchmarkingPage';
import { ReliabilityReportsPage } from './pages/ReliabilityReportsPage';
import { TestScenariosPage } from './pages/TestScenariosPage';
import { SettingsPage } from './pages/SettingsPage';

function Workspace() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState<NavSection>('overview');
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [suites, setSuites] = useState<TestSuiteRecord[]>([]);
  const [recentRuns, setRecentRuns] = useState<EvaluationRunRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [traceExecutionId, setTraceExecutionId] = useState<string | null>(null);
  const [reportRunId, setReportRunId] = useState<number | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const loadWorkspaceData = useCallback(async () => {
    if (!user) return;
    try {
      const [agList, suiteList, runList] = await Promise.all([
        auditApi.getAgents(),
        auditApi.getSuites(),
        auditApi.getEvaluations(),
      ]);
      setAgents(agList);
      setSuites(suiteList);
      setRecentRuns(runList);
      setRefreshSignal((s) => s + 1);
    } catch (err) {
      console.error('Failed to synchronize workspace data:', err);
    }
  }, [user]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  const handleDeploySamples = async () => {
    await auditApi.deploySampleAgents();
    await loadWorkspaceData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0D12] flex items-center justify-center text-sm text-slate-400">
        Initializing Audit-My-Agent workspace...
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <AppShell
      activeSection={section}
      onNavigate={setSection}
      agents={agents}
      selectedAgentId={selectedAgentId}
      onSelectAgent={setSelectedAgentId}
      recentRuns={recentRuns}
      onQuickSearchNavigate={(target, payload) => {
        if (payload?.agentId) setSelectedAgentId(payload.agentId);
        if (payload?.runId) setReportRunId(payload.runId);
        setSection(target);
      }}
    >
      {section === 'overview' && (
        <OverviewPage
          onNavigate={setSection}
          onDeploySamples={handleDeploySamples}
          refreshSignal={refreshSignal}
        />
      )}
      {section === 'agents' && (
        <AgentsPage
          agents={agents}
          onRefresh={loadWorkspaceData}
          onDeploySamples={handleDeploySamples}
          onRunAgentTest={(id) => {
            setSelectedAgentId(id);
            setSection('testing-lab');
          }}
        />
      )}
      {section === 'testing-lab' && (
        <TestingLabPage
          agents={agents}
          suites={suites}
          selectedAgentId={selectedAgentId}
          onRefreshAll={loadWorkspaceData}
          onInspectTrace={(execId) => {
            setTraceExecutionId(execId);
            setSection('traces');
          }}
        />
      )}
      {section === 'red-team' && (
        <RedTeamPage
          agents={agents}
          suites={suites}
          selectedAgentId={selectedAgentId}
          onRefreshAll={loadWorkspaceData}
          onInspectTrace={(execId) => {
            setTraceExecutionId(execId);
            setSection('traces');
          }}
        />
      )}
      {section === 'traces' && (
        <ExecutionTracesPage initialExecutionId={traceExecutionId} />
      )}
      {section === 'benchmarking' && (
        <BenchmarkingPage agents={agents} suites={suites} />
      )}
      {section === 'reports' && (
        <ReliabilityReportsPage initialRunId={reportRunId} />
      )}
      {section === 'scenarios' && (
        <TestScenariosPage
          agents={agents}
          suites={suites}
          onRefreshSuites={loadWorkspaceData}
          onScenarioRunStarted={() => setSection('testing-lab')}
        />
      )}
      {section === 'settings' && <SettingsPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Workspace />
    </AuthProvider>
  );
}
