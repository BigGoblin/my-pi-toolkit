import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	SessionInfoChangedEvent,
	SessionStartEvent,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { discoverDashboardData, type DashboardData } from "./discovery.js";
import { createFooterSnapshot, renderFooter } from "./footer.js";
import { renderDashboard } from "./layout.js";

export default function startupDashboard(pi: ExtensionAPI) {
	let data: DashboardData = {
		contexts: [],
		skills: [],
		extensions: [],
		themes: [],
	};
	let headerEnabled = true;
	let footerEnabled = true;
	let sessionTitle: string | undefined;
	let requestFooterRender: (() => void) | undefined;

	const installHeader = (
		ctx: ExtensionContext,
		clearTerminal = false,
	): void => {
		if (!headerEnabled) {
			ctx.ui.setHeader(undefined);
			return;
		}
		let shouldClearTerminal = clearTerminal;
		ctx.ui.setHeader((tui: TUI, theme: Theme) => {
			if (shouldClearTerminal) {
				tui.terminal.clearScreen();
				tui.terminal.write("\x1b[3J");
				shouldClearTerminal = false;
			}
			return {
				render: (width: number) => renderDashboard(width, data, theme),
				invalidate() {},
			};
		});
	};

	const installFooter = (ctx: ExtensionContext): void => {
		if (!footerEnabled) {
			ctx.ui.setFooter(undefined);
			requestFooterRender = undefined;
			return;
		}
		ctx.ui.setFooter(
			(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
				const requestRender = () => tui.requestRender();
				requestFooterRender = requestRender;
				const unsubscribeBranch = footerData.onBranchChange(requestRender);
				return {
					render: (width: number) =>
						renderFooter(
							width,
							createFooterSnapshot(
								ctx,
								footerData.getGitBranch(),
								sessionTitle,
								footerData.getExtensionStatuses().get("chat-mode"),
								footerData.getExtensionStatuses().get("subagent"),
							),
							theme,
						),
					invalidate() {},
					dispose: () => {
						unsubscribeBranch();
						if (requestFooterRender === requestRender) {
							requestFooterRender = undefined;
						}
					},
				};
			},
		);
	};

	pi.on(
		"session_start",
		async (event: SessionStartEvent, ctx: ExtensionContext) => {
			if (ctx.mode !== "tui") return;
			sessionTitle = pi.getSessionName();
			data = await discoverDashboardData(ctx.cwd);
			installHeader(ctx, event.reason === "startup");
			installFooter(ctx);
		},
	);

	const refreshFooter = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		requestFooterRender?.();
	};

	pi.on("model_select", (_event: unknown, ctx: ExtensionContext) =>
		refreshFooter(ctx),
	);
	pi.on("thinking_level_select", (_event: unknown, ctx: ExtensionContext) =>
		refreshFooter(ctx),
	);
	pi.on(
		"session_info_changed",
		(event: SessionInfoChangedEvent, ctx: ExtensionContext) => {
			sessionTitle = event.name;
			refreshFooter(ctx);
		},
	);
	pi.on("message_start", (_event: unknown, ctx: ExtensionContext) =>
		refreshFooter(ctx),
	);
	pi.on("message_end", (_event: unknown, ctx: ExtensionContext) =>
		refreshFooter(ctx),
	);
	pi.on("session_compact", (_event: unknown, ctx: ExtensionContext) =>
		refreshFooter(ctx),
	);
	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		sessionTitle = undefined;
		requestFooterRender = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
		ctx.ui.setHeader(undefined);
	});

	pi.registerCommand("dashboard-header", {
		description: "Toggle the custom startup dashboard header",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") return;
			headerEnabled = !headerEnabled;
			if (headerEnabled) data = await discoverDashboardData(ctx.cwd);
			installHeader(ctx);
			ctx.ui.notify(
				`Dashboard header ${headerEnabled ? "enabled" : "disabled"}`,
				"info",
			);
		},
	});

	pi.registerCommand("dashboard-footer", {
		description: "Toggle the custom dashboard footer",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") return;
			footerEnabled = !footerEnabled;
			installFooter(ctx);
			ctx.ui.notify(
				`Dashboard footer ${footerEnabled ? "enabled" : "disabled"}`,
				"info",
			);
		},
	});
}
