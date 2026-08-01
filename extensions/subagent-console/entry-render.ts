import {
	AssistantMessageComponent,
	getMarkdownTheme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createConfiguredBuiltinRenderers } from "../built-in-tool-style/renderers.js";
import type { BuiltinToolName } from "../built-in-tool-style/config.js";
import type { SubagentTranscriptEntry } from "../shared/subagent/registry.js";

interface EntryRenderOptions {
	toolsExpanded: boolean;
	thinkingHidden: boolean;
}

export type SubagentEntryRenderer = (
	entry: SubagentTranscriptEntry,
	width: number,
	options: EntryRenderOptions,
) => string[];

function renderTool(
	entry: Extract<SubagentTranscriptEntry, { kind: "tool" }>,
	tui: TUI,
	cwd: string,
	width: number,
	expanded: boolean,
	definition: ConstructorParameters<typeof ToolExecutionComponent>[4],
): string[] {
	const component = new ToolExecutionComponent(
		entry.name,
		entry.id,
		entry.args,
		{ showImages: false },
		definition,
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

export function createSubagentEntryRenderer(
	cwd: string,
	tui: TUI,
): SubagentEntryRenderer {
	const definitions = createConfiguredBuiltinRenderers(cwd);
	const markdownTheme = getMarkdownTheme();
	return (entry, width, options) => {
		if (entry.kind === "user")
			return new UserMessageComponent(entry.text, markdownTheme, 0).render(
				width,
			);
		if (entry.kind === "assistant")
			return new AssistantMessageComponent(
				entry.message as ConstructorParameters<
					typeof AssistantMessageComponent
				>[0],
				options.thinkingHidden,
				markdownTheme,
				undefined,
				0,
			).render(width);
		const definition = definitions[
			entry.name as BuiltinToolName
		] as ConstructorParameters<typeof ToolExecutionComponent>[4];
		return renderTool(
			entry,
			tui,
			cwd,
			width,
			options.toolsExpanded,
			definition,
		);
	};
}
