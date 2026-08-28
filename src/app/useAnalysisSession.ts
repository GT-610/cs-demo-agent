import { useCallback, useEffect, useRef, useState } from "react";
import systemPrompt from "../agent/system-prompt.md?raw";
import { createProviderAdapter } from "../agent/providers";
import { AgentRuntime } from "../agent/runtime";
import { DEMO_TOOL_SPECS, HOST_SYSTEM_ADDENDUM } from "../agent/tools";
import type { AgentEvent } from "../agent/types";
import {
  createDemoToolExecutor,
  createHttpTransport,
  listenForDemoDrops,
  loadDemoOverview,
  selectDemoFile,
  type DemoToolResult,
} from "../bridge/tauri";
import type { Translator } from "../i18n";
import {
  createDefaultProvider,
  isProviderReady,
  type ProviderDraft,
} from "./state";
import type { ChatEntry, EvidenceEntry, StatusMessage } from "./types";
import { errorMessage } from "./display";

interface RuntimeCache {
  revision: number;
  runtime: AgentRuntime;
}

export type ProviderUpdater = (
  update: (current: ProviderDraft) => ProviderDraft,
) => void;

export function useAnalysisSession(t: Translator) {
  const [demoPath, setDemoPath] = useState("");
  const [header, setHeader] = useState<DemoToolResult | null>(null);
  const [players, setPlayers] = useState<DemoToolResult | null>(null);
  const [provider, setProvider] = useState<ProviderDraft>(() =>
    createDefaultProvider("openai-responses"),
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({
    key: "status.readyDemo",
  });
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef<RuntimeCache | null>(null);
  const sessionRevisionRef = useRef(0);
  const messageIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const loadIdRef = useRef(0);

  const providerReady = isProviderReady(provider);
  const canSend =
    !!demoPath && providerReady && !!draft.trim() && !sending && !demoLoading;

  const resetSession = useCallback((nextStatus: StatusMessage) => {
    sessionRevisionRef.current += 1;
    runtimeRef.current = null;
    setMessages([]);
    setEvidence([]);
    setError(null);
    setStatus(nextStatus);
  }, []);

  const clearSession = useCallback(() => {
    resetSession({
      key: demoPath ? "status.readyAnalysis" : "status.readyDemo",
    });
  }, [demoPath, resetSession]);

  const updateProvider = useCallback<ProviderUpdater>(
    (update) => {
      resetSession({
        key: demoPath ? "status.configurationChanged" : "status.readyDemo",
      });
      setProvider(update);
    },
    [demoPath, resetSession],
  );

  const openDemo = useCallback(
    async (path: string) => {
      const loadId = ++loadIdRef.current;
      setDemoLoading(true);
      setError(null);
      setStatus({ key: "status.readingDemo" });
      try {
        const overview = await loadDemoOverview(path);
        if (loadId !== loadIdRef.current) return;
        resetSession({ key: "status.demoReady" });
        setDemoPath(path);
        setHeader(overview.header);
        setPlayers(overview.players);
      } catch (caught) {
        if (loadId === loadIdRef.current) {
          setError(errorMessage(caught));
          setStatus({ key: "status.openFailed" });
        }
      } finally {
        if (loadId === loadIdRef.current) setDemoLoading(false);
      }
    },
    [resetSession],
  );

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void listenForDemoDrops((path) => void openDemo(path))
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
    try {
      const path = await selectDemoFile(t("demo.dialogTitle"));
      if (path) await openDemo(path);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [openDemo, t]);

  const applyAgentEvent = useCallback(
    (event: AgentEvent, turnId: number, revision: number) => {
      if (sessionRevisionRef.current !== revision) return;
      if (event.type === "assistant-start") {
        setStatus({
          key: "status.modelPass",
          params: { iteration: event.iteration },
        });
        return;
      }
      if (event.type === "tool-start") {
        setStatus({ key: "status.runningTool", toolName: event.call.name });
        setEvidence((current) => [
          ...current,
          {
            key: evidenceKey(turnId, event.iteration, event.call.id),
            call: event.call,
            iteration: event.iteration,
            status: "running",
          },
        ]);
        return;
      }
      if (event.type === "tool-result") {
        const key = evidenceKey(turnId, event.iteration, event.call.id);
        setEvidence((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  result: event.result,
                  status: event.ok ? "success" : "error",
                }
              : item,
          ),
        );
        return;
      }
      setStatus({ key: "status.analysisFailed" });
    },
    [],
  );

  const getRuntime = useCallback(
    (revision: number) => {
      if (runtimeRef.current?.revision === revision) {
        return runtimeRef.current.runtime;
      }
      const runtime = new AgentRuntime({
        adapter: createProviderAdapter(provider.kind, createHttpTransport()),
        config: { ...provider },
        tools: DEMO_TOOL_SPECS,
        executeTool: createDemoToolExecutor(demoPath),
        systemPrompt: `${systemPrompt}${HOST_SYSTEM_ADDENDUM}`,
      });
      runtimeRef.current = { revision, runtime };
      return runtime;
    },
    [demoPath, provider],
  );

  const submit = useCallback(async () => {
    if (!canSend) return;
    const question = draft.trim();
    const revision = sessionRevisionRef.current;
    const turnId = ++turnIdRef.current;
    setMessages((current) => [
      ...current,
      { id: ++messageIdRef.current, role: "user", content: question },
    ]);
    setDraft("");
    setError(null);
    setSending(true);
    setStatus({ key: "status.planning" });
    try {
      const reply = await getRuntime(revision).send(question, (event) =>
        applyAgentEvent(event, turnId, revision),
      );
      if (sessionRevisionRef.current !== revision) return;
      setMessages((current) => [
        ...current,
        {
          id: ++messageIdRef.current,
          role: "assistant",
          content: reply.text || t("chat.noFinalText"),
        },
      ]);
      setStatus({ key: "status.complete" });
    } catch (caught) {
      if (sessionRevisionRef.current === revision) {
        setError(errorMessage(caught));
        setStatus({ key: "status.analysisFailed" });
      }
    } finally {
      setSending(false);
    }
  }, [applyAgentEvent, canSend, draft, getRuntime, t]);

  return {
    demoPath,
    header,
    players,
    provider,
    providerReady,
    draft,
    messages,
    evidence,
    demoLoading,
    sending,
    status,
    error,
    canSend,
    setDraft,
    setError,
    updateProvider,
    chooseDemo,
    clearSession,
    submit,
  };
}

function evidenceKey(turnId: number, iteration: number, callId: string): string {
  return `${turnId}:${iteration}:${callId}`;
}
