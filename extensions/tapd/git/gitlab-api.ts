import type { GitLabConfig } from "../types.js";
import type { GitLabMergeRequest } from "./types.js";

export interface GitLabProject {
	apiBase: string;
	projectPath: string;
}

export function parseGitLabProject(
	remoteUrl: string,
	config?: GitLabConfig,
): GitLabProject {
	const ssh = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	const http = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
	const host = ssh?.[1] ?? http?.[1];
	const projectPath = ssh?.[2] ?? http?.[2];
	if (!host || !projectPath)
		throw new Error("无法从 origin URL 解析 GitLab 项目");
	return {
		apiBase: (config?.baseUrl ?? `https://${host}/api/v4`).replace(/\/$/, ""),
		projectPath,
	};
}

async function gitLabRequest<T>(
	project: GitLabProject,
	token: string,
	method: "GET" | "POST" | "PUT",
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(`${project.apiBase}${path}`, {
		method,
		headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok)
		throw new Error(`GitLab API ${response.status}: ${await response.text()}`);
	return response.json() as Promise<T>;
}

function projectApiPath(project: GitLabProject): string {
	return `/projects/${encodeURIComponent(project.projectPath)}`;
}

function mergeRequestTitle(title: string, draft: boolean): string {
	const readyTitle = title.replace(/^(?:Draft:|WIP:)\s*/i, "");
	return draft ? `Draft: ${readyTitle}` : readyTitle;
}

export async function createOrUpdateMergeRequest(
	project: GitLabProject,
	token: string,
	input: {
		sourceBranch: string;
		targetBranch: string;
		title: string;
		labels: string[];
		removeSourceBranch: boolean;
		draft: boolean;
	},
): Promise<GitLabMergeRequest> {
	const query = new URLSearchParams({
		state: "opened",
		source_branch: input.sourceBranch,
		target_branch: input.targetBranch,
	});
	const existing = await gitLabRequest<GitLabMergeRequest[]>(
		project,
		token,
		"GET",
		`${projectApiPath(project)}/merge_requests?${query}`,
	);
	const body = {
		source_branch: input.sourceBranch,
		target_branch: input.targetBranch,
		title: mergeRequestTitle(input.title, input.draft),
		labels: input.labels.join(","),
		remove_source_branch: input.removeSourceBranch,
	};
	if (existing[0]) {
		return gitLabRequest(
			project,
			token,
			"PUT",
			`${projectApiPath(project)}/merge_requests/${existing[0].iid}`,
			body,
		);
	}
	return gitLabRequest(
		project,
		token,
		"POST",
		`${projectApiPath(project)}/merge_requests`,
		body,
	);
}
