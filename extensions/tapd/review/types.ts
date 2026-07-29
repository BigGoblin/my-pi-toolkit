export interface TapdReviewContext {
	storyId: string;
	storyName: string;
	understandingFile: string;
	designFile: string;
	repositoryRoot: string;
	branch: string;
	baseRef: string;
	mergeBase: string;
	changedFiles: string[];
	contextFile: string;
	cleanup(): Promise<void>;
}

export interface ReviewSubagentResult {
	report: string;
	model: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

export interface TapdReviewMetadata {
	storyId: string;
	baseRef: string;
	mergeBase: string;
	branch: string;
	model: string;
	changedFiles: string[];
	generatedAt: string;
}

export interface TapdReviewToolDetails {
	running: boolean;
	phase: string;
	model: string;
	toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
	report?: string;
	metadata?: TapdReviewMetadata;
}
