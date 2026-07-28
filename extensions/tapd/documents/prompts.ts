function buildPathBlock(projectPaths: string[]): string {
	return projectPaths.length > 0
		? projectPaths.map((path) => `- ${path}`).join("\n")
		: "- （未指定，请在当前工作目录中查找相关代码）";
}

export function buildUnderstandPrompt(opts: {
	title: string;
	storyId: string;
	url: string;
	description: string;
	projectPaths: string[];
	understandingFile: string;
}): string {
	const description = opts.description.trim() || "（无描述）";
	return [
		"以下为 TAPD 需求上下文，供后续需求理解使用。",
		"",
		"## 需求",
		`标题：${opts.title}`,
		`链接：${opts.url}`,
		`ID：${opts.storyId}`,
		"",
		"## 需求描述",
		description,
		"",
		"## 相关项目路径",
		buildPathBlock(opts.projectPaths),
		"",
		"## 理解文档输出路径",
		opts.understandingFile,
	].join("\n");
}

export function buildBugContextPrompt(opts: {
	title: string;
	bugId: string;
	url: string;
	description: string;
	projectPaths: string[];
}): string {
	const description = opts.description.trim() || "（无描述）";
	return [
		"以下为 TAPD 缺陷上下文，供后续缺陷定位使用。",
		"",
		"## 缺陷",
		`标题：${opts.title}`,
		`链接：${opts.url}`,
		`ID：${opts.bugId}`,
		"",
		"## 缺陷描述",
		description,
		"",
		"## 相关项目路径",
		buildPathBlock(opts.projectPaths),
		"",
		"## 后续处理",
		"执行 /tapd bug 获取最新的完整缺陷信息，并结合项目代码尝试定位问题原因。",
		"定位阶段不要修改代码，不要创建分析文档或 bug-{id} 目录。定位完成后直接展示代码分析和定位结论，等待我确认后再修改。",
	].join("\n");
}

export function buildBugLocatePrompt(opts: {
	title: string;
	bugId: string;
	url: string;
	projectPaths: string[];
	detail: Record<string, unknown>;
}): string {
	return [
		"请根据以下 TAPD 缺陷完整信息，结合关联项目代码尝试定位问题原因。",
		"",
		"## 缺陷",
		`标题：${opts.title}`,
		`链接：${opts.url}`,
		`ID：${opts.bugId}`,
		"",
		"## 相关项目路径",
		buildPathBlock(opts.projectPaths),
		"",
		"## TAPD 完整字段",
		"```json",
		JSON.stringify(opts.detail, null, 2),
		"```",
		"",
		"## 定位要求",
		"1. 先理解缺陷现象、复现条件、期望表现和实际表现。",
		"2. 在相关项目路径中搜索涉及的入口、组件、状态、接口和数据流，并沿调用链分析问题发生过程。",
		"3. 区分已确认事实、代码证据和推测；尽量定位到具体文件、类、函数或代码区间。",
		"4. 输出必须包含：缺陷理解、定位结论与置信度、代码分析、根因证据、影响范围、建议修复方向、待确认项。",
		"5. 如果无法确认唯一根因，列出候选原因、支持证据和仍需补充的信息。",
		"6. 本阶段不要修改任何代码，不要创建分析文档，不要创建 bug-{id} 或其他目录。",
		"7. 直接在当前会话中输出定位报告，等待我明确确认后再实施代码修改。",
	].join("\n");
}

export const ANALYZE_TRIGGER_PROMPT = [
	"请基于上文 TAPD 需求信息，结合相关项目代码完成需求理解，并输出文档。",
	"",
	"要求：",
	"1. 撰写需求理解文档，包含：目标、范围（做/不做）、与现有代码的关系、验收标准、风险/待确认项。",
	"2. 不要复述整篇 PRD，不要输出技术方案，不要修改代码。",
	"3. 将完整文档写入上文「理解文档输出路径」指定的文件。",
	"4. 写完后简要总结要点，并告知文档路径，等待我确认后再设计方案。",
].join("\n");

