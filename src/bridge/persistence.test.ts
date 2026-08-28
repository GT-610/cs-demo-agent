import { describe, expect, test } from "bun:test";
import {
  createStoredSession,
  deleteStoredSession,
  loadStoredSession,
  loadWorkspace,
  renameStoredSession,
  saveStoredSessionContent,
  saveStoredSettings,
} from "./persistence";
import type { InvokeFunction } from "./tauri";

describe("persistence bridge", () => {
  test("maps workspace and session commands without changing payloads", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeCommand: InvokeFunction = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ command, args });
      if (command === "load_workspace") {
        return { sessions: [] } as T;
      }
      if (command === "load_session") {
        return {
          id: "session-1",
          title: "Match",
          demoPath: "match.dem",
          providerId: "provider-openai",
          model: "gpt-test",
          createdAt: 1,
          updatedAt: 2,
          messages: [],
        } as T;
      }
      if (command === "create_session") {
        return {
          ...(args?.input as object),
          updatedAt: 1,
        } as T;
      }
      return undefined as T;
    };

    await loadWorkspace(invokeCommand);
    await loadStoredSession("session-1", invokeCommand);
    await saveStoredSettings(
      {
        locale: "en",
        defaultProviderId: "provider-openai",
        providers: [
          {
            id: "provider-openai",
            name: "OpenAI",
            kind: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "key",
            models: ["gpt-test"],
            maxOutputTokens: 4096,
          },
        ],
      },
      invokeCommand,
    );
    await createStoredSession(
      {
        id: "session-1",
        title: "Match",
        demoPath: "match.dem",
        providerId: "provider-openai",
        model: "gpt-test",
        createdAt: 1,
      },
      invokeCommand,
    );
    await renameStoredSession("session-1", "Renamed", 2, invokeCommand);
    await saveStoredSessionContent(
      {
        id: "session-1",
        demoPath: "match.dem",
        providerId: "provider-openai",
        model: "gpt-test",
        messages: [],
        updatedAt: 3,
      },
      invokeCommand,
    );
    await deleteStoredSession("session-1", invokeCommand);

    expect(calls.map((call) => call.command)).toEqual([
      "load_workspace",
      "load_session",
      "save_settings",
      "create_session",
      "rename_session",
      "save_session_content",
      "delete_session",
    ]);
    expect(calls[1]?.args).toEqual({ id: "session-1" });
    expect(calls[4]?.args).toEqual({
      input: { id: "session-1", title: "Renamed", updatedAt: 2 },
    });
  });

  test("uses deterministic browser fallbacks for development", async () => {
    expect(await loadWorkspace()).toEqual({ sessions: [] });
    expect(
      await createStoredSession({
        id: "local",
        title: "Local",
        demoPath: "local.dem",
        providerId: "provider-anthropic",
        model: "claude-test",
        createdAt: 10,
      }),
    ).toEqual({
      id: "local",
      title: "Local",
      demoPath: "local.dem",
      providerId: "provider-anthropic",
      model: "claude-test",
      createdAt: 10,
      updatedAt: 10,
    });
  });
});
