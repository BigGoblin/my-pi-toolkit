import {
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type SessionStartEvent,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
	READ_ONLY_TOOL_NAMES,
	resolveBuiltinToolStyle,
	writeBuiltinToolStyle,
	type BuiltinToolName,
	type BuiltinToolStyle,
} from "./config.js";
import { createStyledDefinitions } from "./definitions.js";
import {
	formatRegistrationReport,
	registerStyledBuiltins,
	type RegistrationReport,
} from "./register.js";

function styleLabel(style: BuiltinToolStyle): string {
	return Array.isArray(style) ? style.join(", ") || "none" : style;
}

function parseCommandStyle(value: string): BuiltinToolStyle | undefined {
	switch (value.trim().toLowerCase()) {
		case "native":
			return "native";
		case "grok":
			return "grok";
		case "readonly":
		case "read-only":
			return [...READ_ONLY_TOOL_NAMES];
		default:
			return undefined;
	}
}

function notifyStatus(
	ctx: ExtensionCommandContext,
	style: BuiltinToolStyle,
	report: RegistrationReport | undefined,
): void {
	const registration = report
		? `\n${formatRegistrationReport(report)}`
		: "\nReload to inspect registration status.";
	ctx.ui.notify(
		`Built-in tool style: ${styleLabel(style)}${registration}`,
		"info",
	);
}

function registerForSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	ownedSources: Map<BuiltinToolName, string>,
): RegistrationReport | undefined {
	let config;
	try {
		config = resolveBuiltinToolStyle();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Built-in tool style disabled: ${message}`, "error");
		return undefined;
	}
	if (config.enabledTools.length === 0) {
		return { registered: [], skipped: [], missing: [] };
	}
	const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.projectTrusted,
	});
	const definitions = createStyledDefinitions(ctx.cwd, {
		read: { autoResizeImages: settings.getImageAutoResize() },
		bash: {
			commandPrefix: settings.getShellCommandPrefix(),
			shellPath: settings.getShellPath(),
		},
	});
	const report = registerStyledBuiltins(
		pi,
		config.enabledTools,
		definitions,
		ownedSources,
	);
	const effectiveTools = new Map<string, string>(
		pi
			.getAllTools()
			.map((tool: ToolInfo): [string, string] => [
				tool.name,
				tool.sourceInfo.source,
			]),
	);
	for (const name of report.registered) {
		const source = effectiveTools.get(name);
		if (source && source !== "builtin") ownedSources.set(name, source);
	}
	if (report.skipped.length > 0) {
		ctx.ui.notify(formatRegistrationReport(report), "warning");
	}
	return report;
}

async function handleCommand(
	args: string,
	ctx: ExtensionCommandContext,
	lastReport: RegistrationReport | undefined,
): Promise<void> {
	let current;
	try {
		current = resolveBuiltinToolStyle();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(message, "error");
		return;
	}
	if (!args.trim()) {
		notifyStatus(ctx, current.style, lastReport);
		return;
	}
	const style = parseCommandStyle(args);
	if (style === undefined) {
		ctx.ui.notify("Usage: /grok-tools [native|readonly|grok]", "warning");
		return;
	}
	const configPath = writeBuiltinToolStyle(style);
	ctx.ui.notify(
		`Built-in tool style set to ${styleLabel(style)} in ${configPath}`,
		"info",
	);
	await ctx.reload();
}

export default function builtInToolStyle(pi: ExtensionAPI): void {
	const ownedSources = new Map<BuiltinToolName, string>();
	let lastReport: RegistrationReport | undefined;
	pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
		lastReport = registerForSession(pi, ctx, ownedSources);
	});
	pi.registerCommand("grok-tools", {
		description: "Show or set Grok styling for Pi built-in tools",
		handler: (args: string, ctx: ExtensionCommandContext) =>
			handleCommand(args, ctx, lastReport),
	});
}
