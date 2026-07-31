/**
 * Soft-load pi-lens so toolkit startup survives platforms where pi-lens /
 * @ast-grep native install failed (e.g. Termux/Android).
 */
export default async function piLens(pi) {
	try {
		const mod = await import("../../node_modules/pi-lens/dist/index.js");
		const register = mod.default ?? mod;
		if (typeof register === "function") {
			return register(pi);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[pi-lens] skipped — package unavailable (${message}). Other toolkit extensions still load.`,
		);
	}
}
