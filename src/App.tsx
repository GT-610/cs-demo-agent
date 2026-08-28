import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import systemPrompt from "./agent/system-prompt.md?raw";
import { createProviderAdapter } from "./agent/providers";
import { AgentRuntime } from "./agent/runtime";
import { DEMO_TOOL_SPECS, HOST_SYSTEM_ADDENDUM } from "./agent/tools";
import type {
  AgentEvent,
  JsonObject,
  JsonValue,
  ProviderKind,
  ToolCall,
} from "./agent/types";
import {
  changeProviderKind,
  createDefaultProvider,
  isProviderReady,
  PROVIDER_LABELS,
  sessionKey,
  type ProviderDraft,
} from "./app/state";
import {
  createDemoToolExecutor,
  createHttpTransport,
  listenForDemoDrops,
  loadDemoOverview,
  selectDemoFile,
  type DemoToolResult,
} from "./bridge/tauri";

interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
}

interface EvidenceEntry {
  key: string;
  call: ToolCall;
  iteration: number;
  status: "running" | "success" | "error";
  result?: JsonValue;
}

interface RuntimeCache {
  key: string;
  runtime: AgentRuntime;
}

const TOOL_LABELS: Record<string, string> = {
  get_demo_header: "Demo header",
  get_player_info: "Player roster",
  list_game_events: "Game event index",
  query_events: "Event query",
  query_ticks: "Tick query",
  query_grenades: "Grenade trajectories",
  get_round_summary: "Round summary",
  get_economy_analysis: "Economy analysis",
};

