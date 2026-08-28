import { describe, expect, test } from "bun:test";
import {
  changeProviderKind,
  createDefaultProvider,
  isProviderReady,
  sessionKey,
} from "./state";

describe("application state helpers", () => {
  test("uses provider-specific endpoint defaults", () => {
    expect(createDefaultProvider("openai-responses").baseUrl).toBe(
      "https://api.openai.com/v1",
    );
    expect(createDefaultProvider("anthropic").baseUrl).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  test("changes a known default but preserves a custom base URL", () => {
    const openAi = createDefaultProvider("openai-chat");
    expect(changeProviderKind(openAi, "anthropic").baseUrl).toBe(
      "https://api.anthropic.com/v1",
    );

    const custom = { ...openAi, baseUrl: "http://127.0.0.1:11434/v1" };
    expect(changeProviderKind(custom, "anthropic").baseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  test("requires a valid base URL and model", () => {
    const config = createDefaultProvider("openai-responses");
    expect(isProviderReady(config)).toBe(false);
    expect(isProviderReady({ ...config, model: "gpt-test" })).toBe(true);
    expect(
      isProviderReady({ ...config, model: "gpt-test", baseUrl: "file:///tmp" }),
    ).toBe(false);
  });

  test("session identity changes with credentials without exposing storage", () => {
    const config = {
      ...createDefaultProvider("openai-responses"),
      model: "gpt-test",
    };
    expect(sessionKey("match.dem", config)).not.toBe(
      sessionKey("match.dem", { ...config, apiKey: "new-key" }),
    );
  });
});
