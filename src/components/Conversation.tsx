import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import MyLocationOutlinedIcon from "@mui/icons-material/MyLocationOutlined";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { JsonValue } from "../agent/types";
import { asObject, toolLabel } from "../app/display";
import { markdownUrlTransform } from "../app/markdown";
import { PROVIDER_LABELS } from "../app/state";
import type { ModelOption, TimelineEntry, ToolTimelineEntry } from "../app/types";
import type { Translator } from "../i18n";

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

export function Conversation({
  entries,
  draft,
  demoPath,
  providerReady,
  activeSession,
  providerId,
  model,
  modelOptions,
  sending,
  canSend,
  error,
  setDraft,
  dismissError,
  chooseDemo,
  selectModel,
  submit,
  stop,
  t,
}: {
  entries: TimelineEntry[];
  draft: string;
  demoPath: string;
  providerReady: boolean;
  activeSession: boolean;
  providerId: string | null;
  model: string;
  modelOptions: ModelOption[];
  sending: boolean;
  canSend: boolean;
  error: string | null;
  setDraft: (draft: string) => void;
  dismissError: () => void;
  chooseDemo: () => Promise<void>;
  selectModel: (option: ModelOption) => Promise<void>;
  submit: () => Promise<void>;
  stop: () => void;
  t: Translator;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
  const selectedOption = modelOptions.find(
    (option) => option.providerId === providerId && option.model === model,
  );
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, sending]);

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Box
      component="main"
      aria-label={t("chat.ariaLabel")}
      sx={{ display: "grid", width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", gridTemplateRows: "minmax(0, 1fr) auto" }}
    >
      <Box
        ref={scrollRef}
        aria-live="polite"
        sx={{ minHeight: 0, overflow: "auto", scrollBehavior: "smooth", scrollbarColor: "#343834 transparent" }}
      >
        <Box sx={{ width: "min(790px, calc(100% - 36px))", minHeight: "100%", mx: "auto", py: 3.5 }}>
          {entries.length === 0 ? (
            <EmptyConversation
              hasDemo={!!demoPath}
              providerReady={providerReady}
              chooseDemo={chooseDemo}
              t={t}
            />
          ) : (
            <Stack spacing={2.2}>
              {entries.map((entry) => (
                <TimelineItem entry={entry} key={entry.id} t={t} />
              ))}
            </Stack>
          )}
        </Box>
      </Box>

      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        sx={{ px: { xs: 1.4, sm: 2.4 }, pb: 2, pt: 1, background: "linear-gradient(transparent, #0b0d0b 28%)" }}
      >
        <Box sx={{ width: "min(790px, 100%)", mx: "auto" }}>
          {error && (
            <Alert
              severity="error"
              variant="outlined"
              action={<Button color="inherit" size="small" onClick={dismissError}>{t("action.dismiss")}</Button>}
              sx={{ mb: 1 }}
            >
              {error}
            </Alert>
          )}
          <Paper
            variant="outlined"
            sx={(theme) => ({
              overflow: "hidden",
              borderRadius: 2.2,
              borderColor: alpha("#ffffff", 0.13),
              backgroundColor: "#242724",
              boxShadow: "0 12px 38px rgba(0,0,0,0.28)",
              "&:focus-within": { borderColor: alpha(theme.palette.primary.main, 0.42) },
            })}
          >
            <InputBase
              fullWidth
              multiline
              minRows={2}
              maxRows={7}
              value={draft}
              disabled={sending}
              placeholder={composerPlaceholder(!!demoPath, providerReady, t)}
              inputProps={{ "aria-label": t("composer.ariaLabel") }}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              sx={{ px: 1.7, pt: 1.35, pb: 0.5, color: "#e0e4e0", fontSize: "0.78rem", lineHeight: 1.55 }}
            />
            <Stack direction="row" spacing={0.7} sx={{ px: 1, pb: 0.9, alignItems: "center" }}>
              <Tooltip title={activeSession ? t("demo.bound") : t("demo.section")}>
                <span>
                  <IconButton
                    size="small"
                    disabled={activeSession || sending}
                    onClick={() => void chooseDemo()}
                    aria-label={t("demo.section")}
                    sx={{ color: "#8b928b" }}
                  >
                    <AttachFileRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, color: "#656c65" }}>
                {t("composer.sendHint")}
              </Typography>
              <Stack direction="row" spacing={0.65} sx={{ ml: "auto !important", alignItems: "center" }}>
                <Button
                  variant="text"
                  size="small"
                  disabled={sending || modelOptions.length === 0}
                  aria-label={t("provider.model")}
                  aria-haspopup="menu"
                  aria-expanded={!!modelAnchor}
                  onClick={(event: MouseEvent<HTMLElement>) =>
                    setModelAnchor(event.currentTarget)
                  }
                  sx={{
                    maxWidth: { xs: 135, sm: 230 },
                    minHeight: 28,
                    px: 0.8,
                    color: "#aeb4ae",
                    fontSize: "0.65rem",
                  }}
                >
                  <Typography noWrap sx={{ fontSize: "inherit" }}>
                    {selectedOption
                      ? `${selectedOption.providerName} · ${selectedOption.model}`
                      : model || t("provider.chooseModel")}
                  </Typography>
                  <ExpandMoreRoundedIcon sx={{ ml: 0.35, fontSize: 15 }} />
                </Button>
                <Menu
                  anchorEl={modelAnchor}
                  open={!!modelAnchor}
                  onClose={() => setModelAnchor(null)}
                  anchorOrigin={{ vertical: "top", horizontal: "right" }}
                  transformOrigin={{ vertical: "bottom", horizontal: "right" }}
                  marginThreshold={8}
                >
                  {modelOptions.map((option) => (
                    <MenuItem
                      selected={
                        option.providerId === providerId && option.model === model
                      }
                      key={`${option.providerId}:${option.model}`}
                      onClick={() => {
                        setModelAnchor(null);
                        void selectModel(option);
                      }}
                    >
                      <Stack>
                        <Typography sx={{ fontSize: "0.7rem" }}>{option.model}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {option.providerName} · {PROVIDER_LABELS[option.providerKind]}
                        </Typography>
                      </Stack>
                    </MenuItem>
                  ))}
                </Menu>
                <IconButton
                  type={sending ? "button" : "submit"}
                  disabled={!sending && !canSend}
                  aria-label={sending ? t("action.stop") : t("action.analyze")}
                  onClick={sending ? stop : undefined}
                  sx={(theme) => ({
                    width: 31,
                    height: 31,
                    color: sending || canSend ? theme.palette.primary.contrastText : "#676d67",
                    backgroundColor: sending || canSend ? "primary.main" : alpha("#ffffff", 0.08),
                    "&:hover": { backgroundColor: "primary.light" },
                  })}
                >
                  {sending ? <StopRoundedIcon sx={{ fontSize: 18 }} /> : <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </Stack>
            </Stack>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

function TimelineItem({ entry, t }: { entry: TimelineEntry; t: Translator }) {
  if (entry.kind === "tool") return <ToolEntry entry={entry} t={t} />;
  if (entry.kind === "user") {
    return (
      <Paper
        component="article"
        variant="outlined"
        sx={{ maxWidth: "82%", ml: "auto", px: 1.7, py: 1.15, borderRadius: "13px 13px 3px 13px", backgroundColor: "#252825" }}
      >
        <Typography sx={{ color: "#d7dbd7", fontSize: "0.75rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
          {entry.content}
        </Typography>
      </Paper>
    );
  }
  return (
    <Stack component="article" direction="row" spacing={1.2} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={(theme) => ({
          display: "grid",
          width: 27,
          height: 27,
          flex: "0 0 auto",
          placeItems: "center",
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          borderRadius: 1,
          color: "primary.main",
          backgroundColor: alpha(theme.palette.primary.main, 0.05),
        })}
      >
        <MyLocationOutlinedIcon sx={{ fontSize: 15 }} />
      </Box>
      <Box className="markdown-body" sx={{ minWidth: 0, flex: 1, pt: 0.2, color: "#cbd0cb", fontSize: "0.76rem", lineHeight: 1.72 }}>
        {entry.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform} components={MARKDOWN_COMPONENTS}>
            {entry.content}
          </ReactMarkdown>
        ) : (
          <Box className="thinking-bars" aria-label={t("chat.working")}><span /><span /><span /></Box>
        )}
        {entry.status === "streaming" && entry.content && <span className="streaming-cursor" aria-hidden="true" />}
      </Box>
    </Stack>
  );
}

function ToolEntry({ entry, t }: { entry: ToolTimelineEntry; t: Translator }) {
  const meta = readMeta(entry.result);
  return (
    <Accordion sx={{ ml: 4.9, maxWidth: 620, backgroundColor: "#141714" }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon sx={{ color: "#717971", fontSize: 17 }} />}>
        <Stack direction="row" spacing={1} sx={{ width: "100%", minWidth: 0, alignItems: "center" }}>
          <TerminalRoundedIcon sx={{ flex: "0 0 auto", color: entry.status === "error" ? "error.main" : "#768076", fontSize: 16 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ color: "#abb2ab", fontSize: "0.66rem", fontWeight: 630 }}>
              {toolLabel(entry.call.name, t)}
            </Typography>
            <Typography variant="caption" sx={{ color: "#596159" }}>
              {t("evidence.pass", { iteration: entry.iteration })}
            </Typography>
          </Box>
          {entry.status === "running" ? (
            <CircularProgress size={13} thickness={4.5} />
          ) : (
            <Typography sx={{ color: entry.status === "success" ? "primary.main" : "error.main", fontSize: "0.55rem", textTransform: "uppercase" }}>
              {entry.status === "success" ? t("evidence.success") : t("evidence.error")}
            </Typography>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}>
        <Stack direction="row" sx={{ mb: 0.8, flexWrap: "wrap", gap: 0.5 }}>
          {meta.sampled && <MetaChip label={t("evidence.sampled")} />}
          {meta.truncated && <MetaChip label={t("evidence.truncated")} />}
          {typeof meta.rowCount === "number" && <MetaChip label={t("evidence.rows", { count: meta.rowCount })} />}
        </Stack>
        <EvidenceJson title={t("evidence.arguments")} value={formatJsonString(entry.call.arguments)} />
        {entry.result !== undefined && <EvidenceJson title={t("evidence.resultPreview")} value={previewJson(entry.result, t)} />}
      </AccordionDetails>
    </Accordion>
  );
}

function EmptyConversation({
  hasDemo,
  providerReady,
  chooseDemo,
  t,
}: {
  hasDemo: boolean;
  providerReady: boolean;
  chooseDemo: () => Promise<void>;
  t: Translator;
}) {
  const title = !hasDemo ? t("empty.loadTitle") : !providerReady ? t("empty.providerTitle") : t("empty.readyTitle");
  const detail = !hasDemo ? t("empty.loadDetail") : !providerReady ? t("empty.providerDetail") : t("empty.readyDetail");
  return (
    <Stack sx={{ minHeight: "100%", textAlign: "center", alignItems: "center", justifyContent: "center" }}>
      <Box className="radar-graphic" aria-hidden="true"><span /><span /><MyLocationOutlinedIcon /></Box>
      <Typography variant="overline">{t("empty.kicker")}</Typography>
      <Typography component="h2" sx={{ mt: 1, color: "#dfe3df", fontSize: "1.08rem", fontWeight: 650 }}>
        {title}
      </Typography>
      <Typography sx={{ maxWidth: 480, mt: 0.8, color: "#727a72", fontSize: "0.7rem", lineHeight: 1.65 }}>
        {detail}
      </Typography>
      {!hasDemo && (
        <Button variant="outlined" startIcon={<AttachFileRoundedIcon />} onClick={() => void chooseDemo()} sx={{ mt: 2 }}>
          {t("demo.choose")}
        </Button>
      )}
    </Stack>
  );
}

function MetaChip({ label }: { label: string }) {
  return <Chip label={label} color="primary" sx={{ height: 18, "& .MuiChip-label": { px: 0.6 } }} />;
}

function EvidenceJson({ title, value }: { title: string; value: string }) {
  return (
    <Box sx={{ mt: 0.9 }}>
      <Typography sx={{ mb: 0.45, color: "#666e66", fontSize: "0.53rem", letterSpacing: "0.07em", textTransform: "uppercase" }}>{title}</Typography>
      <Box component="pre" sx={{ maxHeight: 220, m: 0, p: 1, overflow: "auto", borderRadius: 1, color: "#8e978e", backgroundColor: "#090b09", font: '0.56rem/1.5 "Cascadia Mono", Consolas, monospace', whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {value}
      </Box>
    </Box>
  );
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
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function previewJson(value: JsonValue, t: Translator): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 2600 ? `${serialized.slice(0, 2600)}\n${t("evidence.previewLimited")}` : serialized;
}

function composerPlaceholder(hasDemo: boolean, providerReady: boolean, t: Translator): string {
  if (!hasDemo) return t("composer.needDemo");
  if (!providerReady) return t("composer.needProvider");
  return t("composer.ready");
}
