import type { TUI } from "@earendil-works/pi-tui";

const mouseTrackingUsers = new WeakMap<TUI, number>();

export function overlayWheelSupported(tui: TUI): boolean {
	return tui.mode === "regular";
}

function hostOwnsMouseTracking(tui: TUI): boolean {
	return tui.mode === "fullscreen";
}

/** Enable SGR mouse tracking in regular mode; fullscreen owns its mouse mode. */
export function acquireMouseTracking(tui: TUI): () => void {
	if (hostOwnsMouseTracking(tui)) return () => {};
	const users = mouseTrackingUsers.get(tui) ?? 0;
	if (users === 0) tui.terminal.write("\x1b[?1000h\x1b[?1006h");
	mouseTrackingUsers.set(tui, users + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = Math.max(0, (mouseTrackingUsers.get(tui) ?? 1) - 1);
		if (remaining > 0) {
			mouseTrackingUsers.set(tui, remaining);
			return;
		}
		mouseTrackingUsers.delete(tui);
		tui.terminal.write("\x1b[?1006l\x1b[?1000l");
	};
}

/** Parse an SGR wheel event: -1 scrolls up, 1 scrolls down. */
export function mouseWheelDirection(data: string): -1 | 1 | undefined {
	const match = data.match(/^\x1b\[<(\d+);\d+;\d+[Mm]$/);
	if (!match) return undefined;
	const button = Number(match[1]);
	if ((button & 64) === 0) return undefined;
	return (button & 1) === 0 ? -1 : 1;
}
