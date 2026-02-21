import type { z } from 'zod';
import type {
  ciCheckConfigSchema,
  ciConfigSchema,
  ciSetupStepSchema,
  runtimeConfigSchema,
  serviceConfigSchema,
} from './ci-schema.js';
import type {
  adapterConfigSchema,
  checkGateSchema,
  cliConfigSchema,
  entryPointSchema,
  gauntletConfigSchema,
  reviewGateSchema,
  reviewPromptFrontmatterSchema,
  reviewYamlSchema,
} from './schema.js';

export type CheckGateConfig = z.infer<typeof checkGateSchema>;
export type ReviewGateConfig = z.infer<typeof reviewGateSchema>;
export type ReviewPromptFrontmatter = z.infer<
  typeof reviewPromptFrontmatterSchema
>;
export type EntryPointConfig = z.infer<typeof entryPointSchema>;
export type GauntletConfig = z.infer<typeof gauntletConfigSchema>;
export type CLIConfig = z.infer<typeof cliConfigSchema>;
export type AdapterConfig = z.infer<typeof adapterConfigSchema>;

export type CIConfig = z.infer<typeof ciConfigSchema>;
export type CICheckConfig = z.infer<typeof ciCheckConfigSchema>;
export type CISetupStep = z.infer<typeof ciSetupStepSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export type ReviewYamlConfig = z.infer<typeof reviewYamlSchema>;

// Extended check config with loaded content
export interface LoadedCheckGateConfig extends CheckGateConfig {
  name: string;
  fixInstructionsContent?: string;
  fixWithSkill?: string;
}

// Extended review config with loaded content
export interface LoadedReviewGateConfig {
  name: string;
  prompt: string; // filename or source identifier
  promptContent?: string; // loaded prompt content (undefined when skill_name is used)
  skillName?: string; // CLI skill name for prompt delegation
  model?: string;
  cli_preference?: string[];
  num_reviews: number;
  parallel: boolean;
  run_in_ci: boolean;
  run_locally: boolean;
  timeout?: number;
}

// Combined type for the fully loaded configuration
export interface LoadedConfig {
  project: GauntletConfig;
  checks: Record<string, LoadedCheckGateConfig>;
  reviews: Record<string, LoadedReviewGateConfig>;
}
