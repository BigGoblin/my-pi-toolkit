declare module "grok-mermaid" {
	export interface MermaidSpan {
		cls: "border" | "text" | "edge" | "edgeLabel" | "title" | "none";
		text: string;
	}

	export interface MermaidArt {
		plain: string[];
		styled: MermaidSpan[][];
		width: number;
		height: number;
		warnings: string[];
	}

	export function render(source: string): MermaidArt | null;
}
