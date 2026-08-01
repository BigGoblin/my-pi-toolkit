import type { BuiltinToolName } from "./config.js";
import { resolveBuiltinToolStyle } from "./config.js";
import {
	createStyledDefinitions,
	type StyledDefinition,
} from "./definitions.js";

export type ConfiguredBuiltinRenderers = Partial<
	Record<BuiltinToolName, StyledDefinition>
>;

export function createConfiguredBuiltinRenderers(
	cwd: string,
): ConfiguredBuiltinRenderers {
	try {
		const { enabledTools } = resolveBuiltinToolStyle();
		if (enabledTools.length === 0) return {};
		const definitions = createStyledDefinitions(cwd);
		return Object.fromEntries(
			enabledTools.map((name) => [name, definitions[name]]),
		) as ConfiguredBuiltinRenderers;
	} catch {
		return {};
	}
}
