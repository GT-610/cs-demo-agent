import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import systemPrompt from "../agent/system-prompt.md?raw";
import { createProviderAdapter } from "../agent/providers";
import { AgentRuntime } from "../agent/runtime";
import { DEMO_TOOL_SPECS, HOST_SYSTEM_ADDENDUM } from "../agent/tools";
import type {
  AgentEvent,
  AgentRuntimeState,
  JsonValue,
  ProviderKind,
} from "../agent/types";
import {
  createStoredSession,
  deleteStoredSession,
  loadStoredSession,
  loadWorkspace,
  renameStoredSession,
  saveStoredSessionContent,
  saveStoredSettings,
  type SessionSummary,
  type StoredSettings,
} from "../bridge/persistence";
import {
  createDemoToolExecutor,
  createHttpStreamTransport,
  listenForDemoDrops,
  loadDemoOverview,
  selectDemoFile,
} from "../bridge/tauri";
import { translate, type Locale } from "../i18n";
import { errorMessage } from "./display";
import { deserializeTimeline, serializeTimeline, titleFromPrompt } from "./sessionPersistence";
import {
  canSwitchModelFormat,
  createDefaultSettings,
  createProviderConfig,
  getDefaultModel,
  getProviderProfile,
  isProviderReady,
  normalizeSettings,
} from "./state";
import type {
  ConversationState,
  ModelOption,
  StatusMessage,
  TimelineEntry,
  WorkspacePage,
} from "./types";

interface RuntimeCache {
  sessionId: string;
  providerKind: ProviderKind;
  model: string;
  runtime: AgentRuntime;
}

