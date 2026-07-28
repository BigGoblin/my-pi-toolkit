import { execFile } from "node:child_process";
import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Text,
	Input,
	type KeybindingsManager,
	type TUI,
	visibleWidth,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { fetchAll } from "../core/workspace-api.js";
import {
	cleanupStaleSessionLinks,
	deleteLinkedSession,
	scanStaleSessionLinks,
} from "../sessions/cleanup.js";
import {
	buildTree,
	collectTypes,
	flatFilter,
	fmtDate,
	getTypeIcon,
	oneLine,
	padR,
	prioritySymbol,
	searchFlat,
	sortTree,
	tapdUrl,
} from "./model.js";
import {
	linkKey,
	loadLinks,
	loadPathHistory,
	parseItemKey,
	readSessionTitle,
	rememberProjectPaths,
	removeProjectPathFromHistory,
} from "../sessions/storage.js";
import type {
	PickerAction,
	SessionLink,
	TableOutcome,
	TapdConfig,
	TapdItem,
	TapdItemKind,
	TapdLinkRecord,
} from "../types.js";

// ============ 树形列表组件 ============

interface FlatItem {
	item: TapdItem;
	indent: number;
	expandable: boolean;
	expanded: boolean;
}

class TreeList {
	private roots: TapdItem[] = [];
	expandedIds = new Set<string>();
	private visible: FlatItem[] = [];
	selectedIdx = 0;
	private maxVisible = 20;

	onSelect?: (item: FlatItem) => void;
	onCancel?: () => void;

	getSelectedItem(): TapdItem | null {
		if (this.selectedIdx >= 0 && this.selectedIdx < this.visible.length)
			return this.visible[this.selectedIdx].item;
		return null;
	}

	setRoots(r: TapdItem[]) {
		this.roots = r;
		this.selectedIdx = 0;
		this.rebuild();
	}

	private rebuild() {
		this.visible = [];
		const walk = (nodes: TapdItem[]) => {
			for (const n of nodes) {
				this.visible.push({
					item: n,
					indent: n.depth,
					expandable: n.hasChildren,
					expanded: this.expandedIds.has(n.id),
				});
				if (n.hasChildren && this.expandedIds.has(n.id)) walk(n.children);
			}
		};
		walk(this.roots);
		if (this.selectedIdx >= this.visible.length)
			this.selectedIdx = Math.max(0, this.visible.length - 1);
	}

	toggleExpand(idx: number) {
		if (idx < 0 || idx >= this.visible.length) return;
		const fi = this.visible[idx];
		if (!fi.expandable) return;
		if (this.expandedIds.has(fi.item.id)) this.expandedIds.delete(fi.item.id);
		else this.expandedIds.add(fi.item.id);
		this.rebuild();
		const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
		if (i >= 0) this.selectedIdx = i;
	}
	expand(idx: number) {
		if (idx < 0 || idx >= this.visible.length) return;
		const fi = this.visible[idx];
		if (!fi.expandable || fi.expanded) return;
		this.expandedIds.add(fi.item.id);
		this.rebuild();
		const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
		if (i >= 0) this.selectedIdx = i;
	}
	collapse(idx: number) {
		if (idx < 0 || idx >= this.visible.length) return;
		const fi = this.visible[idx];
		if (!fi.expandable || !fi.expanded) return;
		this.expandedIds.delete(fi.item.id);
		this.rebuild();
		const i = this.visible.findIndex((v) => v.item.id === fi.item.id);
		if (i >= 0) this.selectedIdx = i;
	}

	handleInput(data: string): boolean {
		if (data === "\x1b[A" || data === "k") {
			if (this.selectedIdx > 0) this.selectedIdx--;
			return true;
		}
		if (data === "\x1b[B" || data === "j") {
			if (this.selectedIdx < this.visible.length - 1) this.selectedIdx++;
			return true;
		}
		if (data === "\x1b[5~") {
			this.selectedIdx = Math.max(0, this.selectedIdx - 10);
			return true;
		}
		if (data === "\x1b[6~") {
			this.selectedIdx = Math.min(
				this.visible.length - 1,
				this.selectedIdx + 10,
			);
			return true;
		}
		if (data === " ") {
			this.toggleExpand(this.selectedIdx);
			return true;
		}
		if (data === "\x1b[C") {
			this.expand(this.selectedIdx);
			return true;
		}
		if (data === "\x1b[D") {
			this.collapse(this.selectedIdx);
			return true;
		}
		if (data === "\r" || data === "\n") {
			if (this.visible.length > 0 && this.selectedIdx < this.visible.length)
				this.onSelect?.(this.visible[this.selectedIdx]);
			return true;
		}
		if (data === "\x1b") {
			this.onCancel?.();
			return true;
		}
		return false;
	}

