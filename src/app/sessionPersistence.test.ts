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
        phase: "reasoning",
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
          phase: "reasoning",
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

  test("infers legacy reasoning only within the same user turn", () => {
    const restored = deserializeTimeline([
      { id: "u1", kind: "user", content: "Give me the score" },
      {
        id: "a1",
        kind: "assistant",
        content: "The score is 13–9.",
        metadata: { iteration: 1 },
      },
      { id: "u2", kind: "user", content: "Review the decisive rounds" },
      {
        id: "a2",
        kind: "assistant",
        content: "Checking the round summaries.",
        metadata: { iteration: 1 },
      },
      {
        id: "t2",
        kind: "tool",
        content: "get_round_summary",
        metadata: {
          iteration: 1,
          status: "success",
          call: { id: "call-2", name: "get_round_summary", arguments: "{}" },
        },
      },
      {
        id: "a3",
        kind: "assistant",
        content: "The score answer stays visible.",
        metadata: { iteration: 1, phase: "answer" },
      },
      {
        id: "t3",
        kind: "tool",
        content: "get_round_summary",
        metadata: {
          iteration: 1,
          status: "success",
          call: { id: "call-3", name: "get_round_summary", arguments: "{}" },
        },
      },
    ]);

    expect(restored[1]).toMatchObject({ kind: "assistant", phase: "answer" });
    expect(restored[3]).toMatchObject({ kind: "assistant", phase: "reasoning" });
    expect(restored[5]).toMatchObject({ kind: "assistant", phase: "answer" });
  });

  test("creates concise titles from the first prompt", () => {
    expect(titleFromPrompt("  Analyze   the pistol rounds  ")).toBe(
      "Analyze the pistol rounds",
    );
    expect(titleFromPrompt("x".repeat(70))).toHaveLength(56);
  });
});
