import type { ProviderConfig, ProviderKind } from "../agent/types";
import type { StoredProviderProfile, StoredSettings } from "../bridge/persistence";
import type { Locale } from "../i18n";

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  "openai-responses",
  "openai-chat",
  "anthropic",
];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  "openai-responses": "OpenAI Responses",
  "openai-chat": "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
};

const DEFAULT_MODELS: Record<ProviderKind, string[]> = {
  "openai-responses": ["gpt-5.2"],
  "openai-chat": ["gpt-4.1"],
  anthropic: ["claude-sonnet-4-5"],
};

export function createDefaultProviderProfile(
  kind: ProviderKind,
): StoredProviderProfile {
  return {
    kind,
    baseUrl:
      kind === "anthropic"
        ? "https://api.anthropic.com/v1"
        : "https://api.openai.com/v1",
    apiKey: "",
    models: [...DEFAULT_MODELS[kind]],
    maxOutputTokens: 4096,
  };
}

export function createDefaultSettings(locale: Locale): StoredSettings {
  return {
    locale,
    defaultProviderKind: "openai-responses",
    providers: PROVIDER_KINDS.map(createDefaultProviderProfile),
  };
}

export function normalizeSettings(
  settings: StoredSettings | undefined,
  locale: Locale,
): StoredSettings {
  const defaults = createDefaultSettings(settings?.locale ?? locale);
  if (!settings) return defaults;
  const providers = PROVIDER_KINDS.map(
    (kind) =>
      settings.providers.find((profile) => profile.kind === kind) ??
      createDefaultProviderProfile(kind),
  );
  const defaultProviderKind = providers.some(
    (profile) => profile.kind === settings.defaultProviderKind,
  )
    ? settings.defaultProviderKind
    : defaults.defaultProviderKind;
  return { ...settings, defaultProviderKind, providers };
}

export function getProviderProfile(
  settings: StoredSettings,
  kind: ProviderKind,
): StoredProviderProfile {
  return (
    settings.providers.find((profile) => profile.kind === kind) ??
    createDefaultProviderProfile(kind)
  );
}

export function getDefaultModel(
  settings: StoredSettings,
  kind = settings.defaultProviderKind,
): string {
  return getProviderProfile(settings, kind).models[0] ?? "";
}

export function updateProviderProfile(
  settings: StoredSettings,
  kind: ProviderKind,
  update: (profile: StoredProviderProfile) => StoredProviderProfile,
): StoredSettings {
  return {
    ...settings,
    providers: settings.providers.map((profile) =>
      profile.kind === kind ? sanitizeProfile(update(profile)) : profile,
    ),
  };
}

export function parseModelList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((model) => model.trim()).filter(Boolean))].slice(
    0,
    32,
  );
}

export function formatModelList(models: readonly string[]): string {
  return models.join("\n");
}

export function createProviderConfig(
  profile: StoredProviderProfile,
  model: string,
): ProviderConfig {
  return {
    kind: profile.kind,
    baseUrl: profile.baseUrl.trim(),
    apiKey: profile.apiKey,
    model: model.trim(),
    maxOutputTokens: profile.maxOutputTokens,
  };
}

export function isProviderReady(
  profile: StoredProviderProfile,
  model: string,
): boolean {
  if (!profile.baseUrl.trim() || !model.trim()) return false;
  try {
    const url = new URL(profile.baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function canSwitchModelFormat(
  boundProviderKind: ProviderKind | null,
  nextProviderKind: ProviderKind,
): boolean {
  return boundProviderKind === null || boundProviderKind === nextProviderKind;
}

function sanitizeProfile(profile: StoredProviderProfile): StoredProviderProfile {
  return {
    ...profile,
    models: [...new Set(profile.models.map((model) => model.trim()).filter(Boolean))].slice(
      0,
      32,
    ),
    maxOutputTokens: Math.min(131_072, Math.max(256, profile.maxOutputTokens)),
  };
}
