import { beforeEach, describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerUpdateReviewCommand } from '../../src/commands/update-review.js';

describe('Update-Review Command', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    registerUpdateReviewCommand(program);
  });

  it('should register the update-review command', () => {
    const cmd = program.commands.find(
      (cmd) => cmd.name() === 'update-review',
    );
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe('Manage review violations');
  });

  it('should have list subcommand', () => {
    const updateReview = program.commands.find(
      (cmd) => cmd.name() === 'update-review',
    );
    const listCmd = updateReview?.commands.find(
      (cmd) => cmd.name() === 'list',
    );
    expect(listCmd).toBeDefined();
    expect(listCmd?.description()).toBe(
      'List pending review violations with numeric IDs',
    );
  });

  it('should have fix subcommand', () => {
    const updateReview = program.commands.find(
      (cmd) => cmd.name() === 'update-review',
    );
    const fixCmd = updateReview?.commands.find(
      (cmd) => cmd.name() === 'fix',
    );
    expect(fixCmd).toBeDefined();
    expect(fixCmd?.description()).toBe('Mark a violation as fixed');
  });

  it('should have skip subcommand', () => {
    const updateReview = program.commands.find(
      (cmd) => cmd.name() === 'update-review',
    );
    const skipCmd = updateReview?.commands.find(
      (cmd) => cmd.name() === 'skip',
    );
    expect(skipCmd).toBeDefined();
    expect(skipCmd?.description()).toBe('Mark a violation as skipped');
  });
});
