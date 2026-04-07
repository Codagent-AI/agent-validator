import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { dirExists, loadPromptFile } from './loader-utils.js';
import { checkGateSchema } from './schema.js';
import type { CheckGateConfig, LoadedCheckGateConfig } from './types.js';

const CHECKS_DIR = 'checks';

async function buildLoadedCheck(
  name: string,
  parsed: CheckGateConfig,
  configDir: string,
): Promise<LoadedCheckGateConfig> {
  const fixFile = parsed.fix_instructions_file || parsed.fix_instructions;
  const loadedCheck: LoadedCheckGateConfig = { ...parsed, name };

  if (fixFile) {
    loadedCheck.fixInstructionsContent = await loadPromptFile(
      fixFile,
      configDir,
      `check "${name}"`,
    );
  }
  if (parsed.fix_with_skill) {
    loadedCheck.fixWithSkill = parsed.fix_with_skill;
  }
  return loadedCheck;
}

export async function loadCheckGates(
  configDir: string,
  inlineChecks?: Record<string, CheckGateConfig>,
): Promise<Record<string, LoadedCheckGateConfig>> {
  const checksPath = path.join(configDir, CHECKS_DIR);
  const checks: Record<string, LoadedCheckGateConfig> = {};

  // Load file-based checks
  if (await dirExists(checksPath)) {
    const checkFiles = await fs.readdir(checksPath);
    for (const file of checkFiles) {
      if (!(file.endsWith('.yml') || file.endsWith('.yaml'))) {
        continue;
      }
      const filePath = path.join(checksPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const raw = YAML.parse(content);
      const name = path.basename(file, path.extname(file));
      const parsed: CheckGateConfig = checkGateSchema.parse(raw);
      checks[name] = await buildLoadedCheck(name, parsed, configDir);
    }
  }

  // Merge inline checks from entry_points
  if (inlineChecks) {
    for (const [name, parsed] of Object.entries(inlineChecks)) {
      if (checks[name]) {
        throw new Error(
          `Check "${name}" is defined both inline in an entry point and as a file in ${CHECKS_DIR}/. Remove one to resolve the conflict.`,
        );
      }
      checks[name] = await buildLoadedCheck(name, parsed, configDir);
    }
  }

  return checks;
}
