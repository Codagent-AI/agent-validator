import { spawn } from "node:child_process";
import type { Command } from "commander";

/**
 * Output structure from wait-ci command.
 */
export interface WaitCIResult {
	ci_status: "passed" | "failed" | "pending" | "error";
	pr_number?: number;
	pr_url?: string;
	failed_checks: Array<{
		name: string;
		conclusion: string;
		details_url: string;
	}>;
	review_comments: Array<{
		author: string;
		body: string;
		path?: string;
		line?: number;
	}>;
	elapsed_seconds: number;
	error_message?: string;
}

/**
 * Check if gh CLI is available.
 */
async function isGhAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("gh", ["--version"], { stdio: "pipe" });
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
}

/**
 * Run a gh command and return the output.
 */
async function runGh(
	args: string[],
	cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn("gh", args, { stdio: "pipe", cwd });
		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
		proc.on("error", (err) => {
			resolve({ code: 1, stdout: "", stderr: err.message });
		});
	});
}

/**
 * Get PR info for the current branch.
 * Returns null if no PR found or on error.
 */
async function getPRInfo(
	cwd?: string,
): Promise<{ number: number; url: string; headRefName: string } | null> {
	const result = await runGh(
		["pr", "view", "--json", "number,url,headRefName"],
		cwd,
	);
	if (result.code !== 0) {
		return null;
	}
	try {
		return JSON.parse(result.stdout.trim());
	} catch {
		return null;
	}
}

/**
 * Get CI check statuses for a PR.
 * Returns null on error, empty array if no checks.
 * Note: gh pr checks uses 'state' (FAILURE/SUCCESS/PENDING) and 'link' (not conclusion/detailsUrl)
 */
async function getChecks(cwd?: string): Promise<Array<{
	name: string;
	state: string;
	link: string;
}> | null> {
	const result = await runGh(
		["pr", "checks", "--json", "name,state,link"],
		cwd,
	);
	if (result.code !== 0) {
		return null;
	}
	try {
		return JSON.parse(result.stdout.trim()) || [];
	} catch {
		return null;
	}
}

/**
 * Get reviews for a PR.
 * Returns null on error, empty array if no reviews.
 */
async function getReviews(
	prNumber: number,
	cwd?: string,
): Promise<Array<{
	author: { login: string };
	state: string;
	body: string;
}> | null> {
	// Get owner/repo from gh
	const repoResult = await runGh(["repo", "view", "--json", "owner,name"], cwd);
	if (repoResult.code !== 0) {
		return null;
	}
	let owner: string;
	let repo: string;
	try {
		const repoInfo = JSON.parse(repoResult.stdout.trim());
		owner = repoInfo.owner.login;
		repo = repoInfo.name;
	} catch {
		return null;
	}

	const result = await runGh(
		["api", `repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`],
		cwd,
	);
	if (result.code !== 0) {
		return null;
	}
	try {
		// GitHub API returns 'user' not 'author', so we transform the response
		const rawReviews = JSON.parse(result.stdout.trim()) || [];
		return rawReviews
			.filter(
				(r: { user?: { login: string }; state: string; body: string }) =>
					r.user?.login,
			)
			.map((r: { user: { login: string }; state: string; body: string }) => ({
				author: { login: r.user.login },
				state: r.state,
				body: r.body || "",
			}));
	} catch {
		return null;
	}
}

/**
 * Get the latest review state per author.
 * GitHub API returns all historical reviews, so we need to deduplicate
 * to find each reviewer's current state.
 */
