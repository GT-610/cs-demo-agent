import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useRef, useState } from "react";
import type { ProviderKind } from "../agent/types";
import {
  createProviderProfile,
  formatModelList,
  parseModelList,
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  removeProviderProfile,
  updateProviderProfile,
} from "../app/state";
import type { StoredProviderProfile, StoredSettings } from "../bridge/persistence";
import { LOCALE_LABELS, type Locale, type Translator } from "../i18n";

export function SettingsPage({
  settings,
  dirty,
  saving,
  saveError,
  updateSettings,
  saveSettings,
  dismissSaveError,
  t,
}: {
  settings: StoredSettings;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  updateSettings: (update: (current: StoredSettings) => StoredSettings) => void;
  saveSettings: () => Promise<void>;
  dismissSaveError: () => void;
  t: Translator;
}) {
  const addProvider = () => {
    updateSettings((current) => {
      const provider = createProviderProfile();
      return {
        ...current,
        providers: [...current.providers, provider],
        defaultProviderId: current.defaultProviderId ?? provider.id,
      };
    });
  };

  return (
    <Box
      component="main"
      sx={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflowX: "hidden",
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <Box sx={{ width: "min(900px, calc(100% - 40px))", mx: "auto", py: { xs: 3, md: 4.5 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ mb: 3, alignItems: { xs: "stretch", sm: "flex-start" } }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h2" sx={{ color: "#e2e6e2", fontSize: "1.35rem", fontWeight: 680 }}>
              {t("settings.title")}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flex: "0 0 auto", alignItems: "center" }}>
            <Chip
              icon={dirty ? <WarningAmberRoundedIcon /> : <CheckCircleOutlineRoundedIcon />}
              label={dirty ? t("settings.unsaved") : t("settings.saved")}
              color={dirty ? "warning" : "success"}
              variant={dirty ? "filled" : "outlined"}
              sx={{ fontWeight: 680 }}
            />
            <Button
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              disabled={!dirty || saving}
              onClick={() => void saveSettings()}
              sx={{ minWidth: 104 }}
            >
              {saving ? t("settings.saving") : t("action.save")}
            </Button>
          </Stack>
        </Stack>

        {saveError && (
          <Alert severity="error" variant="outlined" onClose={dismissSaveError} sx={{ mb: 2.2 }}>
            {saveError}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2.2, mb: 2.2, backgroundColor: alpha("#ffffff", 0.012) }}>
          <Typography component="h3" sx={{ mb: 1.7, color: "#cbd1cb", fontSize: "0.76rem", fontWeight: 680 }}>
            {t("settings.general")}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="settings-language-label">{t("language.label")}</InputLabel>
              <Select
                labelId="settings-language-label"
                value={settings.locale}
                label={t("language.label")}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    locale: event.target.value as Locale,
                  }))
                }
              >
                {Object.entries(LOCALE_LABELS).map(([value, label]) => (
                  <MenuItem value={value} key={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small" disabled={settings.providers.length === 0}>
              <InputLabel id="default-provider-label">{t("settings.defaultProvider")}</InputLabel>
              <Select
                labelId="default-provider-label"
                value={settings.defaultProviderId ?? ""}
                label={t("settings.defaultProvider")}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    defaultProviderId: event.target.value || null,
                  }))
                }
              >
                {settings.providers.map((profile) => (
                  <MenuItem value={profile.id} key={profile.id}>
                    {profile.name.trim() || t("provider.untitled")}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        <Stack direction="row" spacing={2} sx={{ mb: 1.4, alignItems: "center" }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" sx={{ color: "#cbd1cb", fontSize: "0.78rem", fontWeight: 700 }}>
              {t("settings.providers")}
            </Typography>
            <Typography sx={{ mt: 0.35, color: "#697169", fontSize: "0.65rem", lineHeight: 1.55 }}>
              {t("settings.providersIntro")}
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={addProvider}>
            {t("settings.addProvider")}
          </Button>
        </Stack>

        {settings.providers.length === 0 ? (
          <Paper
            variant="outlined"
            sx={{ px: 3, py: 4.5, textAlign: "center", backgroundColor: alpha("#ffffff", 0.012) }}
          >
            <KeyOutlinedIcon color="primary" sx={{ fontSize: 28 }} />
            <Typography component="h3" sx={{ mt: 1.2, color: "#d1d6d1", fontSize: "0.82rem", fontWeight: 680 }}>
              {t("settings.emptyProvidersTitle")}
            </Typography>
            <Typography sx={{ maxWidth: 520, mx: "auto", mt: 0.65, color: "#707870", fontSize: "0.68rem", lineHeight: 1.6 }}>
              {t("settings.emptyProvidersDetail")}
            </Typography>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={addProvider} sx={{ mt: 2 }}>
              {t("settings.addProvider")}
            </Button>
          </Paper>
        ) : (
          <Stack spacing={1.4}>
            {settings.providers.map((profile) => (
              <ProviderCard
                key={profile.id}
                profile={profile}
                onChange={(update) =>
                  updateSettings((current) => updateProviderProfile(current, profile.id, update))
                }
                onDelete={() =>
                  updateSettings((current) => removeProviderProfile(current, profile.id))
                }
                t={t}
              />
            ))}
          </Stack>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2.2, color: "#697169", alignItems: "flex-start" }}>
          <StorageOutlinedIcon color="primary" sx={{ mt: "1px", fontSize: 16 }} />
          <Typography sx={{ fontSize: "0.64rem", lineHeight: 1.55 }}>
            {t("settings.persistenceNote")}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

function ProviderCard({
  profile,
  onChange,
  onDelete,
  t,
}: {
  profile: StoredProviderProfile;
  onChange: (update: (profile: StoredProviderProfile) => StoredProviderProfile) => void;
  onDelete: () => void;
  t: Translator;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.2, backgroundColor: alpha("#ffffff", 0.012) }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.7, alignItems: "center" }}>
        <KeyOutlinedIcon color="primary" sx={{ fontSize: 17 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap component="h3" sx={{ color: "#d2d7d2", fontSize: "0.75rem", fontWeight: 690 }}>
            {profile.name.trim() || t("provider.untitled")}
          </Typography>
          <Typography variant="caption" sx={{ color: "#626a62" }}>{PROVIDER_LABELS[profile.kind]}</Typography>
        </Box>
        <Tooltip title={t("provider.delete")}>
          <IconButton size="small" color="error" aria-label={t("provider.delete")} onClick={onDelete}>
            <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack spacing={1.35}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.35}>
          <TextField
            fullWidth
            required
            size="small"
            label={t("provider.name")}
            placeholder={t("provider.namePlaceholder")}
            value={profile.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          />
          <FormControl fullWidth size="small">
            <InputLabel id={`provider-format-${profile.id}`}>{t("provider.apiFormat")}</InputLabel>
            <Select
              labelId={`provider-format-${profile.id}`}
              value={profile.kind}
              label={t("provider.apiFormat")}
              onChange={(event) =>
                onChange((current) => ({ ...current, kind: event.target.value as ProviderKind }))
              }
            >
              {PROVIDER_KINDS.map((kind) => (
                <MenuItem value={kind} key={kind}>{PROVIDER_LABELS[kind]}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <TextField
          fullWidth
          required
          size="small"
          type="url"
          label={t("provider.baseUrl")}
          value={profile.baseUrl}
          onChange={(event) => onChange((current) => ({ ...current, baseUrl: event.target.value }))}
        />
        <TextField
          fullWidth
          size="small"
          type="password"
          label={t("provider.apiKey")}
          value={profile.apiKey}
          autoComplete="new-password"
          onChange={(event) => onChange((current) => ({ ...current, apiKey: event.target.value }))}
        />
        <ModelListField profile={profile} onChange={onChange} t={t} />
        <MaxOutputTokensField profile={profile} onChange={onChange} t={t} />
      </Stack>
    </Paper>
  );
}

function ModelListField({
  profile,
  onChange,
  t,
}: {
  profile: StoredProviderProfile;
  onChange: (update: (profile: StoredProviderProfile) => StoredProviderProfile) => void;
  t: Translator;
}) {
  const [value, setValue] = useState(() => formatModelList(profile.models));
  const pendingModelsRef = useRef<string[] | null>(null);
  const formattedModels = formatModelList(profile.models);
  useEffect(() => {
    const pendingModels = pendingModelsRef.current;
    if (pendingModels && modelListsEqual(pendingModels, profile.models)) {
      pendingModelsRef.current = null;
      return;
    }
    setValue(formattedModels);
  }, [formattedModels, profile.models]);
  return (
    <TextField
      fullWidth
      required
      multiline
      minRows={2}
      maxRows={5}
      size="small"
      label={t("provider.models")}
      helperText={t("provider.modelsHint")}
      value={value}
      onBlur={() => {
        pendingModelsRef.current = null;
        setValue(formatModelList(parseModelList(value)));
      }}
      onChange={(event) => {
        const next = event.target.value;
        const models = parseModelList(next);
        setValue(next);
        pendingModelsRef.current = models;
        onChange((current) => ({ ...current, models }));
      }}
    />
  );
}

function MaxOutputTokensField({
  profile,
  onChange,
  t,
}: {
  profile: StoredProviderProfile;
  onChange: (update: (profile: StoredProviderProfile) => StoredProviderProfile) => void;
  t: Translator;
}) {
  const normalizedValue = String(profile.maxOutputTokens);
  const [value, setValue] = useState(normalizedValue);
  const previousValueRef = useRef(profile.maxOutputTokens);
  useEffect(() => {
    if (previousValueRef.current !== profile.maxOutputTokens) {
      previousValueRef.current = profile.maxOutputTokens;
      setValue(normalizedValue);
    }
  }, [normalizedValue, profile.maxOutputTokens]);

  const commit = () => {
    const parsed = Number(value);
    const next = Number.isFinite(parsed)
      ? Math.min(131_072, Math.max(256, Math.trunc(parsed)))
      : 256;
    setValue(String(next));
    onChange((current) => ({ ...current, maxOutputTokens: next }));
  };

  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={t("provider.maxOutputTokens")}
      value={value}
      slotProps={{ htmlInput: { min: 256, max: 131072, step: 256 } }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
    />
  );
}

function modelListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index]);
}
