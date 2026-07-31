import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

export class ChatModeEditor extends CustomEditor {
	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
	}

	onToggle?: () => void;

	handleInput(data: string): void {
		// Intercept before CustomEditor so Pi's app.thinking.cycle (Shift+Tab) does not fire.
		if (matchesKey(data, "shift+tab")) {
			this.onToggle?.();
			return;
		}
		super.handleInput(data);
	}
}
