import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DashboardData {
	contexts: string[];
	skills: string[];
	extensions: string[];
	themes: string[];
}

interface ToolkitManifest {
	pi?: {
		extensions?: string[];
		skills?: string[];
		themes?: string[];
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
		if (!label) return path;
		return label.startsWith("..") ? label : `./${label}`;
	});
}

async function discoverProjectSkillPaths(cwd: string): Promise<string[]> {
	const paths: string[] = [];
	let current = resolve(cwd);
	while (true) {
		for (const configDirectory of [".pi", ".agents"]) {
			const skills = resolve(current, configDirectory, "skills");
			if (await exists(skills)) paths.push(skills);
		}
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
		return frontmatterName(await readFile(path, "utf8"), basename(directory));
	} catch {
		return basename(directory);
	}
}

async function markdownSkillName(path: string): Promise<string | undefined> {
	try {
		return frontmatterName(
			await readFile(path, "utf8"),
			basename(path, extname(path)),
		);
	} catch {
		return undefined;
	}
}

async function collectSkills(
	directory: string,
	names: string[],
	includeRootMarkdown = false,
): Promise<void> {
	const direct = await skillName(directory);
	if (direct) names.push(direct);

	try {
		for (const child of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, child.name);
			if (child.isDirectory()) {
				await collectSkills(path, names);
			} else if (
				includeRootMarkdown &&
				child.isFile() &&
				extname(child.name).toLowerCase() === ".md"
			) {
				const name = await markdownSkillName(path);
				if (name) names.push(name);
			}
		}
	} catch {
		// Optional resource paths should not block startup.
	}
}

async function discoverSkills(
	paths: Array<{ path: string; includeRootMarkdown?: boolean }>,
): Promise<string[]> {
	const names: string[] = [];
	for (const entry of paths) {
		await collectSkills(entry.path, names, entry.includeRootMarkdown);
	}
	return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

async function collectThemes(path: string, names: string[]): Promise<void> {
	try {
		for (const child of await readdir(path, { withFileTypes: true })) {
			const childPath = resolve(path, child.name);
			if (child.isDirectory()) await collectThemes(childPath, names);
			else if (
				child.isFile() &&
				extname(child.name).toLowerCase() === ".json"
			) {
				await collectThemes(childPath, names);
			}
		}
		return;
	} catch {
		// The path may be a theme file rather than a directory.
	}
	try {
		const theme = JSON.parse(await readFile(path, "utf8")) as { name?: string };
		if (theme.name) names.push(theme.name);
	} catch {
		// Invalid or unavailable theme files should not block startup.
	}
}

async function discoverThemes(paths: string[]): Promise<string[]> {
	const names: string[] = [];
	for (const path of paths)
		await collectThemes(resolve(TOOLKIT_ROOT, path), names);
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
		...(manifest.pi?.skills ?? []).map((path) => ({
			path: resolve(TOOLKIT_ROOT, path),
		})),
		{
			path: resolve(homedir(), ".pi", "agent", "skills"),
			includeRootMarkdown: true,
		},
		{ path: resolve(homedir(), ".agents", "skills") },
		...(await discoverProjectSkillPaths(cwd)).map((path) => ({
			path,
			includeRootMarkdown: basename(dirname(path)) === ".pi",
		})),
	];
	const extensions = (manifest.pi?.extensions ?? [])
		.map(extensionName)
		.filter((name) => name !== "startup-dashboard")
		.sort((a, b) => a.localeCompare(b));

	return {
		contexts: await discoverContexts(cwd),
		skills: await discoverSkills(skillPaths),
		extensions: Array.from(new Set(extensions)),
		themes: await discoverThemes(manifest.pi?.themes ?? []),
	};
}
