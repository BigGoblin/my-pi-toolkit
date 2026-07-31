import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ThinkingSelectorComponent } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** Forward keyboard input to the inner SelectList. */
class ThinkingLevelPicker extends ThinkingSelectorComponent {
	handleInput(data: string): void {
		this.getSelectList().handleInput(data);
	}
}

/** Register `/thinking` to open the current model's thinking level selector. */
export function registerThinkingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("thinking", {
		description: "Select thinking level for the current model",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("思考等级选择器仅在交互模式下可用", "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("当前没有选中模型", "warning");
				return;
			}

			const levels = getSupportedThinkingLevels(ctx.model);
			if (levels.length <= 1 && levels[0] === "off") {
				ctx.ui.notify("当前模型不支持思考等级", "warning");
				return;
			}

			const current = pi.getThinkingLevel();
			const selected = await ctx.ui.custom<ThinkingLevel | undefined>(
				(_tui, _theme, _kb, done) =>
					new ThinkingLevelPicker(
						current,
						levels,
						(level) => done(level),
						() => done(undefined),
					),
			);
			if (selected === undefined) return;

			pi.setThinkingLevel(selected);
			ctx.ui.notify(`Thinking level: ${selected}`, "info");
		},
	});
}
