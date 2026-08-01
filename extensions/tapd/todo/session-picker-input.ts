import { matchesKey, type KeybindingsManager } from "@earendil-works/pi-tui";

interface NavigationOptions {
	current: number;
	last: number;
	pageSize: number;
	allowVim?: boolean;
}

export function navigationTarget(
	data: string,
	options: NavigationOptions,
): number | null {
	const { current, last, pageSize, allowVim = true } = options;
	if (matchesKey(data, "up") || (allowVim && data === "k"))
		return Math.max(0, current - 1);
	if (matchesKey(data, "down") || (allowVim && data === "j"))
		return Math.min(last, current + 1);
	if (matchesKey(data, "pageUp"))
		return Math.max(0, current - Math.max(1, pageSize));
	if (matchesKey(data, "pageDown"))
		return Math.min(last, current + Math.max(1, pageSize));
	if (matchesKey(data, "home")) return 0;
	if (matchesKey(data, "end")) return last;
	return null;
}

export type ConfirmationInputAction = "confirm" | "cancel" | "none";

export function decodeConfirmationInput(
	data: string,
	keybindings: KeybindingsManager,
): ConfirmationInputAction {
	if (keybindings.matches(data, "tui.select.confirm")) return "confirm";
	if (
		keybindings.matches(data, "tui.select.cancel") ||
		matchesKey(data, "ctrl+c")
	)
		return "cancel";
	return "none";
}

export type ListInputAction =
	| { type: "navigate"; target: number }
	| { type: "select" | "delete" | "cancel" | "none" };

export function decodeListInput(
	data: string,
	current: number,
	last: number,
	keybindings: KeybindingsManager,
): ListInputAction {
	const target = navigationTarget(data, {
		current,
		last,
		pageSize: 10,
	});
	if (target !== null) return { type: "navigate", target };
	if (keybindings.matches(data, "tui.select.confirm"))
		return { type: "select" };
	if (matchesKey(data, "ctrl+d")) return { type: "delete" };
	if (keybindings.matches(data, "tui.select.cancel")) return { type: "cancel" };
	return { type: "none" };
}

interface CreateInputContext {
	focus: number;
	historyCount: number;
	keybindings: KeybindingsManager;
}

export type CreateInputAction =
	| { type: "navigate"; target: number }
	| { type: "input"; target: "name" | "path" }
	| { type: "toggle-path" | "delete-path"; index: number }
	| { type: "cancel" | "submit" | "none" };

export function decodeCreateInput(
	data: string,
	context: CreateInputContext,
): CreateInputAction {
	const { focus, historyCount, keybindings } = context;
	if (keybindings.matches(data, "tui.select.cancel")) return { type: "cancel" };
	const pathInputFocus = historyCount + 1;
	let inputTarget: "name" | "path" | null = null;
	if (focus === 0) inputTarget = "name";
	else if (focus === pathInputFocus) inputTarget = "path";
	const target = navigationTarget(data, {
		current: focus,
		last: historyCount + 2,
		pageSize: 6,
		allowVim: inputTarget === null,
	});
	if (target !== null) return { type: "navigate", target };
	if (inputTarget) return { type: "input", target: inputTarget };
	const historyIndex = focus - 1;
	const isHistory = historyIndex >= 0 && historyIndex < historyCount;
	if (data === " " && isHistory)
		return { type: "toggle-path", index: historyIndex };
	if (matchesKey(data, "ctrl+d") && isHistory)
		return { type: "delete-path", index: historyIndex };
	if (keybindings.matches(data, "tui.select.confirm")) {
		if (focus === historyCount + 2) return { type: "submit" };
		if (isHistory) return { type: "toggle-path", index: historyIndex };
	}
	return { type: "none" };
}
