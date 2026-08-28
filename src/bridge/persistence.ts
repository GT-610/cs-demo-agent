import { invoke, isTauri } from "@tauri-apps/api/core";
import type { JsonValue } from "../agent/types";
import type { ProviderDraft } from "../app/state";
import type { Locale } from "../i18n";
import type { InvokeFunction } from "./tauri";

export interface StoredSettings {
  locale: Locale;
  provider: ProviderDraft;
}

export interface SessionSummary {
  id: string;
  title: string;
  demoPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedMessage {
  id: string;
  kind: "user" | "assistant" | "tool";
  content: string;
  metadata?: JsonValue;
}

export interface SessionDetail extends SessionSummary {
  messages: PersistedMessage[];
  runtimeState?: JsonValue;
}

export interface WorkspaceSnapshot {
  settings?: StoredSettings;
  sessions: SessionSummary[];
}

export interface CreateSessionInput {
  id: string;
  title: string;
  demoPath: string;
  createdAt: number;
}

export interface SaveSessionContentInput {
  id: string;
  demoPath: string;
  messages: PersistedMessage[];
  runtimeState?: JsonValue;
  updatedAt: number;
}

export async function loadWorkspace(
  invokeCommand?: InvokeFunction,
): Promise<WorkspaceSnapshot> {
  if (!canInvoke(invokeCommand)) return { sessions: [] };
  return getInvoker(invokeCommand)<WorkspaceSnapshot>("load_workspace");
}

export async function loadStoredSession(
  id: string,
  invokeCommand?: InvokeFunction,
): Promise<SessionDetail> {
  return getInvoker(invokeCommand)<SessionDetail>("load_session", { id });
}

export async function saveStoredSettings(
  settings: StoredSettings,
  invokeCommand?: InvokeFunction,
): Promise<void> {
  if (!canInvoke(invokeCommand)) return;
  await getInvoker(invokeCommand)<void>("save_settings", { settings });
}

export async function createStoredSession(
  input: CreateSessionInput,
  invokeCommand?: InvokeFunction,
): Promise<SessionSummary> {
  if (!canInvoke(invokeCommand)) {
    return {
      ...input,
      updatedAt: input.createdAt,
    };
  }
  return getInvoker(invokeCommand)<SessionSummary>("create_session", { input });
}

export async function renameStoredSession(
  id: string,
  title: string,
  updatedAt: number,
  invokeCommand?: InvokeFunction,
): Promise<void> {
  if (!canInvoke(invokeCommand)) return;
  await getInvoker(invokeCommand)<void>("rename_session", {
    input: { id, title, updatedAt },
  });
}

export async function deleteStoredSession(
  id: string,
  invokeCommand?: InvokeFunction,
): Promise<void> {
  if (!canInvoke(invokeCommand)) return;
  await getInvoker(invokeCommand)<void>("delete_session", { id });
}

export async function saveStoredSessionContent(
  input: SaveSessionContentInput,
  invokeCommand?: InvokeFunction,
): Promise<void> {
  if (!canInvoke(invokeCommand)) return;
  await getInvoker(invokeCommand)<void>("save_session_content", { input });
}

function canInvoke(invokeCommand?: InvokeFunction): boolean {
  return !!invokeCommand || isTauri();
}

function getInvoker(invokeCommand?: InvokeFunction): InvokeFunction {
  if (invokeCommand) return invokeCommand;
  if (!isTauri()) {
    throw new Error("This operation requires the Tauri desktop host");
  }
  return invoke;
}
