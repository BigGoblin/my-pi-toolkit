export type TapdReviewScope = "uncommitted" | "branch";

export interface TapdReviewContext {
	storyId: string;
	storyName: string;
	understandingFile: string;
	designFile: string;
	repositoryRoot: string;
	branch: string;
	scope: TapdReviewScope;
	baseRef?: string;
	mergeBase?: string;
	comparisonRef: string;
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
	scope: TapdReviewScope;
	baseRef?: string;
	mergeBase?: string;
	comparisonRef: string;
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
