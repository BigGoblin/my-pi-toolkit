import {
	getMarkdownTheme,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	type KeybindingsManager,
	Markdown,
	matchesKey,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { fitLine } from "../shared/tui/visual-language.js";
import {
	acquireMouseTracking,
	mouseWheelDirection,
	overlayWheelSupported,
} from "../shared/tui/mouse.js";
import {
	createSharedMarkdownRendering,
	type SharedMarkdownRendering,
} from "../shared/tui/markdown.js";
import { overlayPanelHeight } from "../shared/tui/overlay-shell.js";

const PANEL_HEIGHT_RATIO = 0.84;
const WHEEL_STEP = 3;

interface PlanDialogOptions {
	tui: TUI;
	theme: Theme;
	planPath: string;
	planContent: string | undefined;
	markdown: SharedMarkdownRendering;
	close: () => void;
}

function scrollTarget(
	data: string,
	current: number,
	viewport: number,
	maximum: number,
): number | undefined {
	const wheel = mouseWheelDirection(data);
	if (wheel !== undefined) return current + wheel * WHEEL_STEP;
	if (matchesKey(data, "up")) return current - 1;
	if (matchesKey(data, "down")) return current + 1;
	if (matchesKey(data, "pageUp")) return current - viewport;
	if (matchesKey(data, "pageDown")) return current + viewport;
	if (matchesKey(data, "home")) return 0;
	if (matchesKey(data, "end")) return maximum;
	return undefined;
}

class PlanReviewDialog implements Component {
	private readonly contentBox: Box;
	private readonly releaseMouse: () => void;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly planPath: string;
	private readonly close: () => void;
	private scrollOffset = 0;
	private viewportHeight = 1;
	private contentHeight = 0;

	constructor(options: PlanDialogOptions) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.planPath = options.planPath;
		this.close = options.close;
		this.contentBox = new Box(1, 0, (text: string) =>
			options.theme.bg("customMessageBg", text),
		);
		this.contentBox.addChild(
			new Markdown(
				options.planContent ?? "_该 Plan 尚未写入内容。_",
				0,
				0,
				getMarkdownTheme(),
				undefined,
				options.markdown.options("assistant"),
			),
		);
		this.releaseMouse = acquireMouseTracking(options.tui);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
			this.close();
			return;
		}
		const target = scrollTarget(
			data,
			this.scrollOffset,
			this.viewportHeight,
			this.maximumOffset(),
		);
		if (target !== undefined) this.scrollTo(target);
	}

	private maximumOffset(): number {
		return Math.max(0, this.contentHeight - this.viewportHeight);
	}

	private scrollTo(offset: number): void {
		this.scrollOffset = Math.max(0, Math.min(this.maximumOffset(), offset));
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const background = (text: string) => this.theme.bg("customMessageBg", text);
		const title = new Text(
			`${this.theme.bold(this.theme.fg("text", "PLAN REVIEW"))}  ${this.theme.fg("muted", this.planPath)}`,
			1,
			0,
			background,
		).render(innerWidth);
		const content = this.contentBox.render(innerWidth);
		this.contentHeight = content.length;

		const panelHeight = overlayPanelHeight(this.tui.terminal.rows, {
			maxHeightRatio: PANEL_HEIGHT_RATIO,
			margin: 1,
		});
		// top border + separator + footer + bottom border occupy four rows.
		this.viewportHeight = Math.max(1, panelHeight - title.length - 4);
		this.scrollOffset = Math.min(this.scrollOffset, this.maximumOffset());
		const visible = content.slice(
			this.scrollOffset,
			this.scrollOffset + this.viewportHeight,
		);
		const blank = background(" ".repeat(innerWidth));
		while (visible.length < this.viewportHeight) visible.push(blank);

		const end = Math.min(
			this.contentHeight,
			this.scrollOffset + this.viewportHeight,
		);
		const scrollHelp = overlayWheelSupported(this.tui)
			? "↑↓/wheel/PgUp/PgDn scroll"
			: "↑↓/PgUp/PgDn scroll";
		const status = [
			scrollHelp,
			"Enter/Esc close",
			`${this.scrollOffset + 1}-${end}/${this.contentHeight}`,
		].join(" · ");
		const footer = new Text(this.theme.fg("dim", status), 1, 0, background)
			.render(innerWidth)
			.slice(0, 1);
		const border = (text: string) => this.theme.fg("border", text);
		const body = [...title, ...visible].map(
			(line) => `${border("│")}${fitLine(line, innerWidth)}${border("│")}`,
		);
		return [
			border(`╭${"─".repeat(innerWidth)}╮`),
			...body,
			border(`├${"─".repeat(innerWidth)}┤`),
			...footer.map(
				(line: string) =>
					`${border("│")}${fitLine(line, innerWidth)}${border("│")}`,
			),
			border(`╰${"─".repeat(innerWidth)}╯`),
		];
	}

	invalidate(): void {
		this.contentBox.invalidate();
	}

	dispose(): void {
		this.releaseMouse();
	}
}

export async function showPlanDialog(
	ctx: ExtensionContext,
	planPath: string,
	planContent: string | undefined,
): Promise<void> {
	if (ctx.mode !== "tui") return;

	await ctx.ui.custom<void>(
		(
			tui: TUI,
			theme: Theme,
			_keybindings: KeybindingsManager,
			done: (result: void) => void,
		) =>
			new PlanReviewDialog({
				tui,
				theme,
				planPath,
				planContent,
				markdown: createSharedMarkdownRendering(ctx, theme),
				close: done,
			}),
		{
			overlay: true,
			overlayOptions: {
				width: "90%",
				minWidth: 48,
				maxHeight: "84%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}
