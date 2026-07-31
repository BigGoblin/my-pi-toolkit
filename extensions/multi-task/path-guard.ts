import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITE_TOOLS = new Set(["edit", "write"]);

function canonicalize(path: string): string {
	const absolute = resolve(path);
	let cursor = absolute;
	const suffix: string[] = [];
	while (!existsSync(cursor)) {
		const parent = dirname(cursor);
		if (parent === cursor) return absolute;
		suffix.unshift(basename(cursor));
		cursor = parent;
	}
	return resolve(realpathSync(cursor), ...suffix);
}

function allowedRoots(): string[] {
	const raw = process.env.PI_MULTI_TASK_ALLOWED_PATHS;
	if (!raw) throw new Error("Multi Task worker 缺少允许写入路径配置");
	let paths: unknown;
	try {
		paths = JSON.parse(raw);
	} catch {
		throw new Error("Multi Task worker 允许写入路径配置无效");
	}
	if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))
		throw new Error("Multi Task worker 允许写入路径必须是字符串数组");
	return paths.map((path) => canonicalize(path));
}

function isWithin(path: string, root: string): boolean {
	const child = relative(root, path);
	return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export default function multiTaskPathGuard(pi: ExtensionAPI): void {
	const roots = allowedRoots();
	pi.on("tool_call", (event, ctx) => {
		if (!WRITE_TOOLS.has(event.toolName)) return;
		const input = event.input as { path?: unknown };
		if (typeof input.path !== "string")
			return { block: true, reason: "Multi Task 写工具必须提供 path" };
		const rawPath = input.path.replace(/^@/, "");
		const target = canonicalize(
			isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath),
		);
		if (roots.some((root) => isWithin(target, root))) return;
		return {
			block: true,
			reason: `Multi Task worker 无权修改声明范围外的路径: ${input.path}`,
		};
	});
}
