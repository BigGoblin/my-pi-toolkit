import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	matchesKey,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { overlayViewportHeight } from "../../shared/tui/overlay-shell.js";
import type { TapdSessionDescriptor } from "../sessions/catalog.js";
import { loadPathHistory } from "../sessions/storage.js";
import type { PickerAction } from "../types.js";
import {
	addProjectPath,
	applyListAction,
	buildSessionOptions,
	confirmPendingDeletion,
	createPickerAction,
	submitCreate,
	toggleProjectPath,
} from "./session-picker-actions.js";
import {
	decodeConfirmationInput,
	decodeCreateInput,
	decodeListInput,
} from "./session-picker-input.js";
import {
	renderSessionPicker,
	type SessionOption,
	type SessionPickerViewState,
} from "./session-picker-view.js";

export function showSessionPicker(
	ctx: ExtensionContext,
	sessions: TapdSessionDescriptor[],
	itemName: string,
): Promise<PickerAction | null> {
	return ctx.ui.custom<PickerAction | null>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: PickerAction | null) => void,
		) =>
			new SessionPicker({
				tui,
				theme,
				keybindings,
				done,
				ctx,
				options: buildSessionOptions(sessions),
				itemName,
			}),
	);
}

interface SessionPickerOptions {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	done: (result: PickerAction | null) => void;
	ctx: ExtensionContext;
	options: SessionOption[];
	itemName: string;
}

class SessionPicker {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly done: (result: PickerAction | null) => void;
	private readonly ctx: ExtensionContext;
	private state: SessionPickerViewState;

	constructor(options: SessionPickerOptions) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.done = options.done;
		this.ctx = options.ctx;
		this.state = {
			options: options.options,
			selectedIdx: 0,
			pendingDelete: null,
			pendingDeletePath: null,
			cwdChoice: null,
			isCreating: false,
			selectedPaths: [],
			pathHistory: loadPathHistory(),
			focus: 0,
			itemName: options.itemName,
			nameInput: new Input(),
			pathInput: new Input(),
		};
		this.state.nameInput.onSubmit = () => this.moveFocus(1);
		this.state.nameInput.onEscape = () => this.exitCreate();
		this.state.pathInput.onSubmit = (value: string) => {
			addProjectPath(this.state, value);
			this.redraw();
		};
		this.state.pathInput.onEscape = () => this.exitCreate();
	}

	private pathInputFocus(): number {
		return this.state.pathHistory.length + 1;
	}

	private syncFocus(): void {
		this.state.nameInput.focused =
			this.state.isCreating && this.state.focus === 0;
		this.state.pathInput.focused =
			this.state.isCreating && this.state.focus === this.pathInputFocus();
	}

	private redraw(): void {
		this.syncFocus();
		this.tui.requestRender();
	}

	private moveFocus(delta: number): void {
		const lastFocus = this.state.pathHistory.length + 2;
		this.state.focus = Math.max(
			0,
			Math.min(lastFocus, this.state.focus + delta),
		);
		this.redraw();
	}

	private exitCreate(): void {
		this.state.isCreating = false;
		this.redraw();
	}

	render(width: number): string[] {
		this.syncFocus();
		return renderSessionPicker(
			this.state,
			this.theme,
			width,
			overlayViewportHeight(this.tui.terminal.rows),
		);
	}

	/** 底部 Footer 提示：与 TapdOverlayFrame 的 content.footer 约定对应。 */
	footer(width: number): string {
		if (this.state.pendingDelete || this.state.pendingDeletePath)
			return "Enter 确认 · Esc/Ctrl+C 取消";
		if (this.state.cwdChoice) {
			if (width < 64) return "↑↓ 选择 · Enter 确认 · Esc 返回 · Ctrl+C";
			return "↑↓/PgUp/PgDn/Home/End 选择 · Enter 确认 · Esc 返回 · Ctrl+C 退出";
		}
		if (this.state.isCreating) {
			if (width < 64)
				return "↑↓/PgUp/PgDn 切换 · Enter 确认 · Esc 返回 · Ctrl+C";
			return "↑↓/PgUp/PgDn/Home/End 切换 · Enter 确认 · Esc 返回 · Ctrl+C 退出";
		}
		if (width < 71) return "↑↓/PgUp/PgDn 选择 · Enter 打开 · Esc/Ctrl+C";
		return "↑↓/PgUp/PgDn/Home/End 选择 · Enter 打开 · Ctrl+D 删除 · Esc/Ctrl+C 返回";
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.state.pendingDelete || this.state.pendingDeletePath) {
			this.handleConfirmation(data);
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.done(null);
			return;
		}
		if (this.state.cwdChoice) {
			this.handleCwdChoiceInput(data);
			return;
		}
		if (this.state.isCreating) this.handleCreateInput(data);
		else this.handleListInput(data);
	}

	private handleCwdChoiceInput(data: string): void {
		const choice = this.state.cwdChoice;
		if (!choice) return;
		const action = decodeListInput(
			data,
			choice.index,
			choice.paths.length - 1,
			this.keybindings,
		);
		if (action.type === "navigate") {
			choice.index = action.target;
			this.redraw();
			return;
		}
		if (action.type === "cancel") {
			this.state.cwdChoice = null;
			this.redraw();
			return;
		}
		if (action.type === "select") {
			const path = choice.paths[choice.index];
			this.state.cwdChoice = null;
			this.done(createPickerAction(this.state, path));
		}
	}

	private handleConfirmation(data: string): void {
		const action = decodeConfirmationInput(data, this.keybindings);
		if (action === "none") return;
		if (action === "confirm") confirmPendingDeletion(this.state, this.ctx);
		this.state.pendingDelete = null;
		this.state.pendingDeletePath = null;
		this.redraw();
	}

	private handleListInput(data: string): void {
		const action = decodeListInput(
			data,
			this.state.selectedIdx,
			this.state.options.length - 1,
			this.keybindings,
		);
		const effect = applyListAction(this.state, action, this.ctx);
		if (effect.type === "redraw") this.redraw();
		else if (effect.type === "done") this.done(effect.result);
	}

	private handleCreateInput(data: string): void {
		const action = decodeCreateInput(data, {
			focus: this.state.focus,
			historyCount: this.state.pathHistory.length,
			keybindings: this.keybindings,
		});
		switch (action.type) {
			case "cancel":
				this.exitCreate();
				return;
			case "navigate":
				this.state.focus = action.target;
				this.redraw();
				return;
			case "input":
				this.forwardInput(action.target, data);
				return;
			case "toggle-path":
				toggleProjectPath(this.state, action.index);
				this.redraw();
				return;
			case "delete-path":
				this.state.pendingDeletePath = this.state.pathHistory[action.index];
				this.redraw();
				return;
			case "submit": {
				const result = submitCreate(this.state);
				if (result === "cwd-choice") this.redraw();
				else this.done(result);
				return;
			}
			default:
				return;
		}
	}

	private forwardInput(target: "name" | "path", data: string): void {
		if (target === "name") this.state.nameInput.handleInput(data);
		else this.state.pathInput.handleInput(data);
		this.tui.requestRender();
	}
}
