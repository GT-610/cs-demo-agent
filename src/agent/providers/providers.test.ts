import { describe, expect, test } from "bun:test";
import type {
  AgentMessage,
  HttpJsonRequest,
  HttpStreamTransport,
  JsonObject,
  JsonSchema,
  JsonValue,
  ProviderConfig,
} from "../types";
import { DEMO_TOOL_SPECS } from "../tools";
import { AnthropicAdapter } from "./anthropic";
import { OpenAiChatAdapter } from "./openaiChat";
import { OpenAiResponsesAdapter } from "./openaiResponses";

const openAiConfig: ProviderConfig = {
  providerId: "provider-openai",
  kind: "openai-chat",
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
};

const initialMessages: AgentMessage[] = [
  { role: "system", content: "Use tools." },
  { role: "user", content: "What map is this?" },
];

function queuedStreamTransport(
  eventQueues: JsonValue[][],
  requests: HttpJsonRequest[],
): HttpStreamTransport {
  return async (request, onData) => {
    requests.push(request);
    const events = eventQueues.shift();
    if (!events) throw new Error("No queued provider stream");
    events.forEach(onData);
    return { status: 200 };
  };
}

function validateStrictObjectSchemas(schema: JsonSchema): void {
  if (schema.type === "object") {
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(
      new Set(Object.keys(schema.properties ?? {})),
    );
  }
  Object.values(schema.properties ?? {}).forEach(validateStrictObjectSchemas);
  schema.anyOf?.forEach(validateStrictObjectSchemas);
  if (schema.items) validateStrictObjectSchemas(schema.items);
}

test("all demo tool schemas satisfy OpenAI strict mode object rules", () => {
  DEMO_TOOL_SPECS.forEach((tool) => validateStrictObjectSchemas(tool.inputSchema));
});

describe("OpenAiChatAdapter", () => {
  test("streams text and assembles fragmented function calls", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new OpenAiChatAdapter(
      queuedStreamTransport(
        [
          [
            { choices: [{ delta: { content: "Checking " } }] },
            { choices: [{ delta: { content: "the demo." } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-header",
                        function: {
                          name: "get_demo_header",
                          arguments: "{",
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { arguments: "}" } },
                    ],
                  },
                },
              ],
            },
          ],
        ],
        requests,
      ),
    );
    const deltas: string[] = [];
    const turn = await adapter.generate(
      {
        config: openAiConfig,
        messages: initialMessages,
        tools: DEMO_TOOL_SPECS,
      },
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(["Checking ", "the demo."]);
    expect(turn.text).toBe("Checking the demo.");
    expect(turn.toolCalls).toEqual([
      { id: "call-header", name: "get_demo_header", arguments: "{}" },
    ]);
    expect(requests[0]?.url).toBe(
      "https://api.example.test/v1/chat/completions",
    );
    expect(requests[0]?.headers.Authorization).toBe("Bearer secret");
    const body = requests[0]?.body as JsonObject;
    expect(body.stream).toBe(true);
    const tools = body.tools as JsonObject[];
    const firstFunction = tools[0]?.function as JsonObject;
    expect(firstFunction.strict).toBe(true);
  });
});

describe("OpenAiResponsesAdapter", () => {
  test("streams text and replays complete output without server state", async () => {
    const requests: HttpJsonRequest[] = [];
    const firstOutput: JsonValue[] = [
      {
        type: "reasoning",
        id: "reasoning-1",
        encrypted_content: "encrypted-reasoning",
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "get_demo_header",
        arguments: "{}",
      },
    ];
    const secondOutput: JsonValue[] = [
      {
        type: "message",
        phase: "final_answer",
        content: [{ type: "output_text", text: "Map: de_nuke" }],
      },
    ];
    const adapter = new OpenAiResponsesAdapter(
      queuedStreamTransport(
        [
          [{ type: "response.completed", response: { output: firstOutput } }],
          [
            { type: "response.output_text.delta", delta: "Map: " },
            { type: "response.output_text.delta", delta: "de_nuke" },
            { type: "response.completed", response: { output: secondOutput } },
          ],
        ],
        requests,
      ),
    );
    const config = { ...openAiConfig, kind: "openai-responses" as const };
    const first = await adapter.generate({
      config,
      messages: initialMessages,
      tools: DEMO_TOOL_SPECS,
    });
    const continuedMessages: AgentMessage[] = [
      ...initialMessages,
      { role: "assistant", content: "", toolCalls: first.toolCalls },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "get_demo_header",
        content: '{"data":{"map_name":"de_nuke"}}',
      },
    ];
    const deltas: string[] = [];
    const second = await adapter.generate(
      {
        config,
        messages: continuedMessages,
        tools: DEMO_TOOL_SPECS,
        continuation: first.continuation,
      },
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(["Map: ", "de_nuke"]);
    expect(second.text).toBe("Map: de_nuke");
    const firstBody = requests[0]?.body as JsonObject;
    expect(firstBody.store).toBe(false);
    expect(firstBody.stream).toBe(true);
    expect(firstBody.previous_response_id).toBeUndefined();
    const secondBody = requests[1]?.body as JsonObject;
    expect(secondBody.input).toEqual([
      { role: "user", content: "What map is this?" },
      ...firstOutput,
      {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"data":{"map_name":"de_nuke"}}',
      },
    ]);
  });

  test("reconstructs function calls when persisted history has no continuation", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new OpenAiResponsesAdapter(
      queuedStreamTransport(
        [[{ type: "response.completed", response: { output: [] } }]],
        requests,
      ),
    );
    await adapter.generate({
      config: { ...openAiConfig, kind: "openai-responses" },
      messages: [
        ...initialMessages,
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call-1", name: "get_demo_header", arguments: "{}" },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-1",
          name: "get_demo_header",
          content: "{}",
        },
      ],
      tools: DEMO_TOOL_SPECS,
    });

    expect((requests[0]?.body as JsonObject).input).toEqual([
      { role: "user", content: "What map is this?" },
      {
        type: "function_call",
        call_id: "call-1",
        name: "get_demo_header",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call-1", output: "{}" },
    ]);
  });
});

describe("AnthropicAdapter", () => {
  test("streams text and fragmented tool JSON", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new AnthropicAdapter(
      queuedStreamTransport(
        [
          [
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Checking the demo." },
            },
            {
              type: "content_block_start",
              index: 1,
              content_block: {
                type: "tool_use",
                id: "toolu-1",
                name: "get_player_info",
                input: {},
              },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: "{" },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: "}" },
            },
          ],
        ],
        requests,
      ),
    );
    const config: ProviderConfig = {
      providerId: "provider-anthropic",
      kind: "anthropic",
      baseUrl: "https://anthropic.example.test",
      apiKey: "anthropic-secret",
      model: "claude-test",
    };
    const deltas: string[] = [];
    const turn = await adapter.generate(
      { config, messages: initialMessages, tools: DEMO_TOOL_SPECS },
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(["Checking the demo."]);
    expect(turn.text).toBe("Checking the demo.");
    expect(turn.toolCalls[0]).toEqual({
      id: "toolu-1",
      name: "get_player_info",
      arguments: "{}",
    });
    expect(requests[0]?.url).toBe(
      "https://anthropic.example.test/v1/messages",
    );
    expect(requests[0]?.headers["x-api-key"]).toBe("anthropic-secret");
    expect((requests[0]?.body as JsonObject).stream).toBe(true);
  });
});
