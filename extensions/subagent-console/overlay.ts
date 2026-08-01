import {
	AssistantMessageComponent,
	getMarkdownTheme,
	ToolExecutionComponent,
	UserMessageComponent,
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
import { fitLine } from "../shared/tui/visual-language.js";
import { acquireMouseTracking, mouseWheelDirection } from "./mouse.js";

export interface HistoricalSubagentView {
	title: string;
	model: string;
	status: string;
	markdown: string;
}

type SubagentView = Omit<HistoricalSubagentView, "markdown"> & {
	markdown?: string;
	entries?: SubagentTranscriptEntry[];
	subscribe?: LiveSubagentRun["subscribe"];
};

const SUBAGENT_OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: {
		anchor: "center",
		width: "92%",
		maxHeight: "88%",
		margin: 1,
	},
} as const;

function renderTool(
	entry: Extract<SubagentTranscriptEntry, { kind: "tool" }>,
	tui: TUI,
	cwd: string,
	width: number,
	expanded: boolean,
): string[] {
	const component = new ToolExecutionComponent(
		entry.name,
		entry.id,
		entry.args,
		{ showImages: false },
		undefined,
		tui,
		cwd,
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	component.setExpanded(expanded);
	const result = entry.result as
		| {
				content?: Array<{
					type: string;
					text?: string;
					data?: string;
					mimeType?: string;
				}>;
				details?: unknown;
		  }
		| undefined;
	if (result?.content)
		component.updateResult({
			content: result.content,
			details: result.details,
			isError: entry.isError ?? false,
		});
	return component.render(width);
}

function renderEntry(
	entry: SubagentTranscriptEntry,
	tui: TUI,
	cwd: string,
	width: number,
	expanded: boolean,
): string[] {
	const markdownTheme = getMarkdownTheme();
	if (entry.kind === "user")
		return new UserMessageComponent(entry.text, markdownTheme, 0).render(width);
	if (entry.kind === "assistant")
		return new AssistantMessageComponent(
			entry.message as ConstructorParameters<
				typeof AssistantMessageComponent
			>[0],
			false,
			markdownTheme,
			undefined,
			0,
		).render(width);
	return renderTool(entry, tui, cwd, width, expanded);
}

function subagentStatusColor(status: string): "accent" | "success" | "error" {
	if (status === "running") return "accent";
	if (status === "completed") return "success";
	return "error";
}

class SubagentOverlay implements Component {
	private readonly unsubscribe: () => void;
	private readonly releaseMouseTracking: () => void;
	private scrollOffset = 0;
	private contentHeight = 0;
	private viewportHeight = 1;
	private autoFollow = true;
	private toolOutputExpanded = false;

	constructor(
		private readonly run: SubagentView,
		private readonly cwd: string,
		private readonly tui: TUI,
		private readonly requestRender: () => void,
		private readonly theme: Theme,
		private readonly close: () => void,
	) {
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
		if (matchesKey(data, "ctrl+o")) {
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
		const innerWidth = Math.max(18, width - 2);
		const panelHeight = Math.max(8, Math.floor(this.tui.terminal.rows * 0.88));
		this.viewportHeight = Math.max(1, panelHeight - 6);
		const renderedEntries = this.run.entries?.flatMap((entry) =>
			renderEntry(
				entry,
				this.tui,
				this.cwd,
				innerWidth,
				this.toolOutputExpanded,
			),
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
		const border = (value: string) => this.theme.fg("border", value);
		const statusColor = subagentStatusColor(this.run.status);
		const header = fitLine(
			`${this.theme.bold(this.theme.fg("text", "SUBAGENT"))}  ${this.theme.fg("accent", this.run.title)}  ${this.theme.fg(statusColor, this.run.status.toUpperCase())} ${this.theme.fg("muted", `· ${this.run.model}`)}`,
			innerWidth,
		);
		const endLine = Math.min(
			this.contentHeight,
			this.scrollOffset + this.viewportHeight,
		);
		const position = this.contentHeight
			? `${this.scrollOffset + 1}-${endLine}/${this.contentHeight}`
			: "0/0";
		const help = fitLine(
			this.theme.fg(
				"dim",
				`↑↓/wheel scroll · Ctrl+O expand tools · End follow · Esc close · ${position}`,
			),
			innerWidth,
		);
		return [
			border(`╭${"─".repeat(innerWidth)}╮`),
			`${border("│")}${header}${border("│")}`,
			border(`├${"─".repeat(innerWidth)}┤`),
			...visible.map(
				(line: string) =>
					`${border("│")}${fitLine(line, innerWidth)}${border("│")}`,
			),
			border(`├${"─".repeat(innerWidth)}┤`),
			`${border("│")}${help}${border("│")}`,
			border(`╰${"─".repeat(innerWidth)}╯`),
		];
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
	cwd: string,
): Promise<void> {
	await ctx.ui.custom<void>(
		(
			tui: TUI,
			theme: Theme,
			_keybindings: KeybindingsManager,
			done: (value: void) => void,
		) =>
			new SubagentOverlay(
				run,
				cwd,
				tui,
				() => tui.requestRender(),
				theme,
				() => done(),
			),
		SUBAGENT_OVERLAY_OPTIONS,
	);
}

export async function openSubagentOverlay(
	ctx: ExtensionContext,
	run: LiveSubagentRun,
): Promise<void> {
	await showOverlay(ctx, run, run.cwd);
}

export async function openHistoricalSubagentOverlay(
	ctx: ExtensionContext,
	run: HistoricalSubagentView,
): Promise<void> {
	await showOverlay(ctx, run, process.cwd());
}
