import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

export const IMPLEMENTATION_WORKER_EXTENSIONS = [
	resolve(EXTENSION_DIR, "../cursor-models/index.ts"),
	resolve(EXTENSION_DIR, "../pi-lens/index.js"),
	resolve(EXTENSION_DIR, "path-guard.ts"),
];
