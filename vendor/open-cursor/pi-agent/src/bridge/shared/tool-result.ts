import type { ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";

export function toolResultToText(result: ToolResultMessage): string {
  return result.content
    .map((item: TextContent | ImageContent) => {
      if (item.type === "text") return item.text;
      return `[${item.mimeType} image]`;
    })
    .join("\n");
}

export function toolResultWasTruncated(result: ToolResultMessage): boolean {
  if (!result.details || typeof result.details !== "object") {
    return false;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object above
  const truncation = (result.details as { truncation?: { truncated?: boolean } }).truncation;
  return !!truncation?.truncated;
}

export function toolResultDetailBoolean(result: ToolResultMessage, key: string): boolean {
  if (!result.details || typeof result.details !== "object") {
    return false;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object above
  const value = (result.details as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : false;
}
