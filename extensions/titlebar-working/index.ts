import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

function getBaseTitle(pi: ExtensionAPI): string {
	const cwd = path.basename(process.cwd());
	const session = pi.getSessionName();
	return session ? `M-PI · ${session} · ${cwd}` : `M-PI · ${cwd}`;
}

function getWorkingTitle(pi: ExtensionAPI, frame: string): string {
	const cwd = path.basename(process.cwd());
	const session = pi.getSessionName();
	return session
		? `${frame} M-PI · ${session} · ${cwd}`
		: `${frame} M-PI · ${cwd}`;
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;

	function stopAnimation(ctx: ExtensionContext): void {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
		ctx.ui.setTitle(getBaseTitle(pi));
	}

	function startAnimation(ctx: ExtensionContext): void {
		stopAnimation(ctx);
		const tick = () => {
			const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
			ctx.ui.setTitle(getWorkingTitle(pi, frame));
			frameIndex += 1;
		};
		tick();
		timer = setInterval(tick, FRAME_INTERVAL_MS);
	}

	pi.on("agent_start", (_event: unknown, ctx: ExtensionContext) => {
		startAnimation(ctx);
	});

	pi.on("agent_settled", (_event: unknown, ctx: ExtensionContext) => {
		stopAnimation(ctx);
	});

	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		stopAnimation(ctx);
	});
}
