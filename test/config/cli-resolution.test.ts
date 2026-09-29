import { expect, it } from 'bun:test';
import {
  describeCliSource, inferDefaultPreference, missingCliConfigMessage,
  resolveEffectiveCli, validateCliSemantics,
} from '../../src/config/cli-resolution.js';

const paths = { projectConfigPath: '/project/.validator/config.yml', globalConfigPath: '/home/.config/agent-validator/config.yml' };
it('resolves project, global, and absent blocks without merging', () => {
  const globalCli = { default_preference: ['codex'], adapters: { codex: { allow_tool_use: false } } };
  const project = resolveEffectiveCli({ ...paths, projectCli: {}, globalCli });
  expect(project?.cli).toEqual({});
  expect(project?.source.kind).toBe('project');
  const inherited = resolveEffectiveCli({ ...paths, projectCli: undefined, globalCli });
  expect(inherited?.source.kind).toBe('global');
  expect(describeCliSource(inherited!.source)).toContain('(global config)');
  inherited!.cli.adapters!.codex = { allow_tool_use: true };
  expect(globalCli.adapters.codex.allow_tool_use).toBe(false);
  expect(resolveEffectiveCli({ ...paths, projectCli: undefined, globalCli: undefined })).toBeUndefined();
  expect(missingCliConfigMessage(paths.projectConfigPath, paths.globalConfigPath)).toContain(paths.globalConfigPath);
});

it('infers preference and validates every tool', () => {
  expect(inferDefaultPreference({ adapters: { codex: { allow_tool_use: true } } }).default_preference).toEqual(['codex']);
  expect(inferDefaultPreference({ default_preference: ['claude'] }).default_preference).toEqual(['claude']);
  expect(validateCliSemantics({})[0]?.field).toBe('cli.default_preference');
  expect(validateCliSemantics({ default_preference: ['not-a-tool'] })[0]?.field).toBe('cli.default_preference[0]');
  expect(validateCliSemantics({ default_preference: ['codex'] })).toEqual([]);
});
