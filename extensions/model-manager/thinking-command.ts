import {
	DynamicBorder,
	getSelectListTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container as RuntimeContainer,
	SelectList as RuntimeSelectList,
	Spacer as RuntimeSpacer,
	Text as RuntimeText,
	type Component,
	type SelectItem,
	type SelectList as SelectListType,
	type Spacer as SpacerType,
	type Text as TextType,
	type TUI,
} from "@earendil-works/pi-tui";

interface ChildContainer extends Component {
	addChild(component: Component): void;
}

const Container = RuntimeContainer as unknown as new () => ChildContainer;
const SelectList = RuntimeSelectList as typeof SelectListType;
const Spacer = RuntimeSpacer as typeof SpacerType;
const Text = RuntimeText as typeof TextType;

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

const THINKING_DESCRIPTIONS: Record<ThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Extra-high reasoning (~32k tokens)",
	max: "Maximum reasoning",
};

class EffortSelector extends Container {
	private readonly selectList: SelectListType;

	constructor(
		levels: ThinkingLevel[],
		current: ThinkingLevel,
		theme: Theme,
		onSelect: (level: ThinkingLevel) => void,
		onCancel: () => void,
	) {
		super();
		this.addChild(new DynamicBorder());
		this.addChild(
			new Text(theme.bold(theme.fg("accent", "Thinking Level")), 0, 0),
		);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg("muted", "Select reasoning depth for thinking-capable models"),
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));

		const items = levels.map((level) => ({
			value: level,
			label: level,
			description: THINKING_DESCRIPTIONS[level],
		}));
		this.selectList = new SelectList(
			items,
			Math.min(items.length, 10),
			getSelectListTheme(),
			{ minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 32 },
		);
		this.selectList.setSelectedIndex(Math.max(0, levels.indexOf(current)));
		this.selectList.onSelect = (item: SelectItem) =>
			onSelect(item.value as ThinkingLevel);
		this.selectList.onCancel = onCancel;
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0),
		);
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

function getSupportedThinkingLevels(
	model: NonNullable<ExtensionCommandContext["model"]>,
): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		return (level !== "xhigh" && level !== "max") || mapped !== undefined;
	});
}

/** Register `/effort` to open the current model's thinking level selector. */
export function registerThinkingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("effort", {
		description: "Select thinking level for the current model",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
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

			const selected = await ctx.ui.custom<ThinkingLevel | undefined>(
				(
					_tui: TUI,
					theme: Theme,
					_keybindings: KeybindingsManager,
					done: (value: ThinkingLevel | undefined) => void,
				) =>
					new EffortSelector(levels, pi.getThinkingLevel(), theme, done, () =>
						done(undefined),
					),
			);
			if (selected === undefined) return;

			pi.setThinkingLevel(selected);
		},
	});
}
