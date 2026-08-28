import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useState } from "react";
import type { ProviderKind } from "../agent/types";
import {
  formatModelList,
  parseModelList,
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  updateProviderProfile,
} from "../app/state";
import type { StoredProviderProfile, StoredSettings } from "../bridge/persistence";
import { LOCALE_LABELS, type Locale, type Translator } from "../i18n";

export function SettingsPage({
  settings,
  updateSettings,
  t,
}: {
  settings: StoredSettings;
  updateSettings: (update: (current: StoredSettings) => StoredSettings) => void;
  t: Translator;
}) {
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
      <Box sx={{ width: "min(850px, calc(100% - 40px))", mx: "auto", py: { xs: 3, md: 4.5 } }}>
        <Typography variant="overline">{t("settings.eyebrow")}</Typography>
        <Typography component="h2" sx={{ mt: 0.7, color: "#e2e6e2", fontSize: "1.35rem", fontWeight: 680 }}>
          {t("settings.title")}
        </Typography>
        <Typography sx={{ mt: 0.7, mb: 3, maxWidth: 640, color: "#788078", fontSize: "0.72rem", lineHeight: 1.65 }}>
          {t("settings.intro")}
        </Typography>

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
            <FormControl fullWidth size="small">
              <InputLabel id="default-provider-label">{t("settings.defaultFormat")}</InputLabel>
              <Select
                labelId="default-provider-label"
                value={settings.defaultProviderKind}
                label={t("settings.defaultFormat")}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    defaultProviderKind: event.target.value as ProviderKind,
                  }))
                }
              >
                {PROVIDER_KINDS.map((kind) => (
                  <MenuItem value={kind} key={kind}>{PROVIDER_LABELS[kind]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        <Stack spacing={1.4}>
          {settings.providers.map((profile) => (
            <ProviderCard
              key={profile.kind}
              profile={profile}
              onChange={(update) =>
                updateSettings((current) =>
                  updateProviderProfile(current, profile.kind, update),
                )
              }
              t={t}
            />
          ))}
        </Stack>

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
  t,
}: {
  profile: StoredProviderProfile;
  onChange: (
    update: (profile: StoredProviderProfile) => StoredProviderProfile,
  ) => void;
  t: Translator;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.2, backgroundColor: alpha("#ffffff", 0.012) }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.7, alignItems: "center" }}>
        <KeyOutlinedIcon color="primary" sx={{ fontSize: 17 }} />
        <Box>
          <Typography component="h3" sx={{ color: "#d2d7d2", fontSize: "0.75rem", fontWeight: 690 }}>
            {PROVIDER_LABELS[profile.kind]}
          </Typography>
          <Typography variant="caption" sx={{ color: "#626a62" }}>{profile.kind}</Typography>
        </Box>
      </Stack>
      <Stack spacing={1.35}>
        <TextField
          fullWidth
          size="small"
          type="url"
          label={t("provider.baseUrl")}
          value={profile.baseUrl}
          onChange={(event) =>
            onChange((current) => ({ ...current, baseUrl: event.target.value }))
          }
        />
        <TextField
          fullWidth
          size="small"
          type="password"
          label={t("provider.apiKey")}
          value={profile.apiKey}
          autoComplete="off"
          onChange={(event) =>
            onChange((current) => ({ ...current, apiKey: event.target.value }))
          }
        />
        <ModelListField profile={profile} onChange={onChange} t={t} />
        <TextField
          fullWidth
          size="small"
          type="number"
          label={t("provider.maxOutputTokens")}
          value={profile.maxOutputTokens}
          slotProps={{ htmlInput: { min: 256, max: 131072, step: 256 } }}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              maxOutputTokens: Number(event.target.value) || 256,
            }))
          }
        />
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
  onChange: (
    update: (profile: StoredProviderProfile) => StoredProviderProfile,
  ) => void;
  t: Translator;
}) {
  const [value, setValue] = useState(() => formatModelList(profile.models));
  useEffect(() => setValue(formatModelList(profile.models)), [profile.models]);
  const commit = () =>
    onChange((current) => ({ ...current, models: parseModelList(value) }));
  return (
    <TextField
      fullWidth
      multiline
      minRows={2}
      maxRows={5}
      size="small"
      label={t("provider.models")}
      helperText={t("provider.modelsHint")}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
    />
  );
}
