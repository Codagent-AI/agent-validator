import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import YAML from 'yaml';
import { loadCIConfig, resolveConfigDir } from '../../config/ci-loader.js';
import type { CIConfig } from '../../config/types.js';
import workflowTemplate from '../../templates/workflow.yml' with {
  type: 'text',
};

export async function initCI(): Promise<void> {
  const cwd = process.cwd();
  const workflowDir = path.join(cwd, '.github', 'workflows');
  const workflowPath = path.join(workflowDir, 'validator.yml');
  const configDir = resolveConfigDir(cwd);
  const ciConfigPath = path.join(configDir, 'ci.yml');
  const configDirName = path.basename(configDir);

  // 1. Ensure <config-dir>/ci.yml exists
  if (await fileExists(ciConfigPath)) {
    console.log(chalk.dim(`Found existing ${configDirName}/ci.yml`));
  } else {
    console.log(chalk.yellow(`Creating starter ${configDirName}/ci.yml...`));
    await fs.mkdir(configDir, { recursive: true });
    const starterContent = `# CI Configuration for Agent Validator
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
      '    # Services will be injected here by agent-validator',
      indentedServices,
    );
  } else {
    templateContent = templateContent.replace(
      '    # Services will be injected here by agent-validator\n',
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
