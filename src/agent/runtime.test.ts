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

  constructor(private readonly turns: ProviderTurn[]) {}

  async generate(request: ProviderRequest): Promise<ProviderTurn> {
    this.requests.push(request);
    const turn = this.turns.shift();
    if (!turn) {
      throw new Error("No provider turn queued");
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
        raw: {},
      },
      {
        text: "地图是 de_ancient。",
        toolCalls: [],
        raw: {},
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
        raw: {},
      },
      {
        text: "工具参数无效，无法查询。",
        toolCalls: [],
        raw: {},
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
      raw: {},
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

    expect(runtime.send("loop")).rejects.toThrow("2 tool iterations");
  });
});
