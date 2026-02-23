import type { PreviousViolation } from './result.js';
import type { ReviewConfig } from './review-types.js';
import { JSON_SYSTEM_INSTRUCTION } from './review-types.js';

// ── Prompt Building ─────────────────────────────────────────────────

export function buildReviewPrompt(
  config: ReviewConfig,
  previousViolations: PreviousViolation[] = [],
): string {
  const baseContent = config.promptContent || '';

  if (previousViolations.length > 0) {
    return (
      baseContent +
      '\n\n' +
      buildPreviousFailuresSection(previousViolations) +
      '\n' +
      JSON_SYSTEM_INSTRUCTION
    );
  }

  return `${baseContent}\n${JSON_SYSTEM_INSTRUCTION}`;
}

export function buildPreviousFailuresSection(
  violations: PreviousViolation[],
): string {
  const toVerify = violations.filter((v) => v.status === 'fixed');
  const unaddressed = violations.filter((v) => v.status === 'new' || !v.status);
  const affectedFiles = [...new Set(violations.map((v) => v.file))];
  const lines: string[] = [];

  lines.push(buildRerunHeader());
  lines.push(...formatVerifySection(toVerify));
  lines.push(...formatUnaddressedSection(unaddressed));
  lines.push(buildRerunInstructions(affectedFiles));
  return lines.join('\n');
}

function formatVerifySection(toVerify: PreviousViolation[]): string[] {
  if (toVerify.length === 0) {
    return ['(No violations were marked as FIXED for verification)\n'];
  }
  const lines: string[] = [];
  for (const [i, v] of toVerify.entries()) {
    lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
    if (v.fix) lines.push(`   Suggested fix: ${v.fix}`);
    if (v.result) lines.push(`   Agent result: ${v.result}`);
    lines.push('');
  }
  return lines;
}

function formatUnaddressedSection(unaddressed: PreviousViolation[]): string[] {
  if (unaddressed.length === 0) return [];
  const lines: string[] = [buildUnaddressedHeader()];
  for (const [i, v] of unaddressed.entries()) {
    lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
  }
  lines.push('');
  return lines;
}

const RERUN_SEPARATOR = '\u2501'.repeat(46);

function buildRerunHeader(): string {
  return `${RERUN_SEPARATOR}\nRERUN MODE: VERIFY PREVIOUS FIXES ONLY\n${RERUN_SEPARATOR}\n\nThis is a RERUN review. The agent attempted to fix some of the violations listed below.\nYour task is STRICTLY LIMITED to verifying the fixes for violations marked as FIXED.\n\nPREVIOUS VIOLATIONS TO VERIFY:\n`;
}

function buildUnaddressedHeader(): string {
  return 'UNADDRESSED VIOLATIONS (STILL FAILING):\nThe following violations were NOT marked as fixed or skipped and are still active failures:\n';
}

function buildRerunInstructions(affectedFiles: string[]): string {
  const files = affectedFiles.join(', ');
  return [
    'STRICT INSTRUCTIONS FOR RERUN MODE:',
    '',
    '1. VERIFY FIXES: Check if each violation marked as FIXED above has been addressed',
    '   - For violations that are fixed, confirm they no longer appear',
    '   - For violations that remain unfixed, include them in your violations array (status: "new")',
    '',
    '2. UNADDRESSED VIOLATIONS: You MUST include all UNADDRESSED violations listed above in your output array if they still exist.',
    '',
    '3. CHECK FOR REGRESSIONS ONLY: You may ONLY report NEW violations if they:',
    `   - Are in FILES that were modified to fix the above violations: ${files}`,
    '   - Are DIRECTLY caused by the fix changes (e.g., a fix introduced a new bug)',
    '   - Are in the same function/region that was modified to address a previous violation',
    '',
    '4. Return status "pass" ONLY if ALL previous violations (including unaddressed ones) are now fixed AND no regressions were introduced.',
    '   Otherwise, return status "fail" and list all remaining violations.',
    '',
    RERUN_SEPARATOR,
  ].join('\n');
}
