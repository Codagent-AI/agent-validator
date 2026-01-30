#!/usr/bin/env bun
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import {
	registerCheckCommand,
	registerCICommand,
	registerCleanCommand,
	registerDetectCommand,
	registerHealthCommand,
	registerHelpCommand,
	registerInitCommand,
	registerListCommand,
	registerReviewCommand,
	registerRunCommand,
	registerStopHookCommand,
	registerValidateCommand,
} from "./commands/index.js";

const program = new Command();

program
	.name("agent-gauntlet")
	.description("AI-assisted quality gates")
	.version(packageJson.version);

// Register all commands
registerRunCommand(program);
registerCheckCommand(program);
registerCICommand(program);
registerCleanCommand(program);
registerReviewCommand(program);
registerDetectCommand(program);
registerListCommand(program);
registerHealthCommand(program);
registerInitCommand(program);
registerValidateCommand(program);
registerStopHookCommand(program);
registerHelpCommand(program);

// Default action: help
if (process.argv.length < 3) {
	process.argv.push("help");
}

program.parse(process.argv);
