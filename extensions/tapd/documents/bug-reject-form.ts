import type {
	ExtensionUIContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { STANDARD_OVERLAY_OPTIONS } from "../../shared/tui/overlay-shell.js";
import { statusGlyph, UI_GLYPHS } from "../../shared/tui/visual-language.js";
import type { ResolutionOption } from "./bug-reject-api.js";

export interface BugRejectFormState {
	reason: string;
	resolutionIndex: number;
	developer: string;
	needFaq: "是" | "否";
}

export type BugRejectFormResult =
	| { action: "submit"; state: BugRejectFormState }
	| { action: "pick-reason"; state: BugRejectFormState }
	| { action: "pick-resolution"; state: BugRejectFormState }
	| { action: "pick-developer"; state: BugRejectFormState }
	| undefined;

type FocusField = "reason" | "resolution" | "developer" | "faq" | "submit";

const FOCUS_ORDER: FocusField[] = [
	"reason",
	"resolution",
	"developer",
	"faq",
	"submit",
];

const REASON_PREVIEW_MAX_LINES = 6;

function fieldLine(
	theme: Theme,
	focused: boolean,
	label: string,
	value: string,
	width: number,
): string {
	const glyph = statusGlyph(theme, focused ? "active" : "pending");
	const clipped = truncateToWidth(
		`${glyph} ${label}：${value}`,
		Math.max(8, width),
		UI_GLYPHS.more,
	);
	return focused
		? theme.fg("accent", theme.bold(clipped))
		: theme.fg("text", clipped);
}

function renderReasonPreview(
	theme: Theme,
	reason: string,
	focused: boolean,
	width: number,
): string[] {
	const glyph = statusGlyph(theme, focused ? "active" : "pending");
	const hint = focused ? " · Enter 编辑" : "";
	const header = truncateToWidth(
		`${glyph} 评价原因：${hint}`,
		Math.max(8, width),
		UI_GLYPHS.more,
	);
	const lines = [
		focused
			? theme.fg("accent", theme.bold(header))
			: theme.fg("text", header),
	];
	const body = reason.trim() || "（空）";
	const wrapped = wrapTextWithAnsi(body, Math.max(8, width - 2));
	const visible = wrapped.slice(0, REASON_PREVIEW_MAX_LINES);
	for (const line of visible) {
		lines.push(
			theme.fg(focused ? "accent" : "muted", `  ${line}`),
		);
	}
	if (wrapped.length > REASON_PREVIEW_MAX_LINES) {
		lines.push(theme.fg("dim", `  ${UI_GLYPHS.more}`));
	}
	return lines;
}

export async function showBugRejectForm(
	ui: ExtensionUIContext,
	title: string,
	initial: BugRejectFormState,
	resolutionOptions: ResolutionOption[],
): Promise<BugRejectFormResult> {
	return ui.custom<BugRejectFormResult>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: BugRejectFormResult) => void,
		) => {
			const state: BugRejectFormState = {
				reason: initial.reason,
				resolutionIndex: Math.min(
					Math.max(0, initial.resolutionIndex),
					resolutionOptions.length - 1,
				),
				developer: initial.developer,
				needFaq: initial.needFaq,
			};
			let focus = 0;

			const content = {
				render(width: number): string[] {
					const resolution = resolutionOptions[state.resolutionIndex];
					const lines = [
						theme.bold(theme.fg("text", title)),
						theme.fg("muted", "确认后将缺陷流转为已拒绝"),
						"",
						fieldLine(theme, false, "状态", "已拒绝", width),
						...renderReasonPreview(
							theme,
							state.reason,
							FOCUS_ORDER[focus] === "reason",
							width,
						),
						fieldLine(
							theme,
							FOCUS_ORDER[focus] === "resolution",
							"解决方法",
							FOCUS_ORDER[focus] === "resolution"
								? `${resolution?.label ?? ""} · Enter 打开列表`
								: (resolution?.label ?? ""),
							width,
						),
						fieldLine(
							theme,
							FOCUS_ORDER[focus] === "developer",
							"开发人员",
							FOCUS_ORDER[focus] === "developer"
								? `${state.developer || "（空）"} · Enter 修改`
								: state.developer || "（空）",
							width,
						),
						fieldLine(
							theme,
							FOCUS_ORDER[focus] === "faq",
							"是否需要写FAQ",
							FOCUS_ORDER[focus] === "faq"
								? `${state.needFaq} · ←→ 切换`
								: state.needFaq,
							width,
						),
						"",
						FOCUS_ORDER[focus] === "submit"
							? theme.fg(
									"accent",
									theme.bold(
										`${statusGlyph(theme, "active")} 确认拒绝`,
									),
								)
							: theme.fg(
									"dim",
									`${statusGlyph(theme, "pending")} 确认拒绝`,
								),
					];
					return lines;
				},
				handleInput(data: string): void {
					if (keybindings.matches(data, "tui.select.cancel")) {
						done(undefined);
						return;
					}
					if (matchesKey(data, "up") || matchesKey(data, "shift+tab")) {
						focus = (focus - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length;
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "down") || matchesKey(data, "tab")) {
						focus = (focus + 1) % FOCUS_ORDER.length;
						tui.requestRender();
						return;
					}

					const field = FOCUS_ORDER[focus];
					if (field === "faq") {
						if (
							matchesKey(data, "left") ||
							matchesKey(data, "right") ||
							data === " "
						) {
							state.needFaq = state.needFaq === "否" ? "是" : "否";
							tui.requestRender();
							return;
						}
					}

					if (!keybindings.matches(data, "tui.select.confirm")) return;
					if (field === "reason") {
						done({ action: "pick-reason", state: { ...state } });
						return;
					}
					if (field === "resolution") {
						done({ action: "pick-resolution", state: { ...state } });
						return;
					}
					if (field === "developer") {
						done({ action: "pick-developer", state: { ...state } });
						return;
					}
					if (field === "faq") {
						focus = FOCUS_ORDER.indexOf("submit");
						tui.requestRender();
						return;
					}
					done({ action: "submit", state: { ...state } });
				},
				invalidate() {},
				footer: () =>
					"↑↓ 字段 · Enter 编辑/选择 · ←→ FAQ · Esc 取消",
			};
			return content;
		},
		STANDARD_OVERLAY_OPTIONS,
	);
}
