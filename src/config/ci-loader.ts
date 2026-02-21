import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ciConfigSchema } from './ci-schema.js';
import type { CIConfig } from './types.js';

const GAUNTLET_DIR = '.gauntlet';
const CI_FILE = 'ci.yml';

export async function loadCIConfig(
  rootDir: string = process.cwd(),
): Promise<CIConfig> {
  const ciPath = path.join(rootDir, GAUNTLET_DIR, CI_FILE);

  if (!(await fileExists(ciPath))) {
    throw new Error(
      `CI configuration file not found at ${ciPath}. Run 'agent-gauntlet ci init' to create it.`,
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
