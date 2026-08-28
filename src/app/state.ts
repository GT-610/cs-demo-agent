import type { ProviderConfig, ProviderKind } from "../agent/types";

export interface ProviderDraft extends ProviderConfig {
  kind: ProviderKind;
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  "openai-responses": "OpenAI Responses",
  "openai-chat": "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
};

export function createDefaultProvider(kind: ProviderKind): ProviderDraft {
  return {
    kind,
    baseUrl:
      kind === "anthropic"
        ? "https://api.anthropic.com/v1"
        : "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    maxOutputTokens: 4096,
  };
}

export function changeProviderKind(
  current: ProviderDraft,
  kind: ProviderKind,
): ProviderDraft {
  const knownDefault =
    current.kind === "anthropic"
      ? "https://api.anthropic.com/v1"
      : "https://api.openai.com/v1";
  const next = createDefaultProvider(kind);
  return {
    ...current,
    kind,
    baseUrl: current.baseUrl === knownDefault ? next.baseUrl : current.baseUrl,
  };
}

export function isProviderReady(config: ProviderDraft): boolean {
  if (!config.baseUrl.trim() || !config.model.trim()) {
    return false;
  }
  try {
    const url = new URL(config.baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
