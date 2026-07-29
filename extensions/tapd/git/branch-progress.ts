import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BranchProgress, BranchProgressStage } from "./types.js";

const WIDGET_ID = "tapd-branch-progress";
const STAGES: BranchProgressStage[] = [
	"tapd-object",
	"repository",
	"base-ref",
	"keyword",
	"branch-check",
	"create-branch",
];
const LABELS: Record<BranchProgressStage, string> = {
	"tapd-object": "读取关联 TAPD 事项",
	repository: "定位 Git 仓库",
	"base-ref": "检查基础分支",
	keyword: "获取 TAPD keyword",
	"branch-check": "检查目标分支",
	"create-branch": "创建分支",
};

function stateIcon(progress?: BranchProgress): string {
	if (progress?.state === "done") return "✓";
	if (progress?.state === "running") return "⠋";
	if (progress?.state === "failed") return "✗";
	return "○";
}

export class BranchProgressView {
	private readonly progress = new Map<BranchProgressStage, BranchProgress>();

	constructor(private readonly ctx: ExtensionCommandContext) {}

	start(): void {
		this.render();
	}

	update(progress: BranchProgress): void {
		this.progress.set(progress.stage, progress);
		this.ctx.ui.setStatus(WIDGET_ID, progress.message);
		this.render();
	}

	fail(message: string): void {
		let runningStage: BranchProgressStage | undefined;
		for (const stage of STAGES) {
			if (this.progress.get(stage)?.state === "running") runningStage = stage;
		}
		if (runningStage)
			this.update({ stage: runningStage, state: "failed", message });
	}

	clear(): void {
		this.ctx.ui.setStatus(WIDGET_ID, undefined);
		this.ctx.ui.setWidget(WIDGET_ID, undefined);
	}

	private render(): void {
		const lines = ["TAPD Branch"];
		for (const stage of STAGES) {
			const progress = this.progress.get(stage);
			lines.push(
				`${stateIcon(progress)} ${progress?.message ?? LABELS[stage]}`,
			);
		}
		this.ctx.ui.setWidget(WIDGET_ID, lines);
	}
}