export const DESIGN_TRIGGER_PROMPT = [
	"我已确认需求理解文档。请基于该文档和相关项目代码输出可执行的技术设计方案。",
	"",
	"要求：",
	"1. 先读取上文「理解文档输出路径」对应的 understanding.md；如果文件不存在，停止并提示我先执行 /tapd analyze。",
	"2. 设计方案应包含：方案概述、现状分析、总体设计、详细改动、数据与接口设计、边界与异常处理、兼容性与影响范围、测试方案、实施步骤、风险与待确认项。",
	"3. 详细改动按模块或文件说明修改目的、关键类/函数和主要逻辑；必要时使用 Mermaid 图。",
	"4. 建立“验收标准 → 设计改动 → 测试场景”的对应关系，确保没有遗漏。",
	"5. 不要修改业务代码，不要直接实施方案。",
	"6. 根据可独立开发、提测和验收的业务闭环，将开发工作拆成 1～5 个开发子需求；不要按文件、组件、接口、联调或自测等纯技术层次机械拆分。",
	"7. 在文档末尾输出固定格式的 TAPD 子需求拆分块，标记之间只能放合法 JSON（不要使用 Markdown 代码围栏）：",
	"<!-- TAPD_SUBTASKS_START -->",
	'{"developmentTasks":[{"id":"stable-kebab-case-id","title":"简洁的开发任务标题","scope":["开发范围"],"acceptanceCriteria":["验收标准"],"dependencies":[],"suggestedEffort":2}]}',
	"<!-- TAPD_SUBTASKS_END -->",
	"其中 id 是稳定、唯一的 kebab-case 标识；修改同一任务时必须保留 id，只有新增任务才生成新 id。suggestedEffort 为可选的正数建议工时，dependencies 使用其他任务的 title；至少一个开发任务，标题和 id 均不得重复。",
	"8. 将完整方案写入 understanding.md 同目录下的 design.md。",
	"9. 写完后简要总结设计要点和拆分结果并告知文档路径，等待我确认后再实施。",
].join("\n");

export const COLLABORATION_TRIGGER_PROMPT = [
	"请以前端视角编写一份精简的设计评审协作文档，供产品、后端和前端 Leader 共同评审。",
	"",
	"要求：",
	"1. 先读取上文「理解文档输出路径」对应的 understanding.md；如果文件不存在，停止并提示我先执行 /tapd analyze。",
	"2. 如果同目录存在 design.md，将其作为实现方案参考；如果不存在，仍可结合需求理解和项目代码完成文档。",
	"3. 根据需求复杂度控制篇幅：简单需求优先控制在 800～1500 个中文字符、1～2 页；只有确有必要时才展开。",
	"4. 不要包含“需求背景与目标”和“范围说明”，也不要重复 understanding.md 中已经明确的需求内容。",
	"5. 文档优先只保留四部分：产品与交互变化、前端实现思路、前后端协作点、评审与验收；没有实际内容的部分可以省略。",
	"6. 产品与交互变化用简短列表或一个表格说明受影响入口及预期表现，不逐项复述相同规则。",
	"7. 前端实现思路使用 3～6 条模块级说明，讲清主要改动、数据流转和能力复用；不要列具体文件、函数、代码或大段状态管理细节。",
	"8. 后端已提供接口资料时，只整理与本次改动直接相关的接口变化；后端未提供时，只列需要确认的业务能力，不推测字段、状态码、接口地址或示例报文。",
	"9. 评审与验收只保留关键场景以及会影响方案或验收的待确认问题，不要按参会角色重复罗列。",
	"10. 不要描述没有变化的 loading、权限、防重复提交等通用行为；“保持现状”只在容易误解时提一次。",
	"11. 简单流程不要生成 Mermaid 图；不要包含排期、负责人或上线计划；不要修改代码。",
	"12. 将完整文档写入 understanding.md 同目录下的 collaboration.md。",
	"13. 写完后用几句话总结评审重点并告知文档路径。",
].join("\n");