function getLatestReviewsByAuthor(
	reviews: Array<{ author: { login: string }; state: string; body: string }>,
): Array<{ author: { login: string }; state: string; body: string }> {
	const latestByAuthor = new Map<
		string,
		{ author: { login: string }; state: string; body: string }
	>();
	// Process in order - later reviews override earlier ones
	for (const review of reviews) {
		latestByAuthor.set(review.author.login, review);
	}
	return Array.from(latestByAuthor.values());
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Helper to create error result */
function createErrorResult(
	startTime: number,
	message: string,
	prInfo?: { number: number; url: string },
): WaitCIResult {
	return {
		ci_status: "error",
		pr_number: prInfo?.number,
		pr_url: prInfo?.url,
		failed_checks: [],
		review_comments: [],
		elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
		error_message: message,
	};
}

/** Helper to create passed result */
function createPassedResult(
	startTime: number,
	prInfo: { number: number; url: string },
): WaitCIResult {
	return {
		ci_status: "passed",
		pr_number: prInfo.number,
		pr_url: prInfo.url,
		failed_checks: [],
		review_comments: [],
		elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
	};
}

/** Helper to create failed result */
function createFailedResult(
	startTime: number,
	prInfo: { number: number; url: string },
	failedChecks: Array<{ name: string; state: string; link: string }>,
	reviewComments: Array<{ author: string; body: string }>,
): WaitCIResult {
	return {
		ci_status: "failed",
		pr_number: prInfo.number,
		pr_url: prInfo.url,
		failed_checks: failedChecks.map((c) => ({
			name: c.name,
			conclusion: c.state.toLowerCase(),
			details_url: c.link,
		})),
		review_comments: reviewComments,
		elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
	};
}

/** Process poll data and determine result or continue polling */
function processPollData(
	checks: Array<{ name: string; state: string; link: string }>,
	reviews: Array<{ author: { login: string }; state: string; body: string }>,
): {
	shouldFail: boolean;
	shouldPass: boolean;
	failedChecks: Array<{ name: string; state: string; link: string }>;
	reviewComments: Array<{ author: string; body: string }>;
} {
	const latestReviews = getLatestReviewsByAuthor(reviews);
	const failedChecks = checks.filter((c) => c.state === "FAILURE");
	const blockingReviews = latestReviews.filter(
		(r) => r.state === "CHANGES_REQUESTED",
	);
	const reviewComments = blockingReviews.map((r) => ({
		author: r.author.login,
		body: r.body || "",
	}));
	const pendingChecks = checks.filter(
		(c) =>
			c.state === "PENDING" ||
			c.state === "QUEUED" ||
			c.state === "IN_PROGRESS",
	);

	return {
		shouldFail: failedChecks.length > 0 || blockingReviews.length > 0,
		shouldPass: pendingChecks.length === 0 && checks.length > 0,
		failedChecks,
		reviewComments,
	};
}

/**
 * Wait for CI to complete and check for blocking reviews.
 * @param timeoutSeconds Maximum time to wait for CI
 * @param pollIntervalSeconds Time between polls
 * @param cwd Working directory for gh commands (defaults to process.cwd())
 */
export async function waitForCI(
	timeoutSeconds: number,
	pollIntervalSeconds: number,
	cwd?: string,
): Promise<WaitCIResult> {
	const startTime = Date.now();
	let isFirstPoll = true;

	if (!(await isGhAvailable())) {
		return createErrorResult(
			startTime,
			"gh CLI is not installed or not authenticated",
		);
	}

	const prInfo = await getPRInfo(cwd);
	if (!prInfo) {
		return createErrorResult(startTime, "No PR found for current branch");
	}

	const timeoutMs = timeoutSeconds * 1000;

	while (Date.now() - startTime < timeoutMs) {
		const checks = await getChecks(cwd);
		const reviews = await getReviews(prInfo.number, cwd);

		if (checks === null || reviews === null) {
			return createErrorResult(
				startTime,
				"Failed to fetch CI status or reviews from GitHub",
				prInfo,
			);
		}

		// Handle zero checks case: wait one poll for checks to spawn
		if (checks.length === 0) {
			if (!isFirstPoll) {
				return createPassedResult(startTime, prInfo);
			}
			isFirstPoll = false;
			await sleep(pollIntervalSeconds * 1000);
			continue;
		}

		isFirstPoll = false;
		const pollResult = processPollData(checks, reviews);

		if (pollResult.shouldFail) {
			return createFailedResult(
				startTime,
				prInfo,
				pollResult.failedChecks,
				pollResult.reviewComments,
			);
		}

		if (pollResult.shouldPass) {
			return createPassedResult(startTime, prInfo);
		}

		// Still pending - sleep and continue
		await sleep(pollIntervalSeconds * 1000);
	}

	// Timeout - checks still pending
	return {
		ci_status: "pending",
		pr_number: prInfo.number,
		pr_url: prInfo.url,
		failed_checks: [],
		review_comments: [],
		elapsed_seconds: timeoutSeconds,
	};
}

export function registerWaitCICommand(program: Command): void {
	program
		.command("wait-ci")
		.description(
			"Wait for CI checks to complete and check for blocking reviews",
		)
		.option(
			"--timeout <seconds>",
			"Maximum time to wait for CI (default: 270)",
			"270",
		)
		.option(
			"--poll-interval <seconds>",
			"Time between CI status checks (default: 15)",
			"15",
		)
		.action(async (options) => {
			const timeout = Number.parseInt(options.timeout, 10);
			const pollInterval = Number.parseInt(options.pollInterval, 10);

			if (Number.isNaN(timeout) || timeout <= 0) {
				console.log(
					JSON.stringify({
						ci_status: "error",
						failed_checks: [],
						review_comments: [],
						elapsed_seconds: 0,
						error_message: "Invalid timeout value",
					}),
				);
				process.exit(1);
			}

			if (Number.isNaN(pollInterval) || pollInterval <= 0) {
				console.log(
					JSON.stringify({
						ci_status: "error",
						failed_checks: [],
						review_comments: [],
						elapsed_seconds: 0,
						error_message: "Invalid poll-interval value",
					}),
				);
				process.exit(1);
			}

			const result = await waitForCI(timeout, pollInterval);
			console.log(JSON.stringify(result));

			// Exit codes: 0=passed, 1=failed/error, 2=pending (timeout)
			if (result.ci_status === "passed") {
				process.exit(0);
			} else if (result.ci_status === "pending") {
				process.exit(2);
			} else {
				process.exit(1);
			}
		});
}
