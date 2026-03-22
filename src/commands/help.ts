import chalk from 'chalk';
import type { Command } from 'commander';

export function registerHelpCommand(program: Command): void {
  program
    .command('help')
    .description('Show help information')
    .action(() => {
      console.log(chalk.bold('Agent Validator - AI-assisted quality gates\n'));
      console.log(
        'Agent Validator runs quality gates (checks + AI reviews) for only the parts',
      );
      console.log(
        'of your repo that changed, based on a configurable set of entry points.\n',
      );
      console.log(chalk.bold('Commands:\n'));
      console.log('  run           Run gates for detected changes');
      console.log('  check         Run only applicable checks');
      console.log('  review        Run only applicable reviews');
      console.log(
        '  clean         Archive logs (move current logs into previous/)',
      );
      console.log(
        '  detect        Show what gates would run (without executing them)',
      );
      console.log('  list          List configured gates');
      console.log('  health        Check CLI tool availability');
      console.log('  init          Initialize .validator configuration');
      console.log('  validate      Validate config files against schemas');
      console.log(
        '  skip          Advance execution state baseline without running gates',
      );
      console.log(
        '  status        Show a summary of the most recent validator session',
      );
      console.log(
        '  review-audit  Audit review execution from the debug log (--date or --since)',
      );
      console.log('  ci            CI integration commands (init, list-jobs)');
      console.log('  help          Show this help message\n');
      console.log(
        'For more information, see: https://github.com/pacaplan/agent-gauntlet',
      );
      console.log('Or run: agent-validate <command> --help');
    });
}
