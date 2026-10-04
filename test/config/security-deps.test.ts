import { expect, it } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');

it('uses the published braces package and ignores only its unpatched advisory', async () => {
  const config = Bun.YAML.parse(await Bun.file(join(root, '.validator/config.yml')).text()) as {
    entry_points: { checks: Record<string, { command: string }>[] }[];
  };
  const packageJson = await Bun.file(join(root, 'package.json')).json();
  const lockfile = Bun.JSONC.parse(await Bun.file(join(root, 'bun.lock')).text()) as {
    overrides: Record<string, string>;
    packages: Record<string, string[]>;
  };
  const securityDeps = config.entry_points[0].checks.find(
    (check) => 'security-deps' in check,
  );

  expect(securityDeps?.['security-deps'].command).toBe(
    'bun audit --audit-level=moderate --ignore=GHSA-vfj7-8cjw-p6xm',
  );
  expect(packageJson.overrides).not.toHaveProperty('braces');
  expect(lockfile.overrides).not.toHaveProperty('braces');
  expect(lockfile.packages.braces[0]).toBe('braces@3.0.3');
});
