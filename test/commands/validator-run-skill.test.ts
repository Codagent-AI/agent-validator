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
