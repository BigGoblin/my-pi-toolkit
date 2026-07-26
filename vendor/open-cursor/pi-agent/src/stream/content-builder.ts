import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
} from "@earendil-works/pi-ai";

import type { ContentEvent } from "../bridge/live-session.js";

/**
 * Cursor-specific extension of AssistantMessage with timing metadata.
 */
export type CursorAssistantMessage = AssistantMessage & {
  duration?: number;
  ttft?: number;
};

/**
 * Tracks the currently-open text and thinking blocks during streaming.
 */
export interface LiveContentState {
  currentText: TextContent | null;
  currentThinking: ThinkingContent | null;
}

/**
 * Finalize the current text block by pushing a text_end event.
 */
export function finalizeText(
  state: LiveContentState,
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  if (!state.currentText) return;
  stream.push({
    type: "text_end",
    contentIndex: output.content.indexOf(state.currentText),
    content: state.currentText.text,
    partial: output,
  });
  state.currentText = null;
}

/**
 * Finalize the current thinking block by pushing a thinking_end event.
 */
export function finalizeThinking(
  state: LiveContentState,
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  if (!state.currentThinking) return;
  stream.push({
    type: "thinking_end",
    contentIndex: output.content.indexOf(state.currentThinking),
    content: state.currentThinking.thinking,
    partial: output,
  });
  state.currentThinking = null;
}

/**
 * Push a content event (text/thinking delta) into the stream.
 * Opens new blocks as needed and finalizes the opposite block type.
 */
export function pushContentEvent(
  event: ContentEvent,
  state: LiveContentState,
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  switch (event.kind) {
    case "text-delta": {
      finalizeThinking(state, output, stream);
      if (!state.currentText) {
        state.currentText = { type: "text", text: "" };
        output.content.push(state.currentText);
        stream.push({
          type: "text_start",
          contentIndex: output.content.length - 1,
          partial: output,
        });
      }
      state.currentText.text += event.text;
      stream.push({
        type: "text_delta",
        contentIndex: output.content.indexOf(state.currentText),
        delta: event.text,
        partial: output,
      });
      break;
    }
    case "thinking-delta": {
      finalizeText(state, output, stream);
      if (!state.currentThinking) {
        state.currentThinking = { type: "thinking", thinking: "" };
        output.content.push(state.currentThinking);
        stream.push({
          type: "thinking_start",
          contentIndex: output.content.length - 1,
          partial: output,
        });
      }
      state.currentThinking.thinking += event.text;
      stream.push({
        type: "thinking_delta",
        contentIndex: output.content.indexOf(state.currentThinking),
        delta: event.text,
        partial: output,
      });
      break;
    }
    case "thinking-completed": {
      finalizeThinking(state, output, stream);
      break;
    }
  }
}

/**
 * Finalize all open content blocks.
 */
export function finalizeAllContent(
  state: LiveContentState,
  output: CursorAssistantMessage,
  stream: AssistantMessageEventStream,
): void {
  finalizeText(state, output, stream);
  finalizeThinking(state, output, stream);
}

/**
 * Serialize content blocks to a portable shape for storage.
 */
export function serializeContentBlocks(content: CursorAssistantMessage["content"]): unknown[] {
  return content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "thinking":
        return { type: "thinking", thinking: block.thinking };
      case "toolCall":
        return {
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: block.arguments,
        };
      default:
        return { type: (block as { type: string }).type };
    }
  });
}
