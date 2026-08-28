# CS Demo Agent

CS Demo Agent is a local-first desktop workspace for analyzing Counter-Strike 2 demo files with an AI agent. The application keeps the raw `.dem` file on the user's machine, exposes narrowly scoped parser tools to the model, and records the tool evidence behind every answer.

## Stack

- Tauri v2 and Rust for the desktop host and demo parsing
- React, TypeScript, Vite, and Bun for the interface and agent runtime
- `demoparser2` as the primary CS2 parser
- OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages adapters

## Development

Prerequisites: Bun 1.4+, Rust stable, and the Windows MSVC build tools.

```powershell
bun install
bun run dev
```

Run the desktop application with:

```powershell
bun run tauri dev
```

Validation commands:

```powershell
bun run check
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Privacy model

Raw demo bytes never leave the machine. Only JSON returned by explicitly selected parser tools is sent to the configured model endpoint. API keys are kept in memory for the current application session and are not written to local storage.
