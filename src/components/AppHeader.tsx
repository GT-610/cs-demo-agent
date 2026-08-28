import MyLocationOutlinedIcon from "@mui/icons-material/MyLocationOutlined";
import {
  AppBar,
  Box,
  Button,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { toolLabel } from "../app/display";
import type { StatusMessage } from "../app/types";
import { LOCALE_LABELS, type Locale, type Translator } from "../i18n";

export function AppHeader({
  locale,
  setLocale,
  status,
  busy,
  canClear,
  onClear,
  t,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  status: StatusMessage;
  busy: boolean;
  canClear: boolean;
  onClear: () => void;
  t: Translator;
}) {
  const statusText = status.toolName
    ? t(status.key, { tool: toolLabel(status.toolName, t) })
    : t(status.key, status.params);

  return (
    <AppBar
      component="header"
      position="static"
      elevation={0}
      sx={{ zIndex: 5, gridColumn: "1 / -1", gridRow: 1 }}
    >
      <Toolbar sx={{ minHeight: "66px !important", gap: 1.5, px: 2.5 }}>
        <Box
          aria-hidden="true"
          sx={(theme) => ({
            display: "grid",
            flex: "0 0 auto",
            width: 36,
            height: 36,
            placeItems: "center",
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            color: "primary.main",
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            clipPath:
              "polygon(12% 0, 100% 0, 100% 72%, 72% 100%, 0 100%, 0 28%)",
          })}
        >
          <MyLocationOutlinedIcon sx={{ fontSize: 21 }} />
        </Box>

        <Stack spacing={0.1} sx={{ minWidth: 174 }}>
          <Typography variant="overline">{t("brand.tagline")}</Typography>
          <Typography sx={{ fontSize: "0.92rem", fontWeight: 700 }}>
            CS Demo Agent
          </Typography>
        </Stack>

        <Tooltip title={statusText} placement="bottom">
          <Stack
            direction="row"
            spacing={1}
            sx={{ minWidth: 0, ml: "auto", color: "text.secondary", alignItems: "center" }}
          >
            {busy ? (
              <CircularProgress size={10} thickness={5} />
            ) : (
              <Box
                sx={(theme) => ({
                  width: 7,
                  height: 7,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  backgroundColor: "primary.main",
                  boxShadow: `0 0 11px ${alpha(theme.palette.primary.main, 0.7)}`,
                })}
              />
            )}
            <Typography
              noWrap
              sx={{ maxWidth: { xs: 180, lg: 320 }, fontSize: "0.76rem" }}
            >
              {statusText}
            </Typography>
          </Stack>
        </Tooltip>

        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <Typography
            component="label"
            htmlFor="locale-select"
            sx={{
              color: "#687169",
              fontSize: "0.61rem",
              fontWeight: 650,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              "@media (max-width: 1040px)": { display: "none" },
            }}
          >
            {t("language.label")}
          </Typography>
          <FormControl size="small">
            <Select
              id="locale-select"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
              inputProps={{ "aria-label": t("language.label") }}
              sx={{ minWidth: 88, height: 32 }}
            >
              {Object.entries(LOCALE_LABELS).map(([value, label]) => (
                <MenuItem value={value} key={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Button variant="outlined" onClick={onClear} disabled={!canClear}>
          {t("action.clearSession")}
        </Button>
      </Toolbar>
    </AppBar>
  );
}
