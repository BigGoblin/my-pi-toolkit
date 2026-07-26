// API clients
export { default as AgentService, wrapAbortSafeStream, type RpcClient } from "./agent.js";
export { default as AiService, type AiRpcClient } from "./ai.js";
export { default as Auth, type AuthResult } from "./auth.js";

// lib
export { CURSOR_API_URL, CURSOR_CLIENT_VERSION, CURSOR_WEBSITE_URL } from "./constants.js";
export { backoff } from "./backoff.js";

// Generated protobuf types — re-export specific common types
export type {
  AgentClientMessage,
  AgentServerMessage,
  AgentRunRequest,
  ConversationAction,
  ConversationStateStructure,
  InteractionResponse,
  ModelDetails,
  ClientHeartbeat,
  ResumeAction,
} from "./__generated__/agent/v1/agent_pb.js";

export type {
  ExecClientMessage,
  ExecClientControlMessage,
  ExecServerMessage,
} from "./__generated__/agent/v1/exec_pb.js";

export type { KvClientMessage, KvServerMessage } from "./__generated__/agent/v1/kv_pb.js";