	render(width: number, theme: any): string[] {
		const maxW = width - 2;
		if (this.visible.length === 0) return [theme.fg("dim", "  (无)")];
		const half = Math.floor(this.maxVisible / 2);
		let start = Math.max(0, this.selectedIdx - half);
		const end = Math.min(this.visible.length, start + this.maxVisible);
		if (end - start < this.maxVisible)
			start = Math.max(0, end - this.maxVisible);
		const lines: string[] = [];
		for (let i = start; i < end; i++) {
			const fi = this.visible[i],
				item = fi.item;
			const indent = "  ".repeat(fi.indent);
			const marker = fi.expandable ? (fi.expanded ? "▾ " : "▸ ") : "  ";
			const icon = getTypeIcon(item);
			const statusW = item.kind === "bug" ? 8 : 10;
			const priorityW = item.kind === "bug" ? 6 : 8;
			const severityW = item.kind === "bug" ? 6 : 0;
			const dateW = item.kind === "bug" ? 10 : 12;
			const columnW = statusW + priorityW + severityW + dateW * 2;
			const separatorW = item.kind === "bug" ? 6 : 5;
			const titleW = Math.max(
				1,
				maxW - visibleWidth(indent + marker + icon) - columnW - separatorW,
			);
			let line = indent + marker + icon;
			line +=
				" " + padR(truncateToWidth(oneLine(item.name), titleW, "…"), titleW);
			line +=
				" " + padR(truncateToWidth(oneLine(item.status), statusW, ""), statusW);
			line +=
				" " +
				padR(
					truncateToWidth(prioritySymbol(item.priority), priorityW, ""),
					priorityW,
				);
			if (item.kind === "bug")
				line +=
					" " +
					padR(
						truncateToWidth(oneLine(item.severity ?? "-"), severityW, ""),
						severityW,
					);
			line += " " + padR(fmtDate(item.begin), dateW);
			line += " " + padR(fmtDate(item.due), dateW);
			lines.push(
				i === this.selectedIdx
					? theme.fg("accent", truncateToWidth(line, maxW, ""))
					: truncateToWidth(line, maxW, ""),
			);
		}
		if (this.visible.length > this.maxVisible)
			lines.push(
				theme.fg("dim", `  ${start + 1}-${end}/${this.visible.length}`),
			);
		return lines;
	}
}

