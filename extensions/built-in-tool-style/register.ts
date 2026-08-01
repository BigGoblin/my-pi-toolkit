import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { BuiltinToolName } from "./config.js";
import type { StyledDefinitions } from "./definitions.js";

export interface RegistrationReport {
	registered: BuiltinToolName[];
	skipped: Array<{ name: BuiltinToolName; source: string }>;
	missing: BuiltinToolName[];
}

function effectiveTools(tools: ToolInfo[]): Map<string, ToolInfo> {
	return new Map(tools.map((tool) => [tool.name, tool]));
}

export function registerStyledBuiltins(
	pi: ExtensionAPI,
	enabledTools: BuiltinToolName[],
	definitions: StyledDefinitions,
	ownedSources: ReadonlyMap<BuiltinToolName, string> = new Map(),
): RegistrationReport {
	const available = effectiveTools(pi.getAllTools());
	const report: RegistrationReport = {
		registered: [],
		skipped: [],
		missing: [],
	};

	for (const name of enabledTools) {
		const current = available.get(name);
		const definition = definitions[name];
		if (!current || !definition) {
			report.missing.push(name);
			continue;
		}
		const source = current.sourceInfo.source;
		if (source !== "builtin" && ownedSources.get(name) !== source) {
			report.skipped.push({ name, source });
			continue;
		}
		pi.registerTool(definition);
		report.registered.push(name);
	}

	return report;
}

export function formatRegistrationReport(report: RegistrationReport): string {
	const lines = [
		`Grok built-in tools: ${report.registered.length > 0 ? report.registered.join(", ") : "none"}`,
	];
	if (report.skipped.length > 0) {
		lines.push(
			`Skipped overrides: ${report.skipped.map(({ name, source }) => `${name} (${source})`).join(", ")}`,
		);
	}
	if (report.missing.length > 0) {
		lines.push(`Unavailable: ${report.missing.join(", ")}`);
	}
	return lines.join("\n");
}
