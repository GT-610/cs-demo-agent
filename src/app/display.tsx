import type { JsonObject, JsonValue } from "../agent/types";
import type { TranslationKey, Translator } from "../i18n";

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  get_demo_header: "tool.getDemoHeader",
  get_player_info: "tool.getPlayerInfo",
  list_game_events: "tool.listGameEvents",
  query_events: "tool.queryEvents",
  query_ticks: "tool.queryTicks",
  query_grenades: "tool.queryGrenades",
  get_round_summary: "tool.getRoundSummary",
  get_economy_analysis: "tool.getEconomyAnalysis",
};

export function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}

export function asObjectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          !!item && !Array.isArray(item) && typeof item === "object",
      )
    : [];
}

export function readString(object: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function readNumber(
  object: JsonObject,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number") return value;
  }
  return null;
}

export function toolLabel(name: string, t: Translator): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
