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
}

export interface ResponsesContinuation {
  provider: "openai-responses";
  inputItems: JsonValue[];
  acknowledgedMessages: number;
}

export type ProviderContinuation = ResponsesContinuation;

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

export interface HttpJsonResponse {
  status: number;
  body: JsonValue;
}

export type HttpTransport = (
  request: HttpJsonRequest,
) => Promise<HttpJsonResponse>;

export interface ProviderAdapter {
  generate(request: ProviderRequest): Promise<ProviderTurn>;
}

export type ToolExecutor = (
  name: string,
  input: JsonObject,
) => Promise<JsonValue>;

export type AgentEvent =
  | { type: "assistant-start"; iteration: number }
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
