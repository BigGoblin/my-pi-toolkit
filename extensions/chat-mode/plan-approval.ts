import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { showPlanDialog } from "./plan-dialog.js";

export type PlanApprovalDecision =
	| "implement"
	| "defer"
	| "revise"
	| "abandon";

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
	const choice = await ctx.ui.select(
		`请选择 ${planPath} 的审批操作：`,
		["批准并实现", "批准方案，暂不实现", "要求修改", "放弃计划"],
	);
	if (choice === "批准并实现") return { decision: "implement" };
	if (choice === "批准方案，暂不实现") return { decision: "defer" };
	if (choice === "放弃计划") return { decision: "abandon" };
	if (choice !== "要求修改") return { decision: "revise" };

	const note = await ctx.ui.editor("希望计划如何修改？", "");
	return { decision: "revise", feedback: note?.trim() || undefined };
}
