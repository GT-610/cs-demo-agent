import { describe, expect, test } from "bun:test";
import {
  createDemoToolExecutor,
  createHttpTransport,
  createHttpStreamTransport,
  loadDemoOverview,
  normalizeDemoPath,
  type InvokeFunction,
} from "./tauri";

describe("Tauri bridge", () => {
  test("injects the trusted demo path into path-only tools", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFunction = async (command, args) => {
      calls.push({ command, args });
      return { data: {}, meta: { truncated: false, sampled: false } } as never;
    };
    const execute = createDemoToolExecutor(" D:\\matches\\final.dem ", invoke);

    await execute("get_demo_header", { path: "C:\\untrusted.dem" });

    expect(calls).toEqual([
      {
        command: "get_demo_header",
        args: { path: "D:\\matches\\final.dem" },
      },
    ]);
  });

  test("wraps query tools and prevents model input from replacing the path", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFunction = async (command, args) => {
      calls.push({ command, args });
      return { data: [], meta: { truncated: false, sampled: false } } as never;
    };
    const execute = createDemoToolExecutor("D:\\matches\\final.dem", invoke);

    await execute("query_events", {
      path: "C:\\untrusted.dem",
      event_names: ["round_end"],
    });

    expect(calls[0]).toEqual({
      command: "query_events",
      args: {
        request: {
          path: "D:\\matches\\final.dem",
          event_names: ["round_end"],
        },
      },
    });
  });

  test("rejects unknown tools before invoking the host", async () => {
    let invoked = false;
    const invoke: InvokeFunction = async () => {
      invoked = true;
      return {} as never;
    };

    expect(
      createDemoToolExecutor("D:\\matches\\final.dem", invoke)(
        "read_arbitrary_file",
        {},
      ),
    ).rejects.toThrow("Unknown demo tool");
    expect(invoked).toBe(false);
  });

  test("routes provider JSON through the Rust HTTP command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: InvokeFunction = async (command, args) => {
      calls.push({ command, args });
      return { status: 200, body: { id: "response" } } as never;
    };
    const transport = createHttpTransport(invoke);
    const request = {
      url: "https://api.example.test/v1/responses",
      headers: { Authorization: "Bearer token" },
      body: { model: "example" },
      timeoutMs: 30_000,
    };

    await transport(request);

    expect(calls).toEqual([
      { command: "send_http_json", args: { request } },
    ]);
  });

  test("routes streaming provider events through a Tauri channel", async () => {
    const calls: string[] = [];
    const invoke: InvokeFunction = async (command, args) => {
      calls.push(command);
      const channel = args?.onEvent as {
        onmessage: (event: unknown) => void;
      };
      channel.onmessage({ type: "started", status: 200 });
      channel.onmessage({ type: "data", data: { delta: "hello" } });
      channel.onmessage({ type: "done" });
      return undefined as never;
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const transport = createHttpStreamTransport(invoke, () => channel as never);
    const data: unknown[] = [];

    const response = await transport(
      {
        url: "https://api.example.test/v1/responses",
        headers: {},
        body: { stream: true },
        timeoutMs: 30_000,
      },
      (event) => data.push(event),
    );

    expect(calls).toEqual(["stream_http_json"]);
    expect(response.status).toBe(200);
    expect(data).toEqual([{ delta: "hello" }]);
  });

  test("loads header and roster together", async () => {
    const commands: string[] = [];
    const invoke: InvokeFunction = async (command) => {
      commands.push(command);
      return {
        data: command === "get_demo_header" ? { map_name: "de_nuke" } : [],
        meta: { truncated: false, sampled: false },
      } as never;
    };

    const overview = await loadDemoOverview("D:\\matches\\final.dem", invoke);

    expect(commands.sort()).toEqual(["get_demo_header", "get_player_info"]);
    expect(overview.header.data).toEqual({ map_name: "de_nuke" });
  });

  test("requires a demo extension", () => {
    expect(() => normalizeDemoPath("notes.txt")).toThrow(".dem");
  });
});
