import type {
  AgentMessage,
  HttpStreamTransport,
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
  constructor(private readonly transport: HttpStreamTransport) {}

  async generate(
    request: ProviderRequest,
    onTextDelta: (delta: string) => void = () => undefined,
  ): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const apiKey = request.config.apiKey.trim();

    const blocks = new Map<
      number,
      {
        type: "text" | "tool_use";
        text: string;
        id: string;
        name: string;
        input: string;
      }
    >();
    let finalTurn: ProviderTurn | undefined;
    let streamError: Error | undefined;
    let emittedText = false;

    await this.transport(
      {
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
          stream: true,
        },
      },
      (value) => {
        try {
          const event = asObject(value, "Anthropic stream event");
          const eventType = asString(event.type);
          if (eventType === "error") {
            streamError = anthropicStreamError(event);
            return;
          }
          if (event.content) {
            finalTurn = parseContent(event);
            return;
          }
          const index =
            typeof event.index === "number" ? event.index : blocks.size;
          if (eventType === "content_block_start" && event.content_block) {
            const block = asObject(event.content_block, "content block");
            if (block.type === "text") {
              const initial = asString(block.text);
              blocks.set(index, {
                type: "text",
                text: initial,
                id: "",
                name: "",
                input: "",
              });
              if (initial) {
                emittedText = true;
                onTextDelta(initial);
              }
            } else if (block.type === "tool_use") {
              blocks.set(index, {
                type: "tool_use",
                text: "",
                id: asString(block.id) || `tool-call-${index}`,
                name: asString(block.name),
                input: initialToolInput(block.input),
              });
            }
            return;
          }
          if (eventType === "content_block_delta" && event.delta) {
            const delta = asObject(event.delta, "content block delta");
            const current = blocks.get(index);
            if (!current) return;
            if (delta.type === "text_delta") {
              const text = asString(delta.text);
              current.text += text;
              if (text) {
                emittedText = true;
                onTextDelta(text);
              }
            }
            if (delta.type === "input_json_delta") {
              current.input += asString(delta.partial_json);
            }
          }
        } catch (error) {
          streamError = error instanceof Error ? error : new Error(String(error));
        }
      },
      request.signal,
    );
    if (streamError) throw streamError;
    if (finalTurn) {
      if (!emittedText && finalTurn.text) onTextDelta(finalTurn.text);
      return finalTurn;
    }

    const orderedBlocks = [...blocks.entries()].sort(
      ([left], [right]) => left - right,
    );

    return {
      text: orderedBlocks
        .filter(([, block]) => block.type === "text")
        .map(([, block]) => block.text)
        .filter(Boolean)
        .join("\n"),
      toolCalls: orderedBlocks
        .filter(([, block]) => block.type === "tool_use")
        .map(([index, block]) => ({
          id: block.id || `tool-call-${index}`,
          name: block.name,
          arguments: block.input || "{}",
        })),
    };
  }
}

function initialToolInput(value: JsonValue | undefined): string {
  if (!value) return "";
  if (!Array.isArray(value) && typeof value === "object" && Object.keys(value).length === 0) {
    return "";
  }
  return JSON.stringify(value);
}

function anthropicStreamError(event: JsonObject): Error {
  const error =
    event.error && !Array.isArray(event.error) && typeof event.error === "object"
      ? event.error
      : undefined;
  const message = asString(error?.message);
  return new Error(message ? `Provider stream failed: ${message}` : "Provider stream failed");
}
