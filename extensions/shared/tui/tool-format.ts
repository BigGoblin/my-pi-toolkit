export function compactText(value: string, maximum = 100): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maximum) return normalized;
	return `${normalized.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

export function previewLines(
	value: string,
	maximumLines: number,
): {
	text: string;
	truncated: boolean;
} {
	const lines = value.split("\n");
	return {
		text: lines.slice(0, maximumLines).join("\n"),
		truncated: lines.length > maximumLines,
	};
}

export function formatCount(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function resultText(
	content: Array<{ type: string; text?: string }> | undefined,
	fallback: string,
): string {
	const first = content?.[0];
	return first?.type === "text" ? (first.text ?? fallback) : fallback;
}
