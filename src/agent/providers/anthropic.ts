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
  buildEndpoint,
  validateProviderConfig,
} from "./shared";

function toAnthropicTool(tool: ToolSpec): JsonObject {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as JsonValue,
  };
}

function toAnthropicMessages(messages: AgentMessage[]): JsonObject[] {
  const result: JsonObject[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: JsonValue[] = [];
      if (message.content) {
        content.push({ type: "text", text: message.content });
      }
      content.push(
        ...message.toolCalls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parseArguments(call.arguments),
        })),
      );
      result.push({ role: "assistant", content });
      continue;
    }

    const toolResult: JsonObject = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    const previous = result.at(-1);
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(toolResult);
    } else {
      result.push({ role: "user", content: [toolResult] });
    }
  }

  return result;
}

function parseArguments(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return {};
  }
}

function parseContent(body: JsonObject): { text: string; toolCalls: ToolCall[] } {
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const [index, blockValue] of asArray(body.content).entries()) {
    const block = asObject(blockValue, `content[${index}]`);
    if (block.type === "text" && typeof block.text === "string") {
      text.push(block.text);
    }
    if (block.type === "tool_use") {
      toolCalls.push({
        id: asString(block.id) || `tool-call-${index}`,
        name: asString(block.name),
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }

  return { text: text.join("\n"), toolCalls };
}

export class AnthropicAdapter implements ProviderAdapter {
  constructor(private readonly transport: HttpTransport) {}

  async generate(request: ProviderRequest): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const apiKey = request.config.apiKey.trim();

    const response = await this.transport({
      url: buildEndpoint(request.config.baseUrl, "/messages"),
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      timeoutMs: 120_000,
      body: {
        model: request.config.model,
        max_tokens: request.config.maxOutputTokens ?? 4096,
        system,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools.map(toAnthropicTool),
        tool_choice: { type: "auto" },
      },
    });
    const body = assertSuccess(response);

    return {
      ...parseContent(body),
    };
  }
}
