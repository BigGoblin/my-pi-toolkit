export type SubagentRunStatus = "starting" | "running" | "completed" | "failed";

export type SubagentTranscriptEntry =
	| { kind: "user"; text: string }
	| { kind: "assistant"; message: unknown }
	| {
			kind: "tool";
			id: string;
			name: string;
			args: Record<string, unknown>;
			result?: unknown;
			isError?: boolean;
	  };

export interface LiveSubagentRun {
	id: string;
	title: string;
	model: string;
	cwd: string;
	status: SubagentRunStatus;
	startedAt: string;
	parentSessionId?: string;
	lines: string[];
	entries: SubagentTranscriptEntry[];
	send(message: string): void;
	abort(): void;
	dispose(): void;
	subscribe(listener: () => void): () => void;
}

const REGISTRY_KEY = Symbol.for("my-pi-toolkit.live-subagent-runs");
const globalRegistry = globalThis as Record<PropertyKey, unknown>;
const existingRuns = globalRegistry[REGISTRY_KEY];
const runs =
	existingRuns instanceof Map
		? (existingRuns as Map<string, LiveSubagentRun>)
		: new Map<string, LiveSubagentRun>();
globalRegistry[REGISTRY_KEY] = runs;

export function registerLiveSubagent(run: LiveSubagentRun): void {
	runs.set(run.id, run);
}

export function removeLiveSubagent(id: string): void {
	runs.delete(id);
}

export function listLiveSubagents(): LiveSubagentRun[] {
	return Array.from(runs.values()).sort((left, right) =>
		right.startedAt.localeCompare(left.startedAt),
	);
}

export function abortAllLiveSubagents(): void {
	runs.forEach((run) => run.dispose());
	runs.clear();
}
