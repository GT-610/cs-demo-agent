import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { createAbortError, raceWithAbort, throwIfAborted } from "../agent/cancellation";
import type {
  HttpStreamEvent,
  HttpStreamTransport,
  JsonObject,
  JsonValue,
  ToolExecutor,
} from "../agent/types";

export interface QueryMeta {
  row_count?: number | null;
  original_row_count?: number | null;
  truncated: boolean;
  sampled: boolean;
}

export interface DemoToolResult {
  data: JsonValue;
  meta: QueryMeta;
}

export type InvokeFunction = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type DemoDropHandler = (path: string) => void;

const PATH_ONLY_TOOLS = new Set([
  "get_demo_header",
  "get_player_info",
  "list_game_events",
  "get_round_summary",
  "get_economy_analysis",
]);

const REQUEST_TOOLS = new Set([
  "query_events",
  "query_ticks",
  "query_grenades",
]);

interface StreamChannel {
  onmessage: (event: HttpStreamEvent) => void;
}

export function createHttpStreamTransport(
  invokeCommand: InvokeFunction = invoke,
  createChannel: () => StreamChannel = () => new Channel<HttpStreamEvent>(),
): HttpStreamTransport {
  return async (request, onData, signal) => {
    throwIfAborted(signal);
    const requestId = createRequestId();
    let status = 0;
    let done = false;
    let handlerError: unknown;
    let resolveDone: (() => void) | undefined;
    const doneEvent = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const onEvent = createChannel();
    onEvent.onmessage = (event) => {
      try {
        if (signal?.aborted) return;
        if (event.type === "started") status = event.status;
        if (event.type === "data") onData(event.data);
        if (event.type === "done") {
          done = true;
          resolveDone?.();
        }
      } catch (error) {
        handlerError ??= error;
      }
    };
    const abort = () => {
      void invokeCommand<void>("cancel_http_stream", { requestId }).catch(
        () => undefined,
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await invokeCommand<void>("stream_http_json", {
        requestId,
        request,
        onEvent,
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    throwIfAborted(signal);
    if (!done) await waitForStreamCompletion(doneEvent, () => status);
    if (handlerError) throw handlerError;
    if (!done || status < 200 || status >= 300) {
      throw new Error(
        `Provider stream ended without a successful completion (status ${status})`,
      );
    }
    return { status };
  };
}

async function waitForStreamCompletion(
  doneEvent: Promise<void>,
  getStatus: () => number,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Provider stream completion event timed out (status ${getStatus()})`));
    }, 5_000);
  });
  try {
    await Promise.race([doneEvent, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function createDemoToolExecutor(
  demoPath: string,
  invokeCommand: InvokeFunction = invoke,
): ToolExecutor {
  const validatedPath = normalizeDemoPath(demoPath);

  return async (
    name: string,
    input: JsonObject,
    signal?: AbortSignal,
  ): Promise<JsonValue> => {
    throwIfAborted(signal);
    if (PATH_ONLY_TOOLS.has(name)) {
      const result = await raceWithAbort(
        invokeCommand<DemoToolResult>(name, { path: validatedPath }),
        signal,
      );
      return result as unknown as JsonValue;
    }
    if (REQUEST_TOOLS.has(name)) {
      const result = await raceWithAbort(
        invokeCommand<DemoToolResult>(name, {
          request: { ...input, path: validatedPath },
        }),
        signal,
      );
      return result as unknown as JsonValue;
    }
    throw new Error(`Unknown demo tool: ${name}`);
  };
}

export async function loadDemoOverview(
  demoPath: string,
  invokeCommand: InvokeFunction = invoke,
): Promise<{ header: DemoToolResult; players: DemoToolResult }> {
  const path = normalizeDemoPath(demoPath);
  const [header, players] = await Promise.all([
    invokeCommand<DemoToolResult>("get_demo_header", { path }),
    invokeCommand<DemoToolResult>("get_player_info", { path }),
  ]);
  return { header, players };
}

export async function selectDemoFile(
  title = "Select a Counter-Strike demo",
): Promise<string | null> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: "Counter-Strike Demo", extensions: ["dem"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function listenForDemoDrops(
  handler: DemoDropHandler,
): Promise<() => void> {
  return getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") {
      return;
    }
    const path = event.payload.paths.find((candidate) =>
      candidate.toLowerCase().endsWith(".dem"),
    );
    if (path) {
      handler(path);
    }
  });
}

export function normalizeDemoPath(path: string): string {
  const normalized = path.trim();
  if (!normalized.toLowerCase().endsWith(".dem")) {
    throw new Error("Select a .dem Counter-Strike demo file");
  }
  return normalized;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `http-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
