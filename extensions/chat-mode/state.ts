export type ChatMode = "build" | "plan" | "ask";

const MODE_CYCLE: ChatMode[] = ["build", "plan", "ask"];

let currentMode: ChatMode = "build";

export function getChatMode(): ChatMode {
	return currentMode;
}

export function setChatMode(mode: ChatMode): void {
	currentMode = mode;
}

export function nextChatMode(mode: ChatMode = currentMode): ChatMode {
	const index = MODE_CYCLE.indexOf(mode);
	return MODE_CYCLE[(index + 1) % MODE_CYCLE.length]!;
}

export function isRestrictedMode(mode: ChatMode): boolean {
	return mode === "ask" || mode === "plan";
}
