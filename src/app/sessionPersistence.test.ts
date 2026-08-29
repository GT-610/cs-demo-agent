import { describe, expect, test } from "bun:test";
import { deserializeTimeline, serializeTimeline, titleFromPrompt } from "./sessionPersistence";
import type { TimelineEntry } from "./types";

describe("session persistence helpers", () => {
  test("round trips chat and inline tool entries", () => {
    const entries: TimelineEntry[] = [
      { id: "u1", kind: "user", content: "Review the game" },
      {
        id: "a1",
        kind: "assistant",
        content: "Checking rounds.",
        iteration: 1,
        status: "complete",
      },
      {
        id: "t1",
        kind: "tool",
        call: { id: "call-1", name: "get_round_summary", arguments: "{}" },
        iteration: 1,
        status: "success",
        result: { data: [], meta: { sampled: false } },
      },
    ];
    expect(deserializeTimeline(serializeTimeline(entries))).toEqual(entries);
  });

  test("restores interrupted entries in a stable terminal state", () => {
    const restored = deserializeTimeline(
      serializeTimeline([
        {
          id: "a1",
          kind: "assistant",
          content: "Partial",
          iteration: 2,
          status: "streaming",
        },
        {
          id: "t1",
          kind: "tool",
          call: { id: "call", name: "query_events", arguments: "{}" },
          iteration: 2,
          status: "running",
        },
      ]),
    );
    expect(restored[0]).toMatchObject({ status: "complete" });
    expect(restored[1]).toMatchObject({ status: "error" });
  });

  test("creates concise titles from the first prompt", () => {
    expect(titleFromPrompt("  Analyze   the pistol rounds  ")).toBe(
      "Analyze the pistol rounds",
    );
    expect(titleFromPrompt("x".repeat(70))).toHaveLength(56);
  });
});
