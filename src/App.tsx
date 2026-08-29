import { Box, Drawer } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { fileName } from "./app/display";
import { useWorkspace } from "./app/useWorkspace";
import { AboutPage } from "./components/AboutPage";
import { Conversation } from "./components/Conversation";
import { DemoSidebar } from "./components/DemoSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { detectLocale, translate, type Translator } from "./i18n";

export function App() {
  const [initialLocale] = useState(detectLocale);
  const workspace = useWorkspace(initialLocale);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [demoInfoOpen, setDemoInfoOpen] = useState(false);
  const t = useCallback<Translator>(
    (key, params) => translate(workspace.settings.locale, key, params),
    [workspace.settings.locale],
  );

  useEffect(() => {
    document.documentElement.lang = workspace.settings.locale;
  }, [workspace.settings.locale]);

  const activeSummary = workspace.sessions.find(
    (session) => session.id === workspace.activeSessionId,
  );
  const headerTitle =
    workspace.page === "settings"
      ? t("settings.title")
      : workspace.page === "about"
        ? t("about.title")
      : activeSummary?.title ??
        (workspace.conversation.demoPath
          ? fileName(workspace.conversation.demoPath)
          : t("sessions.new"));
  const sidebar = (
    <WorkspaceSidebar
      sessions={workspace.sessions}
      activeSessionId={workspace.activeSessionId}
      settingsActive={workspace.page === "settings"}
      aboutActive={workspace.page === "about"}
      runningSessionIds={workspace.runningSessionIds}
      onNewSession={workspace.startNewSession}
      onOpenSession={workspace.openSession}
      onOpenSettings={workspace.openSettings}
      onOpenAbout={workspace.openAbout}
      onRenameSession={workspace.renameSession}
      onDeleteSession={workspace.deleteSession}
      onNavigate={() => setNavigationOpen(false)}
      t={t}
    />
  );

  const demoSidebar = (
    <DemoSidebar
      conversation={workspace.conversation}
      demoLoading={workspace.demoLoading}
      t={t}
    />
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          md: "230px minmax(0, 1fr)",
          lg: "230px minmax(0, 1fr) 286px",
        },
        gridTemplateRows: "54px minmax(0, 1fr)",
        width: "100%",
        height: "100vh",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: { xs: "none", md: "block" }, gridColumn: 1, gridRow: "1 / 3", minHeight: 0 }}>
        {sidebar}
      </Box>
      <Box sx={{ gridColumn: { xs: 1, md: "2 / -1" }, gridRow: 1, minWidth: 0 }}>
        <WorkspaceHeader
          title={headerTitle}
          showDemoInfo={workspace.page === "conversation"}
          onOpenNavigation={() => setNavigationOpen(true)}
          onOpenDemoInfo={() => setDemoInfoOpen(true)}
          t={t}
        />
      </Box>

      {workspace.page === "settings" ? (
        <Box
          sx={{
            gridColumn: { xs: 1, md: "2 / -1" },
            gridRow: 2,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <SettingsPage
            settings={workspace.settingsDraft}
            dirty={workspace.settingsDirty}
            saving={workspace.settingsSaving}
            saveError={workspace.settingsSaveError}
            updateSettings={workspace.updateSettingsDraft}
            saveSettings={workspace.saveSettings}
            dismissSaveError={workspace.dismissSettingsSaveError}
            t={t}
          />
        </Box>
      ) : workspace.page === "about" ? (
        <Box
          sx={{
            gridColumn: { xs: 1, md: "2 / -1" },
            gridRow: 2,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <AboutPage t={t} />
        </Box>
      ) : (
        <>
          <Box sx={{ gridColumn: { xs: 1, md: 2 }, gridRow: 2, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <Conversation
              entries={workspace.conversation.entries}
              draft={workspace.draft}
              demoPath={workspace.conversation.demoPath}
              providerReady={workspace.providerReady}
              activeSession={workspace.activeSessionId !== null}
              providerId={workspace.conversation.providerId}
              model={workspace.conversation.model}
              modelOptions={workspace.modelOptions}
              sending={workspace.sending}
              canSend={workspace.canSend}
              error={workspace.error}
              setDraft={workspace.setDraft}
              dismissError={() => workspace.setError(null)}
              chooseDemo={workspace.chooseDemo}
              selectModel={workspace.selectModel}
              submit={workspace.submit}
              stop={workspace.stop}
              t={t}
            />
          </Box>
          <Box sx={{ display: { xs: "none", lg: "block" }, gridColumn: 3, gridRow: 2, minHeight: 0 }}>
            {demoSidebar}
          </Box>
        </>
      )}

      <Drawer
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: 248 } }}
      >
        {sidebar}
      </Drawer>
      <Drawer
        anchor="right"
        open={demoInfoOpen}
        onClose={() => setDemoInfoOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", lg: "none" }, "& .MuiDrawer-paper": { width: "min(310px, 88vw)" } }}
      >
        {demoSidebar}
      </Drawer>
    </Box>
  );
}
