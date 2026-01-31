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
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn("gh", args, { stdio: "pipe" });
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
 */
async function getPRInfo(): Promise<{
	number: number;
	url: string;
	headRefName: string;
} | null> {
	const result = await runGh([
		"pr",
		"view",
		"--json",
		"number,url,headRefName",
	]);
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
 */
async function getChecks(): Promise<
	Array<{ name: string; state: string; conclusion: string; detailsUrl: string }>
> {
	const result = await runGh([
		"pr",
		"checks",
		"--json",
		"name,state,conclusion,detailsUrl",
	]);
	if (result.code !== 0) {
		return [];
	}
	try {
		return JSON.parse(result.stdout.trim()) || [];
	} catch {
		return [];
	}
}

/**
 * Get reviews for a PR.
 */
async function getReviews(
	prNumber: number,
): Promise<Array<{ author: { login: string }; state: string; body: string }>> {
	// Get owner/repo from gh
	const repoResult = await runGh(["repo", "view", "--json", "owner,name"]);
	if (repoResult.code !== 0) {
		return [];
	}
	let owner: string;
	let repo: string;
	try {
		const repoInfo = JSON.parse(repoResult.stdout.trim());
		owner = repoInfo.owner.login;
		repo = repoInfo.name;
	} catch {
		return [];
	}

	const result = await runGh([
		"api",
		`repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
	]);
	if (result.code !== 0) {
		return [];
	}
	try {
		// GitHub API returns 'user' not 'author', so we transform the response
		const rawReviews = JSON.parse(result.stdout.trim()) || [];
		return rawReviews
			.filter(
				(r: { user?: { login: string }; state: string; body: string }) =>
					r.user?.login,
			)
			.map(
				(r: { user: { login: string }; state: string; body: string }) => ({
					author: { login: r.user.login },
					state: r.state,
					body: r.body || "",
				}),
			);
	} catch {
		return [];
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

/**
 * Wait for CI to complete and check for blocking reviews.
 */
export async function waitForCI(
	timeoutSeconds: number,
	pollIntervalSeconds: number,
): Promise<WaitCIResult> {
	const startTime = Date.now();
	let isFirstPoll = true;

	// Check if gh is available
	if (!(await isGhAvailable())) {
		return {
			ci_status: "error",
			failed_checks: [],
			review_comments: [],
			elapsed_seconds: 0,
			error_message: "gh CLI is not installed or not authenticated",
		};
	}

	// Get PR info
	const prInfo = await getPRInfo();
	if (!prInfo) {
		return {
			ci_status: "error",
			failed_checks: [],
			review_comments: [],
			elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
			error_message: "No PR found for current branch",
		};
	}

	const timeoutMs = timeoutSeconds * 1000;

	// Poll loop
	while (Date.now() - startTime < timeoutMs) {
		const checks = await getChecks();
		const reviews = await getReviews(prInfo.number);

		// Deduplicate reviews to get each author's latest state
		const latestReviews = getLatestReviewsByAuthor(reviews);

		// Check for failed checks - fail immediately if any check has failed
		const failedChecks = checks.filter(
			(c) =>
				c.conclusion === "failure" ||
				c.conclusion === "cancelled" ||
				c.conclusion === "timed_out",
		);

		// Check for blocking reviews (REQUEST_CHANGES) from latest reviews only
		const blockingReviews = latestReviews.filter(
			(r) => r.state === "CHANGES_REQUESTED",
		);

		// Build review comments array from blocking reviews only (not all reviews)
		const reviewComments = blockingReviews.map((r) => ({
			author: r.author.login,
			body: r.body || "",
		}));

		// If any check failed or there are blocking reviews, return immediately
		if (failedChecks.length > 0 || blockingReviews.length > 0) {
			return {
				ci_status: "failed",
				pr_number: prInfo.number,
				pr_url: prInfo.url,
				failed_checks: failedChecks.map((c) => ({
					name: c.name,
					conclusion: c.conclusion,
					details_url: c.detailsUrl,
				})),
				review_comments: reviewComments,
				elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
			};
		}

		// Check if all checks are complete
		const pendingChecks = checks.filter(
			(c) =>
				c.state === "pending" ||
				c.state === "queued" ||
				c.state === "in_progress",
		);

		// Handle zero checks case: if no checks exist after the first poll,
		// wait one more poll interval to allow checks to spawn, then pass
		if (checks.length === 0) {
			if (!isFirstPoll) {
				// No checks after waiting - consider it passed (no CI configured)
				return {
					ci_status: "passed",
					pr_number: prInfo.number,
					pr_url: prInfo.url,
					failed_checks: [],
					review_comments: [],
					elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
				};
			}
			// First poll with no checks - wait and try again
			isFirstPoll = false;
			await sleep(pollIntervalSeconds * 1000);
			continue;
		}

		isFirstPoll = false;

		if (pendingChecks.length === 0) {
			// All checks passed (no failed, no pending)
			return {
				ci_status: "passed",
				pr_number: prInfo.number,
				pr_url: prInfo.url,
				failed_checks: [],
				review_comments: [],
				elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
			};
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
		elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
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
