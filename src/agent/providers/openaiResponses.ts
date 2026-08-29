import type {
  AgentMessage,
  HttpStreamTransport,
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
    "inputItems" in value &&
    Array.isArray(value.inputItems) &&
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

function toInputItems(
  message: AgentMessage,
  continuing: boolean,
): JsonValue[] {
  switch (message.role) {
    case "system":
      return [];
    case "user":
      return [{ role: "user", content: message.content }];
    case "assistant":
      if (continuing) return [];
      return [
        ...(message.content
          ? [{ role: "assistant", content: message.content }]
          : []),
        ...message.toolCalls.map((call) => ({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      ];
    case "tool":
      return [{
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      }];
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
  constructor(private readonly transport: HttpStreamTransport) {}

  async generate(
    request: ProviderRequest,
    onTextDelta: (delta: string) => void = () => undefined,
  ): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    const continuation = isContinuation(request.continuation)
      ? request.continuation
      : undefined;
    const startingIndex = continuation?.acknowledgedMessages ?? 0;
    const input = [
      ...(continuation?.inputItems ?? []),
      ...request.messages
        .slice(startingIndex)
        .flatMap((message) => toInputItems(message, !!continuation)),
    ];
    const instructions = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    let streamedText = "";
    let completedOutput: JsonValue[] | undefined;
    const outputItems = new Map<number, JsonValue>();
    let streamError: Error | undefined;
    await this.transport(
      {
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
          store: false,
          stream: true,
        },
      },
      (value) => {
        try {
          const event = asObject(value, "Responses stream event");
          const eventType = asString(event.type);
          if (eventType === "response.output_text.delta") {
            const delta = asString(event.delta);
            if (delta) {
              streamedText += delta;
              onTextDelta(delta);
            }
            return;
          }
          if (eventType === "response.output_item.done" && event.item) {
            const index =
              typeof event.output_index === "number"
                ? event.output_index
                : outputItems.size;
            outputItems.set(index, event.item);
            return;
          }
          if (eventType === "response.completed" && event.response) {
            const response = asObject(event.response, "completed response");
            completedOutput = asArray(response.output);
            return;
          }
          if (eventType === "response.failed" || eventType === "error") {
            streamError = responseStreamError(event);
            return;
          }
          if (event.output) {
            completedOutput = asArray(event.output);
          }
        } catch (error) {
          streamError = error instanceof Error ? error : new Error(String(error));
        }
      },
    );
    if (streamError) throw streamError;
    const output =
      completedOutput ??
      [...outputItems.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item);
    const parsed = parseOutput({ output });
    const text = parsed.text || streamedText;
    if (!streamedText && text) onTextDelta(text);

    return {
      text,
      toolCalls: parsed.toolCalls,
      continuation: {
        provider: "openai-responses",
        inputItems: [...input, ...output],
        acknowledgedMessages: request.messages.length,
      },
    };
  }
}

function responseStreamError(event: JsonObject): Error {
  const error =
    event.error && !Array.isArray(event.error) && typeof event.error === "object"
      ? event.error
      : undefined;
  const message = asString(error?.message) || asString(event.message);
  return new Error(message ? `Provider stream failed: ${message}` : "Provider stream failed");
}
