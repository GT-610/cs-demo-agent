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

export interface SettingsValidationIssue {
  type: "duplicateProviderId" | "providerName" | "providerConnection" | "defaultProvider";
  providerName?: string;
}

export function createProviderProfile(
  kind: ProviderKind = "openai-responses",
  id = createProviderId(),
): StoredProviderProfile {
  return {
    id,
    credentialRef: id,
    name: "",
    kind,
    baseUrl: "",
    apiKey: "",
    models: [],
    maxOutputTokens: 4096,
  };
}

export function createDefaultSettings(locale: Locale): StoredSettings {
  return {
    locale,
    defaultProviderId: null,
    providers: [],
  };
}

export function normalizeSettings(
  settings: StoredSettings | undefined,
  locale: Locale,
): StoredSettings {
  if (!settings) return createDefaultSettings(locale);
  const providers: StoredProviderProfile[] = [];
  const ids = new Set<string>();
  for (const profile of settings.providers) {
    const normalized = sanitizeProfile(profile);
    if (!normalized.id || ids.has(normalized.id)) continue;
    ids.add(normalized.id);
    providers.push(normalized);
  }
  const defaultProviderId = providers.some(
    (profile) => profile.id === settings.defaultProviderId,
  )
    ? settings.defaultProviderId
    : providers[0]?.id ?? null;
  const normalizedLocale = settings.locale === "en" || settings.locale === "zh-CN"
    ? settings.locale
    : locale;
  return { locale: normalizedLocale, defaultProviderId, providers };
}

export function getProviderProfile(
  settings: StoredSettings,
  id: string | null,
): StoredProviderProfile | null {
  if (!id) return null;
  return settings.providers.find((profile) => profile.id === id) ?? null;
}

export function getDefaultProviderProfile(
  settings: StoredSettings,
): StoredProviderProfile | null {
  return getProviderProfile(settings, settings.defaultProviderId);
}

export function getDefaultModel(settings: StoredSettings): string {
  return getDefaultProviderProfile(settings)?.models[0] ?? "";
}

export function updateProviderProfile(
  settings: StoredSettings,
  id: string,
  update: (profile: StoredProviderProfile) => StoredProviderProfile,
): StoredSettings {
  return {
    ...settings,
    providers: settings.providers.map((profile) =>
      profile.id === id ? update(profile) : profile,
    ),
  };
}

export function removeProviderProfile(
  settings: StoredSettings,
  id: string,
): StoredSettings {
  const providers = settings.providers.filter((profile) => profile.id !== id);
  return {
    ...settings,
    providers,
    defaultProviderId:
      settings.defaultProviderId === id
        ? providers[0]?.id ?? null
        : settings.defaultProviderId,
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
    providerId: profile.id,
    kind: profile.kind,
    baseUrl: profile.baseUrl.trim(),
    apiKey: profile.apiKey,
    model: model.trim(),
    maxOutputTokens: profile.maxOutputTokens,
  };
}

export function isProviderReady(
  profile: StoredProviderProfile | null,
  model: string,
): boolean {
  if (!profile || !profile.baseUrl.trim() || !model.trim()) return false;
  try {
    const url = new URL(profile.baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSettings(settings: StoredSettings): SettingsValidationIssue | null {
  const ids = new Set<string>();
  const credentialRefs = new Set<string>();
  for (const profile of settings.providers) {
    if (
      !profile.id.trim() ||
      ids.has(profile.id) ||
      !profile.credentialRef.trim() ||
      credentialRefs.has(profile.credentialRef)
    ) {
      return { type: "duplicateProviderId" };
    }
    ids.add(profile.id);
    credentialRefs.add(profile.credentialRef);
    if (!profile.name.trim()) return { type: "providerName" };
    if (!isProviderReady(profile, profile.models[0] ?? "")) {
      return {
        type: "providerConnection",
        providerName: profile.name.trim(),
      };
    }
  }
  if (
    settings.defaultProviderId !== null &&
    !settings.providers.some((profile) => profile.id === settings.defaultProviderId)
  ) {
    return { type: "defaultProvider" };
  }
  return null;
}

export function settingsEqual(
  left: StoredSettings,
  right: StoredSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sanitizeProfile(profile: StoredProviderProfile): StoredProviderProfile {
  return {
    ...profile,
    id: profile.id.trim(),
    credentialRef: profile.credentialRef?.trim() || profile.id.trim(),
    name: profile.name.trim(),
    baseUrl: profile.baseUrl.trim(),
    models: [...new Set(profile.models.map((model) => model.trim()).filter(Boolean))].slice(
      0,
      32,
    ),
    maxOutputTokens: Math.min(131_072, Math.max(256, profile.maxOutputTokens)),
  };
}

function createProviderId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? `provider-${random}`
    : `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
