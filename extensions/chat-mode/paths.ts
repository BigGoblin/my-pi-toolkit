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

export async function isProjectPiPath(
	cwd: string,
	requestedPath: string,
): Promise<boolean> {
	const cleanPath = requestedPath.replace(/^@/, "");
	const lexicalRoot = resolve(cwd, CONFIG_DIR_NAME);
	const lexicalTarget = resolve(cwd, cleanPath);
	if (!isWithin(lexicalRoot, lexicalTarget)) return false;

	const canonicalCwd = await realpath(cwd);
	const existingRoot = await tryRealpath(lexicalRoot);
	const canonicalRoot = existingRoot ?? resolve(canonicalCwd, CONFIG_DIR_NAME);
	if (!isWithin(canonicalCwd, canonicalRoot)) return false;

	const existingTarget = await tryRealpath(lexicalTarget);
	if (existingTarget) return isWithin(canonicalRoot, existingTarget);

	const canonicalParent = await nearestExistingPath(dirname(lexicalTarget));
	return (
		isWithin(canonicalRoot, canonicalParent) ||
		(!existingRoot && canonicalParent === canonicalCwd)
	);
}
