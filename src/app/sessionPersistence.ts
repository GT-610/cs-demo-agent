import type { JsonObject, JsonValue, ToolCall } from "../agent/types";
import type { PersistedMessage } from "../bridge/persistence";
import type { TimelineEntry } from "./types";

export function serializeTimeline(entries: readonly TimelineEntry[]): PersistedMessage[] {
  return entries.map((entry) => {
    if (entry.kind === "user") {
      return { id: entry.id, kind: "user", content: entry.content };
    }
    if (entry.kind === "assistant") {
      return {
        id: entry.id,
        kind: "assistant",
        content: entry.content,
        metadata: {
          iteration: entry.iteration,
          status: entry.status === "streaming" ? "complete" : entry.status,
          phase: entry.phase,
        },
      };
    }
    const metadata: JsonObject = {
      call: {
        id: entry.call.id,
        name: entry.call.name,
        arguments: entry.call.arguments,
      },
      iteration: entry.iteration,
      status: entry.status === "running" ? "error" : entry.status,
    };
    if (entry.result !== undefined) metadata.result = entry.result;
    return {
      id: entry.id,
      kind: "tool",
      content: entry.call.name,
      metadata,
    };
  });
}

export function deserializeTimeline(messages: readonly PersistedMessage[]): TimelineEntry[] {
  const legacyAssistantIds = new Set<string>();
  const entries = messages.flatMap((message): TimelineEntry[] => {
    if (message.kind === "user") {
      return [{ id: message.id, kind: "user", content: message.content }];
    }
    if (message.kind === "assistant") {
      const metadata = asObject(message.metadata);
      const persistedPhase = metadata?.phase;
      const hasPersistedPhase =
        persistedPhase === "reasoning" || persistedPhase === "answer";
      if (!hasPersistedPhase) legacyAssistantIds.add(message.id);
      return [
        {
          id: message.id,
          kind: "assistant",
          content: message.content,
          iteration: readPositiveInteger(metadata?.iteration) ?? 1,
          status: "complete",
          phase: persistedPhase === "reasoning" ? "reasoning" : "answer",
        },
      ];
    }
    const metadata = asObject(message.metadata);
    const call = readToolCall(metadata?.call);
    if (!call) return [];
    const status = metadata?.status === "error" ? "error" : "success";
    return [
      {
        id: message.id,
        kind: "tool",
        call,
        iteration: readPositiveInteger(metadata?.iteration) ?? 1,
        status,
        ...(metadata && "result" in metadata ? { result: metadata.result } : {}),
      },
    ];
  });
  return entries.map((entry, index) => {
    if (
      entry.kind !== "assistant" ||
      !legacyAssistantIds.has(entry.id) ||
      !hasToolInSameUserTurn(entries, index, entry.iteration)
    ) {
      return entry;
    }
    return { ...entry, phase: "reasoning" };
  });
}

function hasToolInSameUserTurn(
  entries: readonly TimelineEntry[],
  startIndex: number,
  iteration: number,
): boolean {
  for (const candidate of entries.slice(startIndex + 1)) {
    if (candidate.kind === "user") return false;
    if (candidate.kind === "tool" && candidate.iteration === iteration) {
      return true;
    }
  }
  return false;
}

export function titleFromPrompt(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 56 ? `${compact.slice(0, 55).trimEnd()}…` : compact;
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}

function readToolCall(value: JsonValue | undefined): ToolCall | null {
  const call = asObject(value);
  return call &&
    typeof call.id === "string" &&
    typeof call.name === "string" &&
    typeof call.arguments === "string"
    ? { id: call.id, name: call.name, arguments: call.arguments }
    : null;
}

function readPositiveInteger(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
