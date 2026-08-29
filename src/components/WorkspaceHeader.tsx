import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import {
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { toolLabel } from "../app/display";
import type { StatusMessage } from "../app/types";
import type { Translator } from "../i18n";

export function WorkspaceHeader({
  title,
  status,
  busy,
  showDemoInfo,
  onOpenNavigation,
  onOpenDemoInfo,
  t,
}: {
  title: string;
  status: StatusMessage;
  busy: boolean;
  showDemoInfo: boolean;
  onOpenNavigation: () => void;
  onOpenDemoInfo: () => void;
  t: Translator;
}) {
  const statusText = status.toolName
    ? t(status.key, { tool: toolLabel(status.toolName, t) })
    : t(status.key, status.params);

  return (
    <Stack
      component="header"
      direction="row"
      spacing={1.3}
      sx={{
        minWidth: 0,
        height: 54,
        px: { xs: 1.2, md: 2.1 },
        borderBottom: 1,
        borderColor: "divider",
        alignItems: "center",
        backgroundColor: alpha("#0c0e0c", 0.9),
        backdropFilter: "blur(16px)",
      }}
    >
      <IconButton
        aria-label={t("navigation.open")}
        onClick={onOpenNavigation}
        sx={{ display: { xs: "inline-flex", md: "none" }, color: "#9aa19a" }}
      >
        <MenuRoundedIcon />
      </IconButton>
      <Typography noWrap component="h1" sx={{ minWidth: 0, color: "#dce1dc", fontSize: "0.78rem", fontWeight: 650 }}>
        {title}
      </Typography>
      <Tooltip title={statusText} placement="bottom">
        <Stack direction="row" spacing={0.8} sx={{ minWidth: 0, ml: "auto !important", alignItems: "center" }}>
          {busy ? (
            <CircularProgress size={11} thickness={5} />
          ) : (
            <Box
              sx={(theme) => ({
                width: 6,
                height: 6,
                flex: "0 0 auto",
                borderRadius: "50%",
                backgroundColor: "primary.main",
                boxShadow: `0 0 9px ${alpha(theme.palette.primary.main, 0.55)}`,
              })}
            />
          )}
          <Typography noWrap sx={{ display: { xs: "none", sm: "block" }, maxWidth: 260, color: "#747c74", fontSize: "0.65rem" }}>
            {statusText}
          </Typography>
        </Stack>
      </Tooltip>
      {showDemoInfo && (
        <IconButton
          aria-label={t("demo.openSidebar")}
          onClick={onOpenDemoInfo}
          sx={{ display: { xs: "inline-flex", lg: "none" }, color: "#8f978f" }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 19 }} />
        </IconButton>
      )}
    </Stack>
  );
}
