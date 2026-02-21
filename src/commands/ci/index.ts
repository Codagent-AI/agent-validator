import type { Command } from 'commander';
import { initCI } from './init.js';
import { listJobs } from './list-jobs.js';

export function registerCICommand(program: Command): void {
  const ci = program.command('ci').description('Manage CI integration');

  ci.command('init')
    .description('Initialize CI workflow and configuration')
    .action(initCI);

  ci.command('list-jobs')
    .description('List CI jobs (used by workflow)')
    .action(listJobs);
}
