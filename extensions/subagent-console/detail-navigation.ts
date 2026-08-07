import type { TUI } from "@earendil-works/pi-tui";
import type {
	LiveSubagentRun,
	SubagentTranscriptEntry,
} from "../shared/subagent/registry.js";
import type { SharedMarkdownRendering } from "../shared/tui/markdown.js";
import {
	createSubagentEntryRenderer,
	type SubagentEntryRenderer,
} from "./entry-render.js";

export interface HistoricalSubagentView {
	title: string;
	model: string;
	cwd: string;
	status: string;
	markdown?: string;
	entries?: SubagentTranscriptEntry[];
}

export type SubagentView = HistoricalSubagentView & {
	subscribe?: LiveSubagentRun["subscribe"];
};

export interface SubagentDetailItem {
	id: string;
	load: () => SubagentView;
}

export interface SubagentDetailNavigator {
	position: () => string;
	currentRun: () => SubagentView;
	renderEntry: () => SubagentEntryRenderer;
	switch: (delta: -1 | 1) => boolean;
	dispose: () => void;
}

export function createSubagentDetailNavigator(
	items: SubagentDetailItem[],
	initialId: string,
	tui: TUI,
	requestRender: () => void,
	markdown: SharedMarkdownRendering,
): SubagentDetailNavigator {
	let currentIndex = Math.max(
		0,
		items.findIndex((item) => item.id === initialId),
	);
	const initialItem = items[currentIndex];
	if (!initialItem) throw new Error("Subagent detail list cannot be empty");
	let run = initialItem.load();
	let entryRenderer = createSubagentEntryRenderer(run.cwd, tui, markdown);
	let unsubscribeRun = run.subscribe?.(requestRender) ?? (() => {});

	const clearSubscription = () => {
		const unsubscribe = unsubscribeRun;
		unsubscribeRun = () => {};
		unsubscribe();
	};

	return {
		position: () => `${currentIndex + 1}/${items.length}`,
		currentRun: () => run,
		renderEntry: () => entryRenderer,
		switch: (delta) => {
			if (items.length <= 1) return false;
			const nextIndex = (currentIndex + delta + items.length) % items.length;
			const nextItem = items[nextIndex];
			if (!nextItem) return false;
			clearSubscription();
			currentIndex = nextIndex;
			run = nextItem.load();
			entryRenderer = createSubagentEntryRenderer(run.cwd, tui, markdown);
			unsubscribeRun = run.subscribe?.(requestRender) ?? (() => {});
			return true;
		},
		dispose: clearSubscription,
	};
}
