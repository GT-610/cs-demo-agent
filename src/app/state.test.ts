import { describe, expect, test } from "bun:test";
import {
  createDefaultSettings,
  createProviderProfile,
  getDefaultModel,
  getProviderProfile,
  isProviderReady,
  normalizeSettings,
  parseModelList,
  removeProviderProfile,
  settingsEqual,
  updateProviderProfile,
  validateSettings,
} from "./state";

describe("application state helpers", () => {
  test("starts without any providers", () => {
    const settings = createDefaultSettings("en");
    expect(settings.providers).toEqual([]);
    expect(settings.defaultProviderId).toBeNull();
    expect(getDefaultModel(settings)).toBe("");
  });

  test("normalizes multiple providers that share an API format", () => {
    const first = {
      ...createProviderProfile("openai-chat", "provider-a"),
      name: " First ",
      baseUrl: " https://first.example.test/v1 ",
      models: [" model-a "],
    };
    const second = {
      ...createProviderProfile("openai-chat", "provider-b"),
      name: "Second",
      baseUrl: "https://second.example.test/v1",
      models: ["model-b"],
    };
    const settings = normalizeSettings(
      {
        locale: "zh-CN",
        defaultProviderId: second.id,
        providers: [first, second],
      },
      "en",
    );
    expect(settings.providers).toHaveLength(2);
    expect(settings.providers[0]?.name).toBe("First");
    expect(settings.defaultProviderId).toBe("provider-b");
    expect(getDefaultModel(settings)).toBe("model-b");
  });

  test("normalizes model lists and updates profiles by identifier", () => {
    expect(parseModelList("gpt-a, gpt-b\ngpt-a\n")).toEqual([
      "gpt-a",
      "gpt-b",
    ]);
    const profile = createProviderProfile("openai-chat", "provider-a");
    const updated = updateProviderProfile(
      {
        locale: "en",
        defaultProviderId: profile.id,
        providers: [profile],
      },
      profile.id,
      (current) => ({ ...current, models: ["custom"] }),
    );
    expect(getProviderProfile(updated, profile.id)?.models).toEqual(["custom"]);
  });

  test("requires a selected provider, URL, and model", () => {
    const profile = {
      ...createProviderProfile("openai-responses", "provider-a"),
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-test"],
    };
    expect(isProviderReady(null, "gpt-test")).toBe(false);
    expect(isProviderReady(profile, "")).toBe(false);
    expect(isProviderReady(profile, "gpt-test")).toBe(true);
    expect(isProviderReady({ ...profile, baseUrl: "file:///tmp" }, "gpt-test")).toBe(false);
  });

  test("removing the default provider selects the next provider", () => {
    const first = createProviderProfile("anthropic", "provider-a");
    const second = createProviderProfile("openai-chat", "provider-b");
    const settings = removeProviderProfile(
      {
        locale: "en",
        defaultProviderId: first.id,
        providers: [first, second],
      },
      first.id,
    );
    expect(settings.defaultProviderId).toBe(second.id);
  });

  test("validates complete providers and compares drafts", () => {
    const empty = createDefaultSettings("en");
    expect(validateSettings(empty)).toBeNull();
    expect(settingsEqual(empty, { ...empty })).toBe(true);
    const incomplete = createProviderProfile("anthropic", "provider-a");
    expect(
      validateSettings({
        ...empty,
        defaultProviderId: incomplete.id,
        providers: [incomplete],
      }),
    ).toEqual({ type: "providerName" });
  });
});
