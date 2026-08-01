import type {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	ToolsOptions,
} from "@earendil-works/pi-coding-agent";
import { createStyledBashDefinition } from "./bash.js";
import type { BuiltinToolName } from "./config.js";
import { createStyledEditDefinition } from "./edit.js";
import { createStyledReadDefinition } from "./read.js";
import {
	createStyledFindDefinition,
	createStyledGrepDefinition,
	createStyledLsDefinition,
} from "./search.js";
import { createStyledWriteDefinition } from "./write.js";

export type StyledDefinition =
	| ReturnType<typeof createReadToolDefinition>
	| ReturnType<typeof createWriteToolDefinition>
	| ReturnType<typeof createEditToolDefinition>
	| ReturnType<typeof createBashToolDefinition>
	| ReturnType<typeof createGrepToolDefinition>
	| ReturnType<typeof createFindToolDefinition>
	| ReturnType<typeof createLsToolDefinition>;

export type StyledDefinitions = Record<BuiltinToolName, StyledDefinition>;

export function createStyledDefinitions(
	cwd: string,
	options?: ToolsOptions,
): StyledDefinitions {
	return {
		read: createStyledReadDefinition(cwd, options?.read),
		write: createStyledWriteDefinition(cwd),
		edit: createStyledEditDefinition(cwd),
		bash: createStyledBashDefinition(cwd, options?.bash),
		grep: createStyledGrepDefinition(cwd),
		find: createStyledFindDefinition(cwd),
		ls: createStyledLsDefinition(cwd),
	};
}
