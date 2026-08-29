export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  content: string;
  toolCallId: string;
  name: string;
}

export type AgentMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export type ProviderKind =
  | "openai-chat"
  | "openai-responses"
  | "anthropic";

export interface ProviderConfig {
  providerId: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
}

export interface ProviderRequest {
  config: ProviderConfig;
  messages: AgentMessage[];
  tools: ToolSpec[];
  continuation?: ProviderContinuation;
  signal?: AbortSignal;
}

export interface ResponsesContinuation {
  provider: "openai-responses";
  inputItems: JsonValue[];
  acknowledgedMessages: number;
}

export type ProviderContinuation = ResponsesContinuation;

export interface StoredProviderContinuation {
  providerId: string;
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  value: ProviderContinuation;
}

export interface ProviderTurn {
  text: string;
  toolCalls: ToolCall[];
  continuation?: ProviderContinuation;
}

export interface HttpJsonRequest {
  url: string;
  headers: Record<string, string>;
  body: JsonValue;
  timeoutMs: number;
}

export type HttpStreamEvent =
  | { type: "started"; status: number }
  | { type: "data"; data: JsonValue }
  | { type: "done" };

export interface HttpStreamResponse {
  status: number;
}

export type HttpStreamTransport = (
  request: HttpJsonRequest,
  onData: (data: JsonValue) => void,
  signal?: AbortSignal,
) => Promise<HttpStreamResponse>;

export interface ProviderAdapter {
  generate(
    request: ProviderRequest,
    onTextDelta?: (delta: string) => void,
  ): Promise<ProviderTurn>;
}

export type ToolExecutor = (
  name: string,
  input: JsonObject,
  signal?: AbortSignal,
) => Promise<JsonValue>;

export type AgentEvent =
  | { type: "assistant-start"; iteration: number }
  | { type: "assistant-delta"; delta: string; iteration: number }
  | {
      type: "assistant-end";
      text: string;
      iteration: number;
      hasToolCalls: boolean;
    }
  | { type: "tool-start"; call: ToolCall; iteration: number }
  | {
      type: "tool-result";
      call: ToolCall;
      result: JsonValue;
      iteration: number;
      ok: boolean;
    }
  | { type: "error"; message: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgentRuntimeState {
  messages: AgentMessage[];
  continuation?: StoredProviderContinuation;
}
