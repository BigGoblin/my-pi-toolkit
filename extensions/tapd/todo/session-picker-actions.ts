import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Input } from "@earendil-works/pi-tui";
import { UI_GLYPHS } from "../../shared/tui/visual-language.js";
import {
	invalidateTapdCatalog,
	type TapdSessionDescriptor,
} from "../sessions/catalog.js";
import {
	deleteSessionFile,
	readSessionTitle,
} from "../sessions/session-files.js";
import {
	loadPathHistory,
	rememberProjectPaths,
	removeProjectPathFromHistory,
} from "../sessions/storage.js";
import type { PickerAction } from "../types.js";
import type { ListInputAction } from "./session-picker-input.js";
import type {
	SessionOption,
	SessionPickerViewState,
} from "./session-picker-view.js";

export type PickerEffect =
	| { type: "done"; result: PickerAction | null }
	| { type: "redraw" | "none" };

type CursorInput = Input & { cursor: number };

function resetInput(input: Input, value: string): void {
	input.setValue(value);
	(input as CursorInput).cursor = value.length;
}

export function buildSessionOptions(
	sessions: TapdSessionDescriptor[],
): SessionOption[] {
	const options: SessionOption[] = [];
	for (const session of sessions) {
		const time = new Date(session.createdAt).toLocaleString("zh-CN");
		const title =
			readSessionTitle(session.sessionFile) ?? session.title ?? "(无标题)";
		const paths = session.projectPaths?.length
			? ` | ${session.projectPaths.length} 项目`
			: "";
		options.push({
			link: session,
			label: `${title} | ${time}${paths} [FILE]`,
			isCreate: false,
		});
	}
	options.push({
		isCreate: true,
		label: `${UI_GLYPHS.action} [NEW] 创建新会话`,
	});
	return options;
}

export function beginCreate(
	state: SessionPickerViewState,
	currentWorkingDirectory: string,
): void {
	state.isCreating = true;
	state.pendingDelete = null;
	state.pendingDeletePath = null;
	state.cwdChoice = null;
	const currentPath = currentWorkingDirectory.trim();
	if (currentPath) rememberProjectPaths([currentPath]);
	state.pathHistory = loadPathHistory();
	state.selectedPaths = currentPath ? [currentPath] : [];
	state.focus = 0;
	resetInput(state.nameInput, state.itemName);
	resetInput(state.pathInput, "");
}

export function addProjectPath(
	state: SessionPickerViewState,
	value: string,
): void {
	const path = value.trim();
	if (!path) return;
	if (!state.selectedPaths.includes(path)) state.selectedPaths.push(path);
	rememberProjectPaths([path]);
	state.pathHistory = loadPathHistory();
	resetInput(state.pathInput, "");
	state.focus = state.pathHistory.length + 1;
}

export function createPickerAction(
	state: SessionPickerViewState,
	workingDirectory?: string,
): PickerAction {
	const title = state.nameInput.getValue().trim() || state.itemName;
	const pending = state.pathInput.getValue().trim();
	const projectPaths = [...state.selectedPaths];
	if (pending && !projectPaths.includes(pending)) projectPaths.push(pending);
	return {
		type: "create",
		draft: {
			title,
			projectPaths,
			workingDirectory,
		},
	};
}

/** 多选路径时进入工作目录选择；否则直接返回 create action。 */
export function submitCreate(
	state: SessionPickerViewState,
): PickerAction | "cwd-choice" {
	const pending = state.pathInput.getValue().trim();
	const projectPaths = [...state.selectedPaths];
	if (pending && !projectPaths.includes(pending)) projectPaths.push(pending);
	if (projectPaths.length > 1) {
		beginCwdChoice(state, projectPaths);
		return "cwd-choice";
	}
	return createPickerAction(
		state,
		projectPaths.length === 1 ? projectPaths[0] : undefined,
	);
}

export function beginCwdChoice(
	state: SessionPickerViewState,
	paths: string[],
): void {
	state.cwdChoice = { paths, index: 0 };
}

export function toggleProjectPath(
	state: SessionPickerViewState,
	index: number,
): void {
	const path = state.pathHistory[index];
	if (!path) return;
	const selected = state.selectedPaths.indexOf(path);
	if (selected >= 0) state.selectedPaths.splice(selected, 1);
	else state.selectedPaths.push(path);
}

export function removeHistoryPath(
	state: SessionPickerViewState,
	path: string,
): void {
	const oldIndex = state.pathHistory.indexOf(path);
	removeProjectPathFromHistory(path);
	state.selectedPaths = state.selectedPaths.filter((value) => value !== path);
	state.pathHistory = loadPathHistory();
	const pathInputFocus = state.pathHistory.length + 1;
	state.focus = Math.min(
		Math.max(1, oldIndex + 1),
		state.pathHistory.length ? state.pathHistory.length : pathInputFocus,
	);
}

function removeSession(
	state: SessionPickerViewState,
	session: TapdSessionDescriptor,
): ReturnType<typeof deleteSessionFile> {
	const result = deleteSessionFile(session.sessionFile);
	if (!result.ok) return result;
	invalidateTapdCatalog();
	const index = state.options.findIndex(
		(option) => option.link?.sessionFile === session.sessionFile,
	);
	if (index >= 0) state.options.splice(index, 1);
	state.selectedIdx = Math.min(
		state.selectedIdx,
		Math.max(0, state.options.length - 1),
	);
	return result;
}

export function confirmPendingDeletion(
	state: SessionPickerViewState,
	ctx: ExtensionContext,
): void {
	if (state.pendingDelete) {
		const result = removeSession(state, state.pendingDelete);
		if (!result.ok)
			ctx.ui.notify(`删除会话失败：${result.error ?? "未知错误"}`, "error");
		else
			ctx.ui.notify(
				result.method === "missing"
					? "会话文件已不存在"
					: "会话已删除（关联信息随会话消失）",
				"info",
			);
	}
	if (state.pendingDeletePath) {
		removeHistoryPath(state, state.pendingDeletePath);
		ctx.ui.notify("已删除历史路径", "info");
	}
}

export function applyListAction(
	state: SessionPickerViewState,
	action: ListInputAction,
	ctx: ExtensionContext,
): PickerEffect {
	if (action.type === "navigate") {
		state.selectedIdx = action.target;
		return { type: "redraw" };
	}
	if (action.type === "cancel") return { type: "done", result: null };
	const option = state.options[state.selectedIdx];
	if (action.type === "select") {
		if (option.isCreate) {
			beginCreate(state, ctx.cwd);
			return { type: "redraw" };
		}
		if (option.link?.sessionFile)
			return {
				type: "done",
				result: { type: "switch", sessionFile: option.link.sessionFile },
			};
		ctx.ui.notify("无可恢复文件", "warning");
	}
	if (action.type === "delete" && option?.link && !option.isCreate) {
		const current = ctx.sessionManager.getSessionFile();
		if (current && option.link.sessionFile === current) {
			ctx.ui.notify("不能删除当前会话", "warning");
			return { type: "none" };
		}
		state.pendingDelete = option.link;
		return { type: "redraw" };
	}
	return { type: "none" };
}
