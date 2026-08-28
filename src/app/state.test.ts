import { describe, expect, test } from "bun:test";
import {
  canSwitchModelFormat,
  createDefaultSettings,
  getDefaultModel,
  getProviderProfile,
  isProviderReady,
  normalizeSettings,
  parseModelList,
  updateProviderProfile,
} from "./state";

describe("application state helpers", () => {
  test("provides one persistent profile for every API format", () => {
    const settings = createDefaultSettings("en");
    expect(settings.providers.map((profile) => profile.kind)).toEqual([
      "openai-responses",
      "openai-chat",
      "anthropic",
    ]);
    expect(getProviderProfile(settings, "anthropic").baseUrl).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  test("fills missing profiles when loading a legacy settings record", () => {
    const settings = normalizeSettings(
      {
        locale: "zh-CN",
        defaultProviderKind: "anthropic",
        providers: [
          {
            kind: "anthropic",
            baseUrl: "https://example.test",
            apiKey: "key",
            models: ["claude-test"],
            maxOutputTokens: 2048,
          },
        ],
      },
      "en",
    );
    expect(settings.providers).toHaveLength(3);
    expect(getDefaultModel(settings)).toBe("claude-test");
  });

  test("normalizes model lists and profile updates", () => {
    expect(parseModelList("gpt-a, gpt-b\ngpt-a\n")).toEqual([
      "gpt-a",
      "gpt-b",
    ]);
    const updated = updateProviderProfile(
      createDefaultSettings("en"),
      "openai-chat",
      (profile) => ({ ...profile, models: [" custom ", "custom"] }),
    );
    expect(getProviderProfile(updated, "openai-chat").models).toEqual([
      "custom",
    ]);
  });

  test("requires a valid base URL and selected model", () => {
    const profile = getProviderProfile(
      createDefaultSettings("en"),
      "openai-responses",
    );
    expect(isProviderReady(profile, "")).toBe(false);
    expect(isProviderReady(profile, "gpt-test")).toBe(true);
    expect(
      isProviderReady({ ...profile, baseUrl: "file:///tmp" }, "gpt-test"),
    ).toBe(false);
  });

  test("keeps an existing session on its bound API format", () => {
    expect(canSwitchModelFormat(null, "anthropic")).toBe(true);
    expect(canSwitchModelFormat("openai-responses", "openai-responses")).toBe(true);
    expect(canSwitchModelFormat("openai-responses", "anthropic")).toBe(false);
  });
});
