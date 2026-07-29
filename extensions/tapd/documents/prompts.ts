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
	"请以前端视角编写一份供产品、后端和前端 Leader 阅读的精简设计协作文档。文档不能省略支撑方案落地的关键代码和接口信息。",
	"",
	"要求：",
	"1. 先读取上文「理解文档输出路径」对应的 understanding.md；如果文件不存在，停止并提示我先执行 /tapd analyze。",
	"2. 如果同目录存在 design.md，必须读取并核对其中涉及的模块、已有能力、接口和 Mermaid 图；同时在相关项目中检查实际代码，不能只复述设计文档，也不能编造不存在的实现。",
	"3. 根据需求复杂度控制篇幅。简单需求优先控制在 1200～2500 个中文字符、1～3 页，但不得为了压缩篇幅省略关键函数签名、出入参或接口字段。",
	"4. 不要包含“需求背景与目标”“范围说明”“前后端协作点”或“评审与验收”章节，也不要用其他标题重新包装这两个被移除的章节。",
	"5. 文档优先只包含：产品与交互变化、Design 方案图、前端实现与关键代码；没有实际内容的部分可以省略，但 Design 方案图必须保留。",
	"6. 产品与交互变化用简短列表或一个表格说明受影响入口及预期表现，不逐项复述相同规则。",
	"7. Design 方案图必须包含一个 Mermaid 图，准确表达 design.md 中已经设计好的核心方案、模块关系或关键数据流。design.md 已有合适 Mermaid 图时优先复用或精简；没有时基于设计和实际代码补充，不能引入设计之外的新方案。",
	"8. Mermaid 图只保留评审所需的关键节点和调用方向，并与后文函数、组件及接口名称保持一致；不要为了展示而绘制与方案无关的通用流程。",
	"9. 前端实现与关键代码应使用 3～6 条模块级说明讲清主要改动和数据流，并列出方案依赖或复用的关键已有函数、方法、类型或组件。每个关键代码项至少注明：文件路径、符号名、当前函数签名或组件 Props、主要输入、输出、在本方案中的用途以及是否需要修改；引用必须以实际代码为准。",
	"10. 函数签名优先使用简短的 TypeScript 风格代码或表格表达。只展示评审所需的签名、关键类型和必要的调用示例，不粘贴大段实现代码；如果没有复用已有函数，也要明确说明需要新增的能力及建议签名。",
	"11. 本次设计直接使用或变更的后端接口放在“前端实现与关键代码”的对应流程下说明，不单独创建“前后端协作点”或“接口契约”章节。已有接口需列明用途、请求方式与路径、请求参数、关键响应字段、错误处理和兼容性影响。",
	"12. 后端尚未提供定义时，列出前端落地所需的建议参数、响应字段和关键约束，并显著标记为“建议契约/待后端确认”；不得把建议描述成已确认事实，也不得虚构已存在的地址或状态码。存在字段转换、枚举映射、默认值或空值语义时，在对应实现说明下用简短表格表达。",
	"13. 不要描述没有变化的 loading、权限、防重复提交等通用行为；“保持现状”只在容易误解时提一次。不要包含验收场景、待评审问题、排期、负责人或上线计划；不要修改代码。",
	"14. 将完整文档写入 understanding.md 同目录下的 collaboration.md。",
	"15. 写完后用几句话总结 Design 方案图、关键代码复用点和接口信息，并告知文档路径。",
].join("\n");
