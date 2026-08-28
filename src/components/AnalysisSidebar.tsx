import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import {
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { JsonObject, ProviderKind } from "../agent/types";
import {
  asObject,
  asObjectArray,
  fileName,
  readNumber,
  readString,
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
    <Box
      component="aside"
      sx={{
        gridColumn: 1,
        gridRow: 2,
        minHeight: 0,
        overflow: "auto",
        borderRight: 1,
        borderColor: "divider",
        backgroundColor: "#0d100e",
        scrollbarColor: "#30372f transparent",
        "@media (max-width: 1040px)": {
          minHeight: "calc(100vh - 66px)",
        },
      }}
    >
      <SidebarSection number="01" title={t("demo.section")}>
        <ButtonBase
          component="button"
          type="button"
          onClick={() => void onChooseDemo()}
          disabled={demoLoading || sending}
          sx={(theme) => ({
            display: "flex",
            width: "100%",
            minHeight: 116,
            flexDirection: "column",
            gap: 0.6,
            px: 2,
            py: 1.75,
            overflow: "hidden",
            border: `1px ${demoPath ? "solid" : "dashed"} ${alpha(theme.palette.primary.main, demoPath ? 0.25 : 0.28)}`,
            borderRadius: 1,
            color: "text.secondary",
            background: `linear-gradient(${alpha(theme.palette.primary.main, 0.025)}, ${alpha(theme.palette.primary.main, 0.025)}), repeating-linear-gradient(135deg, transparent 0, transparent 7px, ${alpha("#ffffff", 0.012)} 7px, ${alpha("#ffffff", 0.012)} 8px)`,
            transition: theme.transitions.create(
              ["border-color", "background-color"],
              { duration: theme.transitions.duration.shortest },
            ),
            "&:hover": {
              borderColor: alpha(theme.palette.primary.main, 0.62),
              backgroundColor: alpha(theme.palette.primary.main, 0.045),
            },
          })}
        >
          {demoLoading ? (
            <CircularProgress size={25} sx={{ mb: 0.4 }} />
          ) : (
            <UploadFileOutlinedIcon color="primary" sx={{ fontSize: 27, mb: 0.4 }} />
          )}
          <Typography
            noWrap
            component="strong"
            sx={{ width: "100%", color: "#dfe5df", fontSize: "0.79rem" }}
          >
            {demoLoading
              ? t("demo.parsing")
              : demoPath
                ? fileName(demoPath)
                : t("demo.drop")}
          </Typography>
          <Typography variant="caption">
            {demoPath ? t("demo.change") : t("demo.browse")}
          </Typography>
        </ButtonBase>
        {demoPath && (
          <Tooltip title={demoPath} placement="bottom-start">
            <Typography
              noWrap
              sx={{
                mt: 1,
                color: "#687069",
                font: '0.59rem "Cascadia Mono", Consolas, monospace',
              }}
            >
              {demoPath}
            </Typography>
          </Tooltip>
        )}
        {headerObject && <DemoFacts header={headerObject} t={t} />}
      </SidebarSection>

      <SidebarSection number="02" title={t("roster.section")} count={roster.length}>
        {roster.length === 0 ? (
          <Typography sx={{ color: "#6e766f", fontSize: "0.7rem", lineHeight: 1.55 }}>
            {t("roster.empty")}
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "5px 8px",
              "@media (max-width: 1230px)": {
                gridTemplateColumns: "minmax(0, 1fr)",
              },
            }}
          >
            {roster.map((player, index) => (
              <PlayerRow
                player={player}
                index={index}
                key={playerKey(player, index)}
                t={t}
              />
            ))}
          </Box>
        )}
      </SidebarSection>

      <SidebarSection number="03" title={t("provider.section")} last>
        <Stack spacing={1.3}>
          <FormControl fullWidth size="small">
            <InputLabel id="provider-kind-label">{t("provider.protocol")}</InputLabel>
            <Select
              labelId="provider-kind-label"
              value={provider.kind}
              label={t("provider.protocol")}
              disabled={sending}
              onChange={(event) =>
                updateProvider((current) =>
                  changeProviderKind(current, event.target.value as ProviderKind),
                )
              }
            >
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <MenuItem value={value} key={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "flex-start" }}>
            <LockOutlinedIcon color="primary" sx={{ mt: "1px", fontSize: 14 }} />
            <Typography sx={{ color: "#69716a", fontSize: "0.61rem", lineHeight: 1.5 }}>
              {t("provider.privacy")}
            </Typography>
          </Stack>
        </Stack>
      </SidebarSection>
    </Box>
  );
}

