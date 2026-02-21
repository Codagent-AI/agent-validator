import type { LoadedReviewGateConfig } from '../config/types.js';

export { MAX_BUFFER_BYTES } from '../constants.js';
export const MAX_LOG_BUFFER_SIZE = 10000;
export const REVIEW_ADAPTER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Chars-per-token approximation for rough token estimates. */
export const CHARS_PER_TOKEN = 4;

export const JSON_SYSTEM_INSTRUCTION = `
You are in a read-only mode. You may read files in the repository to gather context.
Do NOT attempt to modify files or run shell commands that change system state.
Do NOT access files outside the repository root.
Do NOT access the .git/ directory or read git history/commit information.
Use your available file-reading and search tools to find information.
If the diff is insufficient or ambiguous, use your tools to read the full file content or related files.

CRITICAL SCOPE RESTRICTIONS:
- ONLY review the code changes shown in the diff below
- DO NOT review commit history or existing code outside the diff
- All violations MUST reference file paths and line numbers that appear IN THE DIFF
- The "file" field must match a file from the diff
- The "line" field must be within a changed region (lines starting with + in the diff)

IMPORTANT: You must output ONLY a valid JSON object. Do not output any markdown text, explanations, or code blocks outside of the JSON.
Each violation MUST include a "priority" field with one of: "critical", "high", "medium", "low".
Each violation MUST include a "status" field set to "new".

If violations are found:
{
  "status": "fail",
  "violations": [
    {
      "file": "path/to/file.rb",
      "line": 10,
      "issue": "Description of the violation",
      "fix": "Suggestion on how to fix it",
      "priority": "high",
      "status": "new"
    }
  ]
}

If NO violations are found:
{
  "status": "pass",
  "message": "No problems found"
}
`;

export type ReviewConfig = LoadedReviewGateConfig;

export interface ReviewJsonOutput {
  status: 'pass' | 'fail';
  message?: string;
  violations?: Array<{
    file: string;
    line: number | string;
    issue: string;
    fix?: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    status: 'new' | 'fixed' | 'skipped';
    result?: string | null;
  }>;
}

export interface ReviewOutputEntry {
  adapter: string;
  reviewIndex: number;
  duration?: number;
  status: 'pass' | 'fail' | 'error';
  message: string;
  json?: ReviewJsonOutput;
  skipped?: Array<{
    file: string;
    line: number | string;
    issue: string;
    result?: string | null;
  }>;
}

export interface SkippedSlotOutput {
  adapter: string;
  reviewIndex: number;
  status: 'skipped_prior_pass';
  message: string;
  passIteration: number;
}

export interface ReviewAssignment {
  adapter: string;
  reviewIndex: number;
  skip?: boolean;
  skipReason?: string;
  passIteration?: number;
}

export interface EvaluationResult {
  status: 'pass' | 'fail' | 'error';
  message: string;
  json?: ReviewJsonOutput;
  filteredCount?: number;
}

export interface SingleReviewResult {
  adapter: string;
  reviewIndex: number;
  duration: number;
  evaluation: {
    status: 'pass' | 'fail' | 'error';
    message: string;
    json?: ReviewJsonOutput;
    skipped?: Array<{
      file: string;
      line: number | string;
      issue: string;
      result?: string | null;
    }>;
  };
}
