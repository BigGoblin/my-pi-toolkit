/** TAPD 扩展共享类型。 */

export interface GitLabConfig {
	token?: string;
	baseUrl?: string;
}

export interface TapdReviewConfig {
	/** Review 子 Agent 模型，例如 anthropic/claude-sonnet-4-5。 */
	model?: string;
}

export interface TapdConfig {
	token: string;
	baseUrl?: string;
	gitlab?: GitLabConfig;
	review?: TapdReviewConfig;
}

export interface TapdResponse<T> {
	status: number;
	data: T[];
}

export type TapdItemKind = "story" | "bug";

export interface TapdItem {
	id: string;
	kind: TapdItemKind;
	name: string;
	status: string;
	priority: string;
	owner: string;
	severity?: string;
	workspaceId: string;
	workspaceName: string;
	begin?: string;
	due?: string;
	iterationId?: string;
	iterationName?: string;
	parentId?: string;
	workitemTypeName?: string;
	children: TapdItem[];
	depth: number;
	hasChildren: boolean;
}

export interface TapdWorkspace {
	id: string;
	name: string;
}

export type SubtaskKind = "design" | "development";

export interface DevelopmentTaskSuggestion {
	id?: string;
	title: string;
	scope: string[];
	acceptanceCriteria: string[];
	dependencies: string[];
	suggestedEffort?: number;
}

export interface SubtaskPlanItem extends DevelopmentTaskSuggestion {
	localId: string;
	kind: SubtaskKind;
	effort: number;
}

export interface SubtaskPlan {
	designFile: string;
	designContentHash: string;
	collaborationContentHash?: string;
	confirmedAt: string;
	items: SubtaskPlanItem[];
}

export interface CreatedSubtask {
	localId: string;
	kind: SubtaskKind;
	title: string;
	effort: number;
	tapdId: string;
	tapdUrl: string;
	createdAt: string;
	updatedAt?: string;
}

export interface SessionLink {
	id: string;
	createdAt: string;
	title?: string;
	sessionFile?: string;
	projectPaths?: string[];
	understandingFile?: string;
	subtaskPlan?: SubtaskPlan;
	subtasks?: CreatedSubtask[];
}

/** storyId 保留用于兼容历史 tapd-links.json。 */
export interface TapdLinkRecord {
	workspaceId: string;
	storyId: string;
	name: string;
	sessions: SessionLink[];
	kind?: TapdItemKind;
	itemId?: string;
}

export type CreateDraft = { title: string; projectPaths: string[] };

export type PickerAction =
	| { type: "create"; draft: CreateDraft }
	| { type: "switch"; sessionFile: string };

export type TableOutcome =
	| { kind: "done"; saveState: boolean }
	| {
			kind: "session_action";
			action: PickerAction;
			itemKey: string;
			itemName: string;
	  };

export interface ItemKey {
	kind: TapdItemKind;
	wsId: string;
	itemId: string;
}
