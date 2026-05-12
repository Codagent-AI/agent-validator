import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AGENT_PLUGIN_SOURCE = 'Codagent-AI/agent-validator';

function resolveAgentPluginBin(): string {
  const packageJson = require.resolve('agent-plugin/package.json');
  return path.join(path.dirname(packageJson), 'dist', 'index.js');
}

export function toAgentPluginName(adapterName: string): string {
  if (adapterName === 'github-copilot') return 'copilot';
  return adapterName;
}

export function runAgentPlugin(args: string[]): void {
  execFileSync(process.execPath, [resolveAgentPluginBin(), ...args], {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 120_000,
  });
}

export function installAgentPluginForAgents(opts: {
  agents: string[];
  scope: 'user' | 'project';
  yes?: boolean;
}): void {
  const args = ['add', AGENT_PLUGIN_SOURCE];
  for (const agent of opts.agents) {
    args.push('--agent', toAgentPluginName(agent));
  }
  if (opts.scope === 'project') args.push('--project');
  if (opts.yes) args.push('--yes');
  runAgentPlugin(args);
}

export function updateAgentPluginForAgents(opts: {
  agents: string[];
  scope?: 'user' | 'project';
  yes?: boolean;
}): void {
  const args = ['update', 'agent-validator'];
  for (const agent of opts.agents) {
    args.push('--agent', toAgentPluginName(agent));
  }
  if (opts.scope === 'project') args.push('--project');
  if (opts.yes) args.push('--yes');
  runAgentPlugin(args);
}
