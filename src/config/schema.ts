import { z } from "zod";

export const adapterConfigSchema = z.object({
	allow_tool_use: z.boolean().default(true),
	thinking_budget: z.enum(["off", "low", "medium", "high"]).optional(),
});

export const cliConfigSchema = z.object({
	default_preference: z.array(z.string().min(1)).min(1),
	adapters: z.record(z.string(), adapterConfigSchema).optional(),
});

export const checkGateSchema = z
	.object({
		command: z.string().min(1),
		rerun_command: z.string().min(1).optional(),
		working_directory: z.string().optional(),
		parallel: z.boolean().default(false),
		run_locally: z.boolean().default(true),
		timeout: z.number().optional(),
		fail_fast: z.boolean().optional(),
		fix_instructions: z.string().optional(), // Deprecated alias for fix_instructions_file
		fix_instructions_file: z.string().optional(),
		fix_with_skill: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		// fail_fast can only be used when parallel is false
		if (data.fail_fast === true && data.parallel === true) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "fail_fast can only be used when parallel is false",
			});
		}
		// Cannot specify both deprecated fix_instructions and fix_instructions_file
		if (data.fix_instructions && data.fix_instructions_file) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Cannot specify both 'fix_instructions' (deprecated) and 'fix_instructions_file'. Use only 'fix_instructions_file'.",
			});
		}
		// fix_instructions_file (or its deprecated alias) and fix_with_skill are mutually exclusive
		const effectiveFixFile =
			data.fix_instructions_file || data.fix_instructions;
		if (effectiveFixFile && data.fix_with_skill) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"'fix_instructions_file' and 'fix_with_skill' are mutually exclusive. Specify only one.",
			});
		}
	});

export const reviewGateSchema = z.object({
	name: z.string().min(1),
	prompt: z.string().min(1), // Path relative to .gauntlet/reviews/
	cli_preference: z.array(z.string().min(1)).optional(),
	num_reviews: z.number().default(1),
	parallel: z.boolean().default(true),
	run_in_ci: z.boolean().default(true),
	run_locally: z.boolean().default(true),
	timeout: z.number().optional(),
});

export const reviewPromptFrontmatterSchema = z
	.object({
		model: z.string().optional(),
		cli_preference: z.array(z.string().min(1)).optional(),
		num_reviews: z.number().default(1),
		parallel: z.boolean().default(true),
		run_in_ci: z.boolean().default(true),
		run_locally: z.boolean().default(true),
		timeout: z.number().optional(),
		prompt_file: z.string().optional(),
		skill_name: z.string().optional(),
	})
	.refine((data) => !(data.prompt_file && data.skill_name), {
		message:
			"'prompt_file' and 'skill_name' are mutually exclusive. Specify only one.",
	});

export const reviewYamlSchema = z
	.object({
		model: z.string().optional(),
		cli_preference: z.array(z.string().min(1)).optional(),
		num_reviews: z.number().default(1),
		parallel: z.boolean().default(true),
		run_in_ci: z.boolean().default(true),
		run_locally: z.boolean().default(true),
		timeout: z.number().optional(),
		prompt_file: z.string().optional(),
		skill_name: z.string().optional(),
		builtin: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		const sources = [data.prompt_file, data.skill_name, data.builtin].filter(
			Boolean,
		);
		if (sources.length > 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"'prompt_file', 'skill_name', and 'builtin' are mutually exclusive. Specify only one.",
			});
		}
		if (sources.length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"YAML review files must specify exactly one of 'prompt_file', 'skill_name', or 'builtin'.",
			});
		}
	});

export const entryPointSchema = z.object({
	path: z.string().min(1),
	exclude: z.array(z.string().min(1)).optional(),
	checks: z.array(z.string().min(1)).optional(),
	reviews: z.array(z.string().min(1)).optional(),
});

export const debugLogConfigSchema = z.object({
	enabled: z.boolean().default(false),
	max_size_mb: z.number().default(10),
});

export const loggingConsoleConfigSchema = z.object({
	enabled: z.boolean().default(true),
	format: z.enum(["pretty", "json"]).default("pretty"),
});

export const loggingFileConfigSchema = z.object({
	enabled: z.boolean().default(true),
	format: z.enum(["text", "json"]).default("text"),
});

export const loggingConfigSchema = z.object({
	level: z.enum(["debug", "info", "warning", "error"]).default("debug"),
	console: loggingConsoleConfigSchema.optional(),
	file: loggingFileConfigSchema.optional(),
});

export const stopHookConfigSchema = z.object({
	enabled: z.boolean().optional(),
	run_interval_minutes: z.number().int().min(0).optional(),
	auto_push_pr: z.boolean().optional(),
	auto_fix_pr: z.boolean().optional(),
});

export const gauntletConfigSchema = z.object({
	base_branch: z.string().min(1).default("origin/main"),
	log_dir: z.string().min(1).default("gauntlet_logs"),
	allow_parallel: z.boolean().default(true),
	max_retries: z.number().default(3),
	rerun_new_issue_threshold: z
		.enum(["critical", "high", "medium", "low"])
		.default("medium"),
	cli: cliConfigSchema,
	entry_points: z.array(entryPointSchema).min(1),
	debug_log: debugLogConfigSchema.optional(),
	logging: loggingConfigSchema.optional(),
	stop_hook: stopHookConfigSchema.optional(),
});
