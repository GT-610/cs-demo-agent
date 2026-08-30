import type {
  AgentEventHandler,
  AgentMessage,
  AgentRuntimeState,
  AssistantMessage,
  JsonObject,
  JsonValue,
  ProviderAdapter,
  ProviderConfig,
  ProviderContinuation,
  StoredProviderContinuation,
  ToolCall,
  ToolExecutor,
  ToolMessage,
  ToolSpec,
} from "./types";
import { isAbortError, throwIfAborted } from "./cancellation";

export interface AgentRuntimeOptions {
  adapter: ProviderAdapter;
  config: ProviderConfig;
  tools: ToolSpec[];
  executeTool: ToolExecutor;
  systemPrompt: string;
  maxIterations?: number;
  initialState?: AgentRuntimeState;
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

export const MAX_MODEL_TOOL_RESULT_CHARS = 32_000;

export class AgentRuntime {
  private readonly adapter: ProviderAdapter;
  private readonly config: ProviderConfig;
  private readonly tools: ToolSpec[];
  private readonly executeTool: ToolExecutor;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private messages: AgentMessage[];
  private continuation?: ProviderContinuation;
  private inFlight = false;

  constructor(options: AgentRuntimeOptions) {
    this.adapter = options.adapter;
    this.config = options.config;
    this.tools = options.tools;
    this.executeTool = options.executeTool;
    this.systemPrompt = options.systemPrompt;
    this.maxIterations = options.maxIterations ?? 8;
    this.messages = restoreMessages(options.initialState, this.systemPrompt);
    // Native provider continuations are useful only while a live tool loop is
    // running. Replaying a persisted continuation can duplicate an entire
    // historical trace and may no longer match the compact canonical history.
    this.continuation = undefined;
  }

  get history(): readonly AgentMessage[] {
    return cloneMessages(this.messages);
  }

  get state(): AgentRuntimeState {
    return {
      messages: cloneMessages(this.messages),
      continuation: storeContinuation(this.continuation, this.config),
    };
  }

  reset(): void {
    if (this.inFlight) {
      throw new Error("Cannot reset the agent while a request is in progress");
    }
    this.messages = [{ role: "system", content: this.systemPrompt }];
    this.continuation = undefined;
  }

