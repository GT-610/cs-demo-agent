import type {
  AgentMessage,
  HttpTransport,
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderRequest,
  ProviderTurn,
  ResponsesContinuation,
  ToolCall,
  ToolSpec,
} from "../types";
import {
  asArray,
  asObject,
  asString,
  assertSuccess,
  authHeaders,
  buildEndpoint,
  validateProviderConfig,
} from "./shared";

function isContinuation(value: unknown): value is ResponsesContinuation {
  return (
    !!value &&
    typeof value === "object" &&
    "provider" in value &&
    value.provider === "openai-responses" &&
    "responseId" in value &&
    typeof value.responseId === "string" &&
    "acknowledgedMessages" in value &&
    typeof value.acknowledgedMessages === "number"
  );
}

function toResponsesTool(tool: ToolSpec): JsonObject {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as JsonValue,
    strict: true,
  };
}

function toInputItem(
  message: AgentMessage,
  continuing: boolean,
): JsonValue | undefined {
  switch (message.role) {
    case "system":
      return undefined;
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return continuing || !message.content
        ? undefined
        : { role: "assistant", content: message.content };
    case "tool":
      return {
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      };
  }
}

function parseOutput(body: JsonObject): { text: string; toolCalls: ToolCall[] } {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const [index, value] of asArray(body.output).entries()) {
    const item = asObject(value, `output[${index}]`);
    if (item.type === "function_call") {
      toolCalls.push({
        id: asString(item.call_id) || asString(item.id) || `tool-call-${index}`,
        name: asString(item.name),
        arguments: asString(item.arguments) || "{}",
      });
      continue;
    }
    if (item.type === "message") {
      for (const blockValue of asArray(item.content)) {
        const block = asObject(blockValue, "output message content");
        if (block.type === "output_text" && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
    }
  }

  if (textParts.length === 0 && typeof body.output_text === "string") {
    textParts.push(body.output_text);
  }

  return { text: textParts.join("\n"), toolCalls };
}

export class OpenAiResponsesAdapter implements ProviderAdapter {
  constructor(private readonly transport: HttpTransport) {}

  async generate(request: ProviderRequest): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    const continuation = isContinuation(request.continuation)
      ? request.continuation
      : undefined;
    const startingIndex = continuation?.acknowledgedMessages ?? 0;
    const input = request.messages
      .slice(startingIndex)
      .map((message) => toInputItem(message, !!continuation))
      .filter((item): item is JsonValue => item !== undefined);
    const instructions = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const response = await this.transport({
      url: buildEndpoint(request.config.baseUrl, "/responses"),
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(request.config),
      },
      timeoutMs: 120_000,
      body: {
        model: request.config.model,
        instructions,
        input,
        tools: request.tools.map(toResponsesTool),
        tool_choice: "auto",
        parallel_tool_calls: true,
        store: true,
        ...(continuation
          ? { previous_response_id: continuation.responseId }
          : {}),
      },
    });
    const body = assertSuccess(response);
    const parsed = parseOutput(body);
    const responseId = asString(body.id);
    if (!responseId) {
      throw new Error("Responses API response did not include an id");
    }

    return {
      ...parsed,
      raw: body,
      continuation: {
        provider: "openai-responses",
        responseId,
        acknowledgedMessages: request.messages.length,
      },
    };
  }
}
