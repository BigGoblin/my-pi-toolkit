import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

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

async function resolveCanonicalTarget(cwd: string, requestedPath: string) {
	const cleanPath = requestedPath.replace(/^@/, "");
	const lexicalRoot = resolve(cwd, CONFIG_DIR_NAME);
	const lexicalTarget = resolve(cwd, cleanPath);
	if (!isWithin(lexicalRoot, lexicalTarget)) return null;

	const canonicalCwd = await realpath(cwd);
	const existingRoot = await tryRealpath(lexicalRoot);
	const canonicalRoot = existingRoot ?? resolve(canonicalCwd, CONFIG_DIR_NAME);
	if (!isWithin(canonicalCwd, canonicalRoot)) return null;

	return {
		canonicalRoot,
		canonicalTarget: await tryRealpath(lexicalTarget),
		canonicalParent: await nearestExistingPath(dirname(lexicalTarget)),
		lexicalTarget,
	};
}

export async function isProjectPiPath(
	cwd: string,
	requestedPath: string,
): Promise<boolean> {
	const target = await resolveCanonicalTarget(cwd, requestedPath);
	if (!target) return false;
	if (target.canonicalTarget) {
		return isWithin(target.canonicalRoot, target.canonicalTarget);
	}
	const existingRoot = await tryRealpath(resolve(cwd, CONFIG_DIR_NAME));
	return (
		isWithin(target.canonicalRoot, target.canonicalParent) ||
		(!existingRoot && target.canonicalParent === (await realpath(cwd)))
	);
}

/** True only when the request exactly targets this session's fixed Plan. */
export async function isPlanFilePath(
	cwd: string,
	requestedPath: string,
	activePlanPath: string | undefined,
): Promise<boolean> {
	if (!activePlanPath) return false;
	const requested = resolve(cwd, requestedPath.replace(/^@/, ""));
	const expected = resolve(activePlanPath);
	if (requested !== expected) return false;

	const requestedCanonical = await tryRealpath(requested);
	const expectedCanonical = await tryRealpath(expected);
	if (requestedCanonical || expectedCanonical) {
		return (
			requestedCanonical !== undefined &&
			expectedCanonical !== undefined &&
			requestedCanonical === expectedCanonical
		);
	}
	return (
		(await nearestExistingPath(dirname(requested))) ===
		(await nearestExistingPath(dirname(expected)))
	);
}
