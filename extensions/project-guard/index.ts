/**
 * Project Guard Extension
 *
 * 项目文件守卫——阻止模型修改项目目录之外的文件。
 * 读取项目外文件不受影响（只拦截写操作）。
 *
 * 拦截范围：
 * - write / edit 工具：检查 path 参数
 * - bash：只拦截写入/删除/权限修改类命令
 *   - 重定向 >、>>、2>（排除 /dev/null 等设备）
 *   - cp / mv / rm / mkdir / rmdir / touch / tee
 *   - ln / chmod / chown
 *   - sed -i / install / dd
 *   - PowerShell: Rename-Item, Move-Item, Copy-Item, Remove-Item,
 *     Out-File, Add-Content, Set-Content, New-Item, Export-Csv ...
 * - 读操作（cat, ls, head, tail, grep, find 等）不受影响
 *
 * 行为：
 * - 首次询问用户，拒绝后明确告知"策略禁止"，阻止模型绕路重试
 * - 无 UI 时直接拦截
 */

import { relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── 写操作命令模式列表 ────────────────────────────────────────────

interface WriteOpPattern {
	/** 显示名称 */
	name: string;
	/** 正则：捕获目标路径到第 1 组 */
	re: RegExp;
}

const writeOpPatterns: WriteOpPattern[] = [
	// 重定向（排除 /dev/null、NUL 等设备）
	{ name: "redirect", re: /(?:>>|>|2>|1>)\s*(\S+)/g },
	// cp / mv / rm 的最后一个参数（目标路径）
	{ name: "cp/mv/rm", re: /\b(cp|mv|rm)\s+(-[a-zA-Z]+\s+)*.*?\s+(\S+)\b/g }, // 组3=路径
	// mkdir / rmdir / touch / tee
	{ name: "mkdir/rmdir/touch/tee", re: /\b(mkdir|rmdir|touch|tee)\s+(-[a-zA-Z]+\s+)*(\S+)/g }, // 组3=路径
	// ln / chmod / chown
	{ name: "ln/chmod/chown", re: /\b(ln|chmod|chown)\s+(-[a-zA-Z]+\s+)*.*?\s+(\S+)\b/g }, // 组3=路径
	// sed -i（原地编辑）
	{ name: "sed -i", re: /\bsed\s+-i[^|;]*\s+(\S+)\b/g }, // 组1=路径
	// install / dd（写入类）
	{ name: "install/dd", re: /\b(install|dd)\s+.*?\s+(\S+)\b/g }, // 组2=路径
	// PowerShell 写操作 cmdlet
	{
		name: "PowerShell write",
		re: /\b(Rename-Item|Move-Item|Copy-Item|Remove-Item|Out-File|Add-Content|Set-Content|New-Item|Export-Csv|Export-Clixml)\s+.*?(?:-Path\s+|-Destination\s+|-LiteralPath\s+)?['"]?([^'";\s]+)['"]?/gi,
	}, // 组2=路径
];

const devicePatterns = [
	/^\/dev\/(null|zero|random|urandom|stdin|stdout|stderr)$/i,
	/^nul$/i,
	/^con$/i,
	/^prn$/i,
	/^lpt\d*$/i,
];

// ─── Extension 主入口 ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const projectRoot = resolve(ctx.cwd);

		// ── write / edit：检查 path 参数 ────────────────────────────
		if (event.toolName === "write" || event.toolName === "edit") {
			const rawPath = event.input.path as string;
			const targetPath = resolve(projectRoot, rawPath);

			if (isOutsideProject(targetPath, projectRoot)) {
				return await blockOrAsk(ctx, `写入/编辑项目外文件: ${targetPath}`);
			}
			return undefined;
		}

		// ── bash：检测写入类命令的目标路径 ──────────────────────────
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			const outsidePaths = findWriteTargets(command, projectRoot);

			if (outsidePaths.length > 0) {
				const detail = outsidePaths.map((p) => `  • ${p}`).join("\n");
				return await blockOrAsk(ctx, `项目外文件写操作:\n${detail}\n\n命令: ${command}`);
			}
			return undefined;
		}

		return undefined;
	});
}

