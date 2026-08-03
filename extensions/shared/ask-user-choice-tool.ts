import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
// @ts-expect-error -- TypeBox's .d.mts exports require a newer resolver than the workspace LSP.
import { Type } from "typebox";
import { compactText } from "./tui/tool-format.js";
import { toolCall, toolResult } from "./tui/tool-render.js";

interface ChoiceOption {
	label: string;
	description?: string;
	recommended?: boolean;
}

interface AskUserChoiceParams {
	question: string;
	options: ChoiceOption[];
}

interface AskUserChoiceDetails {
	question: string;
	answer?: string;
	optionIndex?: number;
	wasCustom: boolean;
	cancelled: boolean;
}

const OptionSchema = Type.Object({
	label: Type.String({ description: "Concise answer shown in the selector." }),
	description: Type.Optional(
		Type.String({
			description: "Reason, trade-off, or impact of this option.",
		}),
	),
	recommended: Type.Optional(
		Type.Boolean({ description: "Mark at most one option as recommended." }),
	),
});

function optionLetter(index: number): string {
	return String.fromCharCode("A".charCodeAt(0) + index);
}

function optionText(option: ChoiceOption, index: number): string {
	const recommendation = option.recommended ? "（推荐）" : "";
	const description = option.description?.trim();
	return `${optionLetter(index)}${recommendation}: ${option.label.trim()}${description ? ` — ${description}` : ""}`;
}

function cancelledResult(
	question: string,
	message: string,
): {
	content: Array<{ type: "text"; text: string }>;
	details: AskUserChoiceDetails;
} {
	return {
		content: [{ type: "text", text: message }],
		details: { question, wasCustom: false, cancelled: true },
	};
}

export function registerAskUserChoiceTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user_choice",
		label: "Ask User Choice",
		description:
			"Ask one blocking clarification with selectable alternatives and a final custom-input option. Use before committing to a plan or design when a material decision needs user confirmation.",
		promptSnippet:
			"Ask a blocking clarification with recommended choices or custom input",
		promptGuidelines: [
			"Use ask_user_choice for unresolved decisions that materially affect a plan or design; investigate available context first and do not ask what repository evidence already answers.",
			"Before calling ask_user_choice, provide 2-5 concrete options, explain each option's key trade-off, and mark at most one option as recommended; custom input is added automatically.",
			"If ask_user_choice reports cancellation, stop the current planning or design workflow instead of inferring an answer.",
		],
		parameters: Type.Object({
			question: Type.String({
				description: "One specific decision to confirm.",
			}),
			options: Type.Array(OptionSchema, {
				description:
					"Two to five concrete choices. Custom input is added automatically.",
				minItems: 2,
				maxItems: 5,
			}),
		}),
		executionMode: "sequential",

		async execute(
			_toolCallId: string,
			params: AskUserChoiceParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			if (!ctx.hasUI) {
				return cancelledResult(params.question, "当前运行模式不支持交互式提问");
			}
			if (params.options.filter((option) => option.recommended).length > 1) {
				throw new Error("每个问题最多只能有一个推荐选项");
			}

			const customIndex = params.options.length;
			const choices = [
				...params.options.map(optionText),
				`${optionLetter(customIndex)}: 其他（自定义输入）`,
			];
			while (true) {
				const selected = await ctx.ui.select(params.question.trim(), choices);
				if (!selected) {
					return cancelledResult(params.question, "用户取消了确认");
				}
				const selectedIndex = choices.indexOf(selected);
				if (selectedIndex !== customIndex) {
					const option = params.options[selectedIndex];
					return {
						content: [
							{
								type: "text" as const,
								text: `用户选择 ${optionLetter(selectedIndex)}${option.recommended ? "（推荐）" : ""}: ${option.label.trim()}`,
							},
						],
						details: {
							question: params.question,
							answer: option.label.trim(),
							optionIndex: selectedIndex,
							wasCustom: false,
							cancelled: false,
						} as AskUserChoiceDetails,
					};
				}

				const custom = await ctx.ui.input(
					`${optionLetter(customIndex)}: 请输入自定义方案`,
					"描述希望采用的方案、约束或取舍",
				);
				if (custom?.trim()) {
					return {
						content: [
							{
								type: "text" as const,
								text: `用户自定义方案: ${custom.trim()}`,
							},
						],
						details: {
							question: params.question,
							answer: custom.trim(),
							wasCustom: true,
							cancelled: false,
						} as AskUserChoiceDetails,
					};
				}
			}
		},

		renderCall(args: AskUserChoiceParams, theme: Theme) {
			return toolCall(
				theme,
				"ask_user_choice",
				compactText(args.question, 80),
				`${args.options.length} 个候选方案 + 自定义输入`,
			);
		},

		renderResult(
			result: AgentToolResult<AskUserChoiceDetails>,
			_options: unknown,
			theme: Theme,
		) {
			const details = result.details as AskUserChoiceDetails | undefined;
			if (!details || details.cancelled) {
				return toolResult(theme, {
					status: "error",
					title: "clarification",
					summary: "cancelled",
				});
			}
			const prefix = details.wasCustom
				? "自定义"
				: optionLetter(details.optionIndex ?? 0);
			return toolResult(theme, {
				status: "success",
				title: "clarification",
				summary: `${prefix}: ${compactText(details.answer ?? "", 80)}`,
			});
		},
	});
}
