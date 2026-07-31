import type { TUI } from "@earendil-works/pi-tui";

const mouseTrackingUsers = new WeakMap<TUI, number>();

export function acquireMouseTracking(tui: TUI): () => void {
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

export function mouseWheelDirection(data: string): -1 | 1 | undefined {
	const match = data.match(/^\x1b\[<(\d+);\d+;\d+[Mm]$/);
	if (!match) return undefined;
	const button = Number(match[1]);
	if ((button & 64) === 0) return undefined;
	return (button & 1) === 0 ? -1 : 1;
}
