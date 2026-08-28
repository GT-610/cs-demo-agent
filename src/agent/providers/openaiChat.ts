import type {
  AgentMessage,
  HttpTransport,
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderRequest,
  ProviderTurn,
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
  extractTextContent,
  validateProviderConfig,
} from "./shared";

function toOpenAiTool(tool: ToolSpec): JsonObject {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as JsonValue,
      strict: true,
    },
  };
}

function toOpenAiMessage(message: AgentMessage): JsonObject {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function parseToolCalls(value: JsonValue | undefined): ToolCall[] {
  return asArray(value).map((item, index) => {
    const call = asObject(item, `tool_calls[${index}]`);
    const fn = asObject(call.function ?? null, `tool_calls[${index}].function`);
    return {
      id: asString(call.id) || `tool-call-${index}`,
      name: asString(fn.name),
      arguments: asString(fn.arguments) || "{}",
    };
  });
}

export class OpenAiChatAdapter implements ProviderAdapter {
  constructor(private readonly transport: HttpTransport) {}

  async generate(request: ProviderRequest): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    const response = await this.transport({
      url: buildEndpoint(request.config.baseUrl, "/chat/completions"),
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(request.config),
      },
      timeoutMs: 120_000,
      body: {
        model: request.config.model,
        messages: request.messages.map(toOpenAiMessage),
        tools: request.tools.map(toOpenAiTool),
        tool_choice: "auto",
        parallel_tool_calls: true,
      },
    });
    const body = assertSuccess(response);
    const choice = asObject(asArray(body.choices)[0] ?? null, "choices[0]");
    const message = asObject(choice.message ?? null, "choices[0].message");

    return {
      text: extractTextContent(message.content),
      toolCalls: parseToolCalls(message.tool_calls),
      raw: body,
    };
  }
}
