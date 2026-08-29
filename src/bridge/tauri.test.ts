import { describe, expect, test } from "bun:test";
import {
  createDemoToolExecutor,
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

  test("waits for trailing channel events after invoke resolves", async () => {
    const invoke: InvokeFunction = async (_command, args) => {
      const channel = args?.onEvent as { onmessage: (event: unknown) => void };
      channel.onmessage({ type: "started", status: 200 });
      setTimeout(() => {
        channel.onmessage({ type: "data", data: { delta: "tail" } });
        channel.onmessage({ type: "done" });
      }, 0);
      return undefined as never;
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const data: unknown[] = [];

    const response = await createHttpStreamTransport(invoke, () => channel as never)(
      {
        url: "https://api.example.test/v1/responses",
        headers: {},
        body: { stream: true },
        timeoutMs: 30_000,
      },
      (event) => data.push(event),
    );

    expect(response.status).toBe(200);
    expect(data).toEqual([{ delta: "tail" }]);
  });

  test("includes the observed status when completion is unsuccessful", async () => {
    const invoke: InvokeFunction = async (_command, args) => {
      const channel = args?.onEvent as { onmessage: (event: unknown) => void };
      channel.onmessage({ type: "started", status: 503 });
      channel.onmessage({ type: "done" });
      return undefined as never;
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const transport = createHttpStreamTransport(invoke, () => channel as never);

    await expect(
      transport(
        {
          url: "https://api.example.test/v1/responses",
          headers: {},
          body: { stream: true },
          timeoutMs: 30_000,
        },
        () => undefined,
      ),
    ).rejects.toThrow("status 503");
  });

  test("preserves handler errors after the done event", async () => {
    const invoke: InvokeFunction = async (_command, args) => {
      const channel = args?.onEvent as { onmessage: (event: unknown) => void };
      channel.onmessage({ type: "started", status: 200 });
      setTimeout(() => {
        channel.onmessage({ type: "data", data: { delta: "tail" } });
        channel.onmessage({ type: "done" });
      }, 0);
      return undefined as never;
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const transport = createHttpStreamTransport(invoke, () => channel as never);

    await expect(
      transport(
        {
          url: "https://api.example.test/v1/responses",
          headers: {},
          body: { stream: true },
          timeoutMs: 30_000,
        },
        () => {
          throw new Error("handler failed");
        },
      ),
    ).rejects.toThrow("handler failed");
  });

  test("preserves provider response details from the host", async () => {
    const invoke: InvokeFunction = async () => {
      throw new Error("provider request error: HTTP 401: invalid API key");
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const transport = createHttpStreamTransport(invoke, () => channel as never);

    await expect(
      transport(
        {
          url: "https://api.example.test/v1/responses",
          headers: {},
          body: { stream: true },
          timeoutMs: 30_000,
        },
        () => undefined,
      ),
    ).rejects.toThrow("HTTP 401: invalid API key");
  });

  test("cancels an active provider stream through the host", async () => {
    const calls: Array<{ command: string; requestId?: unknown }> = [];
    let rejectStream!: (error: Error) => void;
    const invoke: InvokeFunction = (command, args) => {
      calls.push({ command, requestId: args?.requestId });
      if (command === "cancel_http_stream") {
        rejectStream(new Error("provider request error: request stopped"));
        return Promise.resolve(undefined as never);
      }
      return new Promise((_resolve, reject) => {
        rejectStream = reject;
      });
    };
    const channel = { onmessage: (_event: unknown) => undefined };
    const controller = new AbortController();
    const transport = createHttpStreamTransport(invoke, () => channel as never);

    const request = transport(
      {
        url: "https://api.example.test/v1/responses",
        headers: {},
        body: { stream: true },
        timeoutMs: 30_000,
      },
      () => undefined,
      controller.signal,
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.map((call) => call.command)).toEqual([
      "stream_http_json",
      "cancel_http_stream",
    ]);
    expect(calls[0]?.requestId).toBe(calls[1]?.requestId);
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
