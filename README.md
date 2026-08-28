# CS Demo Agent

CS Demo Agent is a local-first desktop application for analyzing Counter-Strike 2 demo files with an AI agent. It combines a native Rust demo parser with model tool calling, so answers can be traced back to the events, rounds, ticks, economy records, and grenade trajectories that produced them.

## What is included

- A Tauri v2 desktop host with a React and TypeScript interface
- Native `demoparser2`-based parsing for Source 2 `.dem` files
- OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages adapters
- Parallel tool execution with malformed-call recovery and an iteration limit
- Markdown conversations and an expandable evidence trace for every tool call
- Local file selection and native drag-and-drop
- In-memory provider credentials and a constrained Rust HTTP transport

## Use the application

1. Start the desktop application and choose or drop a Counter-Strike 2 `.dem` file.
2. Select the provider protocol used by the configured endpoint.
3. Enter the provider base URL, model name, and API key if the endpoint requires one.
4. Ask a question about the match. The agent will query the local parser before making claims about demo data.

Changing the demo, endpoint, protocol, model, or API key resets the active model conversation so provider continuation state cannot leak between configurations. The **Clear session** action resets the conversation and its evidence trace without unloading the demo.

## Provider configuration

| Protocol | Default base URL | Endpoint used |
| --- | --- | --- |
| OpenAI Responses | `https://api.openai.com/v1` | `/responses` |
| OpenAI Chat Completions | `https://api.openai.com/v1` | `/chat/completions` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `/messages` |

OpenAI-compatible and Anthropic-compatible local or hosted endpoints can be used by changing the base URL. HTTP is accepted for local services; remote services should use HTTPS. API keys are optional for endpoints that do not require authentication.

The base URL may include `/v1` or the final endpoint path. The adapter normalizes either form without duplicating path segments.

## Demo analysis tools

The model can use these host-controlled tools:

- `get_demo_header` — map, server, protocol, and demo format metadata
- `get_player_info` — recorded roster and initial team numbers
- `list_game_events` — event names that occur in the selected demo
- `query_events` — filtered event queries with explicit player/global properties
- `query_ticks` — specific or equidistantly sampled player-state ticks
- `query_grenades` — grenade trajectory samples and optional global properties
- `get_round_summary` — host-aggregated winners, reasons, kills, and economy evidence
- `get_economy_analysis` — per-round team balances, equipment values, spending, and buy classification

The model never supplies the file path. The desktop host validates the selected absolute `.dem` path and injects it after receiving a tool call. Event results are bounded at 50,000 rows and tick results at 10,000 rows. Sampled or truncated results are marked in tool metadata and shown in the evidence panel.

## Privacy and security

- Raw demo bytes are memory-mapped and parsed locally. They are never uploaded to the model provider.
- Only the JSON returned by model-selected parser tools is sent to the configured endpoint.
- API keys remain in React memory for the current application process and are not written to local storage.
- Provider requests pass through a Rust command that accepts only HTTP/HTTPS JSON POST requests, rejects credential-bearing URLs and transport-managed headers, disables redirects, applies timeouts, and limits request/response size.
- Player Steam IDs are used only to associate records inside the selected demo.

## Development

Prerequisites:

- Bun 1.4 or newer
- Rust stable
- Windows MSVC build tools when building on Windows

Install dependencies and run the desktop application:

```powershell
bun install
bun run tauri dev
```

Run the browser-only Vite interface for layout work:

```powershell
bun run dev
```

The browser-only interface cannot call native file, parser, or provider transport commands.

## Validation

Frontend and agent runtime:

```powershell
bun run check
bun test
bun run build
```

Rust host:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --no-deps -- -D warnings
```

Build the native release executable:

```powershell
bun run tauri build
```

With the current bundle configuration, the Windows executable is written below `src-tauri/target/release` without creating an installer.

### Real demo integration test

The ordinary Rust test suite does not require a large fixture. To run parser integration coverage against a real demo, set `CS_DEMO_AGENT_TEST_DEMO` to an absolute `.dem` path:

```powershell
$env:CS_DEMO_AGENT_TEST_DEMO='D:\matches\reference.dem'
cargo test --manifest-path src-tauri/Cargo.toml parses_a_demo_when_the_integration_fixture_is_configured -- --nocapture
```

This test covers the header, game events, round aggregation, and grenade trajectories.

## Parser provenance

The Rust parser core is vendored under `vendor/demoparser` from `demoparser2` commit `57f24c76776ac176e893833f3a5b4aad718a8196`. See `vendor/demoparser/NOTICE.md` for the vendoring scope and generated-source rationale.
