import { describe, expect, test } from "bun:test";
import { AgentRuntime } from "./runtime";
import type {
  AgentEvent,
  JsonObject,
  ProviderAdapter,
  ProviderRequest,
  ProviderTurn,
} from "./types";

class SequenceAdapter implements ProviderAdapter {
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly turns: Array<ProviderTurn | Error>) {}

  async generate(request: ProviderRequest): Promise<ProviderTurn> {
    this.requests.push(request);
    const turn = this.turns.shift();
    if (!turn) {
      throw new Error("No provider turn queued");
    }
    if (turn instanceof Error) {
      throw turn;
    }
    return turn;
  }
}

const config = {
  kind: "openai-chat" as const,
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
};

describe("AgentRuntime", () => {
  test("executes tool calls and returns the evidence-backed final answer", async () => {
    const adapter = new SequenceAdapter([
      {
        text: "",
        toolCalls: [
          {
            id: "call-1",
            name: "get_demo_header",
            arguments: "{}",
          },
        ],
      },
      {
        text: "地图是 de_ancient。",
        toolCalls: [],
      },
    ]);
    const calls: Array<{ name: string; input: JsonObject }> = [];
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async (name, input) => {
        calls.push({ name, input });
        return { data: { map_name: "de_ancient" }, meta: {} };
      },
    });

    const reply = await runtime.send("这是什么地图？", (event) =>
      events.push(event),
    );

    expect(reply.text).toBe("地图是 de_ancient。");
    expect(calls).toEqual([{ name: "get_demo_header", input: {} }]);
    expect(
      adapter.requests[1]?.messages.some(
        (message) => message.role === "tool" && message.name === "get_demo_header",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "tool-result")).toBe(true);
  });

  test("returns malformed tool arguments to the model as structured evidence", async () => {
    const adapter = new SequenceAdapter([
      {
        text: "",
        toolCalls: [
          {
            id: "bad-call",
            name: "query_events",
            arguments: "not-json",
          },
        ],
      },
      {
        text: "工具参数无效，无法查询。",
        toolCalls: [],
      },
    ]);
    let executed = false;
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async () => {
        executed = true;
        return {};
      },
    });

    await runtime.send("查询击杀");

    expect(executed).toBe(false);
    const toolMessage = adapter.requests[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("JSON Parse error");
    expect(toolMessage?.content).toContain('"tool":"query_events"');
  });

  test("stops a provider that never produces a final answer", async () => {
    const turn: ProviderTurn = {
      text: "",
      toolCalls: [
        { id: "loop", name: "get_demo_header", arguments: "{}" },
      ],
    };
    const adapter = new SequenceAdapter([turn, turn]);
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      maxIterations: 2,
      executeTool: async () => ({ data: {}, meta: {} }),
    });

    await expect(runtime.send("loop")).rejects.toThrow("2 tool iterations");
    expect(runtime.history).toEqual([
      { role: "system", content: "Use evidence." },
    ]);
  });

  test("rejects concurrent sends and protects an in-flight reset", async () => {
    let finish!: (turn: ProviderTurn) => void;
    const adapter: ProviderAdapter = {
      generate: () =>
        new Promise<ProviderTurn>((resolve) => {
          finish = resolve;
        }),
    };
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async () => ({}),
    });

    const first = runtime.send("first");
    await expect(runtime.send("second")).rejects.toThrow(
      "already in progress",
    );
    expect(() => runtime.reset()).toThrow("while a request is in progress");
    finish({ text: "done", toolCalls: [] });
    await expect(first).resolves.toMatchObject({ text: "done" });
  });

  test("rolls back messages and continuation after a later provider failure", async () => {
    const firstContinuation = {
      provider: "openai-responses" as const,
      inputItems: [{ role: "user", content: "first" }],
      acknowledgedMessages: 2,
    };
    const transientContinuation = {
      provider: "openai-responses" as const,
      inputItems: [{ role: "user", content: "second" }],
      acknowledgedMessages: 4,
    };
    const adapter = new SequenceAdapter([
      { text: "first answer", toolCalls: [], continuation: firstContinuation },
      {
        text: "",
        toolCalls: [{ id: "call", name: "get_demo_header", arguments: "{}" }],
        continuation: transientContinuation,
      },
      new Error("provider unavailable"),
      { text: "recovered", toolCalls: [] },
    ]);
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async () => ({ data: {}, meta: {} }),
    });

    await runtime.send("first");
    const stableHistory = runtime.history;
    await expect(runtime.send("second")).rejects.toThrow("provider unavailable");
    expect(runtime.history).toEqual(stableHistory);

    await runtime.send("third");
    expect(adapter.requests[3]?.continuation).toEqual(firstContinuation);
  });

  test("returns history and reply message snapshots", async () => {
    const adapter = new SequenceAdapter([
      { text: "one", toolCalls: [] },
      { text: "two", toolCalls: [] },
    ]);
    const runtime = new AgentRuntime({
      adapter,
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async () => ({}),
    });

    const reply = await runtime.send("first");
    const history = runtime.history;
    await runtime.send("second");

    expect(reply.messages).toHaveLength(3);
    expect(history).toHaveLength(3);
    expect(runtime.history).toHaveLength(5);
  });

  test("rolls back when an event callback throws", async () => {
    const runtime = new AgentRuntime({
      adapter: new SequenceAdapter([{ text: "answer", toolCalls: [] }]),
      config,
      tools: [],
      systemPrompt: "Use evidence.",
      executeTool: async () => ({}),
    });

    await expect(
      runtime.send("question", () => {
        throw new Error("event callback failed");
      }),
    ).rejects.toThrow("event callback failed");
    expect(runtime.history).toHaveLength(1);
  });
});
