export type GateStatus = "pass" | "fail" | "error";

export interface PreviousViolation {
	file: string;
	line: number | string;
	issue: string;
	fix?: string;
	priority?: "critical" | "high" | "medium" | "low";
	status?: "new" | "fixed" | "skipped";
	result?: string | null;
}

export interface ReviewFullJsonOutput {
	adapter: string;
	timestamp: string;
	status: "pass" | "fail" | "error" | "skipped_prior_pass";
	rawOutput: string;
	violations: PreviousViolation[];
	passIteration?: number; // Only present when status is "skipped_prior_pass"
}

export interface GateResult {
	jobId: string;
	status: GateStatus;
	duration: number; // ms
	message?: string; // summary message
	logPath?: string; // path to full log
	logPaths?: string[]; // paths to multiple logs (e.g. per-agent logs)
	fixInstructions?: string; // Markdown content for fixing failures
	fixWithSkill?: string; // CLI skill name for fixing failures
	errorCount?: number; // Number of active failures/violations
	fixedCount?: number; // Number of violations marked as fixed
	skipped?: Array<{
		file: string;
		line: number | string;
		issue: string;
		result?: string | null;
	}>;
	subResults?: Array<{
		nameSuffix: string;
		status: GateStatus;
		message: string;
		logPath?: string;
		errorCount?: number;
		fixedCount?: number;
		skipped?: Array<{
			file: string;
			line: number | string;
			issue: string;
			result?: string | null;
		}>;
	}>;
}
