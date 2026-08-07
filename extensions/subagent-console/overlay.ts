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
import {
	createSharedMarkdownRendering,
	type SharedMarkdownRendering,
} from "../shared/tui/markdown.js";
import {
	overlayInnerWidth,
	overlayViewportHeight,
	renderOverlayShell,
	STANDARD_OVERLAY_OPTIONS,
} from "../shared/tui/overlay-shell.js";
import {
	createSubagentDetailNavigator,
	type SubagentDetailItem,
} from "./detail-navigation.js";
import {
	acquireMouseTracking,
	mouseWheelDirection,
	overlayWheelSupported,
} from "./mouse.js";

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
	items: SubagentDetailItem[];
	initialId: string;
	tui: TUI;
	requestRender: () => void;
	theme: Theme;
	keybindings: KeybindingsManager;
	markdown: SharedMarkdownRendering;
	close: () => void;
}

function createSubagentOverlay(options: SubagentOverlayOptions): Component {
	const navigator = createSubagentDetailNavigator(
		options.items,
		options.initialId,
		options.tui,
		options.requestRender,
		options.markdown,
	);
	const releaseMouseTracking = acquireMouseTracking(options.tui);
	let scrollOffset = 0;
	let contentHeight = 0;
	let viewportHeight = 1;
	let autoFollow = true;
	let toolOutputExpanded = false;
	let thinkingHidden = true;

	const scrollTo = (offset: number, follow: boolean) => {
		const maximum = Math.max(0, contentHeight - viewportHeight);
		scrollOffset = Math.max(0, Math.min(offset, maximum));
		autoFollow = follow;
		options.requestRender();
	};

	const switchRun = (delta: -1 | 1) => {
		if (!navigator.switch(delta)) return;
		scrollOffset = 0;
		contentHeight = 0;
		autoFollow = true;
		options.requestRender();
	};

	const handleDisplayToggle = (data: string): boolean => {
		if (options.keybindings.matches(data, "app.thinking.toggle"))
			thinkingHidden = !thinkingHidden;
		else if (options.keybindings.matches(data, "app.tools.expand"))
			toolOutputExpanded = !toolOutputExpanded;
		else return false;
		options.requestRender();
		return true;
	};

	const handleScrollKey = (data: string) => {
		const maximum = Math.max(0, contentHeight - viewportHeight);
		const commands = [
			{ key: "up", offset: scrollOffset - 1, follow: false },
			{
				key: "down",
				offset: scrollOffset + 1,
				follow: scrollOffset + 1 >= maximum,
			},
			{ key: "pageUp", offset: scrollOffset - viewportHeight, follow: false },
			{
				key: "pageDown",
				offset: scrollOffset + viewportHeight,
				follow: scrollOffset + viewportHeight >= maximum,
			},
			{ key: "home", offset: 0, follow: false },
			{ key: "end", offset: maximum, follow: true },
		];
		const command = commands.find(({ key }) => matchesKey(data, key));
		if (command) scrollTo(command.offset, command.follow);
	};

	const handleInput = (data: string) => {
		const wheelDirection = mouseWheelDirection(data);
		if (wheelDirection) {
			const maximum = Math.max(0, contentHeight - viewportHeight);
			const nextOffset = scrollOffset + wheelDirection * 3;
			scrollTo(nextOffset, wheelDirection > 0 && nextOffset >= maximum);
			return;
		}
		if (handleDisplayToggle(data)) return;
		if (matchesKey(data, "escape")) {
			navigator.dispose();
			options.close();
			return;
		}
		if (matchesKey(data, "left")) return switchRun(-1);
		if (matchesKey(data, "right")) return switchRun(1);
		handleScrollKey(data);
	};

	const render = (width: number): string[] => {
		const innerWidth = overlayInnerWidth(width);
		viewportHeight = overlayViewportHeight(options.tui.terminal.rows);
		const run = navigator.currentRun();
		const renderEntry = navigator.renderEntry();
		const renderedEntries = run.entries?.flatMap((entry) =>
			renderEntry(entry, innerWidth, {
				toolsExpanded: toolOutputExpanded,
				thinkingHidden,
			}),
		);
		const renderedMarkdown = run.markdown
			? new Markdown(
					run.markdown,
					0,
					0,
					getMarkdownTheme(),
					undefined,
					options.markdown.options("assistant"),
				).render(innerWidth)
			: [];
		const content = renderedEntries?.length
			? renderedEntries
			: renderedMarkdown;
		contentHeight = content.length;
		const maximum = Math.max(0, content.length - viewportHeight);
		scrollOffset = autoFollow ? maximum : Math.min(scrollOffset, maximum);
		const visible = content.slice(scrollOffset, scrollOffset + viewportHeight);
		while (visible.length < viewportHeight) visible.push("");
		const statusColor = subagentStatusColor(run.status);
		const header = `${options.theme.bold(options.theme.fg("text", "SUBAGENT"))} ${options.theme.fg("dim", navigator.position())}  ${options.theme.fg("accent", run.title)}  ${options.theme.fg(statusColor, run.status.toUpperCase())} ${options.theme.fg("muted", `· ${run.model}`)}`;
		const endLine = Math.min(contentHeight, scrollOffset + viewportHeight);
		const position = contentHeight
			? `${scrollOffset + 1}-${endLine}/${contentHeight}`
			: "0/0";
		const thinkingHint = configuredHint(
			options.keybindings,
			"app.thinking.toggle",
			thinkingHidden ? "show thinking" : "hide thinking",
			"toggle thinking",
		);
		const toolsHint = configuredHint(
			options.keybindings,
			"app.tools.expand",
			toolOutputExpanded ? "collapse tools" : "expand tools",
			"toggle tools",
		);
		const scrollHint = overlayWheelSupported(options.tui)
			? "↑↓/wheel scroll"
			: "↑↓/PgUp/PgDn scroll";
		const footer = options.theme.fg(
			"dim",
			`Esc close · ←/→ switch · ${scrollHint} · ${thinkingHint} · ${toolsHint} · End follow · ${position}`,
		);
		return renderOverlayShell(options.theme, width, {
			header,
			body: visible,
			footer,
		});
	};

	return {
		handleInput,
		render,
		invalidate: () => {},
		dispose: () => {
			navigator.dispose();
			releaseMouseTracking();
		},
	};
}

async function showOverlay(
	ctx: ExtensionContext,
	items: SubagentDetailItem[],
	initialId: string,
): Promise<void> {
	await ctx.ui.custom<void>(
		(
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (value: void) => void,
		) =>
			createSubagentOverlay({
				items,
				initialId,
				tui,
				requestRender: () => tui.requestRender(),
				theme,
				keybindings,
				markdown: createSharedMarkdownRendering(ctx, theme),
				close: () => done(),
			}),
		STANDARD_OVERLAY_OPTIONS,
	);
}

export async function openSubagentOverlay(
	ctx: ExtensionContext,
	items: SubagentDetailItem[],
	initialId: string,
): Promise<void> {
	if (items.length === 0) return;
	await showOverlay(ctx, items, initialId);
}
