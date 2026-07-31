import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/** Project-local plan artifact (Grok Build `plan.md` analogue). */
export const PLAN_FILE_RELATIVE = `${CONFIG_DIR_NAME}/plan.md`;

function isWithin(root: string, target: string): boolean {
	const child = relative(root, target);
	return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function tryRealpath(path: string): Promise<string | undefined> {
	try {
		return await realpath(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return undefined;
		throw error;
	}
}

async function nearestExistingPath(path: string): Promise<string> {
	let candidate = path;
	while (true) {
		const canonical = await tryRealpath(candidate);
		if (canonical) return canonical;
		const parent = dirname(candidate);
		if (parent === candidate) throw new Error(`No existing parent for ${path}`);
		candidate = parent;
	}
}

async function resolveCanonicalTarget(
	cwd: string,
	requestedPath: string,
): Promise<{
	canonicalRoot: string;
	canonicalTarget: string | undefined;
	canonicalParent: string;
	lexicalTarget: string;
} | null> {
	const cleanPath = requestedPath.replace(/^@/, "");
	const lexicalRoot = resolve(cwd, CONFIG_DIR_NAME);
	const lexicalTarget = resolve(cwd, cleanPath);
	if (!isWithin(lexicalRoot, lexicalTarget)) return null;

	const canonicalCwd = await realpath(cwd);
	const existingRoot = await tryRealpath(lexicalRoot);
	const canonicalRoot = existingRoot ?? resolve(canonicalCwd, CONFIG_DIR_NAME);
	if (!isWithin(canonicalCwd, canonicalRoot)) return null;

	const existingTarget = await tryRealpath(lexicalTarget);
	const canonicalParent = await nearestExistingPath(dirname(lexicalTarget));
	return {
		canonicalRoot,
		canonicalTarget: existingTarget,
		canonicalParent,
		lexicalTarget,
	};
}

export async function isProjectPiPath(
	cwd: string,
	requestedPath: string,
): Promise<boolean> {
	const resolved = await resolveCanonicalTarget(cwd, requestedPath);
	if (!resolved) return false;
	if (resolved.canonicalTarget) {
		return isWithin(resolved.canonicalRoot, resolved.canonicalTarget);
	}
	const existingRoot = await tryRealpath(resolve(cwd, CONFIG_DIR_NAME));
	return (
		isWithin(resolved.canonicalRoot, resolved.canonicalParent) ||
		(!existingRoot && resolved.canonicalParent === (await realpath(cwd)))
	);
}

/** True only when the target is the project-local `.pi/plan.md`. */
export async function isPlanFilePath(
	cwd: string,
	requestedPath: string,
): Promise<boolean> {
	const resolved = await resolveCanonicalTarget(cwd, requestedPath);
	if (!resolved) return false;

	const planLexical = resolve(cwd, PLAN_FILE_RELATIVE);
	if (resolved.lexicalTarget !== planLexical) return false;

	if (resolved.canonicalTarget) {
		const planCanonical = await tryRealpath(planLexical);
		return (
			planCanonical !== undefined &&
			resolved.canonicalTarget === planCanonical
		);
	}

	const existingRoot = await tryRealpath(resolve(cwd, CONFIG_DIR_NAME));
	return (
		isWithin(resolved.canonicalRoot, resolved.canonicalParent) ||
		(!existingRoot && resolved.canonicalParent === (await realpath(cwd)))
	);
}