export function useWorkspace(initialLocale: Locale) {
  const initialSettings = createDefaultSettings(initialLocale);
  const [settings, setSettingsState] = useState<StoredSettings>(initialSettings);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [page, setPage] = useState<WorkspacePage>("conversation");
  const [conversation, setConversationState] = useState<ConversationState>(() =>
    createEmptyConversation(initialSettings),
  );
  const [draft, setDraft] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage>({ key: "status.readyDemo" });

  const settingsRef = useRef(settings);
  const conversationRef = useRef(conversation);
  const activeSessionIdRef = useRef<string | null>(null);
  const runtimeRef = useRef<RuntimeCache | null>(null);
  const revisionRef = useRef(0);
  const loadRef = useRef(0);

  const replaceConversation = useCallback((next: ConversationState) => {
    conversationRef.current = next;
    setConversationState(next);
  }, []);

  const mutateConversation = useCallback(
    (update: (current: ConversationState) => ConversationState) => {
      replaceConversation(update(conversationRef.current));
    },
    [replaceConversation],
  );

  const setActiveSessionId = useCallback((id: string | null) => {
    activeSessionIdRef.current = id;
    setActiveSessionIdState(id);
  }, []);

  const setSettings = useCallback(
    (update: (current: StoredSettings) => StoredSettings) => {
      setSettingsState((current) => {
        const next = normalizeSettings(update(current), current.locale);
        settingsRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void loadWorkspace()
      .then((snapshot) => {
        if (!active) return;
        const loadedSettings = normalizeSettings(snapshot.settings, initialLocale);
        settingsRef.current = loadedSettings;
        setSettingsState(loadedSettings);
        setSessions(snapshot.sessions);
        replaceConversation(createEmptyConversation(loadedSettings));
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setInitialized(true);
      });
    return () => {
      active = false;
    };
  }, [initialLocale, replaceConversation]);

  useEffect(() => {
    if (!initialized) return undefined;
    const timeout = window.setTimeout(() => {
      void saveStoredSettings(settings).catch((caught) =>
        setError(errorMessage(caught)),
      );
    }, 350);
    runtimeRef.current = null;
    return () => window.clearTimeout(timeout);
  }, [initialized, settings]);

  useEffect(() => {
    if (activeSessionId !== null) return;
    const profile = getProviderProfile(settings, conversation.providerKind);
    if (profile.models.includes(conversation.model)) return;
    mutateConversation((current) => ({
      ...current,
      model: profile.models[0] ?? "",
    }));
  }, [activeSessionId, conversation.model, conversation.providerKind, mutateConversation, settings]);

  const startNewSession = useCallback(() => {
    if (sending) return;
    revisionRef.current += 1;
    loadRef.current += 1;
    runtimeRef.current = null;
    setActiveSessionId(null);
    setPage("conversation");
    setDraft("");
    setError(null);
    setStatus({ key: "status.readyDemo" });
    replaceConversation(createEmptyConversation(settingsRef.current));
  }, [replaceConversation, sending, setActiveSessionId]);

  const openSettings = useCallback(() => {
    if (!sending) setPage("settings");
  }, [sending]);

  const openSession = useCallback(
    async (id: string) => {
      if (sending || id === activeSessionIdRef.current) {
        setPage("conversation");
        return;
      }
      const loadId = ++loadRef.current;
      revisionRef.current += 1;
      runtimeRef.current = null;
      setSessionLoading(true);
      setError(null);
      setStatus({ key: "status.loadingSession" });
      try {
        const summary = sessions.find((item) => item.id === id);
        if (!summary) throw new Error("Session was not found");
        const [detail, overview] = await Promise.all([
          loadStoredSession(id),
          loadDemoOverview(summary.demoPath),
        ]);
        if (loadRef.current !== loadId) return;
        setActiveSessionId(id);
        setPage("conversation");
        setDraft("");
        replaceConversation({
          demoPath: detail.demoPath,
          header: overview.header,
          players: overview.players,
          providerKind: detail.providerKind,
          model: detail.model,
          entries: deserializeTimeline(detail.messages),
          runtimeState: detail.runtimeState as AgentRuntimeState | undefined,
        });
        setStatus({ key: "status.readyAnalysis" });
      } catch (caught) {
        if (loadRef.current === loadId) {
          setError(errorMessage(caught));
          setStatus({ key: "status.openFailed" });
        }
      } finally {
        if (loadRef.current === loadId) setSessionLoading(false);
      }
    },
    [replaceConversation, sending, sessions, setActiveSessionId],
  );

  const openDemo = useCallback(
    async (path: string, forceNew = false) => {
      if (sending) return;
      if (forceNew || activeSessionIdRef.current !== null) startNewSession();
      const loadId = ++loadRef.current;
      setDemoLoading(true);
      setError(null);
      setStatus({ key: "status.readingDemo" });
      try {
        const overview = await loadDemoOverview(path);
        if (loadRef.current !== loadId) return;
        replaceConversation({
          ...createEmptyConversation(settingsRef.current),
          demoPath: path,
          header: overview.header,
          players: overview.players,
        });
        setActiveSessionId(null);
        setPage("conversation");
        setStatus({ key: "status.demoReady" });
      } catch (caught) {
        if (loadRef.current === loadId) {
          setError(errorMessage(caught));
          setStatus({ key: "status.openFailed" });
        }
      } finally {
        if (loadRef.current === loadId) setDemoLoading(false);
      }
    },
    [replaceConversation, sending, setActiveSessionId, startNewSession],
  );

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void listenForDemoDrops((path) => void openDemo(path, true))
      .then((unlisten) => {
        if (active) dispose = unlisten;
        else unlisten();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      dispose?.();
    };
  }, [openDemo]);

  const chooseDemo = useCallback(async () => {
    if (activeSessionIdRef.current !== null || sending) return;
    try {
      const path = await selectDemoFile(
        translate(settingsRef.current.locale, "demo.dialogTitle"),
      );
      if (path) await openDemo(path);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [openDemo, sending]);

  const selectModel = useCallback(
    async (option: ModelOption) => {
      if (sending) return;
      const sessionId = activeSessionIdRef.current;
      const current = conversationRef.current;
      if (
        !canSwitchModelFormat(sessionId ? current.providerKind : null, option.providerKind)
      ) {
        return;
      }
      runtimeRef.current = null;
      const next = {
        ...current,
        providerKind: sessionId ? current.providerKind : option.providerKind,
        model: option.model,
      };
      replaceConversation(next);
      if (!sessionId) return;
      const updatedAt = Date.now();
      setSessions((items) =>
        sortSessions(
          items.map((item) =>
            item.id === sessionId
              ? { ...item, model: option.model, updatedAt }
              : item,
          ),
        ),
      );
      try {
        await persistConversation(sessionId, next, updatedAt);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [replaceConversation, sending],
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    const updatedAt = Date.now();
    await renameStoredSession(id, title, updatedAt);
    setSessions((items) =>
      sortSessions(
        items.map((item) =>
          item.id === id ? { ...item, title: title.trim(), updatedAt } : item,
        ),
      ),
    );
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await deleteStoredSession(id);
      setSessions((items) => items.filter((item) => item.id !== id));
      if (activeSessionIdRef.current === id) startNewSession();
    },
    [startNewSession],
  );

  const submit = useCallback(async () => {
    const question = draft.trim();
    const initial = conversationRef.current;
    const profile = getProviderProfile(settingsRef.current, initial.providerKind);
    if (
      !question ||
      !initial.demoPath ||
      !isProviderReady(profile, initial.model) ||
      sending ||
      demoLoading
    ) {
      return;
    }

    const revision = revisionRef.current;
    const turnId = createId("turn");
    let sessionId = activeSessionIdRef.current;
    const userEntry: TimelineEntry = {
      id: `${turnId}:user`,
      kind: "user",
      content: question,
    };
    mutateConversation((current) => ({
      ...current,
      entries: [...current.entries, userEntry],
    }));
    setDraft("");
    setError(null);
    setSending(true);
    setStatus({ key: "status.planning" });

    try {
      if (!sessionId) {
        const created = await createStoredSession({
          id: createId("session"),
          title: titleFromPrompt(question),
          demoPath: initial.demoPath,
          providerKind: initial.providerKind,
          model: initial.model,
          createdAt: Date.now(),
        });
        if (revisionRef.current !== revision) return;
        sessionId = created.id;
        setActiveSessionId(sessionId);
        setSessions((items) => sortSessions([created, ...items]));
      }

      const runtime = getRuntime(sessionId, conversationRef.current, settingsRef.current, runtimeRef);
      await runtime.send(question, (event) => {
        if (revisionRef.current === revision) {
          applyAgentEvent(event, turnId, mutateConversation, setStatus);
        }
      });
      if (revisionRef.current !== revision) return;
      mutateConversation((current) => ({
        ...current,
        runtimeState: runtime.state,
      }));
      setStatus({ key: "status.complete" });
      try {
        await persistConversation(sessionId, conversationRef.current, Date.now());
        const persisted = conversationRef.current;
        setSessions((items) =>
          sortSessions(
            items.map((item) =>
              item.id === sessionId
                ? { ...item, model: persisted.model, updatedAt: Date.now() }
                : item,
            ),
          ),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    } catch (caught) {
      if (revisionRef.current === revision) {
        settleInterruptedEntries(mutateConversation);
        setError(errorMessage(caught));
        setStatus({ key: "status.analysisFailed" });
        if (sessionId) {
          void persistConversation(sessionId, conversationRef.current, Date.now()).catch(
            () => undefined,
          );
        }
      }
    } finally {
      if (revisionRef.current === revision) setSending(false);
    }
  }, [demoLoading, draft, mutateConversation, sending, setActiveSessionId]);

  const profile = getProviderProfile(settings, conversation.providerKind);
  const providerReady = isProviderReady(profile, conversation.model);
  const canSend =
    initialized &&
    !!conversation.demoPath &&
    providerReady &&
    !!draft.trim() &&
    !sending &&
    !demoLoading &&
    !sessionLoading;

  return {
    settings,
    setSettings,
    sessions,
    activeSessionId,
    page,
    conversation,
    draft,
    initialized,
    sessionLoading,
    demoLoading,
    sending,
    error,
    status,
    providerReady,
    canSend,
    modelOptions: createModelOptions(settings, conversation, activeSessionId),
    setDraft,
    setError,
    startNewSession,
    openSettings,
    openSession,
    chooseDemo,
    selectModel,
    renameSession,
    deleteSession,
    submit,
  };
}

function createEmptyConversation(settings: StoredSettings): ConversationState {
  return {
    demoPath: "",
    header: null,
    players: null,
    providerKind: settings.defaultProviderKind,
    model: getDefaultModel(settings),
    entries: [],
  };
}

function createModelOptions(
  settings: StoredSettings,
  conversation: ConversationState,
  activeSessionId: string | null,
): ModelOption[] {
  if (activeSessionId) {
    const models = getProviderProfile(settings, conversation.providerKind).models;
    return [...new Set([conversation.model, ...models].filter(Boolean))].map((model) => ({
      providerKind: conversation.providerKind,
      model,
    }));
  }
  return settings.providers.flatMap((profile) =>
    profile.models.map((model) => ({ providerKind: profile.kind, model })),
  );
}

function getRuntime(
  sessionId: string,
  conversation: ConversationState,
  settings: StoredSettings,
  runtimeRef: MutableRefObject<RuntimeCache | null>,
): AgentRuntime {
  const cached = runtimeRef.current;
  if (
    cached?.sessionId === sessionId &&
    cached.providerKind === conversation.providerKind &&
    cached.model === conversation.model
  ) {
    return cached.runtime;
  }
  const profile = getProviderProfile(settings, conversation.providerKind);
  const runtime = new AgentRuntime({
    adapter: createProviderAdapter(
      conversation.providerKind,
      createHttpStreamTransport(),
    ),
    config: createProviderConfig(profile, conversation.model),
    tools: DEMO_TOOL_SPECS,
    executeTool: createDemoToolExecutor(conversation.demoPath),
    systemPrompt: `${systemPrompt}${HOST_SYSTEM_ADDENDUM}`,
    initialState: conversation.runtimeState,
  });
  runtimeRef.current = {
    sessionId,
    providerKind: conversation.providerKind,
    model: conversation.model,
    runtime,
  };
  return runtime;
}

function applyAgentEvent(
  event: AgentEvent,
  turnId: string,
  mutate: (update: (current: ConversationState) => ConversationState) => void,
  setStatus: (status: StatusMessage) => void,
): void {
  const iteration = event.type === "error" ? 0 : event.iteration;
  const assistantId = `${turnId}:assistant:${iteration}`;
  if (event.type === "assistant-start") {
    setStatus({ key: "status.modelPass", params: { iteration: event.iteration } });
    mutate((current) => ({
      ...current,
      entries: [
        ...current.entries,
        {
          id: assistantId,
          kind: "assistant",
          content: "",
          status: "streaming",
          iteration: event.iteration,
        },
      ],
    }));
    return;
  }
  if (event.type === "assistant-delta") {
    mutate((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === assistantId && entry.kind === "assistant"
          ? { ...entry, content: `${entry.content}${event.delta}` }
          : entry,
      ),
    }));
    return;
  }
  if (event.type === "assistant-end") {
    mutate((current) => ({
      ...current,
      entries: current.entries.flatMap((entry) =>
        entry.id !== assistantId || entry.kind !== "assistant"
          ? [entry]
          : event.hasToolCalls && !event.text.trim()
            ? []
            : [{ ...entry, content: event.text, status: "complete" }],
      ),
    }));
    return;
  }
  if (event.type === "tool-start") {
    setStatus({ key: "status.runningTool", toolName: event.call.name });
    mutate((current) => ({
      ...current,
      entries: [
        ...current.entries,
        {
          id: `${turnId}:tool:${event.iteration}:${event.call.id}`,
          kind: "tool",
          call: event.call,
          iteration: event.iteration,
          status: "running",
        },
      ],
    }));
    return;
  }
  if (event.type === "tool-result") {
    const id = `${turnId}:tool:${event.iteration}:${event.call.id}`;
    mutate((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === id && entry.kind === "tool"
          ? {
              ...entry,
              result: event.result,
              status: event.ok ? "success" : "error",
            }
          : entry,
      ),
    }));
    return;
  }
  setStatus({ key: "status.analysisFailed" });
}

function settleInterruptedEntries(
  mutate: (update: (current: ConversationState) => ConversationState) => void,
): void {
  mutate((current) => ({
    ...current,
    entries: current.entries.map((entry) => {
      if (entry.kind === "assistant" && entry.status === "streaming") {
        return { ...entry, status: "complete" };
      }
      if (entry.kind === "tool" && entry.status === "running") {
        return { ...entry, status: "error" };
      }
      return entry;
    }),
  }));
}

async function persistConversation(
  sessionId: string,
  conversation: ConversationState,
  updatedAt: number,
): Promise<void> {
  await saveStoredSessionContent({
    id: sessionId,
    demoPath: conversation.demoPath,
    model: conversation.model,
    messages: serializeTimeline(conversation.entries),
    runtimeState: conversation.runtimeState as unknown as JsonValue | undefined,
    updatedAt,
  });
}

function sortSessions(items: SessionSummary[]): SessionSummary[] {
  return [...items].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
  );
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? `${prefix}-${random}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
