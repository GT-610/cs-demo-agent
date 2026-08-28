import { useCallback, useEffect, useState } from "react";
import { useAnalysisSession } from "./app/useAnalysisSession";
import { AnalysisSidebar } from "./components/AnalysisSidebar";
import { AppHeader } from "./components/AppHeader";
import { Conversation } from "./components/Conversation";
import { EvidencePanel } from "./components/EvidencePanel";
import {
  detectLocale,
  translate,
  type Locale,
  type Translator,
} from "./i18n";

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const t = useCallback<Translator>(
    (key, params) => translate(locale, key, params),
    [locale],
  );
  const session = useAnalysisSession(t);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <div className="app-shell">
      <AppHeader
        locale={locale}
        setLocale={setLocale}
        status={session.status}
        busy={session.sending || session.demoLoading}
        canClear={
          !session.sending &&
          (session.messages.length > 0 || session.evidence.length > 0)
        }
        onClear={session.clearSession}
        t={t}
      />
      <AnalysisSidebar
        demoPath={session.demoPath}
        header={session.header}
        players={session.players}
        provider={session.provider}
        demoLoading={session.demoLoading}
        sending={session.sending}
        onChooseDemo={session.chooseDemo}
        updateProvider={session.updateProvider}
        t={t}
      />
      <main className="workspace">
        <Conversation
          messages={session.messages}
          provider={session.provider}
          providerReady={session.providerReady}
          hasDemo={!!session.demoPath}
          draft={session.draft}
          sending={session.sending}
          canSend={session.canSend}
          error={session.error}
          setDraft={session.setDraft}
          dismissError={() => session.setError(null)}
          submit={session.submit}
          t={t}
        />
        <EvidencePanel evidence={session.evidence} t={t} />
      </main>
    </div>
  );
}
