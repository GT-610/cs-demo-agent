import { Box, Link, Stack, Typography } from "@mui/material";
import appIcon from "../../src-tauri/app-icon.svg";
import packageInfo from "../../package.json";
import type { ReactNode } from "react";
import type { Translator } from "../i18n";

const AUTHOR_URL = "https://github.com/GT-610";
const SOURCE_URL = "https://github.com/GT-610/cs-demo-agent";

export function AboutPage({ t }: { t: Translator }) {
  return (
    <Box
      component="main"
      sx={{
        display: "flex",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        px: 3,
        py: 5,
      }}
    >
      <Stack spacing={0.8} sx={{ alignItems: "center", textAlign: "center" }}>
        <Box
          component="img"
          src={appIcon}
          alt=""
          sx={{ width: 80, height: 80, borderRadius: 2, mb: 0.8 }}
        />
        <Typography component="h2" sx={{ color: "#e9ede9", fontSize: "1.35rem", fontWeight: 700 }}>
          CS Demo Agent
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          v{packageInfo.version}
        </Typography>
        <Box sx={{ height: 18 }} />
        <AboutLine label={t("about.author")}>
          <Link href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" color="primary.main">
            GT610
          </Link>
        </AboutLine>
        <AboutLine label={t("about.license")}>GPL-3.0-only</AboutLine>
        <AboutLine label={t("about.sourceCode")}>
          <Link href={SOURCE_URL} target="_blank" rel="noopener noreferrer" color="primary.main">
            {SOURCE_URL}
          </Link>
        </AboutLine>
      </Stack>
    </Box>
  );
}

function AboutLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
      {label}: {children}
    </Typography>
  );
}
