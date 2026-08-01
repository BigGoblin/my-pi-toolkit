import {
	getMarkdownTheme,
	rawKeyHint,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	matchesKey,
	type Component,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import type {
	LiveSubagentRun,
	SubagentTranscriptEntry,
} from "../shared/subagent/registry.js";
import {
	overlayInnerWidth,
	overlayViewportHeight,
	renderOverlayShell,
	STANDARD_OVERLAY_OPTIONS,
} from "../shared/tui/overlay-shell.js";
import {
	createSubagentEntryRenderer,
	type SubagentEntryRenderer,
} from "./entry-render.js";
import { acquireMouseTracking, mouseWheelDirection } from "./mouse.js";

export interface HistoricalSubagentView {
	title: string;
	model: string;
	cwd: string;
	status: string;
	markdown?: string;
	entries?: SubagentTranscriptEntry[];
}

type SubagentView = HistoricalSubagentView & {
	subscribe?: LiveSubagentRun["subscribe"];
};

function subagentStatusColor(status: string): "accent" | "success" | "error" {
	if (status === "running") return "accent";
	if (status === "completed") return "success";
	return "error";
}

function configuredHint(
	keybindings: KeybindingsManager,
	id: "app.thinking.toggle" | "app.tools.expand",
	description: string,
	fallback: string,
): string {
	const key = keybindings.getKeys(id)[0];
	return key ? rawKeyHint(key, description) : fallback;
}

interface SubagentOverlayOptions {
	run: SubagentView;
	cwd: string;
	tui: TUI;
	requestRender: () => void;
	theme: Theme;
	keybindings: KeybindingsManager;
	close: () => void;
}

class SubagentOverlay implements Component {
	private readonly run: SubagentView;
	private readonly tui: TUI;
	private readonly requestRender: () => void;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly close: () => void;
	private readonly renderEntry: SubagentEntryRenderer;
	private readonly unsubscribe: () => void;
	private readonly releaseMouseTracking: () => void;
	private scrollOffset = 0;
	private contentHeight = 0;
	private viewportHeight = 1;
	private autoFollow = true;
	private toolOutputExpanded = false;
	private thinkingHidden = true;

	constructor(options: SubagentOverlayOptions) {
		this.run = options.run;
		this.tui = options.tui;
		this.requestRender = options.requestRender;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.close = options.close;
		this.renderEntry = createSubagentEntryRenderer(options.cwd, options.tui);
		this.unsubscribe = this.run.subscribe?.(this.requestRender) ?? (() => {});
		this.releaseMouseTracking = acquireMouseTracking(this.tui);
	}

	handleInput(data: string): void {
		const wheelDirection = mouseWheelDirection(data);
		if (wheelDirection) {
			const maximum = Math.max(0, this.contentHeight - this.viewportHeight);
			const nextOffset = this.scrollOffset + wheelDirection * 3;
			this.scrollTo(nextOffset, wheelDirection > 0 && nextOffset >= maximum);
			return;
		}
		if (this.keybindings.matches(data, "app.thinking.toggle")) {
			this.thinkingHidden = !this.thinkingHidden;
			this.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "app.tools.expand")) {
			this.toolOutputExpanded = !this.toolOutputExpanded;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "escape")) {
			this.unsubscribe();
			this.close();
			return;
		}
		const maximum = Math.max(0, this.contentHeight - this.viewportHeight);
		if (matchesKey(data, "up")) this.scrollTo(this.scrollOffset - 1, false);
		else if (matchesKey(data, "down"))
			this.scrollTo(this.scrollOffset + 1, this.scrollOffset + 1 >= maximum);
		else if (matchesKey(data, "pageUp"))
			this.scrollTo(this.scrollOffset - this.viewportHeight, false);
		else if (matchesKey(data, "pageDown"))
			this.scrollTo(
				this.scrollOffset + this.viewportHeight,
				this.scrollOffset + this.viewportHeight >= maximum,
			);
		else if (matchesKey(data, "home")) this.scrollTo(0, false);
		else if (matchesKey(data, "end")) this.scrollTo(maximum, true);
	}

	private scrollTo(offset: number, autoFollow: boolean): void {
		const maximum = Math.max(0, this.contentHeight - this.viewportHeight);
		this.scrollOffset = Math.max(0, Math.min(offset, maximum));
		this.autoFollow = autoFollow;
		this.requestRender();
	}

	render(width: number): string[] {
		const innerWidth = overlayInnerWidth(width);
		this.viewportHeight = overlayViewportHeight(this.tui.terminal.rows);
		const renderedEntries = this.run.entries?.flatMap((entry) =>
			this.renderEntry(entry, innerWidth, {
				toolsExpanded: this.toolOutputExpanded,
				thinkingHidden: this.thinkingHidden,
			}),
		);
		const renderedMarkdown = this.run.markdown
			? new Markdown(this.run.markdown, 0, 0, getMarkdownTheme()).render(
					innerWidth,
				)
			: [];
		const content = renderedEntries?.length
			? renderedEntries
			: renderedMarkdown;
		this.contentHeight = content.length;
		const maximum = Math.max(0, content.length - this.viewportHeight);
		if (this.autoFollow) this.scrollOffset = maximum;
		else this.scrollOffset = Math.min(this.scrollOffset, maximum);
		const visible = content.slice(
			this.scrollOffset,
			this.scrollOffset + this.viewportHeight,
		);
		while (visible.length < this.viewportHeight) visible.push("");
		const statusColor = subagentStatusColor(this.run.status);
		const header = `${this.theme.bold(this.theme.fg("text", "SUBAGENT"))}  ${this.theme.fg("accent", this.run.title)}  ${this.theme.fg(statusColor, this.run.status.toUpperCase())} ${this.theme.fg("muted", `· ${this.run.model}`)}`;
		const endLine = Math.min(
			this.contentHeight,
			this.scrollOffset + this.viewportHeight,
		);
		const position = this.contentHeight
			? `${this.scrollOffset + 1}-${endLine}/${this.contentHeight}`
			: "0/0";
		const thinkingAction = this.thinkingHidden
			? "show thinking"
			: "hide thinking";
		const toolAction = this.toolOutputExpanded
			? "collapse tools"
			: "expand tools";
		const thinkingHint = configuredHint(
			this.keybindings,
			"app.thinking.toggle",
			thinkingAction,
			"toggle thinking",
		);
		const toolsHint = configuredHint(
			this.keybindings,
			"app.tools.expand",
			toolAction,
			"toggle tools",
		);
		const help = this.theme.fg(
			"dim",
			`↑↓/wheel scroll · ${thinkingHint} · ${toolsHint} · End follow · Esc close · ${position}`,
		);
		return renderOverlayShell(this.theme, width, {
			header,
			body: visible,
			footer: help,
		});
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe();
		this.releaseMouseTracking();
	}
}

async function showOverlay(
	ctx: ExtensionContext,
	run: SubagentView,
): Promise<void> {
	await ctx.ui.custom<void>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: void) => void,
		) =>
			new SubagentOverlay({
				run,
				cwd: run.cwd,
				tui,
				requestRender: () => tui.requestRender(),
				theme,
				keybindings,
				close: () => done(),
			}),
		STANDARD_OVERLAY_OPTIONS,
	);
}

export async function openSubagentOverlay(
	ctx: ExtensionContext,
	run: LiveSubagentRun,
): Promise<void> {
	await showOverlay(ctx, run);
}

export async function openHistoricalSubagentOverlay(
	ctx: ExtensionContext,
	run: HistoricalSubagentView,
): Promise<void> {
	await showOverlay(ctx, run);
}
