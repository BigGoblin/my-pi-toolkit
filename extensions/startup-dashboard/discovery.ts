import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DashboardData {
	contexts: string[];
	skills: string[];
	extensions: string[];
}

interface ToolkitManifest {
	pi?: {
		extensions?: string[];
		skills?: string[];
	};
}

const TOOLKIT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readManifest(): Promise<ToolkitManifest> {
	try {
		return JSON.parse(
			await readFile(resolve(TOOLKIT_ROOT, "package.json"), "utf8"),
		) as ToolkitManifest;
	} catch {
		return {};
	}
}

async function discoverContexts(cwd: string): Promise<string[]> {
	const paths: string[] = [];
	let current = resolve(cwd);

	while (true) {
		const candidate = resolve(current, "AGENTS.md");
		if (await exists(candidate)) paths.push(candidate);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return paths.map((path) => {
		const label = relative(cwd, path);
		return label && !label.startsWith("..")
			? label
			: (path.split(/[\\/]/).pop() ?? path);
	});
}

async function discoverProjectSkillPaths(cwd: string): Promise<string[]> {
	const paths: string[] = [];
	let current = resolve(cwd);
	while (true) {
		const skills = resolve(current, ".pi", "skills");
		if (await exists(skills)) paths.push(skills);
		if (await exists(resolve(current, ".git"))) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return paths;
}

function frontmatterName(source: string, fallback: string): string {
	const match = source.match(
		/^---\s*[\r\n]+[\s\S]*?^name:\s*["']?([^\r\n"']+)/m,
	);
	return match?.[1]?.trim() || fallback;
}

async function skillName(directory: string): Promise<string | undefined> {
	const path = resolve(directory, "SKILL.md");
	if (!(await exists(path))) return undefined;
	try {
		return frontmatterName(
			await readFile(path, "utf8"),
			directory.split(/[\\/]/).pop() ?? "skill",
		);
	} catch {
		return directory.split(/[\\/]/).pop();
	}
}

async function discoverSkills(paths: string[]): Promise<string[]> {
	const names: string[] = [];
	for (const entry of paths) {
		const directory = resolve(TOOLKIT_ROOT, entry);
		const direct = await skillName(directory);
		if (direct) {
			names.push(direct);
			continue;
		}
		try {
			for (const child of await readdir(directory, { withFileTypes: true })) {
				if (!child.isDirectory()) continue;
				const name = await skillName(resolve(directory, child.name));
				if (name) names.push(name);
			}
		} catch {
			// Optional resource paths should not block startup.
		}
	}
	return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function extensionName(entry: string): string {
	const clean = entry.replace(/\\/g, "/").replace(/\/$/, "");
	const parts = clean.split("/");
	const file = parts.slice(-1)[0] ?? clean;
	return file.startsWith("index.")
		? (parts.slice(-2)[0] ?? file)
		: file.replace(/\.[^.]+$/, "");
}

export async function discoverDashboardData(
	cwd: string,
): Promise<DashboardData> {
	const manifest = await readManifest();
	const skillPaths = [
		...(manifest.pi?.skills ?? []),
		...(await discoverProjectSkillPaths(cwd)),
	];
	const extensions = (manifest.pi?.extensions ?? [])
		.map(extensionName)
		.filter((name) => name !== "startup-dashboard")
		.sort((a, b) => a.localeCompare(b));

	return {
		contexts: await discoverContexts(cwd),
		skills: await discoverSkills(skillPaths),
		extensions: Array.from(new Set(extensions)),
	};
}
