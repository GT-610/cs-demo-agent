import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import MyLocationOutlinedIcon from "@mui/icons-material/MyLocationOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useState, type MouseEvent } from "react";
import type { SessionSummary } from "../bridge/persistence";
import type { Translator } from "../i18n";

interface SessionActionState {
  anchor: HTMLElement;
  session: SessionSummary;
}

export function WorkspaceSidebar({
  sessions,
  activeSessionId,
  settingsActive,
  busy,
  onNewSession,
  onOpenSession,
  onOpenSettings,
  onRenameSession,
  onDeleteSession,
  onNavigate,
  t,
}: {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  settingsActive: boolean;
  busy: boolean;
  onNewSession: () => void;
  onOpenSession: (id: string) => Promise<void>;
  onOpenSettings: () => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onNavigate?: () => void;
  t: Translator;
}) {
  const [actions, setActions] = useState<SessionActionState | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleActions = (event: MouseEvent<HTMLElement>, session: SessionSummary) => {
    event.preventDefault();
    event.stopPropagation();
    setActions({ anchor: event.currentTarget, session });
  };

  const closeActions = () => setActions(null);
  const closeRenameDialog = () => {
    setRenameTarget(null);
    setActionError(null);
  };
  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    setActionError(null);
  };

  return (
    <Box
      component="nav"
      aria-label={t("sessions.ariaLabel")}
      sx={{
        display: "flex",
        width: "100%",
        height: "100%",
        minHeight: 0,
        flexDirection: "column",
        borderRight: 1,
        borderColor: "divider",
        backgroundColor: "#111311",
      }}
    >
      <Stack direction="row" spacing={1.1} sx={{ px: 1.8, pt: 2, pb: 1.4, alignItems: "center" }}>
        <Box
          aria-hidden="true"
          sx={(theme) => ({
            display: "grid",
            width: 30,
            height: 30,
            flex: "0 0 auto",
            placeItems: "center",
            border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
            borderRadius: 1.2,
            color: "primary.main",
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          })}
        >
          <MyLocationOutlinedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ color: "#e5e8e5", fontSize: "0.82rem", fontWeight: 700 }}>
            CS Demo Agent
          </Typography>
          <Typography noWrap variant="caption" sx={{ color: "#626862" }}>
            {t("brand.tagline")}
          </Typography>
        </Box>
      </Stack>

      <Box sx={{ px: 1.2, pb: 1.25 }}>
        <Button
          fullWidth
          variant="text"
          startIcon={<AddRoundedIcon />}
          disabled={busy}
          onClick={() => {
            onNewSession();
            onNavigate?.();
          }}
          sx={(theme) => ({
            justifyContent: "flex-start",
            px: 1.1,
            color: "#d8ddd8",
            backgroundColor:
              activeSessionId === null && !settingsActive
                ? alpha(theme.palette.primary.main, 0.08)
                : "transparent",
            "&:hover": { backgroundColor: alpha("#ffffff", 0.055) },
          })}
        >
          {t("sessions.new")}
        </Button>
      </Box>

      <Typography
        variant="caption"
        sx={{ px: 2, pb: 0.7, color: "#5f665f", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {t("sessions.recent")}
      </Typography>
      <List dense disablePadding sx={{ minHeight: 0, flex: 1, px: 0.8, overflow: "auto" }}>
        {sessions.length === 0 ? (
          <Typography sx={{ px: 1.2, py: 1.5, color: "#626962", fontSize: "0.68rem", lineHeight: 1.55 }}>
            {t("sessions.empty")}
          </Typography>
        ) : (
          sessions.map((session) => (
            <ListItemButton
              key={session.id}
              selected={session.id === activeSessionId && !settingsActive}
              disabled={busy}
              onClick={() => {
                void onOpenSession(session.id);
                onNavigate?.();
              }}
              sx={{
                minHeight: 37,
                mb: 0.25,
                px: 1.1,
                borderRadius: 1.2,
                gap: 0.5,
                "&.Mui-selected": { backgroundColor: "rgba(255,255,255,0.075)" },
                "&.Mui-selected:hover": { backgroundColor: "rgba(255,255,255,0.09)" },
              }}
            >
              <Tooltip title={session.title} placement="right">
                <Typography noWrap sx={{ minWidth: 0, flex: 1, color: "#bfc5bf", fontSize: "0.7rem" }}>
                  {session.title}
                </Typography>
              </Tooltip>
              <IconButton
                size="small"
                aria-label={t("sessions.actions")}
                onClick={(event) => handleActions(event, session)}
                sx={{ width: 25, height: 25, color: "#737a73", opacity: 0.72 }}
              >
                <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </ListItemButton>
          ))
        )}
      </List>

      <Box sx={{ p: 1.15, borderTop: 1, borderColor: "divider" }}>
        <Button
          fullWidth
          variant="text"
          startIcon={<SettingsOutlinedIcon />}
          disabled={busy}
          onClick={() => {
            onOpenSettings();
            onNavigate?.();
          }}
          sx={{
            justifyContent: "flex-start",
            px: 1.1,
            color: settingsActive ? "primary.main" : "#aeb5ae",
            backgroundColor: settingsActive ? "rgba(183,243,75,0.065)" : "transparent",
          }}
        >
          {t("settings.title")}
        </Button>
      </Box>

      <Menu anchorEl={actions?.anchor} open={!!actions} onClose={closeActions}>
        <MenuItem
          onClick={() => {
            if (actions) {
              setActionError(null);
              setRenameTarget(actions.session);
              setRenameValue(actions.session.title);
            }
            closeActions();
          }}
        >
          <EditOutlinedIcon sx={{ mr: 1.1, fontSize: 17 }} />
          {t("sessions.rename")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (actions) {
              setActionError(null);
              setDeleteTarget(actions.session);
            }
            closeActions();
          }}
          sx={{ color: "error.main" }}
        >
          <DeleteOutlineRoundedIcon sx={{ mr: 1.1, fontSize: 17 }} />
          {t("sessions.delete")}
        </MenuItem>
      </Menu>

      <Dialog open={!!renameTarget} onClose={closeRenameDialog} fullWidth maxWidth="xs">
        <DialogTitle>{t("sessions.renameTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={renameValue}
            error={!!actionError}
            helperText={actionError}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            onChange={(event) => {
              setRenameValue(event.target.value);
              setActionError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameValue.trim() && renameTarget) {
                event.preventDefault();
                void onRenameSession(renameTarget.id, renameValue)
                  .then(closeRenameDialog)
                  .catch((caught) => setActionError(String(caught)));
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRenameDialog}>{t("action.cancel")}</Button>
          <Button
            variant="contained"
            disabled={!renameValue.trim()}
            onClick={() => {
              if (!renameTarget) return;
              void onRenameSession(renameTarget.id, renameValue)
                .then(closeRenameDialog)
                .catch((caught) => setActionError(String(caught)));
            }}
          >
            {t("action.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={closeDeleteDialog} fullWidth maxWidth="xs">
        <DialogTitle>{t("sessions.deleteTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("sessions.deleteDetail", { title: deleteTarget?.title ?? "" })}
          </DialogContentText>
          {actionError && (
            <DialogContentText sx={{ mt: 1.5, color: "error.main" }}>
              {actionError}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog}>{t("action.cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (!deleteTarget) return;
              void onDeleteSession(deleteTarget.id)
                .then(closeDeleteDialog)
                .catch((caught) => setActionError(String(caught)));
            }}
          >
            {t("sessions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
