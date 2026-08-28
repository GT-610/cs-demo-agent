import type {
  AgentEventHandler,
  AgentMessage,
  AssistantMessage,
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderConfig,
  ProviderContinuation,
  ToolCall,
  ToolExecutor,
  ToolMessage,
  ToolSpec,
} from "./types";

export interface AgentRuntimeOptions {
  adapter: ProviderAdapter;
  config: ProviderConfig;
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  systemPrompt: string;
  maxIterations?: number;
}

export interface AgentReply {
  text: string;
  messages: readonly AgentMessage[];
}

interface ExecutedTool {
  message: ToolMessage;
  result: JsonValue;
  ok: boolean;
}

export class AgentRuntime {
  private readonly adapter: ProviderAdapter;
  private readonly config: ProviderConfig;
  private readonly tools: ToolSpec[];
  private readonly executeTool: ToolExecutor;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private messages: AgentMessage[];
  private continuation?: ProviderContinuation;

  constructor(options: AgentRuntimeOptions) {
    this.adapter = options.adapter;
    this.config = options.config;
    this.tools = options.tools;
    this.executeTool = options.executeTool;
    this.systemPrompt = options.systemPrompt;
    this.maxIterations = options.maxIterations ?? 12;
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  get history(): readonly AgentMessage[] {
    return this.messages;
  }

  reset(): void {
    this.messages = [{ role: "system", content: this.systemPrompt }];
    this.continuation = undefined;
  }

  async send(
    userText: string,
    onEvent: AgentEventHandler = () => undefined,
  ): Promise<AgentReply> {
    const text = userText.trim();
    if (!text) {
      throw new Error("A user message is required");
    }

    this.messages.push({ role: "user", content: text });

    try {
      for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
        onEvent({ type: "assistant-start", iteration });
        const turn = await this.adapter.generate({
          config: this.config,
          messages: this.messages,
          tools: this.tools,
          continuation: this.continuation,
        });
        this.continuation = turn.continuation;

        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content: turn.text,
          toolCalls: turn.toolCalls,
        };
        this.messages.push(assistantMessage);

        if (turn.text) {
          onEvent({ type: "assistant-text", text: turn.text, iteration });
        }

        if (turn.toolCalls.length === 0) {
          return { text: turn.text, messages: this.history };
        }

        const results = await Promise.all(
          turn.toolCalls.map(async (call) => {
            onEvent({ type: "tool-start", call, iteration });
            const executed = await this.executeCall(call);
            onEvent({
              type: "tool-result",
              call,
              result: executed.result,
              ok: executed.ok,
              iteration,
            });
            return executed.message;
          }),
        );
        this.messages.push(...results);
      }

      throw new Error(
        `Agent stopped after ${this.maxIterations} tool iterations without a final answer`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "error", message });
      throw error;
    }
  }

  private async executeCall(call: ToolCall): Promise<ExecutedTool> {
    try {
      const parsed = JSON.parse(call.arguments) as JsonValue;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Tool arguments must be a JSON object");
      }
      const input = removeNullValues(parsed);
      const result = await this.executeTool(call.name, input);
      return {
        ok: true,
        result,
        message: {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result),
        },
      };
    } catch (error) {
      const result: JsonObject = {
        error: error instanceof Error ? error.message : String(error),
        tool: call.name,
      };
      return {
        ok: false,
        result,
        message: {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result),
        },
      };
    }
  }
}

function removeNullValues(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, cleanValue(item)]),
  );
}

function cleanValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cleanValue);
  }
  if (value && typeof value === "object") {
    return removeNullValues(value);
  }
  return value;
}
