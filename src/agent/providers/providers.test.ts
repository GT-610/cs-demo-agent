import { describe, expect, test } from "bun:test";
import type {
  AgentMessage,
  HttpJsonRequest,
  HttpJsonResponse,
  HttpTransport,
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
  kind: "openai-chat",
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  model: "test-model",
};

const initialMessages: AgentMessage[] = [
  { role: "system", content: "Use tools." },
  { role: "user", content: "What map is this?" },
];

function queuedTransport(
  responses: HttpJsonResponse[],
  requests: HttpJsonRequest[],
): HttpTransport {
  return async (request) => {
    requests.push(request);
    const response = responses.shift();
    if (!response) {
      throw new Error("No queued provider response");
    }
    return response;
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
  if (schema.items) {
    validateStrictObjectSchemas(schema.items);
  }
}

test("all demo tool schemas satisfy OpenAI strict mode object rules", () => {
  DEMO_TOOL_SPECS.forEach((tool) => validateStrictObjectSchemas(tool.inputSchema));
});

describe("OpenAiChatAdapter", () => {
  test("serializes strict tools and parses function calls", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new OpenAiChatAdapter(
      queuedTransport(
        [
          {
            status: 200,
            body: {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "call-header",
                        function: {
                          name: "get_demo_header",
                          arguments: "{}",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        requests,
      ),
    );

    const turn = await adapter.generate({
      config: openAiConfig,
      messages: initialMessages,
      tools: DEMO_TOOL_SPECS,
    });

    expect(turn.toolCalls).toEqual([
      { id: "call-header", name: "get_demo_header", arguments: "{}" },
    ]);
    expect(requests[0]?.url).toBe(
      "https://api.example.test/v1/chat/completions",
    );
    expect(requests[0]?.headers.Authorization).toBe("Bearer secret");
    const body = requests[0]?.body as JsonObject;
    const tools = body.tools as JsonObject[];
    const firstFunction = tools[0]?.function as JsonObject;
    expect(firstFunction.strict).toBe(true);
  });
});

describe("OpenAiResponsesAdapter", () => {
  test("replays complete output items without server-side response state", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new OpenAiResponsesAdapter(
      queuedTransport(
        [
          {
            status: 200,
            body: {
              output: [
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
              ],
            },
          },
          {
            status: 200,
            body: {
              output: [
                {
                  type: "function_call",
                  call_id: "call-2",
                  name: "get_player_info",
                  arguments: "{}",
                  phase: "commentary",
                },
              ],
            },
          },
          {
            status: 200,
            body: {
              output: [
                {
                  type: "message",
                  phase: "final_answer",
                  content: [{ type: "output_text", text: "Map: de_nuke" }],
                },
              ],
            },
          },
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
      {
        role: "assistant",
        content: "",
        toolCalls: first.toolCalls,
      },
      {
        role: "tool",
        toolCallId: "call-1",
        name: "get_demo_header",
        content: '{"data":{"map_name":"de_nuke"}}',
      },
    ];

    const second = await adapter.generate({
      config,
      messages: continuedMessages,
      tools: DEMO_TOOL_SPECS,
      continuation: first.continuation,
    });
    const finalMessages: AgentMessage[] = [
      ...continuedMessages,
      {
        role: "assistant",
        content: "",
        toolCalls: second.toolCalls,
      },
      {
        role: "tool",
        toolCallId: "call-2",
        name: "get_player_info",
        content: '{"data":[{"name":"Player"}]}',
      },
    ];
    const third = await adapter.generate({
      config,
      messages: finalMessages,
      tools: DEMO_TOOL_SPECS,
      continuation: second.continuation,
    });

    expect(third.text).toBe("Map: de_nuke");
    const firstBody = requests[0]?.body as JsonObject;
    expect(firstBody.store).toBe(false);
    expect(firstBody.previous_response_id).toBeUndefined();
    const secondBody = requests[1]?.body as JsonObject;
    expect(secondBody.input).toEqual([
      { role: "user", content: "What map is this?" },
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
      {
        type: "function_call_output",
        call_id: "call-1",
        output: '{"data":{"map_name":"de_nuke"}}',
      },
    ]);
    const thirdBody = requests[2]?.body as JsonObject;
    expect(thirdBody.input).toEqual([
      ...(secondBody.input as JsonValue[]),
      {
        type: "function_call",
        call_id: "call-2",
        name: "get_player_info",
        arguments: "{}",
        phase: "commentary",
      },
      {
        type: "function_call_output",
        call_id: "call-2",
        output: '{"data":[{"name":"Player"}]}',
      },
    ]);
  });
});

describe("AnthropicAdapter", () => {
  test("maps tool use and grouped tool results", async () => {
    const requests: HttpJsonRequest[] = [];
    const adapter = new AnthropicAdapter(
      queuedTransport(
        [
          {
            status: 200,
            body: {
              content: [
                { type: "text", text: "Checking the demo." },
                {
                  type: "tool_use",
                  id: "toolu-1",
                  name: "get_player_info",
                  input: {},
                },
              ],
            },
          },
        ],
        requests,
      ),
    );
    const config: ProviderConfig = {
      kind: "anthropic",
      baseUrl: "https://anthropic.example.test",
      apiKey: "anthropic-secret",
      model: "claude-test",
    };

    const turn = await adapter.generate({
      config,
      messages: initialMessages,
      tools: DEMO_TOOL_SPECS,
    });

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
  });
});