  async send(
    userText: string,
    onEvent: AgentEventHandler = () => undefined,
    signal?: AbortSignal,
  ): Promise<AgentReply> {
    if (this.inFlight) {
      throw new Error("An agent request is already in progress");
    }

    const text = userText.trim();
    if (!text) {
      throw new Error("A user message is required");
    }

    const messageCount = this.messages.length;
    const previousContinuation = this.continuation;
    let partialText = "";
    this.inFlight = true;

    try {
      throwIfAborted(signal);
      this.messages.push({ role: "user", content: text });
      for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
        throwIfAborted(signal);
        onEvent({ type: "assistant-start", iteration });
        partialText = "";
        const turn = await this.adapter.generate(
          {
            config: this.config,
            messages: cloneMessages(this.messages),
            tools: this.tools,
            continuation: cloneContinuation(this.continuation),
            signal,
          },
          (delta) => {
            throwIfAborted(signal);
            partialText += delta;
            onEvent({ type: "assistant-delta", delta, iteration });
          },
        );
        throwIfAborted(signal);
        this.continuation = turn.continuation;

        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content: turn.text,
          toolCalls: turn.toolCalls,
        };
        this.messages.push(assistantMessage);
        partialText = "";
        onEvent({
          type: "assistant-end",
          text: turn.text,
          iteration,
          hasToolCalls: turn.toolCalls.length > 0,
        });

        if (turn.toolCalls.length === 0) {
          this.messages = compactCompletedHistory(this.messages);
          this.continuation = undefined;
          return { text: turn.text, messages: cloneMessages(this.messages) };
        }

        const results = await Promise.all(
          turn.toolCalls.map(async (call) => {
            onEvent({ type: "tool-start", call, iteration });
            const executed = await this.executeCall(call, signal);
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
      const aborted = signal?.aborted || isAbortError(error);
      if (aborted) {
        const lastMessage = this.messages.at(-1);
        if (lastMessage?.role === "assistant" && lastMessage.toolCalls.length > 0) {
          this.messages.push(
            ...lastMessage.toolCalls.map((call): ToolMessage => ({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify({
                error: "Tool execution was stopped",
                tool: call.name,
              }),
            })),
          );
        }
        if (partialText) {
          this.messages.push({
            role: "assistant",
            content: partialText,
            toolCalls: [],
          });
        }
      } else {
        this.messages.length = messageCount;
        this.continuation = previousContinuation;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!aborted) {
        try {
          onEvent({ type: "error", message });
        } catch {
          // Preserve the error that caused the turn to roll back.
        }
      }
      throw error;
    } finally {
      this.inFlight = false;
    }
  }

  private async executeCall(
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<ExecutedTool> {
    try {
      throwIfAborted(signal);
      const parsed = JSON.parse(call.arguments) as JsonValue;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Tool arguments must be a JSON object");
      }
      const input = removeNullValues(parsed);
      const result = await this.executeTool(call.name, input, signal);
      return {
        ok: true,
        result,
        message: {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: serializeToolResultForModel(result),
        },
      };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
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

function restoreMessages(
  state: AgentRuntimeState | undefined,
  systemPrompt: string,
): AgentMessage[] {
  const restored = state?.messages?.filter((message) => message.role !== "system") ?? [];
  return compactCompletedHistory([
    { role: "system", content: systemPrompt },
    ...cloneMessages(restored),
  ]);
}

function compactCompletedHistory(messages: readonly AgentMessage[]): AgentMessage[] {
  return cloneMessages(
    messages.filter(
      (message) =>
        message.role !== "tool" &&
        !(message.role === "assistant" && message.toolCalls.length > 0),
    ),
  );
}

function cloneMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return { ...message };
    return {
      ...message,
      toolCalls: message.toolCalls.map((call) => ({ ...call })),
    };
  });
}

function cloneContinuation(
  continuation: ProviderContinuation | undefined,
): ProviderContinuation | undefined {
  if (!continuation) return undefined;
  return {
    ...continuation,
    inputItems: structuredClone(continuation.inputItems),
  };
}

function storeContinuation(
  continuation: ProviderContinuation | undefined,
  config: ProviderConfig,
): StoredProviderContinuation | undefined {
  const value = cloneContinuation(continuation);
  if (!value) return undefined;
  return {
    providerId: config.providerId,
    providerKind: config.kind,
    baseUrl: config.baseUrl,
    model: config.model,
    value,
  };
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

function serializeToolResultForModel(result: JsonValue): string {
  const serialized = JSON.stringify(result);
  if (serialized.length <= MAX_MODEL_TOOL_RESULT_CHARS) return serialized;

  const object = asJsonObject(result);
  const data = object ? object.data : undefined;
  if (object && Array.isArray(data)) {
    const meta = asJsonObject(object.meta) ?? {};
    const originalRowCount =
      typeof meta.original_row_count === "number"
        ? meta.original_row_count
        : data.length;
    let low = 0;
    let high = data.length;
    let best = boundedToolResult([], meta, originalRowCount);

    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = boundedToolResult(
        equidistantSample(data, count),
        meta,
        originalRowCount,
      );
      if (candidate.length <= MAX_MODEL_TOOL_RESULT_CHARS) {
        best = candidate;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (best.length <= MAX_MODEL_TOOL_RESULT_CHARS) return best;
  }

  return JSON.stringify({
    data: null,
    meta: {
      truncated: true,
      sampled: false,
      model_context_limited: true,
    },
    model_context_note:
      "The tool result exceeded the model context budget. Retry with narrower filters.",
  });
}

function boundedToolResult(
  data: JsonValue[],
  meta: JsonObject,
  originalRowCount: number,
): string {
  return JSON.stringify({
    data,
    meta: {
      ...meta,
      row_count: data.length,
      original_row_count: originalRowCount,
      truncated: true,
      sampled: true,
      model_context_limited: true,
    },
  });
}

function equidistantSample(values: JsonValue[], limit: number): JsonValue[] {
  if (limit <= 0 || values.length === 0) return [];
  if (limit >= values.length) return [...values];
  if (limit === 1) return [values[0]!];
  const last = values.length - 1;
  return Array.from(
    { length: limit },
    (_, index) => values[Math.floor(index * last / (limit - 1))]!,
  );
}

function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}
