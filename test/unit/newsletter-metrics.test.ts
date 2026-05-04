import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildMetricsReport,
  formatReport,
} from '../../src/scripts/newsletter-metrics.js';

const TEST_DIR = path.join(os.tmpdir(), `newsletter-metrics-${Date.now()}`);

async function writeRepo(
  name: string,
  debugLog: string,
  reviewJson?: string,
): Promise<string> {
  const repo = path.join(TEST_DIR, name);
  await fs.mkdir(path.join(repo, '.validator'), { recursive: true });
  await fs.mkdir(path.join(repo, 'validator_logs', 'previous'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repo, '.validator', 'config.yml'),
    `cli:
  default_preference:
    - codex
  adapters:
    codex:
      model: gpt-test
entry_points:
  - path: "."
    reviews:
      - code-quality:
          builtin: code-quality
debug_log:
  enabled: true
`,
  );
  await fs.writeFile(path.join(repo, 'validator_logs', '.debug.log'), debugLog);
  if (reviewJson) {
    await fs.writeFile(
      path.join(
        repo,
        'validator_logs',
        'previous',
        'review_._code-quality_codex@1.2.json',
      ),
      reviewJson,
    );
  }
  return repo;
}

describe('newsletter metrics script', () => {
  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('aggregates review metrics across repositories', async () => {
    const repoA = await writeRepo(
      'repo-a',
      `[2026-05-01T10:00:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-05-01T10:00:10.000] GATE_RESULT review:.:code-quality cli=codex status=fail duration=10.0s violations=2
[2026-05-01T10:00:10.100] RUN_END status=fail fixed=0 skipped=0 failed=2 iterations=1 duration=10.1s
[2026-05-01T10:02:00.000] RUN_START mode=verification files_changed=1 gates=1
[2026-05-01T10:02:05.000] GATE_RESULT review:.:code-quality cli=codex status=pass duration=5.0s violations=0
[2026-05-01T10:02:05.100] RUN_END status=pass fixed=0 skipped=0 failed=0 iterations=2 duration=5.1s
`,
      JSON.stringify({
        adapter: 'codex',
        timestamp: '2026-05-01T10:02:05.000Z',
        violations: [{ status: 'fixed' }, { status: 'skipped' }],
      }),
    );
    const repoB = await writeRepo(
      'repo-b',
      `[2026-05-01T11:00:00.000] RUN_START mode=full files_changed=1 gates=1
[2026-05-01T11:00:08.000] GATE_RESULT review:.:code-quality cli=codex status=fail duration=8.0s violations=1
[2026-05-01T11:00:08.100] RUN_END status=fail fixed=0 skipped=0 failed=1 iterations=1 duration=8.1s
`,
    );

    const report = await buildMetricsReport({
      sources: [repoA, repoB],
      since: '2026-05-01',
      until: '2026-05-01',
      days: 30,
      format: 'markdown',
      modelOverrides: new Map(),
    });

    expect(report.sources).toHaveLength(2);
    expect(report.combined).toHaveLength(1);
    expect(report.combined[0]).toMatchObject({
      reviewer: 'code-quality',
      cli: 'codex',
      model: 'gpt-test',
      executions: 3,
      cycles: 3,
      issuesFound: 3,
      fixedNextCycle: 2,
      jsonFixed: 1,
      jsonSkipped: 1,
    });
    expect(formatReport(report, 'markdown')).toContain(
      '| code-quality | codex | gpt-test |',
    );
  });
});
