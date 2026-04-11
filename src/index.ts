#!/usr/bin/env node
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import {
  registerCheckCommand,
  registerCICommand,
  registerCleanCommand,
  registerDemoCommand,
  registerDetectCommand,
  registerHealthCommand,
  registerHelpCommand,
  registerInitCommand,
  registerListCommand,
  registerReviewAuditCommand,
  registerReviewCommand,
  registerRunCommand,
  registerSkipCommand,
  registerStatusCommand,
  registerUpdateCommand,
  registerUpdateReviewCommand,
  registerValidateCommand,
} from './commands/index.js';

const program = new Command();

// BUILD_GIT_SHA is injected at compile time; falls back to semver for npm installs
declare const BUILD_GIT_SHA: string | undefined;
const versionString =
  typeof BUILD_GIT_SHA !== 'undefined' ? BUILD_GIT_SHA : packageJson.version;

program
  .name('agent-validate')
  .description('AI-assisted quality gates')
  .version(versionString);

// Register all commands
registerRunCommand(program);
registerCheckCommand(program);
registerCICommand(program);
registerCleanCommand(program);
registerDemoCommand(program);
registerReviewAuditCommand(program);
registerReviewCommand(program);
registerDetectCommand(program);
registerListCommand(program);
registerHealthCommand(program);
registerInitCommand(program);
registerUpdateCommand(program);
registerUpdateReviewCommand(program);
registerValidateCommand(program);
registerSkipCommand(program);
registerStatusCommand(program);
registerHelpCommand(program);

// Default action: help
if (process.argv.length < 3) {
  process.argv.push('help');
}

program.parse(process.argv);
