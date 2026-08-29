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
  constructor(private readonly transport: HttpStreamTransport) {}

  async generate(
    request: ProviderRequest,
    onTextDelta: (delta: string) => void = () => undefined,
  ): Promise<ProviderTurn> {
    validateProviderConfig(request.config);
    let text = "";
    let streamedText = false;
    let finalTurn: ProviderTurn | undefined;
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    await this.transport(
      {
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
          stream: true,
        },
      },
      (value) => {
        const body = asObject(value, "OpenAI stream event");
        throwStreamError(body);
        const choiceValue = asArray(body.choices)[0];
        if (!choiceValue) return;
        const choice = asObject(choiceValue, "choices[0]");
        if (choice.message) {
          const message = asObject(choice.message, "choices[0].message");
          finalTurn = {
            text: extractTextContent(message.content),
            toolCalls: parseToolCalls(message.tool_calls),
          };
          return;
        }
        if (!choice.delta) return;
        const delta = asObject(choice.delta, "choices[0].delta");
        const content = extractTextContent(delta.content);
        if (content) {
          streamedText = true;
          text += content;
          onTextDelta(content);
        }
        for (const [fallbackIndex, itemValue] of asArray(
          delta.tool_calls,
        ).entries()) {
          const item = asObject(itemValue, "delta.tool_calls[]");
          const index =
            typeof item.index === "number" ? item.index : fallbackIndex;
          const current = toolCalls.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          const fn = item.function
            ? asObject(item.function, "delta.tool_calls[].function")
            : undefined;
          current.id = asString(item.id) || current.id;
          current.name = asString(fn?.name) || current.name;
          current.arguments += asString(fn?.arguments);
          toolCalls.set(index, current);
        }
      },
      request.signal,
    );

    if (finalTurn) {
      if (!streamedText && finalTurn.text) onTextDelta(finalTurn.text);
      return finalTurn;
    }

    return {
      text,
      toolCalls: [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, call]) => ({
          id: call.id || `tool-call-${index}`,
          name: call.name,
          arguments: call.arguments || "{}",
        })),
    };
  }
}

function throwStreamError(body: JsonObject): void {
  if (!body.error || Array.isArray(body.error) || typeof body.error !== "object") {
    return;
  }
  const message = asString(body.error.message);
  throw new Error(message ? `Provider stream failed: ${message}` : "Provider stream failed");
}
