import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { showPlanDialog } from "./plan-dialog.js";

export type PlanApprovalDecision = "implement" | "defer" | "revise" | "abandon";

export interface PlanApprovalResult {
	decision: PlanApprovalDecision;
	feedback?: string;
}

export async function requestPlanApproval(
	ctx: ExtensionContext,
	planPath: string,
	planContent: string | undefined,
): Promise<PlanApprovalResult> {
	if (!ctx.hasUI) return { decision: "implement" };

	await showPlanDialog(ctx, planPath, planContent);
	const choice = await ctx.ui.select(`PLAN APPROVAL · ${planPath}`, [
		"批准并实现",
		"批准但暂不实现",
		"继续编辑",
		"取消计划",
	]);
	if (choice === "批准并实现") return { decision: "implement" };
	if (choice === "批准但暂不实现") return { decision: "defer" };
	if (choice === "取消计划") return { decision: "abandon" };
	if (choice !== "继续编辑") return { decision: "revise" };

	const note = await ctx.ui.editor("希望计划如何修改？", "");
	return { decision: "revise", feedback: note?.trim() || undefined };
}
