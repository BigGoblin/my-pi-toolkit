import type { TapdConfig } from "../types.js";
import { fetchBugDetail } from "../core/api.js";
import { apiUrl, tapdGet, tapdPost } from "../core/http.js";
import { longTapdObjectId } from "../core/object-id.js";
import { createBugRemark } from "../git/tapd-api.js";

interface TapdDataResponse<T> {
	status: number;
	data: T;
	info?: string;
}

interface BugFieldInfo {
	name: string;
	label: string;
	options?: Record<string, string> | string[] | string;
	html_type?: string;
}

export interface ResolutionOption {
	key: string;
	label: string;
}

export interface BugRejectFields {
	reasonFieldName: string;
	faqFieldName: string;
	developerFieldName: string;
	testerFieldName: string;
	resolutionOptions: ResolutionOption[];
}

const REASON_LABEL = "缺陷原因说明";
const FAQ_LABEL = "是否需要写FAQ";
const DEVELOPER_LABEL = "开发人员";
const TESTER_LABEL = "测试人员";
const RESOLUTION_LABEL = "解决方法";

function optionEntries(
	options: BugFieldInfo["options"],
): Array<[string, string]> {
	if (!options) return [];
	if (Array.isArray(options)) {
		return options.map((value) => [value, value]);
	}
	if (typeof options === "string") {
		return options
			.split("|")
			.map((value) => value.trim())
			.filter(Boolean)
			.map((value) => [value, value]);
	}
	return Object.entries(options);
}

function findByLabel(
	fields: Record<string, BugFieldInfo>,
	label: string,
): BugFieldInfo | undefined {
	return Object.values(fields).find((field) => field.label === label);
}

export async function fetchBugRejectFields(
	config: TapdConfig,
	workspaceId: string,
): Promise<BugRejectFields> {
	const response = await tapdGet<
		TapdDataResponse<Record<string, BugFieldInfo>>
	>(
		apiUrl(config, "/bugs/get_fields_info", { workspace_id: workspaceId }),
		config,
	);
	const fields = response?.data;
	if (!fields) throw new Error("无法获取 TAPD Bug 字段信息");

	const reason = findByLabel(fields, REASON_LABEL);
	const faq = findByLabel(fields, FAQ_LABEL);
	const developer = findByLabel(fields, DEVELOPER_LABEL);
	const tester = findByLabel(fields, TESTER_LABEL);
	const resolution = findByLabel(fields, RESOLUTION_LABEL);
	if (!reason?.name) throw new Error(`未找到「${REASON_LABEL}」字段`);
	if (!faq?.name) throw new Error(`未找到「${FAQ_LABEL}」字段`);
	if (!developer?.name) throw new Error(`未找到「${DEVELOPER_LABEL}」字段`);
	if (!tester?.name) throw new Error(`未找到「${TESTER_LABEL}」字段`);
	if (!resolution?.name) throw new Error(`未找到「${RESOLUTION_LABEL}」字段`);

	const resolutionOptions = optionEntries(resolution.options).map(
		([key, label]) => ({ key, label }),
	);
	if (resolutionOptions.length === 0) {
		throw new Error("解决方法字段没有可用候选值");
	}

	return {
		reasonFieldName: reason.name,
		faqFieldName: faq.name,
		developerFieldName: developer.name,
		testerFieldName: tester.name,
		resolutionOptions,
	};
}

function normalizeUserChooser(value: string): string {
	const nick = value.trim().replace(/;+$/, "");
	return nick ? `${nick};` : "";
}

export async function updateBugReject(
	config: TapdConfig,
	workspaceId: string,
	bugId: string,
	fields: BugRejectFields,
	values: {
		reason: string;
		resolutionKey: string;
		developer: string;
		needFaq: "是" | "否";
		author: string;
	},
): Promise<void> {
	const detail = await fetchBugDetail(workspaceId, bugId, config);
	if (!detail) throw new Error("获取缺陷详情失败，无法设置处理人");
	const testerRaw = detail[fields.testerFieldName];
	const currentOwner = normalizeUserChooser(
		typeof testerRaw === "string" ? testerRaw : "",
	);
	if (!currentOwner) {
		throw new Error("缺陷未设置测试人员，拒绝后处理人需为测试人员");
	}

	const reason = values.reason.trim();
	const developer = normalizeUserChooser(values.developer);
	const body: Record<string, unknown> = {
		workspace_id: workspaceId,
		id: longTapdObjectId(workspaceId, bugId),
		v_status: "已拒绝",
		current_owner: currentOwner,
		resolution: values.resolutionKey,
		[fields.developerFieldName]: developer,
		[fields.faqFieldName]: values.needFaq,
		[fields.reasonFieldName]: reason,
	};
	const response = await tapdPost<TapdDataResponse<unknown>>(
		apiUrl(config, "/bugs"),
		config,
		body,
	);
	if (!response) throw new Error("TAPD Bug 拒绝更新失败");

	if (reason) {
		const description = reason
			.replace(/\n{2,}/g, "<br/><br/>")
			.replace(/\n/g, "<br/>");
		await createBugRemark(
			config,
			{ workspaceId, objectId: bugId, kind: "bug" },
			values.author,
			description,
		);
	}
}
