import { expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

it('instructs agents to record review decisions through update-review', async () => {
  const skill = await fs.readFile(
    path.join(import.meta.dir, '../../skills/validator-run/SKILL.md'),
    'utf-8',
  );
  expect(skill).toContain('agent-validate update-review list');
  expect(skill).toContain('agent-validate update-review fix <id>');
  expect(skill).toContain('agent-validate update-review skip <id>');
  expect(skill).not.toContain('### Update Prompt');
  expect(skill).not.toContain('Write the updated JSON');
});

it('gets review violations from update-review list and reuses their IDs', async () => {
  const skill = await fs.readFile(path.join(import.meta.dir, '../../skills/validator-run/SKILL.md'), 'utf-8');
  const step3 = skill.split('### Step 3 - Extract Failures')[1]?.split('### Step 4')[0];
  const step4 = skill.split('### Step 4 - Report Failures')[1]?.split('### Step 5')[0];
  const step6 = skill.split('### Step 6 - Update Review Decisions')[1]?.split('### Step 7')[0];
  expect(step3).toContain('agent-validate update-review list');
  expect(step3).toContain('priority');
  expect(step3).toContain('file:line');
  expect(step4).toContain('update-review list');
  expect(step6).toContain('IDs from Step 3');
});

it('uses only reported check details and never scans logs or reads review JSON', async () => {
  const skill = await fs.readFile(path.join(import.meta.dir, '../../skills/validator-run/SKILL.md'), 'utf-8');
  const step3 = skill.split('### Step 3 - Extract Failures')[1]?.split('### Step 4')[0];
  expect(step3).toContain('CHECK FAILURES');
  expect(step3).toContain('command');
  expect(step3).toContain('Fix Instructions');
  expect(step3).toContain('Fix Skill');
  expect(step3).toContain('one named log file');
  expect(step3).toContain('re-run');
  expect(step3).toContain('Do not list or scan the log directory');
  expect(step3).toContain('Do not read review JSON files');
});

it('removes extraction subagents and allows Bash only', async () => {
  const skill = await fs.readFile(path.join(import.meta.dir, '../../skills/validator-run/SKILL.md'), 'utf-8');
  expect(skill).toContain('allowed-tools: Bash\n');
  expect(skill).not.toContain('Task');
  expect(skill).not.toContain('Extract Prompt');
  expect(skill).not.toContain('Subagent Prompts');
  expect(skill).not.toContain('run_in_background');
});
