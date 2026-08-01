import {
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type SessionStartEvent,
	type SlashCommandInfo,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import {
	READ_ONLY_TOOL_NAMES,
	resolveBuiltinToolStyle,
	writeBuiltinToolStyle,
	type BuiltinToolStyle,
	type ResolvedBuiltinToolStyle,
} from "./config.js";
import { createStyledDefinitions } from "./definitions.js";
import {
	formatRegistrationReport,
	inspectRegistration,
	registerStyledDefinitions,
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

function registerConfigured(
	pi: ExtensionAPI,
	cwd: string,
	projectTrusted: boolean,
	config: ResolvedBuiltinToolStyle,
): void {
	if (config.enabledTools.length === 0) return;
	const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted });
	const definitions = createStyledDefinitions(cwd, {
		read: { autoResizeImages: settings.getImageAutoResize() },
		bash: {
			commandPrefix: settings.getShellCommandPrefix(),
			shellPath: settings.getShellPath(),
		},
	});
	registerStyledDefinitions(pi, config.enabledTools, definitions);
}

function extensionSource(pi: ExtensionAPI): SourceInfo | undefined {
	return pi
		.getCommands()
		.find((command: SlashCommandInfo) => command.name === "grok-tools")
		?.sourceInfo;
}

function inspectEffectiveRegistration(
	pi: ExtensionAPI,
	config: ResolvedBuiltinToolStyle,
): RegistrationReport | undefined {
	const owner = extensionSource(pi);
	if (!owner) return undefined;
	return inspectRegistration(pi.getAllTools(), config.enabledTools, owner);
}

async function handleCommand(
	args: string,
	ctx: ExtensionCommandContext,
	lastReport: RegistrationReport | undefined,
): Promise<void> {
	let current: ResolvedBuiltinToolStyle;
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
	let lastReport: RegistrationReport | undefined;
	let loadError: string | undefined;
	let config: ResolvedBuiltinToolStyle | undefined;

	pi.registerCommand("grok-tools", {
		description: "Show or set Grok styling for Pi built-in tools",
		handler: (args: string, ctx: ExtensionCommandContext) =>
			handleCommand(args, ctx, lastReport),
	});

	try {
		config = resolveBuiltinToolStyle();
		registerConfigured(pi, process.cwd(), false, config);
	} catch (error) {
		loadError = error instanceof Error ? error.message : String(error);
	}

	pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
		if (!config) {
			ctx.ui.notify(`Built-in tool style disabled: ${loadError}`, "error");
			return;
		}
		registerConfigured(pi, ctx.cwd, ctx.projectTrusted, config);
		lastReport = inspectEffectiveRegistration(pi, config);
		if (lastReport?.skipped.length) {
			ctx.ui.notify(formatRegistrationReport(lastReport), "warning");
		}
	});
}