export function App() {
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
  const [status, setStatus] = useState("Ready for a demo");
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef<RuntimeCache | null>(null);
  const messageIdRef = useRef(0);
  const loadIdRef = useRef(0);

  const providerReady = isProviderReady(provider);
  const canSend =
    !!demoPath && providerReady && !!draft.trim() && !sending && !demoLoading;
  const currentSessionKey = useMemo(
    () => sessionKey(demoPath, provider),
    [demoPath, provider],
  );

  const resetConversation = useCallback(() => {
    runtimeRef.current?.runtime.reset();
    runtimeRef.current = null;
    setMessages([]);
    setEvidence([]);
    setError(null);
    setStatus(demoPath ? "Ready for analysis" : "Ready for a demo");
  }, [demoPath]);

  useEffect(() => {
    if (runtimeRef.current && runtimeRef.current.key !== currentSessionKey) {
      runtimeRef.current = null;
      setMessages([]);
      setEvidence([]);
      setError(null);
      setStatus(demoPath ? "Configuration changed — ready" : "Ready for a demo");
    }
  }, [currentSessionKey, demoPath]);

  const openDemo = useCallback(async (path: string) => {
    const loadId = ++loadIdRef.current;
    setDemoLoading(true);
    setError(null);
    setStatus("Reading demo header and roster…");
    try {
      const overview = await loadDemoOverview(path);
      if (loadId !== loadIdRef.current) {
        return;
      }
      runtimeRef.current = null;
      setDemoPath(path);
      setHeader(overview.header);
      setPlayers(overview.players);
      setMessages([]);
      setEvidence([]);
      setStatus("Demo ready for analysis");
    } catch (caught) {
      if (loadId === loadIdRef.current) {
        setError(errorMessage(caught));
        setStatus("Could not open demo");
      }
    } finally {
      if (loadId === loadIdRef.current) {
        setDemoLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void listenForDemoDrops((path) => void openDemo(path))
      .then((unlisten) => {
        if (active) {
          dispose = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      dispose?.();
    };
  }, [openDemo]);

  const chooseDemo = useCallback(async () => {
    try {
      const path = await selectDemoFile();
      if (path) {
        await openDemo(path);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [openDemo]);

  const updateEvidence = useCallback((event: AgentEvent) => {
    if (event.type === "assistant-start") {
      setStatus(`Model pass ${event.iteration}…`);
      return;
    }
    if (event.type === "tool-start") {
      setStatus(`Running ${TOOL_LABELS[event.call.name] ?? event.call.name}…`);
      setEvidence((current) => [
        ...current,
        {
          key: evidenceKey(event.iteration, event.call),
          call: event.call,
          iteration: event.iteration,
          status: "running",
        },
      ]);
      return;
    }
    if (event.type === "tool-result") {
      const key = evidenceKey(event.iteration, event.call);
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
    if (event.type === "error") {
      setStatus("Analysis failed");
    }
  }, []);

  const getRuntime = useCallback(() => {
    if (runtimeRef.current?.key === currentSessionKey) {
      return runtimeRef.current.runtime;
    }
    const runtime = new AgentRuntime({
      adapter: createProviderAdapter(provider.kind, createHttpTransport()),
      config: { ...provider },
      tools: DEMO_TOOL_SPECS,
      executeTool: createDemoToolExecutor(demoPath),
      systemPrompt: `${systemPrompt}${HOST_SYSTEM_ADDENDUM}`,
    });
    runtimeRef.current = { key: currentSessionKey, runtime };
    return runtime;
  }, [currentSessionKey, demoPath, provider]);

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!canSend) {
        return;
      }
      const question = draft.trim();
      setMessages((current) => [
        ...current,
        { id: ++messageIdRef.current, role: "user", content: question },
      ]);
      setDraft("");
      setError(null);
      setSending(true);
      setStatus("Planning evidence queries…");
      try {
        const reply = await getRuntime().send(question, updateEvidence);
        setMessages((current) => [
          ...current,
          {
            id: ++messageIdRef.current,
            role: "assistant",
            content: reply.text || "The model returned no final text.",
          },
        ]);
        setStatus("Analysis complete");
      } catch (caught) {
        setError(errorMessage(caught));
        setStatus("Analysis failed");
      } finally {
        setSending(false);
      }
    },
    [canSend, draft, getRuntime, updateEvidence],
  );

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const headerObject = asObject(header?.data);
  const roster = asObjectArray(players?.data);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <CrosshairIcon />
        </div>
        <div className="brand-copy">
          <span className="eyebrow">LOCAL DEMO INTELLIGENCE</span>
          <strong>CS Demo Agent</strong>
        </div>
        <div className="topbar-status" title={status}>
          <span
            className={`status-dot ${sending || demoLoading ? "is-busy" : ""}`}
          />
          {status}
        </div>
        <button
          className="ghost-button compact-button"
          type="button"
          onClick={resetConversation}
          disabled={sending || (messages.length === 0 && evidence.length === 0)}
        >
          Clear session
        </button>
      </header>

      <aside className="sidebar">
        <section className="panel-section demo-section">
          <SectionHeading number="01" title="Demo source" />
          <button
            className={`drop-zone ${demoPath ? "has-demo" : ""}`}
            type="button"
            onClick={() => void chooseDemo()}
            disabled={demoLoading || sending}
          >
            <span className="drop-icon" aria-hidden="true">
              {demoLoading ? <SpinnerIcon /> : <UploadIcon />}
            </span>
            <strong>
              {demoLoading
                ? "Parsing overview…"
                : demoPath
                  ? fileName(demoPath)
                  : "Drop a .dem file here"}
            </strong>
            <span>{demoPath ? "Click to choose another" : "or click to browse"}</span>
          </button>
          {demoPath && (
            <div className="file-path" title={demoPath}>
              {demoPath}
            </div>
          )}
          {headerObject && <DemoFacts header={headerObject} />}
        </section>

        <section className="panel-section roster-section">
          <SectionHeading number="02" title="Player roster" count={roster.length} />
          {roster.length === 0 ? (
            <p className="empty-copy">Select a demo to inspect its recorded roster.</p>
          ) : (
            <div className="roster-list">
              {roster.map((player, index) => (
                <PlayerRow player={player} index={index} key={playerKey(player, index)} />
              ))}
            </div>
          )}
        </section>

        <section className="panel-section provider-section">
          <SectionHeading number="03" title="Model provider" />
          <label className="field-label">
            Protocol
            <select
              value={provider.kind}
              disabled={sending}
              onChange={(event) =>
                setProvider((current) =>
                  changeProviderKind(current, event.target.value as ProviderKind),
                )
              }
            >
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ProviderInput
            label="Base URL"
            type="url"
            value={provider.baseUrl}
            disabled={sending}
            onChange={(value) => setProvider((current) => ({ ...current, baseUrl: value }))}
          />
          <ProviderInput
            label="Model"
            value={provider.model}
            placeholder={provider.kind === "anthropic" ? "claude-…" : "gpt-…"}
            disabled={sending}
            onChange={(value) => setProvider((current) => ({ ...current, model: value }))}
          />
          <ProviderInput
            label="API key"
            type="password"
            value={provider.apiKey}
            placeholder="Session only"
            disabled={sending}
            onChange={(value) => setProvider((current) => ({ ...current, apiKey: value }))}
          />
          <p className="privacy-note">
            <LockIcon /> Keys stay in memory. Raw demo bytes never leave this device.
          </p>
        </section>
      </aside>

      <main className="workspace">
        <section className="conversation" aria-label="Analysis conversation">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">EVIDENCE-BACKED CHAT</span>
              <h1>Match analysis</h1>
            </div>
            <span className="provider-pill">{PROVIDER_LABELS[provider.kind]}</span>
          </div>

          <div className="message-stream" aria-live="polite">
            {messages.length === 0 ? (
              <EmptyConversation hasDemo={!!demoPath} providerReady={providerReady} />
            ) : (
              messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <div className="message-role">
                    {message.role === "assistant" ? <CrosshairIcon /> : <span>YOU</span>}
                  </div>
                  <div className="message-body">
                    {message.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </article>
              ))
            )}
            {sending && (
              <article className="message message-assistant pending-message">
                <div className="message-role">
                  <SpinnerIcon />
                </div>
                <div className="thinking-bars" aria-label="Agent is working">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            )}
          </div>

          <form className="composer" onSubmit={(event) => void submit(event)}>
            {error && (
              <div className="error-banner" role="alert">
                <strong>Request failed</strong>
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)}>
                  Dismiss
                </button>
              </div>
            )}
            <div className="composer-box">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={sending}
                rows={3}
                placeholder={composerPlaceholder(!!demoPath, providerReady)}
                aria-label="Ask about the selected demo"
              />
              <button className="send-button" type="submit" disabled={!canSend}>
                <span>{sending ? "Analyzing" : "Analyze"}</span>
                <ArrowIcon />
              </button>
            </div>
            <div className="composer-hint">
              <span>Enter to send · Shift+Enter for a new line</span>
              <span>Answers cite parsed events, rounds, and ticks</span>
            </div>
          </form>
        </section>

        <aside className="evidence-panel" aria-label="Tool evidence">
          <div className="evidence-heading">
            <div>
              <span className="eyebrow">TRACE</span>
              <h2>Evidence</h2>
            </div>
            <span className="evidence-count">{evidence.length}</span>
          </div>
          <p className="evidence-intro">
            Every claim can be traced to a local parser query. Expand an item to
            inspect its inputs and result preview.
          </p>
          <div className="evidence-list">
            {evidence.length === 0 ? (
              <div className="evidence-empty">
                <PulseIcon />
                <strong>No queries yet</strong>
                <span>Tool calls will appear here during analysis.</span>
              </div>
            ) : (
              evidence.map((item, index) => (
                <EvidenceCard item={item} index={index} key={item.key} />
              ))
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function SectionHeading({
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

function DemoFacts({ header }: { header: JsonObject }) {
  return (
    <div className="demo-facts">
      <Fact label="Map" value={readString(header, "map_name", "mapName") || "Unknown"} accent />
      <Fact label="Server" value={readString(header, "server_name", "serverName") || "Not recorded"} />
      <Fact label="Format" value={readString(header, "demo_version_name", "demoVersionName") || "Source 2 demo"} />
      <Fact label="Protocol" value={readString(header, "network_protocol", "networkProtocol") || "—"} />
    </div>
  );
}

function PlayerRow({ player, index }: { player: JsonObject; index: number }) {
  const name = readString(player, "name", "player_name") || `Player ${index + 1}`;
  const steamId = readString(player, "steamid", "steam_id");
  const team = readNumber(player, "team_number", "team_num");
  return (
    <div className="player-row">
      <span className={`team-chip team-${team ?? 0}`}>
        {team === 2 ? "T" : team === 3 ? "CT" : "—"}
      </span>
      <span className="player-name" title={steamId || name}>
        {name}
      </span>
    </div>
  );
}

function ProviderInput({
  label,
  type = "text",
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  type?: "text" | "url" | "password";
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function EvidenceCard({ item, index }: { item: EvidenceEntry; index: number }) {
  const meta = readMeta(item.result);
  return (
    <details className={`evidence-card status-${item.status}`}>
      <summary>
        <span className="evidence-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="evidence-name">
          <strong>{TOOL_LABELS[item.call.name] ?? item.call.name}</strong>
          <small>Pass {item.iteration}</small>
        </span>
        <span className="evidence-state">
          {item.status === "running" ? <SpinnerIcon /> : item.status}
        </span>
      </summary>
      <div className="evidence-detail">
        <div className="evidence-tags">
          {meta.sampled && <span>sampled</span>}
          {meta.truncated && <span>truncated</span>}
          {typeof meta.rowCount === "number" && <span>{meta.rowCount} rows</span>}
        </div>
        <h3>Arguments</h3>
        <pre>{formatJsonString(item.call.arguments)}</pre>
        {item.result !== undefined && (
          <>
            <h3>Result preview</h3>
            <pre>{previewJson(item.result)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function EmptyConversation({ hasDemo, providerReady }: { hasDemo: boolean; providerReady: boolean }) {
  const title = !hasDemo ? "Load a match to begin" : !providerReady ? "Configure a model" : "Ask for a verifiable analysis";
  const detail = !hasDemo
    ? "Choose or drop a Counter-Strike 2 .dem file. The parser reads it locally."
    : !providerReady
      ? "Enter a valid provider base URL and model name in the left panel."
      : "Try a match overview, a round-by-round review, economy analysis, or a player performance question.";
  return (
    <div className="conversation-empty">
      <div className="radar-graphic" aria-hidden="true">
        <span />
        <span />
        <CrosshairIcon />
      </div>
      <span className="empty-kicker">ANALYSIS WORKSPACE</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {hasDemo && providerReady && (
        <div className="prompt-examples">
          <span>“Give me the match overview”</span>
          <span>“Which rounds decided the game?”</span>
          <span>“Analyze both teams’ economy”</span>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="fact-row">
      <span>{label}</span>
      <strong className={accent ? "accent-text" : ""} title={value}>{value}</strong>
    </div>
  );
}

function composerPlaceholder(hasDemo: boolean, providerReady: boolean): string {
  if (!hasDemo) return "Select a demo before asking a question…";
  if (!providerReady) return "Enter a model name and valid provider URL…";
  return "Ask about rounds, players, economy, utility, positioning…";
}

function evidenceKey(iteration: number, call: ToolCall): string {
  return `${iteration}:${call.id}`;
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object" ? value : null;
}

function asObjectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => !!item && !Array.isArray(item) && typeof item === "object")
    : [];
}

function readString(object: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function readNumber(object: JsonObject, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function readMeta(value: JsonValue | undefined): { sampled: boolean; truncated: boolean; rowCount?: number } {
  const result = asObject(value);
  const meta = asObject(result?.meta);
  return {
    sampled: meta?.sampled === true,
    truncated: meta?.truncated === true,
    rowCount: typeof meta?.row_count === "number" ? meta.row_count : undefined,
  };
}

function formatJsonString(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function previewJson(value: JsonValue): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 2600 ? `${serialized.slice(0, 2600)}\n… preview limited in the interface` : serialized;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function playerKey(player: JsonObject, index: number): string {
  return `${readString(player, "steamid", "steam_id")}-${readString(player, "name", "player_name")}-${index}`;
}

function CrosshairIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></svg>;
}

function UploadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 14v5h14v-5" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
}

function PulseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
}

function SpinnerIcon() {
  return <svg className="spinner-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 8 8" /></svg>;
}
