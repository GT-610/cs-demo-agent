import type { KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowIcon,
  CrosshairIcon,
  SpinnerIcon,
} from "../app/display";
import { PROVIDER_LABELS, type ProviderDraft } from "../app/state";
import type { ChatEntry } from "../app/types";
import type { Translator } from "../i18n";

export function Conversation({
  messages,
  provider,
  providerReady,
  hasDemo,
  draft,
  sending,
  canSend,
  error,
  setDraft,
  dismissError,
  submit,
  t,
}: {
  messages: ChatEntry[];
  provider: ProviderDraft;
  providerReady: boolean;
  hasDemo: boolean;
  draft: string;
  sending: boolean;
  canSend: boolean;
  error: string | null;
  setDraft: (draft: string) => void;
  dismissError: () => void;
  submit: () => Promise<void>;
  t: Translator;
}) {
  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <section className="conversation" aria-label={t("chat.ariaLabel")}>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">{t("chat.eyebrow")}</span>
          <h1>{t("chat.title")}</h1>
        </div>
        <span className="provider-pill">{PROVIDER_LABELS[provider.kind]}</span>
      </div>

      <div className="message-stream" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyConversation
            hasDemo={hasDemo}
            providerReady={providerReady}
            t={t}
          />
        ) : (
          messages.map((message) => (
            <article
              className={`message message-${message.role}`}
              key={message.id}
            >
              <div className="message-role">
                {message.role === "assistant" ? (
                  <CrosshairIcon />
                ) : (
                  <span>{t("chat.you")}</span>
                )}
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
            <div className="thinking-bars" aria-label={t("chat.working")}>
              <span />
              <span />
              <span />
            </div>
          </article>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && (
          <div className="error-banner" role="alert">
            <strong>{t("error.requestFailed")}</strong>
            <span>{error}</span>
            <button type="button" onClick={dismissError}>
              {t("action.dismiss")}
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
            placeholder={composerPlaceholder(hasDemo, providerReady, t)}
            aria-label={t("composer.ariaLabel")}
          />
          <button className="send-button" type="submit" disabled={!canSend}>
            <span>{sending ? t("action.analyzing") : t("action.analyze")}</span>
            <ArrowIcon />
          </button>
        </div>
        <div className="composer-hint">
          <span>{t("composer.sendHint")}</span>
          <span>{t("composer.evidenceHint")}</span>
        </div>
      </form>
    </section>
  );
}

function EmptyConversation({
  hasDemo,
  providerReady,
  t,
}: {
  hasDemo: boolean;
  providerReady: boolean;
  t: Translator;
}) {
  const title = !hasDemo
    ? t("empty.loadTitle")
    : !providerReady
      ? t("empty.providerTitle")
      : t("empty.readyTitle");
  const detail = !hasDemo
    ? t("empty.loadDetail")
    : !providerReady
      ? t("empty.providerDetail")
      : t("empty.readyDetail");
  return (
    <div className="conversation-empty">
      <div className="radar-graphic" aria-hidden="true">
        <span />
        <span />
        <CrosshairIcon />
      </div>
      <span className="empty-kicker">{t("empty.kicker")}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {hasDemo && providerReady && (
        <div className="prompt-examples">
          <span>{t("empty.exampleOverview")}</span>
          <span>{t("empty.exampleRounds")}</span>
          <span>{t("empty.exampleEconomy")}</span>
        </div>
      )}
    </div>
  );
}

function composerPlaceholder(
  hasDemo: boolean,
  providerReady: boolean,
  t: Translator,
): string {
  if (!hasDemo) return t("composer.needDemo");
  if (!providerReady) return t("composer.needProvider");
  return t("composer.ready");
}