export async function showTable(
	ctx: ExtensionCommandContext,
	c: TapdConfig,
	workspaces: { id: string; name: string }[],
	initialCurrent: boolean,
): Promise<TableOutcome> {
	const controller = new AbortController();
	const trees: Record<
		TapdItemKind,
		{ current: TapdItem[]; all: TapdItem[]; allLoaded: boolean }
	> = {
		story: { current: [], all: [], allLoaded: false },
		bug: { current: [], all: [], allLoaded: false },
	};
	let kind: TapdItemKind = "story";
	let viewCurrent = initialCurrent;
	let typeFilter: string | null = null;

	async function load(kindToLoad: TapdItemKind, scope: "current" | "all") {
		const state = trees[kindToLoad];
		if (scope === "all" && state.allLoaded) return;
		if (scope === "current" && state.current.length > 0) return;
		ctx.ui.notify(
			`正在获取${kindToLoad === "bug" ? "Bug" : "需求"}${scope === "current" ? "当前迭代" : "所有迭代"}待办...`,
			"info",
		);
		const result = await fetchAll(
			workspaces,
			c,
			scope,
			controller.signal,
			kindToLoad,
		);
		const data =
			kindToLoad === "story" ? buildTree(result.items) : result.items;
		sortTree(data);
		if (scope === "current") state.current = data;
		else {
			state.all = data;
			state.allLoaded = true;
		}
		if (result.errors.length > 0)
			ctx.ui.notify(
				`部分工作空间获取失败: ${result.errors.join(", ")}`,
				"warning",
			);
	}

	await load("story", "current");
	while (true) {
		const state = trees[kind];
		const source = viewCurrent ? state.current : state.all;
		const display =
			kind === "story" && typeFilter ? flatFilter(source, typeFilter) : source;
		const viewLabel = viewCurrent ? "当前迭代" : "所有迭代";
		const sel = await renderTable(
			ctx,
			display,
			viewLabel,
			typeFilter,
			kind,
			state.current.length,
			trees.story.current.length,
			trees.bug.current.length,
		);
		if (!sel) break;

		if (sel.action === "kind_toggle") {
			kind = kind === "story" ? "bug" : "story";
			typeFilter = null;
			await load(kind, viewCurrent ? "current" : "all");
			continue;
		}
		if (sel.action === "scope_toggle") {
			viewCurrent = !viewCurrent;
			await load(kind, viewCurrent ? "current" : "all");
			continue;
		}
		if (sel.action === "type_filter" && kind === "story") {
			const types = collectTypes(viewCurrent ? state.current : state.all);
			const pick = await ctx.ui.select("按类型筛选:", ["全部", ...types]);
			typeFilter = pick && pick !== "全部" ? pick : null;
			continue;
		}
		if (sel.action === "cleanup") {
			const preview = scanStaleSessionLinks();
			if (preview.removedSessions === 0) {
				ctx.ui.notify("没有发现失效的 TAPD 会话关联", "info");
				continue;
			}
			const confirmed = await ctx.ui.confirm(
				"清理失效会话关联",
				`发现 ${preview.removedSessions} 条失效会话关联，涉及清理 ${preview.removedRecords} 个空 TAPD 记录。\n\n只会清理本地关联，不会删除 TAPD 条目或项目文档。`,
			);
			if (confirmed) {
				const result = cleanupStaleSessionLinks();
				ctx.ui.notify(
					`已清理 ${result.removedSessions} 条失效会话关联`,
					"success",
				);
			}
			continue;
		}
		if (sel.action === "open" && sel.url) {
			const error = await openUrl(sel.url);
			if (error)
				ctx.ui.notify(
					`无法自动打开浏览器，请手动访问：${sel.url}\n${error}`,
					"warning",
				);
			else ctx.ui.notify("已在浏览器中打开", "info");
			continue;
		}
		if (sel.action === "link_view" && sel.itemKey) {
			const links = loadLinks();
			const parsed = parseItemKey(sel.itemKey);
			const legacyKey = `${parsed.wsId}_${parsed.itemId}`;
			const rec = links[sel.itemKey] ??
				(parsed.kind === "story" ? links[legacyKey] : undefined) ?? {
					workspaceId: parsed.wsId,
					storyId: parsed.itemId,
					name: sel.itemName!,
					sessions: [],
					kind: parsed.kind,
					itemId: parsed.itemId,
				};
			const action = await showSessionPicker(
				ctx,
				rec,
				sel.itemKey,
				sel.itemName!,
			);
			if (action)
				return {
					kind: "session_action",
					action,
					itemKey: sel.itemKey,
					itemName: sel.itemName!,
				};
			continue;
		}
		break;
	}
	return { kind: "done", saveState: true };
}

async function openUrl(url: string): Promise<string | null> {
	const candidates: Array<[string, string[]]> =
		process.platform === "win32"
			? [["cmd.exe", ["/d", "/s", "/c", "start", "", url]]]
			: process.platform === "darwin"
				? [["open", [url]]]
				: [
						["xdg-open", [url]],
						["gio", ["open", url]],
						["sensible-browser", [url]],
						["wslview", [url]],
						["cmd.exe", ["/d", "/s", "/c", "start", "", url]],
					];

	const errors: string[] = [];
	for (const [command, args] of candidates) {
		const error = await new Promise<Error | null>((resolve) => {
			execFile(command, args, (err) => resolve(err));
		});
		if (!error) return null;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			errors.push(`${command}: ${error.message}`);
	}

	return errors[errors.length - 1] ?? "系统中未找到可用的浏览器打开命令";
}

// ============ 会话选择器 ============

