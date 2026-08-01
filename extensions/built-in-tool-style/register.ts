import type {
	ExtensionAPI,
	SourceInfo,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { BuiltinToolName } from "./config.js";
import type { StyledDefinitions } from "./definitions.js";

export interface RegistrationReport {
	registered: BuiltinToolName[];
	skipped: Array<{ name: BuiltinToolName; source: string }>;
	missing: BuiltinToolName[];
}

function sameSource(left: SourceInfo, right: SourceInfo): boolean {
	return left.path === right.path && left.source === right.source;
}

export function registerStyledDefinitions(
	pi: ExtensionAPI,
	enabledTools: BuiltinToolName[],
	definitions: StyledDefinitions,
): void {
	for (const name of enabledTools) pi.registerTool(definitions[name]);
}

export function inspectRegistration(
	tools: ToolInfo[],
	enabledTools: BuiltinToolName[],
	owner: SourceInfo,
): RegistrationReport {
	const available = new Map(tools.map((tool) => [tool.name, tool]));
	const report: RegistrationReport = {
		registered: [],
		skipped: [],
		missing: [],
	};
	for (const name of enabledTools) {
		const current = available.get(name);
		if (!current) {
			report.missing.push(name);
			continue;
		}
		if (sameSource(current.sourceInfo, owner)) report.registered.push(name);
		else report.skipped.push({ name, source: current.sourceInfo.source });
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
