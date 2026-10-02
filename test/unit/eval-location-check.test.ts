import { describe, expect, it, spyOn } from "bun:test";
import {
	checkMatchLocations,
	diagnoseMatches,
	formatLocationFlag,
	LOCATION_LINE_TOLERANCE,
	locationMismatch,
	normalizePath,
	sameFile,
} from "../../evals/location-check.js";
import { printReport } from "../../evals/reporter.js";
import { aggregateConfig } from "../../evals/scoring.js";
import type {
	AdapterRunResult,
	AdapterViolation,
	EvalConfiguration,
	EvalResults,
	GroundTruthIssue,
	JudgeMatch,
	JudgeResult,
} from "../../evals/types.js";

const issue = (
	id: string,
	file: string,
	line_range: [number, number],
): GroundTruthIssue => ({
	id,
	file,
	line_range,
	description: "d",
	category: "bug",
	difficulty: "easy",
	priority: "high",
	requires_tool_use: false,
});

const violation = (file: string, line: number): AdapterViolation => ({
	file,
	line,
	issue: "i",
	priority: "high",
	status: "new",
});

const match = (
	groundTruthId: string,
	violationIndex: number,
	confidence: JudgeMatch["confidence"] = "high",
): JudgeMatch => ({ groundTruthId, violationIndex, confidence, reasoning: "" });

const groundTruth = [
	issue("py-closure", "src/batch_processor.py", [81, 82]),
	issue("go-leak", "src/batch_handler.go", [222, 250]),
];

describe("location check paths", () => {
	it("normalizes separators and diff/relative prefixes", () => {
		expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
		expect(normalizePath("b/src/a.ts")).toBe("src/a.ts");
		expect(normalizePath("src\\api\\a.ts")).toBe("src/api/a.ts");
	});

	it("accepts a path-suffix match but not a partial filename", () => {
		expect(sameFile("/repo/fixture/codebase/src/a.ts", "src/a.ts")).toBe(true);
		expect(sameFile("a.ts", "src/a.ts")).toBe(true);
		expect(sameFile("src/data.ts", "src/a.ts")).toBe(false);
		expect(sameFile("", "src/a.ts")).toBe(false);
	});
});

describe("locationMismatch", () => {
	const gt = issue("x", "src/a.py", [10, 12]);

	it("allows lines within the range expanded by the tolerance", () => {
		expect(LOCATION_LINE_TOLERANCE).toBe(5);
		expect(locationMismatch(violation("src/a.py", 5), gt)).toBeNull();
		expect(locationMismatch(violation("src/a.py", 17), gt)).toBeNull();
	});

	it("flags lines just outside the tolerance", () => {
		expect(locationMismatch(violation("src/a.py", 4), gt)).toBe("line");
		expect(locationMismatch(violation("src/a.py", 18), gt)).toBe("line");
		expect(locationMismatch(violation("src/a.py", 13), gt, 0)).toBe("line");
	});

	it("flags a missing line instead of treating it as line 0", () => {
		const nearTop = issue("y", "src/a.py", [1, 2]);
		const missing = { file: "src/a.py", line: null as unknown as number };
		expect(locationMismatch(missing, nearTop)).toBe("line");
	});

	it("flags a different file regardless of line", () => {
		expect(locationMismatch(violation("src/b.py", 11), gt)).toBe("file");
	});
});

describe("checkMatchLocations", () => {
	const violations = [
		violation("src/batch_processor.py", 83),
		violation("src/batch_processor.py", 120),
		violation("src/batch_handler.go", 164),
	];

	it("flags only distant or cross-file matches with their details", () => {
		const flags = checkMatchLocations(
			[match("py-closure", 0), match("py-closure", 1, "medium"), match("go-leak", 2, "low")],
			violations,
			groundTruth,
		);
		expect(flags).toEqual([
			{
				groundTruthId: "py-closure",
				violationIndex: 1,
				violationFile: "src/batch_processor.py",
				violationLine: 120,
				expectedFile: "src/batch_processor.py",
				expectedRange: [81, 82],
				confidence: "medium",
				reason: "line",
			},
			expect.objectContaining({ groundTruthId: "go-leak", reason: "line", confidence: "low" }),
		]);
		expect(formatLocationFlag(flags[0]!)).toBe(
			"py-closure: src/batch_processor.py:120 vs src/batch_processor.py:[81-82] (line, medium)",
		);
	});

	it("flags matches that reference an unknown issue or violation", () => {
		const flags = checkMatchLocations(
			[match("nope", 0), match("py-closure", 9)],
			violations,
			groundTruth,
		);
		expect(flags.map((f) => f.reason)).toEqual(["unresolved", "unresolved"]);
		expect(formatLocationFlag(flags[1]!)).toBe(
			"py-closure: violation #9 vs src/batch_processor.py:[81-82] (unresolved, high)",
		);
	});

	it("reports flag and low-confidence counts per run", () => {
		expect(
			diagnoseMatches(
				[match("py-closure", 0, "low"), match("go-leak", 2, "low")],
				violations,
				groundTruth,
			),
		).toMatchObject({ locationFlagCount: 1, lowConfidenceMatches: 2 });
	});
});

describe("location diagnostics in scoring and reporting", () => {
	const config: EvalConfiguration = {
		adapter: "claude",
		allowToolUse: false,
		thinkingBudget: "low",
		label: "claude-test",
	};
	const run: AdapterRunResult = {
		configLabel: config.label,
		adapter: "claude",
		runIndex: 0,
		rawOutput: "",
		violations: [
			violation("src/batch_processor.py", 82),
			violation("src/api/other.ts", 230),
		],
		status: "fail",
		durationMs: 1000,
		telemetry: [],
	};
	const judge: JudgeResult = {
		matches: [match("py-closure", 0), match("go-leak", 1, "low")],
		missedIssues: [],
		falsePositives: [],
		reasoning: "",
	};

	it("records flags per run without changing true positives", () => {
		const aggregate = aggregateConfig(config, [run], new Map([[run, judge]]), groundTruth);
		const score = aggregate.runs[0];
		expect(score?.truePositives).toBe(2);
		expect(score?.locationFlagCount).toBe(1);
		expect(score?.lowConfidenceMatches).toBe(1);
		expect(score?.locationFlags?.[0]).toMatchObject({ groundTruthId: "go-leak", reason: "file" });
	});

	it("prints the LocFlag column and the flagged list", () => {
		const aggregate = aggregateConfig(config, [run], new Map([[run, judge]]), groundTruth);
		const results: EvalResults = {
			timestamp: "t",
			fixture: "fixtures/x",
			groundTruthCount: 2,
			versions: [],
			configs: [aggregate],
			rawRuns: [run],
			judgeResults: [judge],
		};
		const lines: string[] = [];
		const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.join(" "));
		});
		try {
			printReport(results, groundTruth);
		} finally {
			spy.mockRestore();
		}
		const output = lines.join("\n");
		expect(output).toContain("LocFlag");
		expect(output).toMatch(/claude-test.*\s1\s+1$/m);
		expect(output).toContain("claude-test [run 1]:");
		expect(output).toContain(
			"go-leak: src/api/other.ts:230 vs src/batch_handler.go:[222-250] (file, low)",
		);
	});
});
