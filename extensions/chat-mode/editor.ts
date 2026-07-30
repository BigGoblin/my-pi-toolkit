import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

export class ChatModeEditor extends CustomEditor {
	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
	}

	onToggle?: () => void;

	handleInput(data: string): void {
		if (matchesKey(data, Key.tab)) {
			this.onToggle?.();
			return;
		}
		super.handleInput(data);
	}
}
