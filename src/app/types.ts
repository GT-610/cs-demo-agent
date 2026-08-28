import type { JsonValue, ToolCall } from "../agent/types";
import type { TranslationKey, TranslationParams } from "../i18n";

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export interface EvidenceEntry {
  key: string;
  call: ToolCall;
  iteration: number;
  status: "running" | "success" | "error";
  result?: JsonValue;
}

export interface StatusMessage {
  key: TranslationKey;
  params?: TranslationParams;
  toolName?: string;
}
