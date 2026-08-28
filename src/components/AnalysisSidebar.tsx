import type { JsonObject, ProviderKind } from "../agent/types";
import {
  asObject,
  asObjectArray,
  fileName,
  LockIcon,
  readNumber,
  readString,
  SectionHeading,
  SpinnerIcon,
  UploadIcon,
} from "../app/display";
import {
  changeProviderKind,
  PROVIDER_LABELS,
  type ProviderDraft,
} from "../app/state";
import type { ProviderUpdater } from "../app/useAnalysisSession";
import type { DemoToolResult } from "../bridge/tauri";
import type { Translator } from "../i18n";

export function AnalysisSidebar({
  demoPath,
  header,
  players,
  provider,
  demoLoading,
  sending,
  onChooseDemo,
  updateProvider,
  t,
}: {
  demoPath: string;
  header: DemoToolResult | null;
  players: DemoToolResult | null;
  provider: ProviderDraft;
  demoLoading: boolean;
  sending: boolean;
  onChooseDemo: () => Promise<void>;
  updateProvider: ProviderUpdater;
  t: Translator;
}) {
  const headerObject = asObject(header?.data);
  const roster = asObjectArray(players?.data);
  return (
    <aside className="sidebar">
      <section className="panel-section demo-section">
        <SectionHeading number="01" title={t("demo.section")} />
        <button
          className={`drop-zone ${demoPath ? "has-demo" : ""}`}
          type="button"
          onClick={() => void onChooseDemo()}
          disabled={demoLoading || sending}
        >
          <span className="drop-icon" aria-hidden="true">
            {demoLoading ? <SpinnerIcon /> : <UploadIcon />}
          </span>
          <strong>
            {demoLoading
              ? t("demo.parsing")
              : demoPath
                ? fileName(demoPath)
                : t("demo.drop")}
          </strong>
          <span>{demoPath ? t("demo.change") : t("demo.browse")}</span>
        </button>
        {demoPath && (
          <div className="file-path" title={demoPath}>
            {demoPath}
          </div>
        )}
        {headerObject && <DemoFacts header={headerObject} t={t} />}
      </section>

      <section className="panel-section roster-section">
        <SectionHeading
          number="02"
          title={t("roster.section")}
          count={roster.length}
        />
        {roster.length === 0 ? (
          <p className="empty-copy">{t("roster.empty")}</p>
        ) : (
          <div className="roster-list">
            {roster.map((player, index) => (
              <PlayerRow
                player={player}
                index={index}
                key={playerKey(player, index)}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel-section provider-section">
        <SectionHeading number="03" title={t("provider.section")} />
        <label className="field-label">
          {t("provider.protocol")}
          <select
            value={provider.kind}
            disabled={sending}
            onChange={(event) =>
              updateProvider((current) =>
                changeProviderKind(
                  current,
                  event.target.value as ProviderKind,
                ),
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
          label={t("provider.baseUrl")}
          type="url"
          value={provider.baseUrl}
          disabled={sending}
          onChange={(value) =>
            updateProvider((current) => ({ ...current, baseUrl: value }))
          }
        />
        <ProviderInput
          label={t("provider.model")}
          value={provider.model}
          placeholder={provider.kind === "anthropic" ? "claude-…" : "gpt-…"}
          disabled={sending}
          onChange={(value) =>
            updateProvider((current) => ({ ...current, model: value }))
          }
        />
        <ProviderInput
          label={t("provider.apiKey")}
          type="password"
          value={provider.apiKey}
          placeholder={t("provider.sessionOnly")}
          disabled={sending}
          onChange={(value) =>
            updateProvider((current) => ({ ...current, apiKey: value }))
          }
        />
        <p className="privacy-note">
          <LockIcon /> {t("provider.privacy")}
        </p>
      </section>
    </aside>
  );
}

function DemoFacts({ header, t }: { header: JsonObject; t: Translator }) {
  return (
    <div className="demo-facts">
      <Fact
        label={t("facts.map")}
        value={readString(header, "map_name", "mapName") || t("facts.unknown")}
        accent
      />
      <Fact
        label={t("facts.server")}
        value={
          readString(header, "server_name", "serverName") ||
          t("facts.notRecorded")
        }
      />
      <Fact
        label={t("facts.format")}
        value={
          readString(header, "demo_version_name", "demoVersionName") ||
          t("facts.source2")
        }
      />
      <Fact
        label={t("facts.protocol")}
        value={readString(header, "network_protocol", "networkProtocol") || "—"}
      />
    </div>
  );
}

function PlayerRow({
  player,
  index,
  t,
}: {
  player: JsonObject;
  index: number;
  t: Translator;
}) {
  const name =
    readString(player, "name", "player_name") ||
    t("roster.player", { number: index + 1 });
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

function Fact({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="fact-row">
      <span>{label}</span>
      <strong className={accent ? "accent-text" : ""} title={value}>
        {value}
      </strong>
    </div>
  );
}

function playerKey(player: JsonObject, index: number): string {
  return `${readString(player, "steamid", "steam_id")}-${readString(
    player,
    "name",
    "player_name",
  )}-${index}`;
}
