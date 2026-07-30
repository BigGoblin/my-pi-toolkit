export type ChatMode = "build" | "ask";

let currentMode: ChatMode = "build";

export function getChatMode(): ChatMode {
	return currentMode;
}

export function setChatMode(mode: ChatMode): void {
	currentMode = mode;
}
