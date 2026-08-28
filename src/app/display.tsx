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

export function SectionHeading({
  number,
  title,
  count,
}: {
  number: string;
  title: string;
  count?: number;
}) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2>{title}</h2>
      {!!count && <em>{count}</em>}
    </div>
  );
}

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

export function CrosshairIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </svg>
  );
}

export function SpinnerIcon() {
  return (
    <svg className="spinner-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  );
}