/** @returns 用户选择的会话操作；null 表示取消或返回列表 */
async function showSessionPicker(
	ctx: ExtensionContext,
	rec: TapdLinkRecord,
	_itemKey: string,
	itemName: string,
): Promise<PickerAction | null> {
	const opts: { link?: SessionLink; label: string; isCreate: boolean }[] = [];
	for (const s of rec.sessions.slice().reverse()) {
		const time = new Date(s.createdAt).toLocaleString("zh-CN");
		let title = s.sessionFile
			? (readSessionTitle(s.sessionFile) ?? s.title)
			: s.title;
		if (!title) title = "(无标题)";
		const pathHint = s.projectPaths?.length
			? `  │  ${s.projectPaths.length} 项目`
			: "";
		opts.push({
			link: s,
			label: `${title}  │  ${time}${pathHint}${s.sessionFile ? " ◆" : ""}`,
			isCreate: false,
		});
	}
	opts.push({ isCreate: true, label: "📝 创建新会话" });

	const action = await ctx.ui.custom<PickerAction | null>(
		(
			tui: TUI,
			theme: Theme,
			_kb: KeybindingsManager,
			done: (result: PickerAction | null) => void,
		) => {
			let container = new Container();
			let selectedIdx = 0;
			let pendingDelete: SessionLink | null = null;
			let pendingDeletePath: string | null = null;

			// 创建流程：直接填写表单
			let isCreating = false;
			let selectedPaths: string[] = [];
			let pathHistory = loadPathHistory();
			let focus = 0; // form: 0=名称 1..=历史路径 pathHistory.length+1=路径输入 +2=创建
			const nameInput = new Input();
			const pathInput = new Input();

			function focusCount(): number {
				return pathHistory.length + 3; // name + histories + pathInput + submit
			}
			function histFocusStart(): number {
				return 1;
			}
			function pathInputFocus(): number {
				return pathHistory.length + 1;
			}
			function submitFocus(): number {
				return pathHistory.length + 2;
			}

			function finishCreate() {
				const title = nameInput.getValue().trim() || itemName;
				const pendingPath = pathInput.getValue().trim();
				const paths = [...selectedPaths];
				if (pendingPath && !paths.includes(pendingPath))
					paths.push(pendingPath);
				done({
					type: "create",
					draft: { title, projectPaths: paths },
				});
			}

			nameInput.onSubmit = () => {
				focus = Math.min(focus + 1, focusCount() - 1);
				syncInputFocus();
				rebuild();
				tui.requestRender();
			};
			nameInput.onEscape = () => {
				exitCreate();
			};

			pathInput.onSubmit = (value: string) => {
				const p = value.trim();
				if (p) {
					if (!selectedPaths.includes(p)) selectedPaths.push(p);
					rememberProjectPaths([p]);
					pathHistory = loadPathHistory();
					pathInput.setValue("");
					(pathInput as any).cursor = 0;
					focus = pathInputFocus();
				}
				syncInputFocus();
				rebuild();
				tui.requestRender();
			};
			pathInput.onEscape = () => {
				exitCreate();
			};

			function syncInputFocus() {
				nameInput.focused = isCreating && focus === 0;
				pathInput.focused = isCreating && focus === pathInputFocus();
			}

			function enterCreate() {
				isCreating = true;
				pendingDelete = null;
				pendingDeletePath = null;
				const currentPath = ctx.cwd.trim();
				if (currentPath) {
					// Keep the current project visible in the history list so its checked
					// state is explicit and can still be toggled off by the user.
					rememberProjectPaths([currentPath]);
					pathHistory = loadPathHistory();
					selectedPaths = [currentPath];
				} else {
					selectedPaths = [];
					pathHistory = loadPathHistory();
				}
				focus = 0;
				nameInput.setValue(itemName);
				(nameInput as any).cursor = itemName.length;
				pathInput.setValue("");
				(pathInput as any).cursor = 0;
				syncInputFocus();
				rebuild();
				tui.requestRender();
			}

			function exitCreate() {
				isCreating = false;
				syncInputFocus();
				rebuild();
				tui.requestRender();
			}

			function applyDelete(link: SessionLink) {
				const result = deleteLinkedSession(link);
				if (!result.ok) {
					ctx.ui.notify(`删除会话失败：${result.error ?? "未知错误"}`, "error");
					return;
				}
				const idx = opts.findIndex((o) => o.link?.id === link.id);
				if (idx >= 0) opts.splice(idx, 1);
				if (selectedIdx >= opts.length)
					selectedIdx = Math.max(0, opts.length - 1);
				ctx.ui.notify(
					result.method === "missing"
						? "会话文件已不存在，关联记录已清理"
						: "会话及关联记录已删除",
					"info",
				);
			}

			function togglePathAt(histIdx: number) {
				const p = pathHistory[histIdx];
				if (!p) return;
				const i = selectedPaths.indexOf(p);
				if (i >= 0) selectedPaths.splice(i, 1);
				else selectedPaths.push(p);
			}

			function applyDeletePath(path: string) {
				const histIdx = pathHistory.indexOf(path);
				if (histIdx < 0) return;
				removeProjectPathFromHistory(path);
				selectedPaths = selectedPaths.filter((p) => p !== path);
				pathHistory = loadPathHistory();
				if (focus > histFocusStart() + histIdx) focus--;
				else if (focus === histFocusStart() + histIdx) {
					focus =
						pathHistory.length > 0
							? Math.min(
									histFocusStart() + histIdx,
									histFocusStart() + pathHistory.length - 1,
								)
							: pathInputFocus();
				}
				syncInputFocus();
				ctx.ui.notify("已删除历史路径", "info");
			}

			const HINT_INDENT = "    ";
			const SECTION_INDENT = "  ";

			function cursor(active: boolean): string {
				return active ? theme.fg("accent", "> ") : SECTION_INDENT;
			}

			function addBlankLine() {
				container.addChild(new Text("", 1, 0));
			}

			function addCreatePageHeader() {
				container.addChild(new Text(theme.bold("创建新会话"), 1, 0));
				addBlankLine();
			}

			function addSectionTitle(label: string, optional = false) {
				const suffix = optional ? theme.fg("muted", "（可选）") : "";
				container.addChild(new Text(theme.bold(label) + suffix, 1, 0));
			}

			function addSubmitAction(active: boolean) {
				const label = active
					? theme.fg("accent", theme.bold("[ 创建会话 ]"))
					: theme.fg("dim", "[ 创建会话 ]");
				container.addChild(new Text(SECTION_INDENT + label, 1, 0));
			}

			function addHelp(text: string) {
				addBlankLine();
				container.addChild(new Text(theme.fg("dim", text), 1, 0));
			}

			function rebuild() {
				container = new Container();
				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);
				container.addChild(
					new Text(
						theme.bold(`「${itemName}」关联会话`) +
							theme.fg("muted", `  │  ${opts.length} 项`),
						1,
						0,
					),
				);

				if (pendingDelete) {
					addBlankLine();
					container.addChild(
						new Text(
							theme.fg(
								"error",
								theme.bold(`确认删除「${pendingDelete.title || "会话"}」？`),
							),
							1,
							0,
						),
					);
					addHelp("Enter 确认  Esc/Ctrl+C 取消");
				} else if (pendingDeletePath) {
					addBlankLine();
					container.addChild(
						new Text(
							theme.fg("error", theme.bold("确认从历史中删除该路径？")),
							1,
							0,
						),
					);
					container.addChild(new Text(HINT_INDENT + pendingDeletePath, 1, 0));
					addHelp("Enter 确认  Esc/Ctrl+C 取消");
				} else if (isCreating) {
					addBlankLine();
					addCreatePageHeader();

					addSectionTitle("会话名称", true);
					if (focus === 0) {
						container.addChild(nameInput);
					} else {
						const title = nameInput.getValue().trim() || itemName;
						container.addChild(
							new Text(SECTION_INDENT + theme.fg("text", title), 1, 0),
						);
					}
					addBlankLine();

					addSectionTitle("项目路径", true);
					container.addChild(
						new Text(
							SECTION_INDENT +
								theme.fg(
									"muted",
									"可多选历史路径，或添加新路径；Ctrl+D 删除历史项",
								),
							1,
							0,
						),
					);
					if (selectedPaths.length > 0) {
						container.addChild(
							new Text(
								HINT_INDENT +
									theme.fg(
										"muted",
										`已选 ${selectedPaths.length} 项: ${selectedPaths.join(" | ")}`,
									),
								1,
								0,
							),
						);
					}
					for (let i = 0; i < pathHistory.length; i++) {
						const p = pathHistory[i];
						const checked = selectedPaths.includes(p) ? "[x]" : "[ ]";
						const active = focus === histFocusStart() + i;
						const row = active
							? theme.bold(`${checked} ${p}`)
							: theme.fg("text", `${checked} ${p}`);
						container.addChild(new Text(cursor(active) + row, 1, 0));
					}
					if (focus === pathInputFocus()) {
						container.addChild(pathInput);
					} else {
						const pending = pathInput.getValue().trim();
						const hint = pending || "添加路径…";
						const row = pending
							? theme.fg("text", hint)
							: theme.fg("muted", hint);
						container.addChild(
							new Text(cursor(focus === pathInputFocus()) + row, 1, 0),
						);
					}
					addBlankLine();

					addSubmitAction(focus === submitFocus());
					addHelp(
						"↑↓ 切换  Space 勾选  Enter 确认  Ctrl+D 删历史  Esc 返回  Ctrl+C 退出\n    创建后输入 /tapd analyze 开始需求理解",
					);
				} else {
					addBlankLine();
					for (let i = 0; i < opts.length; i++) {
						const o = opts[i];
						const active = i === selectedIdx;
						const label = active
							? theme.bold(o.label)
							: theme.fg("text", o.label);
						container.addChild(new Text(cursor(active) + label, 1, 0));
					}
					addHelp("Enter 选择  Ctrl+D 删除  Esc/Ctrl+C 返回");
				}

				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);
			}

			rebuild();

			return {
				render(w: number) {
					return container.render(w);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					// 页内删除确认：禁止再嵌套 ctx.ui.confirm，否则取消后 custom 无法 done() 会堵死主循环
					if (pendingDelete) {
						if (data === "\r" || data === "\n") {
							applyDelete(pendingDelete);
							pendingDelete = null;
							rebuild();
							tui.requestRender();
							return;
						}
						if (data === "\x1b" || data === "\x03") {
							pendingDelete = null;
							rebuild();
							tui.requestRender();
							return;
						}
						return;
					}

					if (pendingDeletePath) {
						if (data === "\r" || data === "\n") {
							applyDeletePath(pendingDeletePath);
							pendingDeletePath = null;
							rebuild();
							tui.requestRender();
							return;
						}
						if (data === "\x1b" || data === "\x03") {
							pendingDeletePath = null;
							rebuild();
							tui.requestRender();
							return;
						}
						return;
					}

					if (data === "\x03") {
						done(null);
						return;
					}

					if (isCreating) {
						if (data === "\x1b") {
							exitCreate();
							return;
						}

						// 输入框聚焦时：↑↓ 切焦点，其余交给 Input
						if (focus === 0 || focus === pathInputFocus()) {
							if (data === "\x1b[A" || data === "\x1b[B") {
								if (data === "\x1b[A" && focus > 0) focus--;
								if (data === "\x1b[B" && focus < focusCount() - 1) focus++;
								syncInputFocus();
								rebuild();
								tui.requestRender();
								return;
							}
							if (focus === 0) nameInput.handleInput(data);
							else pathInput.handleInput(data);
							tui.requestRender();
							return;
						}

						if (data === "\x1b[A" || data === "k") {
							if (focus > 0) {
								focus--;
								syncInputFocus();
								rebuild();
								tui.requestRender();
							}
							return;
						}
						if (data === "\x1b[B" || data === "j") {
							if (focus < focusCount() - 1) {
								focus++;
								syncInputFocus();
								rebuild();
								tui.requestRender();
							}
							return;
						}
						if (data === " ") {
							if (focus >= histFocusStart() && focus < pathInputFocus()) {
								togglePathAt(focus - histFocusStart());
								rebuild();
								tui.requestRender();
							}
							return;
						}
						if (data === "\x04") {
							if (focus >= histFocusStart() && focus < pathInputFocus()) {
								const p = pathHistory[focus - histFocusStart()];
								if (p) {
									pendingDeletePath = p;
									rebuild();
									tui.requestRender();
								}
							}
							return;
						}
						if (data === "\r" || data === "\n") {
							if (focus >= histFocusStart() && focus < pathInputFocus()) {
								togglePathAt(focus - histFocusStart());
								rebuild();
								tui.requestRender();
							} else if (focus === submitFocus()) {
								finishCreate();
							}
							return;
						}
						return;
					}

					if (data === "\x1b[A" || data === "k") {
						if (selectedIdx > 0) {
							selectedIdx--;
							rebuild();
							tui.requestRender();
						}
						return;
					}
					if (data === "\x1b[B" || data === "j") {
						if (selectedIdx < opts.length - 1) {
							selectedIdx++;
							rebuild();
							tui.requestRender();
						}
						return;
					}

					if (data === "\r" || data === "\n") {
						const o = opts[selectedIdx];
						if (o.isCreate) {
							enterCreate();
						} else if (o.link?.sessionFile) {
							done({ type: "switch", sessionFile: o.link.sessionFile });
						} else {
							ctx.ui.notify("无可恢复文件", "warning");
						}
						return;
					}

					if (data === "\x04") {
						const o = opts[selectedIdx];
						if (o.isCreate || !o.link) return;
						const link = o.link;
						const curFile = ctx.sessionManager.getSessionFile();
						if (curFile && link.sessionFile === curFile) {
							ctx.ui.notify("不能删除当前会话", "warning");
							return;
						}
						pendingDelete = link;
						rebuild();
						tui.requestRender();
						return;
					}

					if (data === "\x1b") {
						done(null);
						return;
					}
				},
			};
		},
	);

	return action;
}

