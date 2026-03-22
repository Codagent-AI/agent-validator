import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ciConfigSchema } from './ci-schema.js';
import type { CIConfig } from './types.js';

const VALIDATOR_DIR = '.validator';
const LEGACY_GAUNTLET_DIR = '.gauntlet';
const CI_FILE = 'ci.yml';

function resolveConfigDir(rootDir: string): string {
  const validatorPath = path.join(rootDir, VALIDATOR_DIR);
  const gauntletPath = path.join(rootDir, LEGACY_GAUNTLET_DIR);
  // Prefer the dir that already has ci.yml (handles legacy .gauntlet/ projects)
  if (existsSync(path.join(validatorPath, CI_FILE))) return validatorPath;
  if (existsSync(path.join(gauntletPath, CI_FILE))) return gauntletPath;
  // Fall back to whichever dir has the main config
  if (existsSync(path.join(validatorPath, 'config.yml'))) return validatorPath;
  if (existsSync(path.join(gauntletPath, 'config.yml'))) return gauntletPath;
  return validatorPath;
}

export async function loadCIConfig(
  rootDir: string = process.cwd(),
): Promise<CIConfig> {
  const ciPath = path.join(resolveConfigDir(rootDir), CI_FILE);

  if (!(await fileExists(ciPath))) {
    throw new Error(
      `CI configuration file not found at ${ciPath}. Run 'agent-validate ci init' to create it.`,
    );
  }

  const content = await fs.readFile(ciPath, 'utf-8');
  const raw = YAML.parse(content);
  return ciConfigSchema.parse(raw);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}
