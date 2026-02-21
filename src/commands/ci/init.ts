import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import YAML from 'yaml';
import { loadCIConfig } from '../../config/ci-loader.js';
import type { CIConfig } from '../../config/types.js';
import workflowTemplate from '../../templates/workflow.yml' with {
  type: 'text',
};

export async function initCI(): Promise<void> {
  const workflowDir = path.join(process.cwd(), '.github', 'workflows');
  const workflowPath = path.join(workflowDir, 'gauntlet.yml');
  const gauntletDir = path.join(process.cwd(), '.gauntlet');
  const ciConfigPath = path.join(gauntletDir, 'ci.yml');

  // 1. Ensure .gauntlet/ci.yml exists
  if (await fileExists(ciConfigPath)) {
    console.log(chalk.dim('Found existing .gauntlet/ci.yml'));
  } else {
    console.log(chalk.yellow('Creating starter .gauntlet/ci.yml...'));
    await fs.mkdir(gauntletDir, { recursive: true });
    const starterContent = `# CI Configuration for Agent Gauntlet
# Define runtimes, services, and which checks to run in CI.

runtimes:
  # ruby:
  #   version: "3.3"
  #   bundler_cache: true

services:
  # postgres:
  #   image: postgres:16
  #   ports: ["5432:5432"]

setup:
  # - name: Global Setup
  #   run: echo "Setting up..."

checks:
  # - name: linter
  #   requires_runtimes: [ruby]
`;
    await fs.writeFile(ciConfigPath, starterContent);
  }

  // 2. Load CI config to get services
  let ciConfig: CIConfig | undefined;
  try {
    ciConfig = await loadCIConfig();
  } catch (_e) {
    console.warn(
      chalk.yellow(
        'Could not load CI config to inject services. Workflow will have no services defined.',
      ),
    );
  }

  // 3. Generate workflow file
  console.log(chalk.dim(`Generating ${workflowPath}...`));
  await fs.mkdir(workflowDir, { recursive: true });

  let templateContent = workflowTemplate;

  // Inject services
  if (ciConfig?.services && Object.keys(ciConfig.services).length > 0) {
    const servicesYaml = YAML.stringify({ services: ciConfig.services });
    // Indent services
    const indentedServices = servicesYaml
      .split('\n')
      .map((line) => (line.trim() ? `    ${line}` : line))
      .join('\n');

    templateContent = templateContent.replace(
      '    # Services will be injected here by agent-gauntlet',
      indentedServices,
    );
  } else {
    templateContent = templateContent.replace(
      '    # Services will be injected here by agent-gauntlet\n',
      '',
    );
  }

  await fs.writeFile(workflowPath, templateContent);
  console.log(chalk.green('Successfully generated GitHub Actions workflow!'));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}
