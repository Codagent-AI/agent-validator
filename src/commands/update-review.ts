import fs from 'node:fs/promises';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import type { ReviewFullJsonOutput } from '../gates/result.js';
import { enumerateNewViolations } from '../output/report.js';

async function ensureLogDir(logDir: string): Promise<void> {
  try {
    await fs.stat(logDir);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      console.error(`Error: Log directory does not exist: ${logDir}`);
      process.exit(1);
    }
    throw new Error(
      `Failed to access log directory ${logDir}: ${String(error)}`,
    );
  }
}

function printViolation(
  v: ReturnType<typeof enumerateNewViolations> extends Promise<(infer T)[]>
    ? T
    : never,
): void {
  const priorityStr = v.priority ? ` [${v.priority}]` : '';
  console.log(`#${v.id}${priorityStr} ${v.gateLabel} (${v.adapterSuffix})`);
  console.log(`  ${v.file}:${v.line} - ${v.issue}`);
  if (v.fix) {
    console.log(`  Fix: ${v.fix}`);
  }
  console.log(`  JSON: ${v.jsonPath}`);
  console.log('');
}

export function registerUpdateReviewCommand(program: Command): void {
  const cmd = program
    .command('update-review')
    .description('Manage review violations');

  cmd
    .command('list')
    .description('List pending review violations with numeric IDs')
    .action(async () => {
      try {
        const config = await loadConfig();
        const logDir = config.project.log_dir;

        await ensureLogDir(logDir);

        const violations = await enumerateNewViolations(logDir);

        if (violations.length === 0) {
          console.log('No pending violations.');
          process.exit(0);
        }

        for (const v of violations) {
          printViolation(v);
        }

        process.exit(0);
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error(`Error: ${err.message || 'Unknown error'}`);
        process.exit(1);
      }
    });

  cmd
    .command('fix <id> <reason>')
    .description('Mark a violation as fixed')
    .action(async (idStr: string, reason: string | undefined) => {
      await updateViolation(idStr, reason, 'fixed');
    });

  cmd
    .command('skip <id> <reason>')
    .description('Mark a violation as skipped')
    .action(async (idStr: string, reason: string | undefined) => {
      await updateViolation(idStr, reason, 'skipped');
    });
}

async function updateViolation(
  idStr: string,
  reason: string | undefined,
  newStatus: 'fixed' | 'skipped',
): Promise<void> {
  try {
    if (!reason) {
      console.error(
        `Error: Missing reason. Usage: agent-validate update-review ${newStatus} <id> "<reason>"`,
      );
      process.exit(1);
    }

    const id = parseInt(idStr, 10);
    if (Number.isNaN(id) || id < 1) {
      console.error(`Error: Invalid ID: ${idStr}`);
      process.exit(1);
    }

    const config = await loadConfig();
    const logDir = config.project.log_dir;

    const violations = await enumerateNewViolations(logDir);
    const target = violations.find((v) => v.id === id);

    if (!target) {
      console.error(
        `Error: Violation #${id} not found. Use 'update-review list' to see available violations.`,
      );
      process.exit(1);
    }

    // Read the JSON file
    const content = await fs.readFile(target.jsonPath, 'utf-8');
    const data: ReviewFullJsonOutput = JSON.parse(content);

    // Verify the violation is still "new"
    const violation = data.violations[target.violationIndex];
    if (!violation) {
      console.error(
        `Error: Violation at index ${target.violationIndex} not found in ${target.jsonPath}`,
      );
      process.exit(1);
    }

    const currentStatus = violation.status || 'new';
    if (currentStatus !== 'new') {
      console.error(
        `Error: Violation #${id} is already ${currentStatus} and cannot be updated.`,
      );
      process.exit(1);
    }

    // Update the violation
    violation.status = newStatus;
    violation.result = reason;

    // Write back
    await fs.writeFile(target.jsonPath, JSON.stringify(data, null, 2), 'utf-8');

    const action = newStatus === 'fixed' ? 'Fixed' : 'Skipped';
    console.log(
      `${action} violation #${id}: ${target.file}:${target.line} - ${target.issue}`,
    );
    process.exit(0);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error(`Error: ${err.message || 'Unknown error'}`);
    process.exit(1);
  }
}
