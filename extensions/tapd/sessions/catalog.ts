import {
	SessionManager,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { TapdItemKind } from "../types.js";
import { linkKey } from "./keys.js";
import { readTapdSessionState } from "./session-state.js";

/** 供 picker 展示的会话描述（关联信息来自 session custom entry）。 */
export interface TapdSessionDescriptor {
	sessionFile: string;
	createdAt: string;
	title?: string;
	projectPaths?: string[];
	understandingFile?: string;
	workspaceId: string;
	itemId: string;
	kind: TapdItemKind;
	itemName: string;
}

export type CatalogProgress = (loaded: number, total: number) => void;

const OPEN_CONCURRENCY = 8;

let catalogCache: Map<string, TapdSessionDescriptor[]> | null = null;

/** 创建/更新/删除会话后调用，使内存目录失效。 */
export function invalidateTapdCatalog(): void {
	catalogCache = null;
}

/** 同步读取已构建的目录快照（未构建时返回空 Map），供同步渲染使用。 */
export function getTapdCatalogSnapshot(): Map<string, TapdSessionDescriptor[]> {
	return catalogCache ?? new Map();
}

/** 有界并发执行异步任务（按批次并行，避免索引 while 循环）。 */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	for (let start = 0; start < items.length; start += limit) {
		const batch = items.slice(start, start + limit);
		const batchResults = await Promise.all(batch.map((item) => fn(item)));
		results.push(...batchResults);
	}
	return results;
}

function toDescriptor(
	sessionFile: string,
	state: NonNullable<ReturnType<typeof readTapdSessionState>>,
): TapdSessionDescriptor {
	return {
		sessionFile,
		createdAt: state.createdAt,
		title: state.title,
		projectPaths: state.projectPaths,
		understandingFile: state.understandingFile,
		workspaceId: state.workspaceId,
		itemId: state.itemId,
		kind: state.kind,
		itemName: state.itemName,
	};
}

function indexByItem(
	descriptors: TapdSessionDescriptor[],
): Map<string, TapdSessionDescriptor[]> {
	const map = new Map<string, TapdSessionDescriptor[]>();
	for (const descriptor of descriptors) {
		const key = linkKey(
			descriptor.workspaceId,
			descriptor.itemId,
			descriptor.kind,
		);
		const list = map.get(key) ?? [];
		list.push(descriptor);
		map.set(key, list);
	}
	map.forEach((list) =>
		list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
	);
	return map;
}

/**
 * 扫描全部 Pi 会话，构建「TAPD 事项 → 会话」内存目录。
 * 会话关联来自各会话 custom entry（tapd-session-link）。
 */
export async function buildTapdCatalog(
	onProgress?: CatalogProgress,
): Promise<Map<string, TapdSessionDescriptor[]>> {
	if (catalogCache) return catalogCache;

	const infos: SessionInfo[] = await SessionManager.listAll(onProgress);
	const descriptors: TapdSessionDescriptor[] = [];
	await mapWithConcurrency(infos, OPEN_CONCURRENCY, async (info) => {
		try {
			const sm = SessionManager.open(info.path);
			const state = readTapdSessionState(sm.getEntries());
			if (state) descriptors.push(toDescriptor(info.path, state));
		} catch {
			// 损坏或已删除的 session 跳过，不让单个文件阻断整个 picker
		}
	});

	catalogCache = indexByItem(descriptors);
	return catalogCache;
}

/** 查询某 TAPD 事项关联的历史会话（按创建时间倒序）。 */
export async function listTapdSessions(
	itemKey: string,
	onProgress?: CatalogProgress,
): Promise<TapdSessionDescriptor[]> {
	const catalog = await buildTapdCatalog(onProgress);
	return catalog.get(itemKey) ?? [];
}
