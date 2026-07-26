import { InteractionResponse } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import type {
  InteractionQuery,
  InteractionResponse as InteractionResponseType,
  InteractionUpdate,
} from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import { PrManagementResult } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import { McpAuthRequestResponse } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import { GenerateImageRequestResponse } from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import {
  ReplaceEnvResult,
  ReplaceEnvSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/agent_pb.js";
import { AskQuestionInteractionResponse } from "@open-cursor/protocol/__generated__/agent/v1/ask_question_tool_pb.js";
import type { AskQuestionResult } from "@open-cursor/protocol/__generated__/agent/v1/ask_question_tool_pb.js";
import { CreatePlanRequestResponse } from "@open-cursor/protocol/__generated__/agent/v1/create_plan_tool_pb.js";
import type { CreatePlanResult } from "@open-cursor/protocol/__generated__/agent/v1/create_plan_tool_pb.js";
import {
  SetupVmEnvironmentResult,
  SetupVmEnvironmentSuccess,
} from "@open-cursor/protocol/__generated__/agent/v1/setup_vm_environment_tool_pb.js";
import {
  SwitchModeRequestResponse,
  SwitchModeRequestResponse_Rejected,
} from "@open-cursor/protocol/__generated__/agent/v1/switch_mode_tool_pb.js";
import { ThinkingStyle } from "@open-cursor/protocol/__generated__/agent/v1/utils_pb.js";
import {
  WebFetchRequestResponse,
  WebFetchRequestResponse_Approved,
  WebFetchRequestResponse_Rejected,
} from "@open-cursor/protocol/__generated__/agent/v1/web_fetch_tool_pb.js";
import {
  WebSearchRequestResponse,
  WebSearchRequestResponse_Approved,
  WebSearchRequestResponse_Rejected,
} from "@open-cursor/protocol/__generated__/agent/v1/web_search_tool_pb.js";

/**
 * Converts a string-based thinking style to the proto enum
 */
export function thinkingStyleToProto(style: string | undefined): ThinkingStyle | undefined {
  switch (style) {
    case "default":
      return ThinkingStyle.DEFAULT;
    case "codex":
      return ThinkingStyle.CODEX;
    case "gpt5":
      return ThinkingStyle.GPT5;
    default:
      return undefined;
  }
}

/**
 * Converts a proto thinking style enum to string
 */
function thinkingStyleFromProto(style: ThinkingStyle | undefined): string | undefined {
  switch (style) {
    case ThinkingStyle.DEFAULT:
      return "default";
    case ThinkingStyle.CODEX:
      return "codex";
    case ThinkingStyle.GPT5:
      return "gpt5";
    default:
      return undefined;
  }
}

export type CoreInteractionUpdate =
  | { type: "text-delta"; text: string }
  | {
      type: "tool-call-started";
      callId: string;
      toolCall: unknown;
      modelCallId: string;
    }
  | {
      type: "tool-call-completed";
      callId: string;
      toolCall: unknown;
      modelCallId: string;
    }
  | { type: "thinking-delta"; text: string; thinkingStyle?: string | undefined }
  | { type: "thinking-completed"; thinkingDurationMs?: number | undefined }
  | { type: "user-message-appended"; userMessage: unknown }
  | {
      type: "partial-tool-call";
      callId: string;
      toolCall: unknown;
      modelCallId: string;
    }
  | { type: "token-delta"; tokens: number }
  | { type: "summary"; summary: unknown }
  | { type: "summary-started" }
  | { type: "heartbeat" }
  | { type: "summary-completed"; hookMessage?: string | undefined }
  | { type: "shell-output-delta"; event: unknown }
  | {
      type: "turn-ended";
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | {
      type: "tool-call-delta";
      callId: string;
      toolCallDelta: unknown;
      modelCallId: string;
    }
  | { type: "step-started"; stepId: number }
  | { type: "step-completed"; stepId: number; stepDurationMs: number };

export type CoreInteractionQuery =
  | { type: "web-search-request"; args: unknown }
  | { type: "web-fetch-request"; args: unknown }
  | { type: "ask-question-request"; args: unknown; toolCallId: string }
  | { type: "switch-mode-request"; args: unknown; toolCallId: string }
  | { type: "create-plan-request"; args: unknown; toolCallId: string }
  | { type: "setup-vm-environment-request"; args: unknown }
  | { type: "pr-management-request"; args: unknown }
  | { type: "mcp-auth-request"; args: unknown }
  | { type: "generate-image-request"; args: unknown; toolCallId: string }
  | { type: "replace-env-request"; args: unknown };

export type CoreInteractionResponse =
  | { approved: true }
  | { approved: false; reason?: string }
  | { result: unknown };

/**
 * Converts a protobuf InteractionUpdate to its corresponding core representation
 */
export function convertProtoToInteractionUpdate(
  update: InteractionUpdate,
): CoreInteractionUpdate | null {
  if (!update.message) {
    return null;
  }
  switch (update.message.case) {
    case "textDelta":
      return {
        type: "text-delta",
        text: update.message.value.text,
      };
    case "toolCallStarted":
      if (!update.message.value.toolCall || !update.message.value.modelCallId) {
        return null;
      }
      return {
        type: "tool-call-started",
        callId: update.message.value.callId,
        toolCall: update.message.value.toolCall,
        modelCallId: update.message.value.modelCallId,
      };
    case "toolCallCompleted":
      if (!update.message.value.toolCall || !update.message.value.modelCallId) {
        return null;
      }
      return {
        type: "tool-call-completed",
        callId: update.message.value.callId,
        toolCall: update.message.value.toolCall,
        modelCallId: update.message.value.modelCallId,
      };
    case "thinkingDelta":
      return {
        type: "thinking-delta",
        text: update.message.value.text,
        thinkingStyle: thinkingStyleFromProto(update.message.value.thinkingStyle),
      };
    case "thinkingCompleted":
      return {
        type: "thinking-completed",
        thinkingDurationMs: update.message.value.thinkingDurationMs,
      };
    case "userMessageAppended":
      if (!update.message.value.userMessage) {
        return null;
      }
      return {
        type: "user-message-appended",
        userMessage: update.message.value.userMessage,
      };
    case "partialToolCall":
      if (!update.message.value.toolCall || !update.message.value.modelCallId) {
        return null;
      }
      return {
        type: "partial-tool-call",
        callId: update.message.value.callId,
        toolCall: update.message.value.toolCall,
        modelCallId: update.message.value.modelCallId,
      };
    case "tokenDelta":
      return {
        type: "token-delta",
        tokens: update.message.value.tokens,
      };
    case "summary":
      return {
        type: "summary",
        summary: update.message.value.summary,
      };
    case "summaryStarted":
      return {
        type: "summary-started",
      };
    case "heartbeat":
      return {
        type: "heartbeat",
      };
    case "summaryCompleted":
      return {
        type: "summary-completed",
        hookMessage: update.message.value.hookMessage,
      };
    case "shellOutputDelta":
      return {
        type: "shell-output-delta",
        event: update.message.value.event,
      };
    case "turnEnded":
      return {
        type: "turn-ended",
        inputTokens:
          update.message.value.inputTokens !== undefined
            ? Number(update.message.value.inputTokens)
            : undefined,
        outputTokens:
          update.message.value.outputTokens !== undefined
            ? Number(update.message.value.outputTokens)
            : undefined,
        cacheReadTokens:
          update.message.value.cacheReadTokens !== undefined
            ? Number(update.message.value.cacheReadTokens)
            : undefined,
        cacheWriteTokens:
          update.message.value.cacheWriteTokens !== undefined
            ? Number(update.message.value.cacheWriteTokens)
            : undefined,
      };
    case "toolCallDelta":
      if (
        !update.message.value.toolCallDelta ||
        !update.message.value.callId ||
        !update.message.value.modelCallId
      ) {
        return null;
      }
      return {
        type: "tool-call-delta",
        callId: update.message.value.callId,
        toolCallDelta: update.message.value.toolCallDelta,
        modelCallId: update.message.value.modelCallId,
      };
    case "stepStarted":
      return {
        type: "step-started",
        stepId: Number(update.message.value.stepId),
      };
    case "stepCompleted":
      return {
        type: "step-completed",
        stepId: Number(update.message.value.stepId),
        stepDurationMs: Number(update.message.value.stepDurationMs),
      };
    default:
      return null;
  }
}

/**
 * Converts a protobuf InteractionQuery to its corresponding core representation
 */
export function convertProtoToInteractionQuery(proto: InteractionQuery): CoreInteractionQuery {
  if (proto.query?.case === undefined) {
    throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
  }
  switch (proto.query.case) {
    case "webSearchRequestQuery":
      if (!proto.query.value.args) {
        throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
      }
      return {
        type: "web-search-request",
        args: proto.query.value.args,
      };
    case "webFetchRequestQuery":
      if (!proto.query.value.args) {
        throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
      }
      return {
        type: "web-fetch-request",
        args: proto.query.value.args,
      };
    case "askQuestionInteractionQuery":
      if (!proto.query.value.args || !proto.query.value.toolCallId) {
        throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
      }
      return {
        type: "ask-question-request",
        args: proto.query.value.args,
        toolCallId: proto.query.value.toolCallId,
      };
    case "switchModeRequestQuery":
      if (!proto.query.value.args) {
        throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
      }
      return {
        type: "switch-mode-request",
        args: proto.query.value.args,
        toolCallId: proto.query.value.args.toolCallId,
      };
    case "createPlanRequestQuery":
      if (!proto.query.value.args || !proto.query.value.toolCallId) {
        throw new Error(`Failed to convert interaction query to core type: ${proto.id}`);
      }
      return {
        type: "create-plan-request",
        args: proto.query.value.args,
        toolCallId: proto.query.value.toolCallId,
      };
    case "setupVmEnvironmentArgs":
      return {
        type: "setup-vm-environment-request",
        args: proto.query.value,
      };
    case "prManagementRequestQuery":
      return {
        type: "pr-management-request",
        args: proto.query.value.args,
      };
    case "mcpAuthRequestQuery":
      return {
        type: "mcp-auth-request",
        args: proto.query.value.args,
      };
    case "generateImageRequestQuery":
      return {
        type: "generate-image-request",
        args: proto.query.value.args,
        toolCallId: proto.query.value.toolCallId,
      };
    case "replaceEnvArgs":
      return {
        type: "replace-env-request",
        args: proto.query.value.config,
      };
    default: {
      const _exhaustiveCheck: never = proto.query;
      throw new Error(`Unhandled interaction query type: ${JSON.stringify(_exhaustiveCheck)}`);
    }
  }
}

/**
 * Converts an InteractionResponse to its corresponding protobuf representation
 */
export function convertInteractionResponseToProto(
  response: CoreInteractionResponse,
  id: number,
  queryType: CoreInteractionQuery["type"],
): InteractionResponseType {
  switch (queryType) {
    case "web-search-request": {
      const webSearchResponse = response as
        | { approved: true }
        | { approved: false; reason?: string };
      const resultValue = webSearchResponse.approved
        ? {
            case: "approved" as const,
            value: new WebSearchRequestResponse_Approved(),
          }
        : {
            case: "rejected" as const,
            value: new WebSearchRequestResponse_Rejected({
              reason: webSearchResponse.reason ?? "",
            }),
          };
      return new InteractionResponse({
        id,
        result: {
          case: "webSearchRequestResponse",
          value: new WebSearchRequestResponse({
            result: resultValue,
          }),
        },
      });
    }
    case "web-fetch-request": {
      const webFetchResponse = response as
        | { approved: true }
        | { approved: false; reason?: string };
      const resultValue = webFetchResponse.approved
        ? {
            case: "approved" as const,
            value: new WebFetchRequestResponse_Approved(),
          }
        : {
            case: "rejected" as const,
            value: new WebFetchRequestResponse_Rejected({
              reason: webFetchResponse.reason ?? "",
            }),
          };
      return new InteractionResponse({
        id,
        result: {
          case: "webFetchRequestResponse",
          value: new WebFetchRequestResponse({
            result: resultValue,
          }),
        },
      });
    }
    case "ask-question-request": {
      const askQuestionResponse = response as { result: unknown };
      return new InteractionResponse({
        id,
        result: {
          case: "askQuestionInteractionResponse",
          value: new AskQuestionInteractionResponse({
            result: askQuestionResponse.result as AskQuestionResult,
          }),
        },
      });
    }
    case "switch-mode-request": {
      const switchModeResponse = response as
        | { approved: true }
        | { approved: false; reason?: string };
      if (switchModeResponse.approved) {
        return new InteractionResponse({
          id,
          result: {
            case: "switchModeRequestResponse",
            value: new SwitchModeRequestResponse({
              result: {
                case: "approved",
                value: {},
              },
            }),
          },
        });
      }
      return new InteractionResponse({
        id,
        result: {
          case: "switchModeRequestResponse",
          value: new SwitchModeRequestResponse({
            result: {
              case: "rejected",
              value: new SwitchModeRequestResponse_Rejected({
                reason: !switchModeResponse.approved ? (switchModeResponse.reason ?? "") : "",
              }),
            },
          }),
        },
      });
    }
    case "create-plan-request": {
      const createPlanResponse = response as { result: unknown };
      return new InteractionResponse({
        id,
        result: {
          case: "createPlanRequestResponse",
          value: new CreatePlanRequestResponse({
            result: createPlanResponse.result as CreatePlanResult,
          }),
        },
      });
    }
    case "setup-vm-environment-request": {
      return new InteractionResponse({
        id,
        result: {
          case: "setupVmEnvironmentResult",
          value: new SetupVmEnvironmentResult({
            result: {
              case: "success",
              value: new SetupVmEnvironmentSuccess({}),
            },
          }),
        },
      });
    }
    case "pr-management-request": {
      return new InteractionResponse({
        id,
        result: {
          case: "prManagementResult",
          value: new PrManagementResult({ result: { case: "success", value: true } }),
        },
      });
    }
    case "mcp-auth-request": {
      return new InteractionResponse({
        id,
        result: {
          case: "mcpAuthRequestResponse",
          value: new McpAuthRequestResponse({
            result: { case: "approved", value: true },
          }),
        },
      });
    }
    case "generate-image-request": {
      return new InteractionResponse({
        id,
        result: {
          case: "generateImageRequestResponse",
          value: new GenerateImageRequestResponse({
            result: { case: "approved", value: true },
          }),
        },
      });
    }
    case "replace-env-request": {
      return new InteractionResponse({
        id,
        result: {
          case: "replaceEnvResult",
          value: new ReplaceEnvResult({
            result: { case: "success", value: new ReplaceEnvSuccess({}) },
          }),
        },
      });
    }
    default: {
      const _exhaustiveCheck: never = queryType;
      throw new Error(`Unhandled interaction query response type: ${String(_exhaustiveCheck)}`);
    }
  }
}
