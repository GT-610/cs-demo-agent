import type {
  AgentRuntimeState,
  JsonValue,
  ProviderKind,
  ToolCall,
} from "../agent/types";
import type { DemoToolResult } from "../bridge/tauri";
import type { TranslationKey, TranslationParams } from "../i18n";

interface TimelineEntryBase {
  id: string;
}

export interface UserTimelineEntry extends TimelineEntryBase {
  kind: "user";
  content: string;
}

export interface AssistantTimelineEntry extends TimelineEntryBase {
  kind: "assistant";
  content: string;
  status: "streaming" | "complete";
  iteration: number;
}

export interface ToolTimelineEntry extends TimelineEntryBase {
  kind: "tool";
  call: ToolCall;
  iteration: number;
  status: "running" | "success" | "error";
  result?: JsonValue;
}

export type TimelineEntry =
  | UserTimelineEntry
  | AssistantTimelineEntry
  | ToolTimelineEntry;

export interface ConversationState {
  demoPath: string;
  header: DemoToolResult | null;
  players: DemoToolResult | null;
  providerId: string | null;
  model: string;
  entries: TimelineEntry[];
  runtimeState?: AgentRuntimeState;
}

export interface StatusMessage {
  key: TranslationKey;
  params?: TranslationParams;
  toolName?: string;
}

export type WorkspacePage = "conversation" | "settings";

export interface ModelOption {
  providerId: string;
  providerKind: ProviderKind;
  providerName: string;
  model: string;
}
