/**
 * aboveEditor widget 按 Map 插入顺序渲染。后 set 的会出现在下方。
 * 优先条（如 Working）set 之后调用 restack，让其它面板重新挂到栈底。
 */

export interface WidgetRestackContext {
	hasUI: boolean;
	ui: {
		setWidget: (
			key: string,
			content: unknown,
			options?: { placement?: string },
		) => void;
	};
}

type RestackFn = (ctx: WidgetRestackContext) => void;

const RESTACK_KEY = Symbol.for("my-pi-toolkit.widget-restack.above-editor");

function handlers(): Set<RestackFn> {
	const shared = globalThis as typeof globalThis & {
		[RESTACK_KEY]?: Set<RestackFn>;
	};
	return (shared[RESTACK_KEY] ??= new Set<RestackFn>());
}

export function registerAboveEditorRestack(fn: RestackFn): () => void {
	handlers().add(fn);
	return () => {
		handlers().delete(fn);
	};
}

export function restackAboveEditorWidgets(ctx: WidgetRestackContext): void {
	if (!ctx.hasUI) return;
	for (const fn of handlers()) fn(ctx);
}
