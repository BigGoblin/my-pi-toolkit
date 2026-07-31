import type { SubagentPresentation } from "../shared/subagent/config.js";

export interface RepoSearchDetails {
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

export interface RepoSearchRunConfig {
	model: string;
	source: "project" | "user" | "current";
	presentation?: SubagentPresentation;
}

export interface RepoSearchRunResult {
	content: string;
	details: RepoSearchDetails;
}
