import type { SubagentPresentation } from "../shared/subagent/config.js";

export interface SearchDetails {
	task: string;
	model: string;
	modelSource: "project" | "user" | "current";
	output: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
	exitCode: number;
	stderr: string;
	truncated: boolean;
	runDir?: string;
}

export interface SearchRunConfig {
	model: string;
	source: "project" | "user" | "current";
	presentation?: SubagentPresentation;
}

export interface SearchRunResult {
	content: string;
	details: SearchDetails;
}
