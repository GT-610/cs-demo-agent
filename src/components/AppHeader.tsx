import {
  CrosshairIcon,
  toolLabel,
} from "../app/display";
import type { StatusMessage } from "../app/types";
import {
  LOCALE_LABELS,
  type Locale,
  type Translator,
} from "../i18n";

export function AppHeader({
  locale,
  setLocale,
  status,
  busy,
  canClear,
  onClear,
  t,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  status: StatusMessage;
  busy: boolean;
  canClear: boolean;
  onClear: () => void;
  t: Translator;
}) {
  const statusText = status.toolName
    ? t(status.key, { tool: toolLabel(status.toolName, t) })
    : t(status.key, status.params);
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">
        <CrosshairIcon />
      </div>
      <div className="brand-copy">
        <span className="eyebrow">{t("brand.tagline")}</span>
        <strong>CS Demo Agent</strong>
      </div>
      <div className="topbar-status" title={statusText}>
        <span className={`status-dot ${busy ? "is-busy" : ""}`} />
        {statusText}
      </div>
      <label className="language-switcher">
        <span>{t("language.label")}</span>
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          aria-label={t("language.label")}
        >
          {Object.entries(LOCALE_LABELS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={onClear}
        disabled={!canClear}
      >
        {t("action.clearSession")}
      </button>
    </header>
  );
}
