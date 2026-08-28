import type { JsonValue } from "../agent/types";
import {
  asObject,
  PulseIcon,
  SpinnerIcon,
  toolLabel,
} from "../app/display";
import type { EvidenceEntry } from "../app/types";
import type { Translator } from "../i18n";

export function EvidencePanel({
  evidence,
  t,
}: {
  evidence: EvidenceEntry[];
  t: Translator;
}) {
  return (
    <aside className="evidence-panel" aria-label={t("evidence.ariaLabel")}>
      <div className="evidence-heading">
        <div>
          <span className="eyebrow">{t("evidence.eyebrow")}</span>
          <h2>{t("evidence.title")}</h2>
        </div>
        <span className="evidence-count">{evidence.length}</span>
      </div>
      <p className="evidence-intro">{t("evidence.intro")}</p>
      <div className="evidence-list">
        {evidence.length === 0 ? (
          <div className="evidence-empty">
            <PulseIcon />
            <strong>{t("evidence.emptyTitle")}</strong>
            <span>{t("evidence.emptyDetail")}</span>
          </div>
        ) : (
          evidence.map((item, index) => (
            <EvidenceCard item={item} index={index} key={item.key} t={t} />
          ))
        )}
      </div>
    </aside>
  );
}

function EvidenceCard({
  item,
  index,
  t,
}: {
  item: EvidenceEntry;
  index: number;
  t: Translator;
}) {
  const meta = readMeta(item.result);
  return (
    <details className={`evidence-card status-${item.status}`}>
      <summary>
        <span className="evidence-index">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="evidence-name">
          <strong>{toolLabel(item.call.name, t)}</strong>
          <small>{t("evidence.pass", { iteration: item.iteration })}</small>
        </span>
        <span className="evidence-state">
          {item.status === "running" ? (
            <SpinnerIcon />
          ) : item.status === "success" ? (
            t("evidence.success")
          ) : (
            t("evidence.error")
          )}
        </span>
      </summary>
      <div className="evidence-detail">
        <div className="evidence-tags">
          {meta.sampled && <span>{t("evidence.sampled")}</span>}
          {meta.truncated && <span>{t("evidence.truncated")}</span>}
          {typeof meta.rowCount === "number" && (
            <span>{t("evidence.rows", { count: meta.rowCount })}</span>
          )}
        </div>
        <h3>{t("evidence.arguments")}</h3>
        <pre>{formatJsonString(item.call.arguments)}</pre>
        {item.result !== undefined && (
          <>
            <h3>{t("evidence.resultPreview")}</h3>
            <pre>{previewJson(item.result, t)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function readMeta(value: JsonValue | undefined): {
  sampled: boolean;
  truncated: boolean;
  rowCount?: number;
} {
  const result = asObject(value);
  const meta = asObject(result?.meta);
  return {
    sampled: meta?.sampled === true,
    truncated: meta?.truncated === true,
    rowCount:
      typeof meta?.row_count === "number" ? meta.row_count : undefined,
  };
}

function formatJsonString(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function previewJson(value: JsonValue, t: Translator): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 2600
    ? `${serialized.slice(0, 2600)}\n${t("evidence.previewLimited")}`
    : serialized;
}
