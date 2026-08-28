use std::{fs, path::PathBuf, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};

const MAX_ID_CHARS: usize = 128;
const MAX_TITLE_CHARS: usize = 200;
const MAX_PATH_CHARS: usize = 32_768;
const MAX_MESSAGE_CHARS: usize = 1_048_576;
const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;
const MAX_MESSAGES: usize = 10_000;
const MAX_MODELS_PER_PROVIDER: usize = 32;
const MAX_PROVIDERS: usize = 64;
const SETTINGS_SCHEMA_VERSION: u32 = 2;

pub struct DatabaseState {
    connection: Mutex<Connection>,
}

impl DatabaseState {
    pub fn initialize(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| AppError::Database(error.to_string()))?;
        }
        let connection =
            Connection::open(path).map_err(|error| AppError::Database(error.to_string()))?;
        initialize_connection(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn in_memory() -> AppResult<Self> {
        let connection =
            Connection::open_in_memory().map_err(|error| AppError::Database(error.to_string()))?;
        initialize_connection(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::Database("database lock was poisoned".to_string()))?;
        operation(&mut connection)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredProviderSettings {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredSettings {
    pub locale: String,
    pub default_provider_id: Option<String>,
    pub providers: Vec<StoredProviderSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub demo_path: String,
    pub provider_id: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedMessage {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    #[serde(flatten)]
    pub summary: SessionSummary,
    pub messages: Vec<PersistedMessage>,
    pub runtime_state: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub settings: Option<StoredSettings>,
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: String,
    pub title: String,
    pub demo_path: String,
    pub provider_id: String,
    pub model: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionInput {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSessionContentInput {
    pub id: String,
    pub demo_path: String,
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<PersistedMessage>,
    pub runtime_state: Option<Value>,
    pub updated_at: i64,
}

#[tauri::command]
pub fn load_workspace(state: State<'_, DatabaseState>) -> Result<WorkspaceSnapshot, String> {
    state
        .with_connection(|connection| {
            Ok(WorkspaceSnapshot {
                settings: load_settings_inner(connection)?,
                sessions: list_sessions_inner(connection)?,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_session(state: State<'_, DatabaseState>, id: String) -> Result<SessionDetail, String> {
    state
        .with_connection(|connection| load_session_inner(connection, &id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, DatabaseState>,
    settings: StoredSettings,
) -> Result<(), String> {
    state
        .with_connection(|connection| save_settings_inner(connection, &settings))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_session(
    state: State<'_, DatabaseState>,
    input: CreateSessionInput,
) -> Result<SessionSummary, String> {
    state
        .with_connection(|connection| create_session_inner(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_session(
    state: State<'_, DatabaseState>,
    input: RenameSessionInput,
) -> Result<(), String> {
    state
        .with_connection(|connection| rename_session_inner(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_session(state: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    state
        .with_connection(|connection| delete_session_inner(connection, &id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_session_content(
    state: State<'_, DatabaseState>,
    input: SaveSessionContentInput,
) -> Result<(), String> {
    state
        .with_connection(|connection| save_session_content_inner(connection, &input))
        .map_err(|error| error.to_string())
}

fn initialize_connection(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS settings (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 locale TEXT NOT NULL,
                 provider_kind TEXT NOT NULL,
                 base_url TEXT NOT NULL,
                 api_key TEXT NOT NULL,
                 model TEXT NOT NULL,
                 max_output_tokens INTEGER NOT NULL,
                 providers_json TEXT,
                 default_provider_id TEXT,
                 schema_version INTEGER NOT NULL DEFAULT 1
             );
             CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 demo_path TEXT NOT NULL,
                 provider_kind TEXT NOT NULL DEFAULT 'openai-responses',
                 provider_id TEXT NOT NULL DEFAULT '',
                 model TEXT NOT NULL DEFAULT '',
                 runtime_state TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS sessions_updated_at_idx
                 ON sessions(updated_at DESC);
             CREATE TABLE IF NOT EXISTS messages (
                 id TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 kind TEXT NOT NULL,
                 content TEXT NOT NULL,
                 metadata TEXT,
                 UNIQUE(session_id, position)
             );",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    let _ = ensure_column(connection, "settings", "providers_json", "TEXT")?;
    let _ = ensure_column(connection, "settings", "default_provider_id", "TEXT")?;
    let _ = ensure_column(
        connection,
        "settings",
        "schema_version",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    let _ = ensure_column(
        connection,
        "sessions",
        "provider_kind",
        "TEXT NOT NULL DEFAULT 'openai-responses'",
    )?;
    let _ = ensure_column(
        connection,
        "sessions",
        "provider_id",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    let _ = ensure_column(connection, "sessions", "model", "TEXT NOT NULL DEFAULT ''")?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(())
}

fn load_settings_inner(connection: &Connection) -> AppResult<Option<StoredSettings>> {
    let stored = connection
        .query_row(
            "SELECT locale, default_provider_id, providers_json, schema_version
             FROM settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, u32>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let Some((locale, default_provider_id, providers_json, schema_version)) = stored else {
        return Ok(None);
    };
    if schema_version != SETTINGS_SCHEMA_VERSION {
        return Ok(Some(StoredSettings {
            locale,
            default_provider_id: None,
            providers: Vec::new(),
        }));
    }
    let providers = match providers_json.filter(|value| !value.trim().is_empty()) {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| AppError::Database(format!("invalid provider settings: {error}")))?,
        None => Vec::new(),
    };
    Ok(Some(StoredSettings {
        locale,
        default_provider_id: default_provider_id.filter(|value| !value.is_empty()),
        providers,
    }))
}

fn save_settings_inner(connection: &Connection, settings: &StoredSettings) -> AppResult<()> {
    validate_settings(settings)?;
    let default_provider = settings.default_provider_id.as_ref().and_then(|id| {
        settings
            .providers
            .iter()
            .find(|provider| &provider.id == id)
    });
    let legacy_provider = default_provider.or_else(|| settings.providers.first());
    let providers_json = serde_json::to_string(&settings.providers)
        .map_err(|error| AppError::Serialization(error.to_string()))?;
    connection
        .execute(
            "INSERT INTO settings (
                 id, locale, provider_kind, base_url, api_key, model, max_output_tokens,
                 providers_json, default_provider_id, schema_version
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 locale = excluded.locale,
                 provider_kind = excluded.provider_kind,
                 base_url = excluded.base_url,
                 api_key = excluded.api_key,
                 model = excluded.model,
                 max_output_tokens = excluded.max_output_tokens,
                 providers_json = excluded.providers_json,
                 default_provider_id = excluded.default_provider_id,
                 schema_version = excluded.schema_version",
            params![
                settings.locale,
                legacy_provider
                    .map(|provider| provider.kind.as_str())
                    .unwrap_or(""),
                legacy_provider
                    .map(|provider| provider.base_url.as_str())
                    .unwrap_or(""),
                legacy_provider
                    .map(|provider| provider.api_key.as_str())
                    .unwrap_or(""),
                legacy_provider
                    .and_then(|provider| provider.models.first())
                    .map(String::as_str)
                    .unwrap_or(""),
                legacy_provider
                    .map(|provider| provider.max_output_tokens)
                    .unwrap_or(4096),
                providers_json,
                settings.default_provider_id,
                SETTINGS_SCHEMA_VERSION,
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(())
}

fn list_sessions_inner(connection: &Connection) -> AppResult<Vec<SessionSummary>> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, demo_path, provider_id, model, created_at, updated_at
             FROM sessions ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    let rows = statement
        .query_map([], session_summary_from_row)
        .map_err(|error| AppError::Database(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::Database(error.to_string()))
}

fn create_session_inner(
    connection: &Connection,
    input: &CreateSessionInput,
) -> AppResult<SessionSummary> {
    validate_id(&input.id)?;
    validate_title(&input.title)?;
    validate_demo_path(&input.demo_path)?;
    validate_id(&input.provider_id)?;
    validate_model(&input.model)?;
    connection
        .execute(
            "INSERT INTO sessions (
                 id, title, demo_path, provider_id, model, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                input.id,
                input.title.trim(),
                input.demo_path,
                input.provider_id,
                input.model.trim(),
                input.created_at
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(SessionSummary {
        id: input.id.clone(),
        title: input.title.trim().to_string(),
        demo_path: input.demo_path.clone(),
        provider_id: input.provider_id.clone(),
        model: input.model.trim().to_string(),
        created_at: input.created_at,
        updated_at: input.created_at,
    })
}

fn rename_session_inner(connection: &Connection, input: &RenameSessionInput) -> AppResult<()> {
    validate_id(&input.id)?;
    validate_title(&input.title)?;
    let changed = connection
        .execute(
            "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![input.title.trim(), input.updated_at, input.id],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    require_session(changed)
}

fn delete_session_inner(connection: &Connection, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let changed = connection
        .execute("DELETE FROM sessions WHERE id = ?1", [id])
        .map_err(|error| AppError::Database(error.to_string()))?;
    require_session(changed)
}

fn load_session_inner(connection: &Connection, id: &str) -> AppResult<SessionDetail> {
    validate_id(id)?;
    let (summary, runtime_state_text): (SessionSummary, Option<String>) = connection
        .query_row(
            "SELECT id, title, demo_path, provider_id, model, created_at, updated_at,
                    runtime_state
             FROM sessions WHERE id = ?1",
            [id],
            |row| Ok((session_summary_from_row(row)?, row.get(7)?)),
        )
        .optional()
        .map_err(|error| AppError::Database(error.to_string()))?
        .ok_or_else(|| AppError::InvalidInput("session was not found".to_string()))?;
    let runtime_state = parse_optional_json(runtime_state_text, "runtime state")?;
    let mut statement = connection
        .prepare(
            "SELECT id, kind, content, metadata
             FROM messages WHERE session_id = ?1 ORDER BY position ASC",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    let rows = statement
        .query_map([id], |row| {
            let metadata: Option<String> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                metadata,
            ))
        })
        .map_err(|error| AppError::Database(error.to_string()))?;
    let mut messages = Vec::new();
    for row in rows {
        let (message_id, kind, content, metadata) =
            row.map_err(|error| AppError::Database(error.to_string()))?;
        messages.push(PersistedMessage {
            id: message_id,
            kind,
            content,
            metadata: parse_optional_json(metadata, "message metadata")?,
        });
    }
    Ok(SessionDetail {
        summary,
        messages,
        runtime_state,
    })
}

fn save_session_content_inner(
    connection: &mut Connection,
    input: &SaveSessionContentInput,
) -> AppResult<()> {
    validate_id(&input.id)?;
    validate_demo_path(&input.demo_path)?;
    validate_id(&input.provider_id)?;
    validate_model(&input.model)?;
    validate_messages(&input.messages)?;
    let runtime_state = serialize_optional_json(input.runtime_state.as_ref(), "runtime state")?;
    let transaction = connection
        .transaction()
        .map_err(|error| AppError::Database(error.to_string()))?;
    let changed = transaction
        .execute(
            "UPDATE sessions
             SET demo_path = ?1, provider_id = ?2, model = ?3, runtime_state = ?4,
                 updated_at = ?5
             WHERE id = ?6",
            params![
                input.demo_path,
                input.provider_id,
                input.model.trim(),
                runtime_state,
                input.updated_at,
                input.id
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    require_session(changed)?;
    replace_messages(&transaction, input)?;
    transaction
        .commit()
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(())
}

fn replace_messages(
    transaction: &Transaction<'_>,
    input: &SaveSessionContentInput,
) -> AppResult<()> {
    transaction
        .execute("DELETE FROM messages WHERE session_id = ?1", [&input.id])
        .map_err(|error| AppError::Database(error.to_string()))?;
    let mut statement = transaction
        .prepare(
            "INSERT INTO messages (id, session_id, position, kind, content, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    for (position, message) in input.messages.iter().enumerate() {
        let metadata = serialize_optional_json(message.metadata.as_ref(), "message metadata")?;
        statement
            .execute(params![
                message.id,
                input.id,
                position as i64,
                message.kind,
                message.content,
                metadata,
            ])
            .map_err(|error| AppError::Database(error.to_string()))?;
    }
    Ok(())
}

fn session_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        demo_path: row.get(2)?,
        provider_id: row.get(3)?,
        model: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn validate_settings(settings: &StoredSettings) -> AppResult<()> {
    if !matches!(settings.locale.as_str(), "en" | "zh-CN") {
        return Err(AppError::InvalidInput("unsupported locale".to_string()));
    }
    if settings.providers.len() > MAX_PROVIDERS {
        return Err(AppError::InvalidInput(format!(
            "provider settings cannot contain more than {MAX_PROVIDERS} profiles"
        )));
    }
    let mut ids = std::collections::HashSet::new();
    for provider in &settings.providers {
        validate_id(&provider.id)?;
        validate_text(&provider.name, "provider name", MAX_TITLE_CHARS, false)?;
        validate_provider_kind(&provider.kind)?;
        if !ids.insert(provider.id.as_str()) {
            return Err(AppError::InvalidInput(
                "provider settings contain duplicate identifiers".to_string(),
            ));
        }
        validate_text(
            &provider.base_url,
            "provider base URL",
            MAX_PATH_CHARS,
            false,
        )?;
        validate_text(&provider.api_key, "provider API key", MAX_PATH_CHARS, true)?;
        if provider.models.is_empty() || provider.models.len() > MAX_MODELS_PER_PROVIDER {
            return Err(AppError::InvalidInput(format!(
                "provider must contain between one and {MAX_MODELS_PER_PROVIDER} models"
            )));
        }
        let mut models = std::collections::HashSet::new();
        for model in &provider.models {
            validate_model(model)?;
            if !models.insert(model.trim()) {
                return Err(AppError::InvalidInput(
                    "provider settings contain duplicate models".to_string(),
                ));
            }
        }
        if !(256..=131_072).contains(&provider.max_output_tokens) {
            return Err(AppError::InvalidInput(
                "max output tokens must be between 256 and 131072".to_string(),
            ));
        }
    }
    if let Some(default_provider_id) = &settings.default_provider_id {
        if !ids.contains(default_provider_id.as_str()) {
            return Err(AppError::InvalidInput(
                "default provider is missing".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_provider_kind(value: &str) -> AppResult<()> {
    if matches!(value, "openai-responses" | "openai-chat" | "anthropic") {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "unsupported provider kind".to_string(),
        ))
    }
}

fn validate_model(value: &str) -> AppResult<()> {
    validate_text(value, "provider model", MAX_TITLE_CHARS, false)
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<bool> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| AppError::Database(error.to_string()))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| AppError::Database(error.to_string()))?;
    for existing in columns {
        if existing.map_err(|error| AppError::Database(error.to_string()))? == column {
            return Ok(false);
        }
    }
    connection
        .execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(true)
}

fn validate_messages(messages: &[PersistedMessage]) -> AppResult<()> {
    if messages.len() > MAX_MESSAGES {
        return Err(AppError::InvalidInput(format!(
            "session has more than {MAX_MESSAGES} messages"
        )));
    }
    for message in messages {
        validate_id(&message.id)?;
        if !matches!(message.kind.as_str(), "user" | "assistant" | "tool") {
            return Err(AppError::InvalidInput(
                "unsupported message kind".to_string(),
            ));
        }
        validate_text(&message.content, "message content", MAX_MESSAGE_CHARS, true)?;
        let _ = serialize_optional_json(message.metadata.as_ref(), "message metadata")?;
    }
    Ok(())
}

fn validate_id(value: &str) -> AppResult<()> {
    validate_text(value, "identifier", MAX_ID_CHARS, false)
}

fn validate_title(value: &str) -> AppResult<()> {
    validate_text(value, "session title", MAX_TITLE_CHARS, false)
}

fn validate_demo_path(value: &str) -> AppResult<()> {
    validate_text(value, "demo path", MAX_PATH_CHARS, false)?;
    if !value.to_ascii_lowercase().ends_with(".dem") {
        return Err(AppError::InvalidInput(
            "session demo path must end with .dem".to_string(),
        ));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str, max_chars: usize, allow_empty: bool) -> AppResult<()> {
    if !allow_empty && value.trim().is_empty() {
        return Err(AppError::InvalidInput(format!("{label} is required")));
    }
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{label} exceeds {max_chars} characters"
        )));
    }
    Ok(())
}

fn serialize_optional_json(value: Option<&Value>, label: &str) -> AppResult<Option<String>> {
    value
        .map(|value| {
            let serialized = serde_json::to_string(value)
                .map_err(|error| AppError::Serialization(error.to_string()))?;
            if serialized.len() > MAX_JSON_BYTES {
                return Err(AppError::InvalidInput(format!(
                    "{label} exceeds {MAX_JSON_BYTES} bytes"
                )));
            }
            Ok(serialized)
        })
        .transpose()
}

fn parse_optional_json(value: Option<String>, label: &str) -> AppResult<Option<Value>> {
    value
        .map(|value| {
            serde_json::from_str(&value)
                .map_err(|error| AppError::Database(format!("invalid {label}: {error}")))
        })
        .transpose()
}

fn require_session(changed: usize) -> AppResult<()> {
    if changed == 0 {
        Err(AppError::InvalidInput("session was not found".to_string()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> StoredSettings {
        StoredSettings {
            locale: "zh-CN".to_string(),
            default_provider_id: Some("provider-openai".to_string()),
            providers: vec![StoredProviderSettings {
                id: "provider-openai".to_string(),
                name: "OpenAI".to_string(),
                kind: "openai-responses".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "test-key".to_string(),
                models: vec!["gpt-test".to_string(), "gpt-next".to_string()],
                max_output_tokens: 4096,
            }],
        }
    }

    fn create_input() -> CreateSessionInput {
        CreateSessionInput {
            id: "session-1".to_string(),
            title: "First match".to_string(),
            demo_path: "C:\\demos\\match.dem".to_string(),
            provider_id: "provider-openai".to_string(),
            model: "gpt-test".to_string(),
            created_at: 100,
        }
    }

    #[test]
    fn settings_round_trip() {
        let state = DatabaseState::in_memory().expect("database");
        state
            .with_connection(|connection| save_settings_inner(connection, &settings()))
            .expect("save settings");
        let loaded = state
            .with_connection(|connection| load_settings_inner(connection))
            .expect("load settings");
        assert_eq!(loaded, Some(settings()));
    }

    #[test]
    fn empty_provider_settings_round_trip() {
        let state = DatabaseState::in_memory().expect("database");
        let empty = StoredSettings {
            locale: "en".to_string(),
            default_provider_id: None,
            providers: Vec::new(),
        };
        state
            .with_connection(|connection| save_settings_inner(connection, &empty))
            .expect("save empty settings");
        let loaded = state
            .with_connection(|connection| load_settings_inner(connection))
            .expect("load settings");
        assert_eq!(loaded, Some(empty));
    }

    #[test]
    fn sessions_and_messages_round_trip_atomically() {
        let state = DatabaseState::in_memory().expect("database");
        let created = state
            .with_connection(|connection| create_session_inner(connection, &create_input()))
            .expect("create session");
        assert_eq!(created.title, "First match");

        let content = SaveSessionContentInput {
            id: created.id.clone(),
            demo_path: created.demo_path.clone(),
            provider_id: "provider-backup".to_string(),
            model: "gpt-next".to_string(),
            messages: vec![PersistedMessage {
                id: "message-1".to_string(),
                kind: "assistant".to_string(),
                content: "Analysis".to_string(),
                metadata: Some(serde_json::json!({ "status": "complete" })),
            }],
            runtime_state: Some(serde_json::json!({ "messages": [] })),
            updated_at: 200,
        };
        state
            .with_connection(|connection| save_session_content_inner(connection, &content))
            .expect("save content");
        let loaded = state
            .with_connection(|connection| load_session_inner(connection, &created.id))
            .expect("load session");
        assert_eq!(loaded.messages, content.messages);
        assert_eq!(loaded.runtime_state, content.runtime_state);
        assert_eq!(loaded.summary.provider_id, "provider-backup");
        assert_eq!(loaded.summary.model, "gpt-next");
        assert_eq!(loaded.summary.updated_at, 200);
    }

    #[test]
    fn deleting_a_session_cascades_messages() {
        let state = DatabaseState::in_memory().expect("database");
        let created = state
            .with_connection(|connection| create_session_inner(connection, &create_input()))
            .expect("create session");
        state
            .with_connection(|connection| {
                save_session_content_inner(
                    connection,
                    &SaveSessionContentInput {
                        id: created.id.clone(),
                        demo_path: created.demo_path.clone(),
                        provider_id: created.provider_id.clone(),
                        model: created.model.clone(),
                        messages: vec![PersistedMessage {
                            id: "message-1".to_string(),
                            kind: "user".to_string(),
                            content: "Question".to_string(),
                            metadata: None,
                        }],
                        runtime_state: None,
                        updated_at: 200,
                    },
                )?;
                delete_session_inner(connection, &created.id)
            })
            .expect("delete session");
        let count: i64 = state
            .with_connection(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                    .map_err(|error| AppError::Database(error.to_string()))
            })
            .expect("count messages");
        assert_eq!(count, 0);
    }

    #[test]
    fn persistence_limits_untrusted_values() {
        let state = DatabaseState::in_memory().expect("database");
        let mut input = create_input();
        input.title = " ".to_string();
        assert!(state
            .with_connection(|connection| create_session_inner(connection, &input))
            .is_err());
        assert!(validate_demo_path("notes.txt").is_err());
        assert!(validate_settings(&StoredSettings {
            locale: "fr".to_string(),
            ..settings()
        })
        .is_err());
    }

    #[test]
    fn legacy_provider_settings_are_discarded_without_losing_sessions() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "CREATE TABLE settings (
                     id INTEGER PRIMARY KEY,
                     locale TEXT NOT NULL,
                     provider_kind TEXT NOT NULL,
                     base_url TEXT NOT NULL,
                     api_key TEXT NOT NULL,
                     model TEXT NOT NULL,
                     max_output_tokens INTEGER NOT NULL
                 );
                 INSERT INTO settings VALUES (
                     1, 'en', 'anthropic', 'https://api.anthropic.com', 'key',
                     'claude-test', 4096
                 );
                 CREATE TABLE sessions (
                     id TEXT PRIMARY KEY,
                     title TEXT NOT NULL,
                     demo_path TEXT NOT NULL,
                     runtime_state TEXT,
                     created_at INTEGER NOT NULL,
                     updated_at INTEGER NOT NULL
                 );
                 INSERT INTO sessions VALUES (
                     'legacy', 'Legacy', 'C:\\demos\\legacy.dem', NULL, 1, 2
                 );",
            )
            .expect("legacy schema");
        initialize_connection(&connection).expect("migrate");

        let loaded_settings = load_settings_inner(&connection)
            .expect("load settings")
            .expect("settings");
        assert_eq!(loaded_settings.locale, "en");
        assert_eq!(loaded_settings.default_provider_id, None);
        assert!(loaded_settings.providers.is_empty());
        let sessions = list_sessions_inner(&connection).expect("sessions");
        assert_eq!(sessions[0].id, "legacy");
        assert_eq!(sessions[0].provider_id, "");
        assert_eq!(sessions[0].model, "");
    }
}
