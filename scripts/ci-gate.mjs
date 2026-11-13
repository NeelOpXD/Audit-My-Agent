#!/usr/bin/env node
import fs from 'node:fs';

const apiUrl = (process.env.AUDIT_API_URL || '').replace(/\/+$/, '');
const ciToken = process.env.AUDIT_CI_TOKEN || '';
const agentId = Number(process.env.AUDIT_AGENT_ID || '0');
const suiteId = process.env.AUDIT_SUITE_ID ? Number(process.env.AUDIT_SUITE_ID) : undefined;
const trials = process.env.AUDIT_TRIALS ? Number(process.env.AUDIT_TRIALS) : 2;

const policy = {
  minReliabilityScore: process.env.AUDIT_MIN_SCORE
    ? Number(process.env.AUDIT_MIN_SCORE)
    : 80,
  minPassCaretK: process.env.AUDIT_MIN_PASS_CARET_K
    ? Number(process.env.AUDIT_MIN_PASS_CARET_K)
    : 80,
  maxP95LatencyMs:
    process.env.AUDIT_MAX_P95_MS === 'null'
      ? null
      : process.env.AUDIT_MAX_P95_MS
        ? Number(process.env.AUDIT_MAX_P95_MS)
        : 5000,
  failOnCriticalRedTeam: process.env.AUDIT_FAIL_RED_TEAM !== 'false',
  failOnObservedLoop: process.env.AUDIT_FAIL_LOOP !== 'false',
};

if (!apiUrl || !ciToken || !Number.isFinite(agentId) || agentId <= 0) {
  console.error(
    'Missing required configuration: set AUDIT_API_URL, AUDIT_CI_TOKEN, and AUDIT_AGENT_ID.'
  );
  process.exit(2);
}

async function run() {
  const response = await fetch(`${apiUrl}/api/ci/gate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ciToken}`,
    },
    body: JSON.stringify({
      agentId,
      suiteId,
      trials,
      wait: true,
      policy,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Unexpected non-JSON response (${response.status}): ${text.slice(0, 300)}`);
    process.exit(2);
  }

  if (!response.ok) {
    console.error(`CI Gate request failed (${response.status}):`, data.error || text);
    process.exit(2);
  }

  console.log('\n' + (data.markdownSummary || JSON.stringify(data, null, 2)) + '\n');

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath && data.markdownSummary) {
    fs.appendFileSync(summaryPath, data.markdownSummary + '\n');
  }

  process.exit(data.passed ? 0 : 1);
}

run().catch((err) => {
  console.error('CI Gate runner error:', err instanceof Error ? err.message : String(err));
  process.exit(2);
});
