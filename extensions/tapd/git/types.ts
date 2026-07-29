import type { TapdItemKind } from "../types.js";

export type TapdGitKind = TapdItemKind | "task";

export interface LinkedTapdObject {
	workspaceId: string;
	objectId: string;
	kind: TapdGitKind;
	name?: string;
}

export interface TapdKeyword extends LinkedTapdObject {
	keyword: string;
	shortId: string;
	author?: string;
}

export interface GitRepositoryState {
	root: string;
	branch: string;
	originUrl: string;
	upstream?: string;
	dirty: boolean;
	head?: string;
}

export type BranchProgressStage =
	| "tapd-object"
	| "repository"
	| "base-ref"
	| "keyword"
	| "branch-check"
	| "create-branch";

export interface BranchProgress {
	stage: BranchProgressStage;
	state: "running" | "done" | "failed";
	message: string;
}

export type BranchProgressReporter = (progress: BranchProgress) => void;

export interface LinkedCommit {
	hash: string;
	subject: string;
	objects: TapdKeyword[];
}

export interface GitLabMergeRequest {
	iid: number;
	web_url: string;
	title: string;
	labels: string[];
	should_remove_source_branch?: boolean;
}

export interface GitWorkflowPolicy {
	baseRef: string;
	targetBranch: string;
	removeSourceBranch: boolean;
	labels: Record<TapdGitKind | "mixed", string[]>;
	transitions: Record<TapdGitKind, { status: string; currentOwner?: string }>;
}
