import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { IconButton, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { Translator } from "../i18n";

export function WorkspaceHeader({
  title,
  showDemoInfo,
  onOpenNavigation,
  onOpenDemoInfo,
  t,
}: {
  title: string;
  showDemoInfo: boolean;
  onOpenNavigation: () => void;
  onOpenDemoInfo: () => void;
  t: Translator;
}) {
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
      <Typography noWrap component="h1" sx={{ minWidth: 0, mr: "auto !important", color: "#dce1dc", fontSize: "0.78rem", fontWeight: 650 }}>
        {title}
      </Typography>
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
