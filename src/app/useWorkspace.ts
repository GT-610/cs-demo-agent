import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { isAbortError } from "../agent/cancellation";
import systemPrompt from "../agent/system-prompt.md?raw";
import { createProviderAdapter } from "../agent/providers";
import { AgentRuntime } from "../agent/runtime";
import { DEMO_TOOL_SPECS, HOST_SYSTEM_ADDENDUM } from "../agent/tools";
import type { AgentEvent, AgentRuntimeState, JsonValue, ProviderKind } from "../agent/types";
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
  createDefaultSettings,
  createProviderConfig,
  getDefaultProviderProfile,
  getDefaultModel,
  getProviderProfile,
  isProviderReady,
  normalizeSettings,
  settingsEqual,
  type SettingsValidationIssue,
  validateSettings,
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
  providerId: string;
  providerKind: ProviderKind;
  baseUrl: string;
  model: string;
  runtime: AgentRuntime;
}

interface RunningTask {
  controller: AbortController;
  promise: Promise<void>;
}

interface SessionWorkspace {
  conversation: ConversationState;
  runtime?: RuntimeCache;
  task?: RunningTask;
  error: string | null;
  status: StatusMessage;
}

export function useWorkspace(initialLocale: Locale) {
  const initialSettings = createDefaultSettings(initialLocale);
  const [settings, setSettingsState] = useState<StoredSettings>(initialSettings);
  const [settingsDraft, setSettingsDraftState] = useState<StoredSettings>(initialSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
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
  const [newSessionSending, setNewSessionSending] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage>({ key: "status.readyDemo" });

  const settingsRef = useRef(settings);
  const settingsDraftRef = useRef(settingsDraft);
  const settingsSavingRef = useRef(false);
  const pendingSessionRef = useRef<AbortController | null>(null);
  const conversationRef = useRef(conversation);
  const activeSessionIdRef = useRef<string | null>(null);
  const pageRef = useRef<WorkspacePage>("conversation");
  const sessionWorkspacesRef = useRef(new Map<string, SessionWorkspace>());
  const bootstrapLoadRef = useRef(0);
  const navigationRef = useRef(0);
  const demoLoadRef = useRef(0);

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

  const replacePage = useCallback((next: WorkspacePage) => {
    pageRef.current = next;
    setPage(next);
  }, []);

  const updateSessionConversation = useCallback(
    (
      sessionId: string,
      update: (current: ConversationState) => ConversationState,
    ) => {
      const workspace = sessionWorkspacesRef.current.get(sessionId);
      if (!workspace) return;
      const next = update(workspace.conversation);
      workspace.conversation = next;
      if (
        activeSessionIdRef.current === sessionId &&
        pageRef.current === "conversation"
      ) {
        replaceConversation(next);
      }
    },
    [replaceConversation],
  );

  const setSessionFeedback = useCallback(
    (
      sessionId: string,
      next: { error?: string | null; status?: StatusMessage },
    ) => {
      const workspace = sessionWorkspacesRef.current.get(sessionId);
      if (!workspace) return;
      if ("error" in next) workspace.error = next.error ?? null;
      if (next.status) workspace.status = next.status;
      if (
        activeSessionIdRef.current === sessionId &&
        pageRef.current === "conversation"
      ) {
        if ("error" in next) setError(next.error ?? null);
        if (next.status) setStatus(next.status);
      }
    },
    [],
  );

  const setActiveError = useCallback((next: string | null) => {
    setError(next);
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      const workspace = sessionWorkspacesRef.current.get(sessionId);
      if (workspace) workspace.error = next;
    }
  }, []);

  const updateSettingsDraft = useCallback(
    (update: (current: StoredSettings) => StoredSettings) => {
      const next = update(settingsDraftRef.current);
      settingsDraftRef.current = next;
      setSettingsDraftState(next);
      setSettingsDirty(!settingsEqual(settingsRef.current, next));
      setSettingsSaveError(null);
    },
    [],
  );

  const saveSettings = useCallback(async () => {
    if (settingsSavingRef.current) return;
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    setSettingsSaveError(null);
    const draftAtStart = settingsDraftRef.current;
    try {
      const next = normalizeSettings(draftAtStart, initialLocale);
      const validationIssue = validateSettings(next);
      if (validationIssue) {
        throw new Error(settingsValidationMessage(next.locale, validationIssue));
      }
      await saveStoredSettings(next);
      settingsRef.current = next;
      setSettingsState(next);
      if (settingsDraftRef.current === draftAtStart) {
        settingsDraftRef.current = next;
        setSettingsDraftState(next);
        setSettingsDirty(false);
      } else {
        setSettingsDirty(!settingsEqual(next, settingsDraftRef.current));
      }
      for (const workspace of sessionWorkspacesRef.current.values()) {
        workspace.runtime = undefined;
      }
      setStatus({ key: "status.configurationChanged" });
    } catch (caught) {
      setSettingsSaveError(errorMessage(caught));
    } finally {
      settingsSavingRef.current = false;
      setSettingsSaving(false);
    }
  }, [initialLocale]);

  useEffect(() => {
    let active = true;
    const loadId = ++bootstrapLoadRef.current;
    const navigationId = navigationRef.current;
    void loadWorkspace()
      .then((snapshot) => {
        if (!active || bootstrapLoadRef.current !== loadId) return;
        const loadedSettings = normalizeSettings(snapshot.settings, initialLocale);
        settingsRef.current = loadedSettings;
        settingsDraftRef.current = loadedSettings;
        setSettingsState(loadedSettings);
        setSettingsDraftState(loadedSettings);
        setSessions(snapshot.sessions);
        if (navigationRef.current === navigationId) {
          replaceConversation(createEmptyConversation(loadedSettings));
        }
      })
      .catch((caught) => {
        if (
          active &&
          bootstrapLoadRef.current === loadId &&
          navigationRef.current === navigationId
        ) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (active && bootstrapLoadRef.current === loadId) setInitialized(true);
      });
    return () => {
      active = false;
    };
  }, [initialLocale, replaceConversation]);

  const cancelDemoLoad = useCallback(() => {
    demoLoadRef.current += 1;
    setDemoLoading(false);
  }, []);

  useEffect(() => {
    if (activeSessionId !== null) return;
    const profile = getProviderProfile(settings, conversation.providerId);
    if (profile?.models.includes(conversation.model)) return;
    mutateConversation((current) => selectDefaultProvider(current, settings));
  }, [activeSessionId, conversation.model, conversation.providerId, mutateConversation, settings]);

  const startNewSession = useCallback(() => {
    navigationRef.current += 1;
    cancelDemoLoad();
    setSessionLoading(false);
    setActiveSessionId(null);
    replacePage("conversation");
    setDraft("");
    setError(null);
    setStatus({ key: "status.readyDemo" });
    replaceConversation(createEmptyConversation(settingsRef.current));
  }, [cancelDemoLoad, replaceConversation, replacePage, setActiveSessionId]);

  const openSettings = useCallback(() => {
    navigationRef.current += 1;
    cancelDemoLoad();
    setSessionLoading(false);
    replacePage("settings");
  }, [cancelDemoLoad, replacePage]);

  const openSession = useCallback(
    async (id: string) => {
      const cached = sessionWorkspacesRef.current.get(id);
      if (cached) {
        navigationRef.current += 1;
        cancelDemoLoad();
        setSessionLoading(false);
        setActiveSessionId(id);
        replacePage("conversation");
        setDraft("");
        replaceConversation(cached.conversation);
        setError(cached.error);
        setStatus(cached.status);
        return;
      }
      cancelDemoLoad();
      const loadId = ++navigationRef.current;
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
        if (navigationRef.current !== loadId) return;
        const workspace: SessionWorkspace = {
          conversation: {
            demoPath: detail.demoPath,
            header: overview.header,
            players: overview.players,
            providerId: detail.providerId,
            model: detail.model,
            entries: deserializeTimeline(detail.messages),
            runtimeState: detail.runtimeState as AgentRuntimeState | undefined,
          },
          error: null,
          status: { key: "status.readyAnalysis" },
        };
        sessionWorkspacesRef.current.set(id, workspace);
        setActiveSessionId(id);
        replacePage("conversation");
        setDraft("");
        replaceConversation(workspace.conversation);
        setStatus(workspace.status);
      } catch (caught) {
        if (navigationRef.current === loadId) {
          setError(errorMessage(caught));
          setStatus({ key: "status.openFailed" });
        }
      } finally {
        if (navigationRef.current === loadId) setSessionLoading(false);
      }
    },
    [cancelDemoLoad, replaceConversation, replacePage, sessions, setActiveSessionId],
  );

  const openDemo = useCallback(
    async (path: string, forceNew = false) => {
      if (forceNew || activeSessionIdRef.current !== null) startNewSession();
      navigationRef.current += 1;
      setSessionLoading(false);
      const loadId = ++demoLoadRef.current;
      setDemoLoading(true);
      setError(null);
      setStatus({ key: "status.readingDemo" });
      try {
        const overview = await loadDemoOverview(path);
        if (demoLoadRef.current !== loadId) return;
        replaceConversation({
          ...createEmptyConversation(settingsRef.current),
          demoPath: path,
          header: overview.header,
          players: overview.players,
        });
        setActiveSessionId(null);
        replacePage("conversation");
        setStatus({ key: "status.demoReady" });
      } catch (caught) {
        if (demoLoadRef.current === loadId) {
          setError(errorMessage(caught));
          setStatus({ key: "status.openFailed" });
        }
      } finally {
        if (demoLoadRef.current === loadId) setDemoLoading(false);
      }
    },
    [replaceConversation, replacePage, setActiveSessionId, startNewSession],
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
    if (activeSessionIdRef.current !== null || demoLoading) return;
    try {
      const path = await selectDemoFile(
        translate(settingsRef.current.locale, "demo.dialogTitle"),
      );
      if (path) await openDemo(path);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [demoLoading, openDemo]);

  const selectModel = useCallback(
    async (option: ModelOption) => {
      const sessionId = activeSessionIdRef.current;
      if (
        pendingSessionRef.current ||
        (sessionId && sessionWorkspacesRef.current.get(sessionId)?.task)
      ) {
        return;
      }
      const current = conversationRef.current;
      const next = {
        ...current,
        providerId: option.providerId,
        model: option.model,
      };
      replaceConversation(next);
      if (!sessionId) return;
      const workspace = sessionWorkspacesRef.current.get(sessionId);
      if (workspace) {
        workspace.conversation = next;
        workspace.runtime = undefined;
      }
      const updatedAt = Date.now();
      setSessions((items) =>
        sortSessions(
          items.map((item) =>
            item.id === sessionId
              ? {
                  ...item,
                  providerId: option.providerId,
                  model: option.model,
                  updatedAt,
                }
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
    [replaceConversation],
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

  const stopSession = useCallback(
    (id: string | null = activeSessionIdRef.current) => {
      if (!id) {
        const pending = pendingSessionRef.current;
        if (!pending || pending.signal.aborted) return;
        setStatus({ key: "status.stopping" });
        pending.abort();
        return;
      }
      const task = sessionWorkspacesRef.current.get(id)?.task;
      if (!task || task.controller.signal.aborted) return;
      task.controller.abort();
      setSessionFeedback(id, { status: { key: "status.stopping" } });
    },
    [setSessionFeedback],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      navigationRef.current += 1;
      setSessionLoading(false);
      const workspace = sessionWorkspacesRef.current.get(id);
      if (workspace?.task) {
        workspace.task.controller.abort();
        await workspace.task.promise;
      }
      await deleteStoredSession(id);
      sessionWorkspacesRef.current.delete(id);
      setRunningSessionIds((current) => withoutSession(current, id));
      setSessions((items) => items.filter((item) => item.id !== id));
      if (activeSessionIdRef.current === id) startNewSession();
    },
    [startNewSession],
  );

  const runSessionTask = useCallback(
    (
      sessionId: string,
      workspace: SessionWorkspace,
      question: string,
      turnId: string,
      controller: AbortController,
    ): Promise<void> => {
      let cache: RuntimeCache;
      try {
        cache = getRuntime(
          sessionId,
          workspace.conversation,
          settingsRef.current,
          workspace.runtime,
        );
      } catch (caught) {
        setSessionFeedback(sessionId, {
          error: errorMessage(caught),
          status: { key: "status.analysisFailed" },
        });
        void persistConversation(
          sessionId,
          workspace.conversation,
          Date.now(),
        ).catch(() => undefined);
        return Promise.resolve();
      }
      workspace.runtime = cache;
      const task: RunningTask = {
        controller,
        promise: Promise.resolve(),
      };
      workspace.task = task;
      workspace.error = null;
      workspace.status = { key: "status.planning" };
      setRunningSessionIds((current) => withSession(current, sessionId));
      setSessionFeedback(sessionId, {
        error: null,
        status: workspace.status,
      });

      task.promise = (async () => {
        try {
          await cache.runtime.send(
            question,
            (event) => {
              applyAgentEvent(
                event,
                turnId,
                (update) => updateSessionConversation(sessionId, update),
                (nextStatus) =>
                  setSessionFeedback(sessionId, { status: nextStatus }),
              );
            },
            controller.signal,
          );
          updateSessionConversation(sessionId, (current) => ({
            ...current,
            runtimeState: cache.runtime.state,
          }));
          setSessionFeedback(sessionId, { status: { key: "status.complete" } });
          try {
            const updatedAt = Date.now();
            await persistConversation(
              sessionId,
              workspace.conversation,
              updatedAt,
            );
            setSessions((items) =>
              sortSessions(
                items.map((item) =>
                  item.id === sessionId
                    ? {
                        ...item,
                        providerId:
                          workspace.conversation.providerId ?? item.providerId,
                        model: workspace.conversation.model,
                        updatedAt,
                      }
                    : item,
                ),
              ),
            );
          } catch (caught) {
            setSessionFeedback(sessionId, { error: errorMessage(caught) });
          }
        } catch (caught) {
          const stopped = controller.signal.aborted || isAbortError(caught);
          settleInterruptedEntries((update) =>
            updateSessionConversation(sessionId, update),
          );
          updateSessionConversation(sessionId, (current) => ({
            ...current,
            runtimeState: cache.runtime.state,
          }));
          setSessionFeedback(sessionId, {
            error: stopped ? null : errorMessage(caught),
            status: {
              key: stopped ? "status.stopped" : "status.analysisFailed",
            },
          });
          await persistConversation(
            sessionId,
            workspace.conversation,
            Date.now(),
          ).catch(() => undefined);
        } finally {
          if (workspace.task === task) workspace.task = undefined;
          setRunningSessionIds((current) => withoutSession(current, sessionId));
        }
      })();

      return task.promise;
    },
    [setSessionFeedback, updateSessionConversation],
  );

  const submit = useCallback(async () => {
    const question = draft.trim();
    const initial = conversationRef.current;
    const profile = getProviderProfile(settingsRef.current, initial.providerId);
    const currentSessionId = activeSessionIdRef.current;
    const currentWorkspace = currentSessionId
      ? sessionWorkspacesRef.current.get(currentSessionId)
      : undefined;
    if (
      !question ||
      !initial.demoPath ||
      !profile ||
      !isProviderReady(profile, initial.model) ||
      pendingSessionRef.current ||
      currentWorkspace?.task ||
      demoLoading
    ) {
      return;
    }

    const turnId = createId("turn");
    const userEntry: TimelineEntry = {
      id: `${turnId}:user`,
      kind: "user",
      content: question,
    };
    const startedConversation: ConversationState = {
      ...initial,
      entries: [...initial.entries, userEntry],
    };
    replaceConversation(startedConversation);
    if (currentWorkspace) currentWorkspace.conversation = startedConversation;
    setDraft("");
    setError(null);
    setStatus({ key: "status.planning" });

    if (currentSessionId && currentWorkspace) {
      await runSessionTask(
        currentSessionId,
        currentWorkspace,
        question,
        turnId,
        new AbortController(),
      );
      return;
    }

    const controller = new AbortController();
    const originLoadId = navigationRef.current;
    pendingSessionRef.current = controller;
    setNewSessionSending(true);
    try {
      const created = await createStoredSession({
        id: createId("session"),
        title: titleFromPrompt(question),
        demoPath: initial.demoPath,
        providerId: profile.id,
        model: initial.model,
        createdAt: Date.now(),
      });
      const workspace: SessionWorkspace = {
        conversation: startedConversation,
        error: null,
        status: { key: "status.planning" },
      };
      sessionWorkspacesRef.current.set(created.id, workspace);
      setSessions((items) => sortSessions([created, ...items]));
      if (
        navigationRef.current === originLoadId &&
        activeSessionIdRef.current === null &&
        pageRef.current === "conversation"
      ) {
        setActiveSessionId(created.id);
        replaceConversation(workspace.conversation);
      }
      pendingSessionRef.current = null;
      setNewSessionSending(false);
      await runSessionTask(
        created.id,
        workspace,
        question,
        turnId,
        controller,
      );
    } catch (caught) {
      if (
        navigationRef.current === originLoadId &&
        activeSessionIdRef.current === null &&
        pageRef.current === "conversation"
      ) {
        settleInterruptedEntries((update) =>
          replaceConversation(update(conversationRef.current)),
        );
        setError(errorMessage(caught));
        setStatus({ key: "status.analysisFailed" });
      }
    } finally {
      if (pendingSessionRef.current === controller) {
        pendingSessionRef.current = null;
        setNewSessionSending(false);
      }
    }
  }, [
    demoLoading,
    draft,
    replaceConversation,
    runSessionTask,
    setActiveSessionId,
  ]);

  const profile = getProviderProfile(settings, conversation.providerId);
  const providerReady = isProviderReady(profile, conversation.model);
  const sending = activeSessionId
    ? runningSessionIds.has(activeSessionId)
    : newSessionSending;
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
    settingsDraft,
    settingsDirty,
    settingsSaving,
    settingsSaveError,
    updateSettingsDraft,
    saveSettings,
    dismissSettingsSaveError: () => setSettingsSaveError(null),
    sessions,
    runningSessionIds,
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
    modelOptions: createModelOptions(settings, conversation),
    setDraft,
    setError: setActiveError,
    startNewSession,
    openSettings,
    openSession,
    chooseDemo,
    selectModel,
    renameSession,
    deleteSession,
    submit,
    stop: () => stopSession(),
  };
}

function createEmptyConversation(settings: StoredSettings): ConversationState {
  const provider = getDefaultProviderProfile(settings);
  return {
    demoPath: "",
    header: null,
    players: null,
    providerId: provider?.id ?? null,
    model: getDefaultModel(settings),
    entries: [],
  };
}

function createModelOptions(
  settings: StoredSettings,
  conversation: ConversationState,
): ModelOption[] {
  return settings.providers.flatMap((profile) =>
    [...new Set([
      ...(profile.id === conversation.providerId ? [conversation.model] : []),
      ...profile.models,
    ].filter(Boolean))].map((model) => ({
      providerId: profile.id,
      providerKind: profile.kind,
      providerName: profile.name,
      model,
    })),
  );
}

function getRuntime(
  sessionId: string,
  conversation: ConversationState,
  settings: StoredSettings,
  cached: RuntimeCache | undefined,
): RuntimeCache {
  const profile = getProviderProfile(settings, conversation.providerId);
  if (!profile) throw new Error("The selected provider is no longer available");
  if (
    cached?.sessionId === sessionId &&
    cached.providerId === profile.id &&
    cached.providerKind === profile.kind &&
    cached.baseUrl === profile.baseUrl &&
    cached.model === conversation.model
  ) {
    return cached;
  }
  const runtime = new AgentRuntime({
    adapter: createProviderAdapter(
      profile.kind,
      createHttpStreamTransport(),
    ),
    config: createProviderConfig(profile, conversation.model),
    tools: DEMO_TOOL_SPECS,
    executeTool: createDemoToolExecutor(conversation.demoPath),
    systemPrompt: `${systemPrompt}${HOST_SYSTEM_ADDENDUM}`,
    initialState: conversation.runtimeState,
  });
  return {
    sessionId,
    providerId: profile.id,
    providerKind: profile.kind,
    baseUrl: profile.baseUrl,
    model: conversation.model,
    runtime,
  };
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
    entries: current.entries.flatMap((entry) => {
      if (entry.kind === "assistant" && entry.status === "streaming") {
        return entry.content ? [{ ...entry, status: "complete" }] : [];
      }
      if (entry.kind === "tool" && entry.status === "running") {
        return [{ ...entry, status: "error" }];
      }
      return [entry];
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
    providerId: requireProviderId(conversation.providerId),
    model: conversation.model,
    messages: serializeTimeline(conversation.entries),
    runtimeState: conversation.runtimeState as unknown as JsonValue | undefined,
    updatedAt,
  });
}

function selectDefaultProvider(
  conversation: ConversationState,
  settings: StoredSettings,
): ConversationState {
  const provider = getDefaultProviderProfile(settings);
  return {
    ...conversation,
    providerId: provider?.id ?? null,
    model: provider?.models[0] ?? "",
  };
}

function requireProviderId(providerId: string | null): string {
  if (!providerId) throw new Error("A provider must be selected");
  return providerId;
}

function settingsValidationMessage(
  locale: Locale,
  issue: SettingsValidationIssue,
): string {
  switch (issue.type) {
    case "duplicateProviderId":
      return translate(locale, "settings.errorDuplicateProviderId");
    case "providerName":
      return translate(locale, "settings.errorProviderName");
    case "providerConnection":
      return translate(locale, "settings.errorProviderConnection", {
        name: issue.providerName ?? "",
      });
    case "defaultProvider":
      return translate(locale, "settings.errorDefaultProvider");
  }
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

function withSession(current: Set<string>, sessionId: string): Set<string> {
  if (current.has(sessionId)) return current;
  const next = new Set(current);
  next.add(sessionId);
  return next;
}

function withoutSession(current: Set<string>, sessionId: string): Set<string> {
  if (!current.has(sessionId)) return current;
  const next = new Set(current);
  next.delete(sessionId);
  return next;
}
