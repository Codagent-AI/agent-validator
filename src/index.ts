#!/usr/bin/env node
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import {
  registerCheckCommand,
  registerCICommand,
  registerCleanCommand,
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

program
  .name('agent-validate')
  .description('AI-assisted quality gates')
  .version(packageJson.version);

// Register all commands
registerRunCommand(program);
registerCheckCommand(program);
registerCICommand(program);
registerCleanCommand(program);
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
