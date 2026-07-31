/**
 * Context7 扩展 — 拉取最新库文档
 *
 * 配置 ~/.pi/agent/context7.json：
 * { "apiKey": "你的 Context7 API Key" }
 *
 * 也可设置环境变量 CONTEXT7_API_KEY。
 * API Key 获取：https://context7.com/dashboard
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";

import { formatSearchResults, queryDocs, searchLibraries } from "./api.js";
import { configPath, loadConfig } from "./config.js";

interface ResolveParams {
	libraryName: string;
	query: string;
}

interface QueryParams {
	libraryId: string;
	query: string;
}

const RESOLVE_PARAMS = Type.Object({
	libraryName: Type.String({
		description: "要搜索的库名称，例如 next.js、prisma、react",
	}),
	query: Type.String({
		description: "用户的问题或任务，用于按相关性对搜索结果排序",
	}),
});

const QUERY_PARAMS = Type.Object({
	libraryId: Type.String({
		description: "Context7 库 ID，例如 /vercel/next.js、/mongodb/docs",
	}),
	query: Type.String({ description: "要查询的文档主题或具体问题" }),
});

function toolError(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { isError: true },
		isError: true,
	};
}

export default function context7Extension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "resolve-library-id",
		label: "Context7 Resolve Library",
		description: "将通用库名称解析为 Context7 兼容的库 ID",
		promptSnippet:
			"Resolve a library name to a Context7 library ID before fetching docs",
		promptGuidelines: [
			"第三方库、SDK、外部 API、官方文档、配置步骤或版本能力调研应优先使用 resolve-library-id 和 query-docs；不要调用 repo_search，除非用户还要求检查当前仓库如何使用或集成该库。",
			"当用户询问第三方库/API 文档、配置步骤或版本相关用法时，先用 resolve-library-id 解析库 ID，再用 query-docs 获取文档。",
			"若用户已给出库 ID（如 /vercel/next.js），可跳过 resolve-library-id，直接调用 query-docs。",
		],
		parameters: RESOLVE_PARAMS,
		async execute(
			_toolCallId: string,
			params: ResolveParams,
			signal: AbortSignal | undefined,
		) {
			const { apiKey } = loadConfig();
			try {
				const results = await searchLibraries(
					params.libraryName,
					params.query,
					apiKey,
					signal,
				);
				return {
					content: [{ type: "text", text: formatSearchResults(results) }],
					details: { count: results.length },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return toolError(message);
			}
		},
	});

	pi.registerTool({
		name: "query-docs",
		label: "Context7 Query Docs",
		description: "使用 Context7 库 ID 获取最新文档片段",
		promptSnippet:
			"Fetch up-to-date library documentation snippets from Context7",
		promptGuidelines: [
			"第三方库、SDK、外部 API 和官方文档调研优先使用 query-docs，而不是 repo_search；只有同时检查当前仓库集成情况时才需要 repo_search。",
			"query-docs 需要精确的 Context7 库 ID；不确定时先调用 resolve-library-id。",
			"涉及库版本时，可在 libraryId 中指定版本，例如 /vercel/next.js/v15.1.8。",
		],
		parameters: QUERY_PARAMS,
		async execute(
			_toolCallId: string,
			params: QueryParams,
			signal: AbortSignal | undefined,
		) {
			const { apiKey } = loadConfig();
			try {
				const text = await queryDocs(
					params.libraryId,
					params.query,
					apiKey,
					signal,
				);
				return {
					content: [{ type: "text", text: text || "(无文档内容)" }],
					details: { libraryId: params.libraryId },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return toolError(message);
			}
		},
	});

	pi.registerCommand("context7", {
		description: "查看 Context7 配置状态",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { apiKey } = loadConfig();
			const configured = Boolean(apiKey);

			if (!args.trim()) {
				ctx.ui.notify(
					configured
						? `Context7 已配置 API Key（${configPath()} 或 CONTEXT7_API_KEY）`
						: `Context7 未配置 API Key。请在 ${configPath()} 写入 { "apiKey": "..." }，或设置 CONTEXT7_API_KEY。\n免费申请：https://context7.com/dashboard`,
					configured ? "info" : "warning",
				);
				return;
			}

			const parts = args.trim().split(/\s+/);
			const libraryName = parts[0];
			const query = parts.slice(1).join(" ") || libraryName;

			ctx.ui.notify(`正在搜索库: ${libraryName}...`, "info");
			try {
				const results = await searchLibraries(libraryName, query, apiKey);
				ctx.ui.notify(formatSearchResults(results.slice(0, 3)), "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
			}
		},
	});
}