// ─── 路径检测 ───────────────────────────────────────────────────────

function isOutsideProject(absPath: string, projectRoot: string): boolean {
	const rel = relative(projectRoot, absPath);
	return (
		rel.startsWith(".." + sep) ||
		(rel.length > 0 && rel.split(sep)[0] === "..")
	);
}

function isDevice(raw: string): boolean {
	const clean = raw.replace(/^["']/, "").replace(/["']$/, "");
	return devicePatterns.some((p) => p.test(clean));
}

function looksLikePath(s: string): boolean {
	if (!s) return false;
	const clean = s.replace(/^["']/, "").replace(/["']$/, "");
	if (!clean) return false;
	if (clean.startsWith("-")) return false;
	if (/^\d+$/.test(clean)) return false;
	if (clean.startsWith("$")) return false;
	if (/^[a-zA-Z]:[\\/]/i.test(clean)) return true;
	if (clean.includes("/") || clean.includes("\\")) return true;
	if (clean.startsWith(".") || clean.startsWith("~")) return true;
	return false;
}

// ─── 从命令中提取写入目标路径 ─────────────────────────────────────

function findWriteTargets(command: string, projectRoot: string): string[] {
	const results = new Set<string>();
	const seen = new Set<string>();

	const tryAdd = (raw: string) => {
		if (!raw) return;
		if (isDevice(raw)) return;
		const clean = raw.replace(/^["']/, "").replace(/["']$/, "");
		if (!clean || !looksLikePath(clean)) return;
		const key = clean.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		const abs = resolve(projectRoot, clean);
		if (isOutsideProject(abs, projectRoot)) {
			results.add(abs);
		}
	};

	for (const pattern of writeOpPatterns) {
		pattern.re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.re.exec(command)) !== null) {
			// 不同正则把路径放在不同的捕获组
			const pathCapture =
				m[3] ?? m[2] ?? m[1] ?? "";
			if (pathCapture) tryAdd(pathCapture);
		}
	}

	// 额外：提取引号包裹的路径作为补充（写命令即使引号嵌套也能抓到）
	// 但只从写操作上下文中提取，避免误伤纯读命令
	const writeKeywords = /\b(cp|mv|rm|mkdir|rmdir|touch|tee|ln|chmod|chown|install|dd|sed)\b/gi;
	const hasWriteKeyword = writeKeywords.test(command);
	const hasRedirect = /[>|]\s*[^|>]*[>/]/.test(command);
	const hasPowerShell = /\b(Rename-Item|Move-Item|Copy-Item|Remove-Item|Out-File|Add-Content|Set-Content)\b/i.test(
		command,
	);

	if (hasWriteKeyword || hasRedirect || hasPowerShell) {
		const quotedRe = /"([^"]+)"|'([^']*)'/g;
		let m: RegExpExecArray | null;
		while ((m = quotedRe.exec(command)) !== null) {
			const val = m[1] ?? m[2] ?? "";
			tryAdd(val);
		}
	}

	return [...results];
}

// ─── 拦截/确认 ─────────────────────────────────────────────────────

async function blockOrAsk(
	ctx: any,
	message: string,
): Promise<{ block: true; reason: string } | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `[策略禁止] 项目外文件写操作已拦截（无交互界面）。这是硬性策略，不要尝试用其他方式绕过。${message}`,
		};
	}

	const ok = await ctx.ui.confirm(
		"⚠️ 项目外写操作",
		`${message}\n\n是否允许本次操作？`,
	);

	if (!ok) {
		return {
			block: true,
			reason: `[策略禁止] 用户已拒绝项目外文件写操作。这是硬性策略禁止，不要尝试使用其他工具、命令或编码方式绕路重试。${message}`,
		};
	}
	return undefined;
}
