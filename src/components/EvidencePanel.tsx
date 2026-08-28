import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { JsonValue } from "../agent/types";
import { asObject, toolLabel } from "../app/display";
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
    <Box
      component="aside"
      aria-label={t("evidence.ariaLabel")}
      sx={{
        display: "flex",
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        borderLeft: 1,
        borderColor: "divider",
        backgroundColor: "#0d100e",
        "@media (max-width: 1040px)": { display: "none" },
      }}
    >
      <Stack direction="row" sx={{ px: 2.5, pt: 2.8, pb: 1.4, alignItems: "flex-start", justifyContent: "space-between" }}>
        <Box>
          <Typography variant="overline">{t("evidence.eyebrow")}</Typography>
          <Typography component="h2" variant="h2" sx={{ mt: 0.45 }}>
            {t("evidence.title")}
          </Typography>
        </Box>
        <Chip
          label={evidence.length}
          sx={{ width: 25, height: 25, borderRadius: "50%", "& .MuiChip-label": { px: 0 } }}
        />
      </Stack>
      <Typography
        sx={{
          px: 2.5,
          pb: 2,
          borderBottom: 1,
          borderColor: "divider",
          color: "#6b746c",
          fontSize: "0.65rem",
          lineHeight: 1.55,
        }}
      >
        {t("evidence.intro")}
      </Typography>
      <Box sx={{ minHeight: 0, p: 1.6, overflow: "auto", scrollbarColor: "#30372f transparent" }}>
        {evidence.length === 0 ? (
          <Stack sx={{ minHeight: 240, px: 3.5, color: "#535b54", textAlign: "center", alignItems: "center", justifyContent: "center" }}>
            <InsightsOutlinedIcon sx={{ mb: 1.5, color: "#465046", fontSize: 33 }} />
            <Typography component="strong" sx={{ mb: 0.5, color: "#747d75", fontSize: "0.72rem", fontWeight: 700 }}>
              {t("evidence.emptyTitle")}
            </Typography>
            <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.5 }}>
              {t("evidence.emptyDetail")}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={0.8}>
            {evidence.map((item, index) => (
              <EvidenceCard item={item} index={index} key={item.key} t={t} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
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
  const panelId = `evidence-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <Accordion>
      <AccordionSummary
        expandIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 17, color: "#687069" }} />}
        aria-controls={`${panelId}-content`}
        id={`${panelId}-header`}
      >
        <Stack direction="row" spacing={1.1} sx={{ width: "100%", minWidth: 0, pr: 0.5, alignItems: "center" }}>
          <Typography sx={{ width: 27, flex: "0 0 auto", color: "#4d554e", font: '0.58rem "Cascadia Mono", Consolas, monospace' }}>
            {String(index + 1).padStart(2, "0")}
          </Typography>
          <Stack spacing={0.3} sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap component="strong" sx={{ color: "#bac2bb", fontSize: "0.66rem", fontWeight: 620 }}>
              {toolLabel(item.call.name, t)}
            </Typography>
            <Typography sx={{ color: "#59615a", font: '0.54rem "Cascadia Mono", Consolas, monospace' }}>
              {t("evidence.pass", { iteration: item.iteration })}
            </Typography>
          </Stack>
          <EvidenceStatus status={item.status} t={t} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails
        id={`${panelId}-content`}
        sx={{ px: 1.3, pt: 1.1, pb: 1.3, borderTop: 1, borderColor: "divider" }}
      >
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, minHeight: meta.sampled || meta.truncated || typeof meta.rowCount === "number" ? 20 : 0 }}>
          {meta.sampled && <MetaChip label={t("evidence.sampled")} />}
          {meta.truncated && <MetaChip label={t("evidence.truncated")} />}
          {typeof meta.rowCount === "number" && (
            <MetaChip label={t("evidence.rows", { count: meta.rowCount })} />
          )}
        </Stack>
        <EvidenceJson title={t("evidence.arguments")} value={formatJsonString(item.call.arguments)} />
        {item.result !== undefined && (
          <EvidenceJson title={t("evidence.resultPreview")} value={previewJson(item.result, t)} />
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function EvidenceStatus({
  status,
  t,
}: {
  status: EvidenceEntry["status"];
  t: Translator;
}) {
  if (status === "running") {
    return <CircularProgress size={14} thickness={4.5} sx={{ flex: "0 0 auto" }} />;
  }
  return (
    <Typography
      sx={{
        flex: "0 0 auto",
        color: status === "success" ? "primary.main" : "error.main",
        font: '0.51rem "Cascadia Mono", Consolas, monospace',
        textTransform: "uppercase",
      }}
    >
      {status === "success" ? t("evidence.success") : t("evidence.error")}
    </Typography>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <Chip
      label={label}
      color="primary"
      sx={{ height: 19, backgroundColor: "rgba(183, 243, 75, 0.04)", "& .MuiChip-label": { px: 0.65 } }}
    />
  );
}

function EvidenceJson({ title, value }: { title: string; value: string }) {
  return (
    <Box sx={{ mt: 1.1 }}>
      <Typography sx={{ mb: 0.55, color: "#687169", fontSize: "0.54rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </Typography>
      <Box
        component="pre"
        sx={{
          maxHeight: 230,
          m: 0,
          p: 1,
          overflow: "auto",
          border: 1,
          borderColor: "rgba(255,255,255,0.055)",
          borderRadius: 0.75,
          color: "#8d978f",
          backgroundColor: "#090b0a",
          font: '0.56rem/1.5 "Cascadia Mono", Consolas, monospace',
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {value}
      </Box>
    </Box>
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

function previewJson(value: JsonValue, t: Translator): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 2600
    ? `${serialized.slice(0, 2600)}\n${t("evidence.previewLimited")}`
    : serialized;
}
