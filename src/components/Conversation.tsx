import EastRoundedIcon from "@mui/icons-material/EastRounded";
import MyLocationOutlinedIcon from "@mui/icons-material/MyLocationOutlined";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputBase,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { KeyboardEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "../app/markdown";
import { PROVIDER_LABELS, type ProviderDraft } from "../app/state";
import type { ChatEntry } from "../app/types";
import type { Translator } from "../i18n";

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

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
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
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
    <Box
      component="section"
      aria-label={t("chat.ariaLabel")}
      sx={{
        display: "grid",
        minWidth: 0,
        minHeight: 0,
        gridTemplateRows: "auto minmax(0, 1fr) auto",
        "@media (max-width: 1040px)": {
          minHeight: "calc(100vh - 66px)",
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2.5}
        sx={{
          alignItems: "flex-start",
          justifyContent: "space-between",
          px: 3.9,
          pt: 2.9,
          pb: 2.3,
          borderBottom: 1,
          borderColor: "divider",
          backgroundColor: alpha("#0f1210", 0.55),
        }}
      >
        <Box>
          <Typography variant="overline">{t("chat.eyebrow")}</Typography>
          <Typography component="h1" variant="h1" sx={{ mt: 0.45 }}>
            {t("chat.title")}
          </Typography>
        </Box>
        <Chip label={PROVIDER_LABELS[provider.kind]} />
      </Stack>

      <Box
        aria-live="polite"
        sx={{
          minHeight: 0,
          px: 3.9,
          pt: 3,
          pb: 4,
          overflow: "auto",
          scrollBehavior: "smooth",
          scrollbarColor: "#30372f transparent",
        }}
      >
        {messages.length === 0 ? (
          <EmptyConversation hasDemo={hasDemo} providerReady={providerReady} t={t} />
        ) : (
          messages.map((message) => <Message entry={message} key={message.id} t={t} />)
        )}
        {sending && (
          <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: "center" }}>
            <Avatar
              variant="square"
              sx={(theme) => ({
                width: 31,
                height: 31,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                color: "primary.main",
                backgroundColor: alpha(theme.palette.primary.main, 0.065),
              })}
            >
              <CircularProgress size={16} thickness={4} />
            </Avatar>
            <Box className="thinking-bars" aria-label={t("chat.working")}>
              <span />
              <span />
              <span />
            </Box>
          </Stack>
        )}
      </Box>

      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        sx={{
          px: 3.75,
          pt: 1.8,
          pb: 2,
          borderTop: 1,
          borderColor: "divider",
          backgroundColor: alpha("#0c0f0d", 0.96),
        }}
      >
        {error && (
          <Alert
            severity="error"
            variant="outlined"
            action={
              <Button color="inherit" size="small" onClick={dismissError}>
                {t("action.dismiss")}
              </Button>
            }
            sx={{ mb: 1 }}
          >
            <Typography component="strong" sx={{ mr: 0.8, color: "error.main", fontSize: "inherit" }}>
              {t("error.requestFailed")}
            </Typography>
            {error}
          </Alert>
        )}
        <Paper
          variant="outlined"
          sx={(theme) => ({
            display: "flex",
            alignItems: "flex-end",
            borderColor: alpha("#e6efe6", 0.17),
            backgroundColor: "#111512",
            boxShadow: "0 12px 34px rgba(0, 0, 0, 0.18)",
            transition: theme.transitions.create("border-color", {
              duration: theme.transitions.duration.shortest,
            }),
            "&:focus-within": {
              borderColor: alpha(theme.palette.primary.main, 0.45),
            },
          })}
        >
          <InputBase
            fullWidth
            multiline
            minRows={3}
            maxRows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={sending}
            placeholder={composerPlaceholder(hasDemo, providerReady, t)}
            inputProps={{ "aria-label": t("composer.ariaLabel") }}
            sx={{
              flex: 1,
              px: 1.8,
              py: 1.35,
              color: "#dce1dc",
              fontSize: "0.8rem",
              lineHeight: 1.5,
            }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!canSend}
            endIcon={<EastRoundedIcon />}
            sx={{ flex: "0 0 auto", mb: 1, mr: 1, minHeight: 36 }}
          >
            {sending ? t("action.analyzing") : t("action.analyze")}
          </Button>
        </Paper>
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 0.8, color: "#565e57", justifyContent: "space-between" }}
        >
          <Typography variant="caption">{t("composer.sendHint")}</Typography>
          <Typography variant="caption">{t("composer.evidenceHint")}</Typography>
        </Stack>
      </Box>
    </Box>
  );
}

function Message({ entry, t }: { entry: ChatEntry; t: Translator }) {
  const assistant = entry.role === "assistant";
  return (
    <Stack
      component="article"
      direction={assistant ? "row" : "row-reverse"}
      spacing={1.5}
      sx={{ maxWidth: 830, mb: 3, ml: assistant ? 0 : "auto", alignItems: "flex-start" }}
    >
      <Avatar
        variant="square"
        sx={(theme) => ({
          width: 31,
          height: 31,
          flex: "0 0 auto",
          border: `1px solid ${alpha(assistant ? theme.palette.primary.main : "#ffffff", assistant ? 0.22 : 0.12)}`,
          color: assistant ? "primary.main" : "#939c95",
          backgroundColor: assistant
            ? alpha(theme.palette.primary.main, 0.065)
            : "#181d19",
          fontSize: "0.52rem",
        })}
      >
        {assistant ? <MyLocationOutlinedIcon sx={{ fontSize: 17 }} /> : t("chat.you")}
      </Avatar>
      {assistant ? (
        <Box className="markdown-body" sx={{ minWidth: 0, pt: 0.4, color: "#c8cec9", fontSize: "0.8rem", lineHeight: 1.65 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={markdownUrlTransform}
            components={MARKDOWN_COMPONENTS}
          >
            {entry.content}
          </ReactMarkdown>
        </Box>
      ) : (
        <Paper
          variant="outlined"
          sx={{
            minWidth: 0,
            px: 1.8,
            py: 1.35,
            borderRadius: "5px 1px 5px 5px",
            backgroundColor: "#151916",
          }}
        >
          <Typography sx={{ color: "#c8cec9", fontSize: "0.8rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {entry.content}
          </Typography>
        </Paper>
      )}
    </Stack>
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
    <Stack
      sx={{ width: "min(540px, 92%)", minHeight: "100%", mx: "auto", py: 4.5, textAlign: "center", alignItems: "center", justifyContent: "center" }}
    >
      <Box className="radar-graphic" aria-hidden="true">
        <span />
        <span />
        <MyLocationOutlinedIcon />
      </Box>
      <Typography variant="overline">{t("empty.kicker")}</Typography>
      <Typography component="h2" sx={{ mt: 1.1, mb: 0.8, color: "#dfe4e0", fontSize: "1.18rem", fontWeight: 580 }}>
        {title}
      </Typography>
      <Typography sx={{ maxWidth: "49ch", color: "#778078", fontSize: "0.76rem", lineHeight: 1.65 }}>
        {detail}
      </Typography>
      {hasDemo && providerReady && (
        <Stack direction="row" sx={{ mt: 2.5, flexWrap: "wrap", justifyContent: "center", gap: 0.75 }}>
          <Chip label={t("empty.exampleOverview")} sx={{ borderRadius: 999 }} />
          <Chip label={t("empty.exampleRounds")} sx={{ borderRadius: 999 }} />
          <Chip label={t("empty.exampleEconomy")} sx={{ borderRadius: 999 }} />
        </Stack>
      )}
    </Stack>
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
