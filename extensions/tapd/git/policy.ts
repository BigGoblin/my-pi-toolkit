import type { GitWorkflowPolicy, TapdGitKind } from "./types.js";

export const DEFAULT_GIT_WORKFLOW_POLICY: GitWorkflowPolicy = {
	baseRef: "origin/dev",
	targetBranch: "dev",
	removeSourceBranch: true,
	labels: {
		bug: ["二组", "迭代bug(每日发布)"],
		story: ["二组", "迭代任务(随迭代发布)"],
		task: ["二组", "迭代任务(随迭代发布)"],
		mixed: ["二组", "迭代任务(随迭代发布)"],
	},
	transitions: {
		bug: { status: "已解决", currentOwner: "沈瑞昀" },
		story: { status: "开发完成" },
		task: { status: "开发完成" },
	},
};

export function branchPrefix(kind: TapdGitKind): "bug" | "feature" {
	return kind === "bug" ? "bug" : "feature";
}

export function commitPrefix(kind: TapdGitKind): "fix" | "feat" {
	return kind === "bug" ? "fix" : "feat";
}
