import { alpha, createTheme } from "@mui/material/styles";

const acid = "#b7f34b";
const orange = "#f5a24b";
const cyan = "#63cbd7";
const background = "#090b0a";
const surface = "#111512";
const divider = "rgba(230, 239, 230, 0.10)";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: acid,
      light: "#c8ff68",
      dark: "#8fbe3a",
      contrastText: "#0b1008",
    },
    secondary: {
      main: cyan,
    },
    warning: {
      main: orange,
    },
    error: {
      main: "#ff7870",
    },
    background: {
      default: background,
      paper: surface,
    },
    text: {
      primary: "#e8ece8",
      secondary: "#8f9991",
      disabled: "#596159",
    },
    divider,
  },
  typography: {
    fontFamily:
      'Inter, "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    fontSize: 12,
    h1: {
      fontSize: "1.35rem",
      fontWeight: 650,
      letterSpacing: "-0.025em",
    },
    h2: {
      fontSize: "1.05rem",
      fontWeight: 630,
    },
    button: {
      fontSize: "0.7rem",
      fontWeight: 720,
      letterSpacing: "0.01em",
      textTransform: "none",
    },
    overline: {
      color: acid,
      fontSize: "0.61rem",
      fontWeight: 760,
      letterSpacing: "0.19em",
      lineHeight: 1.5,
    },
    caption: {
      fontSize: "0.62rem",
    },
  },
  shape: {
    borderRadius: 5,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "html, body, #root": {
          width: "100%",
          minWidth: 320,
          minHeight: "100%",
        },
        body: {
          minHeight: "100vh",
          overflow: "hidden",
          background: `radial-gradient(circle at 64% -10%, ${alpha(acid, 0.055)}, transparent 32%), ${background}`,
          fontSynthesis: "none",
          textRendering: "optimizeLegibility",
        },
        "::selection": {
          color: "#0b1008",
          background: alpha(acid, 0.78),
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          color: "#e8ece8",
          backgroundColor: alpha("#0a0d0b", 0.93),
          backgroundImage: "none",
          borderBottom: `1px solid ${divider}`,
          backdropFilter: "blur(18px)",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        size: "small",
      },
      styleOverrides: {
        root: {
          minHeight: 34,
          borderRadius: 4,
        },
        outlined: {
          borderColor: alpha("#e6efe6", 0.17),
          color: "#b4bcb5",
          "&:hover": {
            borderColor: alpha(acid, 0.5),
            color: acid,
            backgroundColor: alpha(acid, 0.04),
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#0a0d0b",
          fontSize: "0.7rem",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha("#e6efe6", 0.17),
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha(acid, 0.36),
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha(acid, 0.58),
            borderWidth: 1,
          },
        },
        input: {
          padding: "8px 10px",
          "&::placeholder": {
            color: "#667067",
            opacity: 1,
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: "#747d76",
          fontSize: "0.7rem",
          fontWeight: 650,
        },
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
        variant: "outlined",
      },
      styleOverrides: {
        root: {
          height: 23,
          borderColor: alpha("#e6efe6", 0.15),
          borderRadius: 4,
          color: "#879088",
          backgroundColor: alpha("#ffffff", 0.018),
          fontFamily: '"Cascadia Mono", Consolas, monospace',
          fontSize: "0.58rem",
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          fontSize: "0.67rem",
        },
      },
    },
    MuiAccordion: {
      defaultProps: {
        disableGutters: true,
        elevation: 0,
      },
      styleOverrides: {
        root: {
          border: `1px solid ${divider}`,
          borderRadius: "4px !important",
          backgroundColor: surface,
          "&::before": {
            display: "none",
          },
          "&.Mui-expanded": {
            margin: 0,
            borderColor: alpha("#e6efe6", 0.17),
          },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 50,
          padding: "0 10px",
          "&.Mui-expanded": {
            minHeight: 50,
          },
        },
        content: {
          margin: "8px 0",
          minWidth: 0,
          "&.Mui-expanded": {
            margin: "8px 0",
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          border: `1px solid ${alpha("#e6efe6", 0.14)}`,
          backgroundColor: "#151a16",
          color: "#d4dad5",
          fontSize: "0.65rem",
        },
      },
    },
  },
});
