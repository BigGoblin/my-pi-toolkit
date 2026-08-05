import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Input } from "@earendil-works/pi-tui";
import { statusGlyph, UI_GLYPHS } from "../../shared/tui/visual-language.js";
import type { TapdSessionDescriptor } from "../sessions/catalog.js";

export interface SessionOption {
	link?: TapdSessionDescriptor;
	label: string;
	isCreate: boolean;
}

export interface SessionPickerViewState {
	options: SessionOption[];
	selectedIdx: number;
	pendingDelete: TapdSessionDescriptor | null;
	pendingDeletePath: string | null;
	/** 多选项目路径后，选择新会话工作目录。 */
	cwdChoice: { paths: string[]; index: number } | null;
	isCreating: boolean;
	selectedPaths: string[];
	pathHistory: string[];
	focus: number;
	itemName: string;
	nameInput: Input;
	pathInput: Input;
}

function windowAround(
	index: number,
	count: number,
	size: number,
): [number, number] {
	let start = Math.max(0, index - Math.floor(size / 2));
	const end = Math.min(count, start + size);
	start = Math.max(0, end - size);
	return [start, end];
}

function clipped(
	theme: Theme,
	value: string,
	width: number,
	active = false,
): string {
	const text = truncateToWidth(value, Math.max(1, width), UI_GLYPHS.more);
	return active ? theme.fg("accent", theme.bold(text)) : text;
}

export function renderSessionPicker(
	state: SessionPickerViewState,
	theme: Theme,
	width: number,
	rows: number,
): string[] {
	const lines = [
		theme.bold(
			theme.fg(
				"text",
				truncateToWidth(`「${state.itemName}」关联会话`, width, UI_GLYPHS.more),
			),
		),
		theme.fg("muted", `${state.options.length} 项`),
	];
	if (state.pendingDelete) {
		lines.push(
			"",
			theme.fg(
				"error",
				theme.bold(`确认删除「${state.pendingDelete.title || "会话"}」？`),
			),
		);
		return lines;
	}
	if (state.pendingDeletePath) {
		lines.push("", theme.fg("error", theme.bold("确认从历史中删除该路径？")));
		lines.push(clipped(theme, `  ${state.pendingDeletePath}`, width));
		return lines;
	}
	if (state.cwdChoice)
		return [...lines, ...renderCwdChoice(state.cwdChoice, theme, width, rows)];
	if (state.isCreating)
		return [...lines, ...renderCreate(state, theme, width, rows)];
	lines.push("");
	const viewport = Math.max(2, Math.min(16, rows - 5));
	const [start, end] = windowAround(
		state.selectedIdx,
		state.options.length,
		viewport,
	);
	for (let index = start; index < end; index++) {
		const option = state.options[index];
		const active = index === state.selectedIdx;
		const marker = statusGlyph(theme, active ? "active" : "pending");
		lines.push(clipped(theme, `${marker} ${option.label}`, width, active));
	}
	if (state.options.length > viewport)
		lines.push(theme.fg("dim", `${start + 1}-${end}/${state.options.length}`));
	return lines;
}

function renderCwdChoice(
	choice: { paths: string[]; index: number },
	theme: Theme,
	width: number,
	rows: number,
): string[] {
	const lines = [
		theme.bold("选择工作目录"),
		theme.fg(
			"muted",
			truncateToWidth("新会话将在该目录中创建", width, UI_GLYPHS.more),
		),
		"",
	];
	const viewport = Math.max(2, Math.min(12, rows - 6));
	const [start, end] = windowAround(choice.index, choice.paths.length, viewport);
	for (let index = start; index < end; index++) {
		const path = choice.paths[index];
		const active = index === choice.index;
		const marker = statusGlyph(theme, active ? "active" : "pending");
		lines.push(clipped(theme, `${marker} ${path}`, width, active));
	}
	if (choice.paths.length > viewport)
		lines.push(
			theme.fg("dim", `${start + 1}-${end}/${choice.paths.length}`),
		);
	return lines;
}

function renderCreate(
	state: SessionPickerViewState,
	theme: Theme,
	width: number,
	rows: number,
): string[] {
	const lines = [theme.bold("创建新会话"), theme.bold("会话名称（可选）")];
	if (state.focus === 0) lines.push(...state.nameInput.render(width));
	else
		lines.push(
			clipped(
				theme,
				`  ${state.nameInput.getValue().trim() || state.itemName}`,
				width,
			),
		);
	lines.push(theme.bold("项目路径（可选）"));
	lines.push(
		theme.fg(
			"muted",
			truncateToWidth("  Space 多选 · Ctrl+D 删除历史", width, ""),
		),
	);
	const pathInputFocus = state.pathHistory.length + 1;
	const historyFocus = Math.max(
		0,
		Math.min(state.pathHistory.length - 1, state.focus - 1),
	);
	const viewport = Math.max(1, Math.min(8, rows - 11));
	const [start, end] = windowAround(
		historyFocus,
		state.pathHistory.length,
		viewport,
	);
	for (let index = start; index < end; index++) {
		const path = state.pathHistory[index];
		const active = state.focus === index + 1;
		const checked = state.selectedPaths.includes(path) ? "[x]" : "[ ]";
		const marker = statusGlyph(theme, active ? "active" : "pending");
		lines.push(clipped(theme, `${marker} ${checked} ${path}`, width, active));
	}
	if (state.pathHistory.length > viewport)
		lines.push(
			theme.fg("dim", `${start + 1}-${end}/${state.pathHistory.length}`),
		);
	if (state.focus === pathInputFocus)
		lines.push(...state.pathInput.render(width));
	else {
		const pending = state.pathInput.getValue().trim() || "添加路径…";
		lines.push(
			clipped(theme, `${statusGlyph(theme, "pending")} ${pending}`, width),
		);
	}
	const submitFocus = state.pathHistory.length + 2;
	const submitMarker = statusGlyph(
		theme,
		state.focus === submitFocus ? "active" : "pending",
	);
	lines.push(
		clipped(
			theme,
			`${submitMarker} [NEW] 创建会话`,
			width,
			state.focus === submitFocus,
		),
	);
	return lines;
}
