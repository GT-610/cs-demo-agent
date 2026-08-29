import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { JsonObject } from "../agent/types";
import {
  asObject,
  asObjectArray,
  fileName,
  readString,
} from "../app/display";
import type { ConversationState } from "../app/types";
import type { Translator } from "../i18n";

export function DemoSidebar({
  conversation,
  demoLoading,
  t,
}: {
  conversation: ConversationState;
  demoLoading: boolean;
  t: Translator;
}) {
  const header = asObject(conversation.header?.data);
  const roster = asObjectArray(conversation.players?.data);
  const mapName = header ? readString(header, "map_name", "mapName") : "";

  return (
    <Box
      component="aside"
      aria-label={t("demo.sidebar")}
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        borderLeft: 1,
        borderColor: "divider",
        backgroundColor: "#101210",
      }}
    >
      <SidebarSection title={t("demo.overview")}>
        {demoLoading ? (
          <Stack spacing={1} sx={{ minHeight: 86, alignItems: "center", justifyContent: "center" }}>
            <CircularProgress size={21} />
            <Typography sx={{ color: "#7c847c", fontSize: "0.66rem" }}>
              {t("demo.parsing")}
            </Typography>
          </Stack>
        ) : conversation.demoPath ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.1} sx={{ minWidth: 0, alignItems: "center" }}>
              <Box
                sx={(theme) => ({
                  display: "grid",
                  width: 33,
                  height: 33,
                  flex: "0 0 auto",
                  placeItems: "center",
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
                  borderRadius: 1.1,
                  color: "primary.main",
                  backgroundColor: alpha(theme.palette.primary.main, 0.07),
                })}
              >
                <InsertDriveFileOutlinedIcon sx={{ fontSize: 19 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ color: "#d9ded9", fontSize: "0.72rem", fontWeight: 680 }}>
                  {mapName || t("facts.unknown")}
                </Typography>
                <Typography noWrap sx={{ color: "#707870", fontSize: "0.6rem" }}>
                  {fileName(conversation.demoPath)}
                </Typography>
              </Box>
            </Stack>
            <Tooltip title={conversation.demoPath} placement="bottom-start">
              <Typography noWrap sx={{ color: "#626962", font: '0.56rem "Cascadia Mono", Consolas, monospace' }}>
                {conversation.demoPath}
              </Typography>
            </Tooltip>
            {header && <DemoFacts header={header} t={t} />}
          </Stack>
        ) : (
          <Typography sx={{ color: "#687068", fontSize: "0.66rem", lineHeight: 1.55 }}>
            {t("demo.empty")}
          </Typography>
        )}
      </SidebarSection>

      <Divider />
      <SidebarSection title={t("roster.section")} count={roster.length}>
        {roster.length === 0 ? (
          <Typography sx={{ color: "#687068", fontSize: "0.66rem", lineHeight: 1.55 }}>
            {t("roster.empty")}
          </Typography>
        ) : (
          <Stack spacing={0.4}>
            <Typography sx={{ mb: 0.65, color: "#687068", fontSize: "0.58rem", lineHeight: 1.45 }}>
              {t("roster.teamHint")}
            </Typography>
            {roster.map((player, index) => (
              <PlayerRow player={player} index={index} key={playerKey(player, index)} t={t} />
            ))}
          </Stack>
        )}
      </SidebarSection>
    </Box>
  );
}

function SidebarSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Box component="section" sx={{ px: 1.8, py: 2 }}>
      <Stack direction="row" sx={{ mb: 1.35, alignItems: "center" }}>
        <Typography component="h2" sx={{ color: "#aeb5ae", fontSize: "0.65rem", fontWeight: 720, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </Typography>
        {typeof count === "number" && (
          <Chip label={count} sx={{ ml: "auto", height: 19, "& .MuiChip-label": { px: 0.65 } }} />
        )}
      </Stack>
      {children}
    </Box>
  );
}

function DemoFacts({ header, t }: { header: JsonObject; t: Translator }) {
  return (
    <Stack spacing={0.8} sx={{ mt: 1.6 }}>
      <Fact label={t("facts.map")} value={readString(header, "map_name", "mapName") || t("facts.unknown")} accent />
      <Fact label={t("facts.server")} value={readString(header, "server_name", "serverName") || t("facts.notRecorded")} />
      <Fact label={t("facts.format")} value={readString(header, "demo_version_name", "demoVersionName") || t("facts.source2")} />
      <Fact label={t("facts.protocol")} value={readString(header, "network_protocol", "networkProtocol") || "—"} />
    </Stack>
  );
}

function Fact({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <Stack direction="row" spacing={1} sx={{ minWidth: 0, alignItems: "baseline" }}>
      <Typography sx={{ minWidth: 52, color: "#646b64", fontSize: "0.58rem", textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography noWrap title={value} sx={{ minWidth: 0, ml: "auto !important", color: accent ? "primary.main" : "#aeb5ae", fontSize: "0.64rem", textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function PlayerRow({ player, index, t }: { player: JsonObject; index: number; t: Translator }) {
  const name = readString(player, "name", "player_name") || t("roster.player", { number: index + 1 });
  const steamId = readString(player, "steamid", "steam_id");
  const stableTeam = readString(player, "stable_team");
  const isTeamA = stableTeam === "A";
  const isTeamB = stableTeam === "B";
  const teamLabel = isTeamA
    ? t("roster.teamA")
    : isTeamB
      ? t("roster.teamB")
      : "—";
  const teamDescription = isTeamA
    ? t("roster.teamAInitial")
    : isTeamB
      ? t("roster.teamBInitial")
      : t("roster.teamUnknown");
  return (
    <Stack direction="row" spacing={0.8} sx={{ minWidth: 0, minHeight: 27, alignItems: "center" }}>
      <Tooltip title={teamDescription} placement="left">
        <Chip
          aria-label={teamDescription}
          label={teamLabel}
          sx={(theme) => ({
            minWidth: 45,
            height: 19,
            flex: "0 0 auto",
            color: isTeamA ? "primary.main" : isTeamB ? "secondary.main" : "text.secondary",
            borderColor: isTeamA
              ? alpha(theme.palette.primary.main, 0.3)
              : isTeamB
                ? alpha(theme.palette.secondary.main, 0.3)
                : undefined,
            "& .MuiChip-label": { px: 0.55, fontWeight: 750 },
          })}
        />
      </Tooltip>
      <Typography noWrap title={steamId || name} sx={{ color: "#b4bbb4", fontSize: "0.65rem" }}>
        {name}
      </Typography>
    </Stack>
  );
}

function playerKey(player: JsonObject, index: number): string {
  return `${readString(player, "steamid", "steam_id")}-${readString(player, "name", "player_name")}-${index}`;
}