// ============ 表格渲染 ============

async function renderTable(
	_ctx: ExtensionContext,
	forest: TapdItem[],
	viewLabel: string,
	typeFilter: string | null,
	kind: TapdItemKind,
	_currentCount: number,
	storyCount: number,
	bugCount: number,
): Promise<{
	action: string;
	url?: string;
	itemKey?: string;
	itemName?: string;
} | null> {
	function countAll(ns: TapdItem[]): number {
		let c = 0;
		for (const n of ns) {
			c++;
			c += countAll(n.children);
		}
		return c;
	}
	const total = countAll(forest);

	return await _ctx.ui.custom<{
		action: string;
		url?: string;
		itemKey?: string;
		itemName?: string;
	} | null>(
		(
			tui: TUI,
			theme: Theme,
			_kb: KeybindingsManager,
			done: (
				result: {
					action: string;
					url?: string;
					itemKey?: string;
					itemName?: string;
				} | null,
			) => void,
		) => {
			const treeList = new TreeList();
			treeList.setRoots(forest);
			treeList.onCancel = () => done(null);

			const searchInput = new Input();
			let focusSearch = false;
			let searching = false;
			let shownCount = total;
			let curW = 80,
				container: Container;

			function applySearch() {
				const q = searchInput.getValue().trim();
				searching = q.length > 0;
				if (!searching) {
					treeList.setRoots(forest);
					shownCount = total;
				} else {
					const matched = searchFlat(forest, q);
					treeList.setRoots(matched);
					shownCount = matched.length;
				}
			}

			function clearSearch() {
				searchInput.setValue("");
				(searchInput as any).cursor = 0;
				applySearch();
			}

			searchInput.onEscape = () => {
				clearSearch();
				focusSearch = false;
				rebuildAll();
				tui.requestRender();
			};

			function rebuildAll() {
				const statusW = kind === "bug" ? 8 : 10;
				const priorityW = kind === "bug" ? 6 : 8;
				const severityW = kind === "bug" ? 6 : 0;
				const dateW = kind === "bug" ? 10 : 12;
				const columnW = statusW + priorityW + severityW + dateW * 2;
				const separatorW = kind === "bug" ? 5 : 4;
				const titleW = Math.max(1, curW - 2 - 5 - columnW - separatorW);
				container = new Container();
				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);
				container.addChild(
					new Text(
						(kind === "story"
							? theme.bg(
									"selectedBg",
									theme.fg("text", ` 🎯 需求 ${storyCount} `),
								)
							: theme.fg("muted", ` 🎯 需求 ${storyCount} `)) +
							" " +
							(kind === "bug"
								? theme.bg(
										"selectedBg",
										theme.fg("text", ` 🐛 Bug ${bugCount} `),
									)
								: theme.fg("muted", ` 🐛 Bug ${bugCount} `)) +
							theme.fg(
								"dim",
								`  │  ${viewLabel}  ${shownCount}${searching ? "/" + total : ""} 项`,
							) +
							(typeFilter ? theme.fg("warning", `  [${typeFilter}]`) : "") +
							(searching ? theme.fg("warning", "  [搜索]") : ""),
						1,
						0,
					),
				);

				searchInput.focused = focusSearch;
				if (focusSearch) {
					container.addChild(new Text(theme.fg("accent", "搜索"), 1, 0));
					container.addChild(searchInput);
				} else {
					const q = searchInput.getValue();
					container.addChild(
						new Text(
							theme.fg("dim", q ? `搜索: ${q}` : "搜索: (按 / 输入)"),
							1,
							0,
						),
					);
				}

				container.addChild(
					new Text(
						"     " +
							theme.fg("dim", padR("标题", titleW)) +
							" " +
							theme.fg("dim", padR("状态", statusW)) +
							" " +
							theme.fg("dim", padR("优先", priorityW)) +
							(kind === "bug"
								? " " + theme.fg("dim", padR("严重度", severityW))
								: "") +
							" " +
							theme.fg("dim", padR("开始", dateW)) +
							" " +
							theme.fg("dim", padR("结束", dateW)),
						1,
						0,
					),
				);
				for (const line of treeList.render(curW, theme))
					container.addChild(new Text(line, 1, 0));
				if (kind === "bug") {
					const selected = treeList.getSelectedItem();
					if (selected)
						container.addChild(
							new Text(
								theme.fg("muted", `当前 Bug：${oneLine(selected.name)}`),
								1,
								0,
							),
						);
				}

				const hint = focusSearch
					? "输入过滤  ↑↓ 选中  Enter 关联会话  Esc 清除并返回  Ctrl+C 退出"
					: searching
						? "↑↓ 导航  Enter 关联会话  o 浏览器打开  / 搜索  Esc 清除搜索  Ctrl+C 退出"
						: "↑↓ 导航  Space/→/← 展开收起  Enter 关联会话  o 浏览器打开  / 搜索  Tab 切换需求/Bug  i 切换迭代" +
							(kind === "story" ? "  t 类型" : "") +
							"  c 清理失效关联  Esc/Ctrl+C 退出";
				container.addChild(new Text(theme.fg("dim", hint), 1, 0));
				container.addChild(
					new DynamicBorder((s: string) => theme.fg("accent", s)),
				);
			}
			rebuildAll();

			return {
				render(w: number) {
					if (w !== curW) {
						curW = w;
						rebuildAll();
					}
					return container.render(w);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					if (focusSearch) {
						if (data === "\x03") {
							done(null);
							return;
						}
						if (
							data === "\x1b[A" ||
							data === "\x1b[B" ||
							data === "\x1b[5~" ||
							data === "\x1b[6~"
						) {
							treeList.handleInput(data);
							rebuildAll();
							tui.requestRender();
							return;
						}
						if (data === "\r" || data === "\n") {
							const it = treeList.getSelectedItem();
							if (it)
								done({
									action: "link_view",
									itemKey: linkKey(it.workspaceId, it.id, it.kind),
									itemName: it.name,
								});
							return;
						}
						searchInput.handleInput(data);
						applySearch();
						rebuildAll();
						tui.requestRender();
						return;
					}

					if (data === "\x03") {
						done(null);
						return;
					}
					if (data === "\x1b") {
						if (searchInput.getValue()) {
							clearSearch();
							rebuildAll();
							tui.requestRender();
							return;
						}
						done(null);
						return;
					}
					if (data === "/") {
						focusSearch = true;
						rebuildAll();
						tui.requestRender();
						return;
					}
					if (data === "\t" || data === "\x1b[Z") {
						done({ action: "kind_toggle" });
						return;
					}
					if (data === "i") {
						done({ action: "scope_toggle" });
						return;
					}
					if (data === "t" && kind === "story") {
						done({ action: "type_filter" });
						return;
					}
					if (data === "c") {
						done({ action: "cleanup" });
						return;
					}
					if (data === "\r" || data === "\n") {
						const it = treeList.getSelectedItem();
						if (it)
							done({
								action: "link_view",
								itemKey: linkKey(it.workspaceId, it.id, it.kind),
								itemName: it.name,
							});
						return;
					}
					if (data === "o") {
						const it = treeList.getSelectedItem();
						if (it) done({ action: "open", url: tapdUrl(it) });
						return;
					}
					if (treeList.handleInput(data)) {
						rebuildAll();
						tui.requestRender();
					}
				},
			};
		},
	);
}