function SidebarSection({
  number,
  title,
  count,
  last = false,
  children,
}: {
  number: string;
  title: string;
  count?: number;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="section"
      sx={{ px: 2.25, pt: 2.4, pb: 2.6, borderBottom: last ? 0 : 1, borderColor: "divider" }}
    >
      <Stack direction="row" spacing={1.1} sx={{ mb: 1.75, alignItems: "center" }}>
        <Typography
          color="primary"
          sx={{ font: '0.61rem "Cascadia Mono", Consolas, monospace' }}
        >
          {number}
        </Typography>
        <Typography
          component="h2"
          sx={{ fontSize: "0.72rem", fontWeight: 720, letterSpacing: "0.09em", textTransform: "uppercase" }}
        >
          {title}
        </Typography>
        {!!count && <Chip label={count} sx={{ ml: "auto !important", height: 20 }} />}
      </Stack>
      {children}
    </Box>
  );
}

function DemoFacts({ header, t }: { header: JsonObject; t: Translator }) {
  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      <Fact
        label={t("facts.map")}
        value={readString(header, "map_name", "mapName") || t("facts.unknown")}
        accent
      />
      <Fact
        label={t("facts.server")}
        value={readString(header, "server_name", "serverName") || t("facts.notRecorded")}
      />
      <Fact
        label={t("facts.format")}
        value={readString(header, "demo_version_name", "demoVersionName") || t("facts.source2")}
      />
      <Fact
        label={t("facts.protocol")}
        value={readString(header, "network_protocol", "networkProtocol") || "—"}
      />
    </Stack>
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
  const name = readString(player, "name", "player_name") || t("roster.player", { number: index + 1 });
  const steamId = readString(player, "steamid", "steam_id");
  const team = readNumber(player, "team_number", "team_num");
  const teamColor = team === 2 ? "warning.main" : team === 3 ? "secondary.main" : "text.secondary";

  return (
    <Stack direction="row" spacing={0.8} sx={{ minWidth: 0, py: 0.35, alignItems: "center" }}>
      <Chip
        label={team === 2 ? "T" : team === 3 ? "CT" : "—"}
        sx={(theme) => ({
          width: 25,
          height: 20,
          flex: "0 0 auto",
          color: teamColor,
          borderColor:
            team === 2
              ? alpha(theme.palette.warning.main, 0.32)
              : team === 3
                ? alpha(theme.palette.secondary.main, 0.32)
                : undefined,
          backgroundColor:
            team === 2
              ? alpha(theme.palette.warning.main, 0.08)
              : team === 3
                ? alpha(theme.palette.secondary.main, 0.08)
                : undefined,
          "& .MuiChip-label": { px: 0.4, fontWeight: 750 },
        })}
      />
      <Typography noWrap title={steamId || name} sx={{ color: "#b8c0b9", fontSize: "0.68rem" }}>
        {name}
      </Typography>
    </Stack>
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
    <TextField
      fullWidth
      size="small"
      label={label}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
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
    <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: "baseline" }}>
      <Typography sx={{ minWidth: 57, color: "#69716b", fontSize: "0.64rem", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography
        noWrap
        component="strong"
        title={value}
        sx={{
          minWidth: 0,
          ml: "auto !important",
          color: accent ? "primary.main" : "#b4bcb5",
          font: accent ? '0.7rem "Cascadia Mono", Consolas, monospace' : undefined,
          fontSize: "0.7rem",
          fontWeight: 570,
          textAlign: "right",
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function playerKey(player: JsonObject, index: number): string {
  return `${readString(player, "steamid", "steam_id")}-${readString(
    player,
    "name",
    "player_name",
  )}-${index}`;
}
