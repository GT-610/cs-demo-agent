use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
};

use ahash::AHashMap;
use memmap2::{Mmap, MmapOptions};
use parser::{
    first_pass::parser_settings::{rm_user_friendly_names, FirstPassParser, ParserInputs},
    parse_demo::{DemoOutput, Parser, ParsingMode},
    second_pass::{
        parser_settings::create_huffman_lookup_table,
        variants::{soa_to_aos, OutputSerdeHelperStruct},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::State;
use tokio::sync::Semaphore;

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::error::{AppError, AppResult};

const MAX_EVENT_ROWS: usize = 50_000;
const MAX_TICK_ROWS: usize = 10_000;
const MAX_REQUESTED_TICKS: usize = 10_000;
const MAX_PROPERTIES: usize = 40;
const MAX_EVENT_NAMES: usize = 16;
const MAX_STEAM_IDS: usize = 64;
const MAX_SERIALIZED_ROWS_BYTES: usize = 512 * 1024;
const ROW_METADATA_RESERVE_BYTES: usize = 512;

const FILTER_FIELDS: &[&str] = &[
    "total_rounds_played",
    "is_warmup_period",
    "is_freeze_period",
    "tick",
    "user_name",
    "attacker_name",
];

const PLAYER_PROPERTIES: &[&str] = &[
    "X",
    "Y",
    "Z",
    "health",
    "armor_value",
    "is_alive",
    "team_num",
    "balance",
    "current_equip_value",
    "is_scoped",
    "is_defusing",
    "is_walking",
    "flash_duration",
    "has_defuser",
    "has_helmet",
    "active_weapon_name",
    "velocity",
    "velocity_X",
    "velocity_Y",
    "velocity_Z",
    "pitch",
    "yaw",
    "last_place_name",
    "spotted",
    "in_bomb_zone",
    "in_buy_zone",
    "shots_fired",
    "fov",
    "player_name",
    "player_steamid",
    "rank",
    "crosshair_code",
    "m_iStartAccount",
    "m_iTotalCashSpent",
    "FORWARD",
    "BACK",
    "LEFT",
    "RIGHT",
    "FIRE",
    "RELOAD",
    "USE",
    "ZOOM",
];

const OTHER_PROPERTIES: &[&str] = &[
    "total_rounds_played",
    "is_warmup_period",
    "is_freeze_period",
    "is_bomb_planted",
    "is_bomb_dropped",
    "round_win_status",
    "round_win_reason",
    "team_rounds_total",
    "is_ct_timeout",
    "is_terrorist_timeout",
    "game_phase",
    "map_name",
];

#[cfg(test)]
static PARSE_DEMO_CALLS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Default, Serialize)]
pub struct QueryMeta {
    pub row_count: Option<usize>,
    pub original_row_count: Option<usize>,
    pub truncated: bool,
    pub sampled: bool,
}

#[derive(Debug, Serialize)]
pub struct ToolResult {
    pub data: Value,
    pub meta: QueryMeta,
}

impl ToolResult {
    fn scalar(data: Value) -> Self {
        Self {
            data,
            meta: QueryMeta::default(),
        }
    }

    fn rows_unchecked(data: Vec<Value>, original_row_count: usize, sampled: bool) -> Self {
        let row_count = data.len();
        Self {
            data: Value::Array(data),
            meta: QueryMeta {
                row_count: Some(row_count),
                original_row_count: Some(original_row_count),
                truncated: row_count < original_row_count,
                sampled,
            },
        }
    }
}

pub struct DemoParseState {
    permits: Arc<Semaphore>,
}

impl Default for DemoParseState {
    fn default() -> Self {
        Self {
            permits: Arc::new(Semaphore::new(2)),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct QueryEventsRequest {
    pub path: String,
    pub event_names: Vec<String>,
    #[serde(default)]
    pub player_props: Option<Vec<String>>,
    #[serde(default)]
    pub other_props: Option<Vec<String>>,
    #[serde(default, rename = "where")]
    pub where_filter: Option<HashMap<String, Value>>,
}

#[derive(Debug, Deserialize)]
pub struct QueryTicksRequest {
    pub path: String,
    pub wanted_props: Vec<String>,
    #[serde(default)]
    pub ticks: Option<Vec<i32>>,
    #[serde(default)]
    pub players: Option<Vec<String>>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct QueryGrenadesRequest {
    pub path: String,
    #[serde(default)]
    pub extra: Option<Vec<String>>,
}

#[tauri::command]
pub async fn get_demo_header(
    state: State<'_, DemoParseState>,
    path: String,
) -> Result<ToolResult, String> {
    run_blocking(state, move || get_demo_header_sync(&path)).await
}

#[tauri::command]
pub async fn get_player_info(
    state: State<'_, DemoParseState>,
    path: String,
) -> Result<ToolResult, String> {
    run_blocking(state, move || get_player_info_sync(&path)).await
}

#[tauri::command]
pub async fn list_game_events(
    state: State<'_, DemoParseState>,
    path: String,
) -> Result<ToolResult, String> {
    run_blocking(state, move || list_game_events_sync(&path)).await
}

#[tauri::command]
pub async fn query_events(
    state: State<'_, DemoParseState>,
    request: QueryEventsRequest,
) -> Result<ToolResult, String> {
    run_blocking(state, move || query_events_sync(request)).await
}

#[tauri::command]
pub async fn query_ticks(
    state: State<'_, DemoParseState>,
    request: QueryTicksRequest,
) -> Result<ToolResult, String> {
    run_blocking(state, move || query_ticks_sync(request)).await
}

#[tauri::command]
pub async fn query_grenades(
    state: State<'_, DemoParseState>,
    request: QueryGrenadesRequest,
) -> Result<ToolResult, String> {
    run_blocking(state, move || query_grenades_sync(request)).await
}

#[tauri::command]
pub async fn get_round_summary(
    state: State<'_, DemoParseState>,
    path: String,
) -> Result<ToolResult, String> {
    run_blocking(state, move || get_round_summary_sync(&path)).await
}

#[tauri::command]
pub async fn get_economy_analysis(
    state: State<'_, DemoParseState>,
    path: String,
) -> Result<ToolResult, String> {
    run_blocking(state, move || get_economy_analysis_sync(&path)).await
}

async fn run_blocking<F>(
    state: State<'_, DemoParseState>,
    operation: F,
) -> Result<ToolResult, String>
where
    F: FnOnce() -> AppResult<ToolResult> + Send + 'static,
{
    let permit = state
        .permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "demo parser concurrency limiter closed".to_string())?;
    let result = tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("background parser task failed: {error}"))?
        .map_err(|error| error.to_string());
    drop(permit);
    result
}

fn get_demo_header_sync(path: &str) -> AppResult<ToolResult> {
    let mmap = open_demo(path)?;
    let huffman = create_huffman_lookup_table();
    let settings = base_settings(&huffman);
    let mut parser = FirstPassParser::new(&settings);
    let header: HashMap<String, String> = parser
        .parse_header_only(&mmap)
        .map_err(|error| AppError::DemoParse(error.to_string()))?
        .into_iter()
        .collect();
    serialize_scalar(header)
}

fn get_player_info_sync(path: &str) -> AppResult<ToolResult> {
    let mmap = open_demo(path)?;
    let huffman = create_huffman_lookup_table();
    let mut settings = base_settings(&huffman);
    let player_props = vec!["team_num".to_string()];
    let other_props = vec![
        "total_rounds_played".to_string(),
        "is_warmup_period".to_string(),
    ];
    let real_player_props = real_property_names(&player_props)?;
    let real_other_props = real_property_names(&other_props)?;
    let mut name_map = property_name_map(&real_player_props, &player_props);
    name_map.extend(property_name_map(&real_other_props, &other_props));
    settings.real_name_to_og_name = name_map;
    settings.wanted_player_props = real_player_props;
    settings.wanted_other_props = real_other_props;
    settings.wanted_events = vec![
        "player_spawn".to_string(),
        "player_first_connect".to_string(),
    ];
    settings.parse_ents = true;
    settings.only_header = true;
    let output = parse_demo(&mmap, settings)?;
    let events = to_value_array(&output.game_events)?;
    let fallback_players = if output.player_md.is_empty() {
        to_value_array(&output.roster)?
    } else {
        to_value_array(&output.player_md)?
    };
    let rows = build_initial_player_info(&events, &fallback_players);
    let count = rows.len();
    bounded_rows(rows, count, false)
}

#[derive(Debug)]
struct InitialPlayerIdentity {
    name: String,
    steamid: Option<String>,
    team_number: Option<i64>,
    first_tick: i64,
    source_priority: u8,
}

fn build_initial_player_info(events: &[Value], fallback_players: &[Value]) -> Vec<Value> {
    let mut players: HashMap<String, InitialPlayerIdentity> = HashMap::new();

    for event in events {
        let event_name = event.get("event_name").and_then(Value::as_str);
        let (name_field, steamid_field, source_priority) = match event_name {
            Some("player_spawn") => {
                if event.get("is_warmup_period").and_then(Value::as_bool) == Some(true) {
                    continue;
                }
                ("user_name", "user_steamid", 0)
            }
            Some("player_first_connect") => ("name", "steamid", 1),
            _ => continue,
        };
        let Some(steamid) = value_as_string(event.get(steamid_field)) else {
            continue;
        };
        if steamid == "0" {
            continue;
        }
        let team_number = event
            .get("user_team_num")
            .and_then(number_as_i64)
            .filter(|team| matches!(team, 2 | 3));
        let Some(team_number) = team_number else {
            continue;
        };
        let candidate = InitialPlayerIdentity {
            name: event
                .get(name_field)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            steamid: Some(steamid.clone()),
            team_number: Some(team_number),
            first_tick: event
                .get("tick")
                .and_then(number_as_i64)
                .unwrap_or(i64::MAX),
            source_priority,
        };
        let should_replace = players.get(&steamid).is_none_or(|current| {
            (candidate.source_priority, candidate.first_tick)
                < (current.source_priority, current.first_tick)
        });
        if should_replace {
            players.insert(steamid, candidate);
        }
    }

    let mut initial_team_by_final_side = HashMap::new();
    let mut ambiguous_final_sides = HashSet::new();
    for fallback in fallback_players {
        let Some(steamid) = value_as_string(fallback.get("steamid")) else {
            continue;
        };
        let Some(final_side) = fallback_team_number(fallback) else {
            continue;
        };
        let Some(initial_team) = players.get(&steamid).and_then(|player| player.team_number) else {
            continue;
        };
        if ambiguous_final_sides.contains(&final_side) {
            continue;
        }
        if let Some(existing_team) = initial_team_by_final_side.get(&final_side) {
            if *existing_team != initial_team {
                initial_team_by_final_side.remove(&final_side);
                ambiguous_final_sides.insert(final_side);
            }
        } else {
            initial_team_by_final_side.insert(final_side, initial_team);
        }
    }

    for (index, fallback) in fallback_players.iter().enumerate() {
        let steamid = value_as_string(fallback.get("steamid"));
        let name = fallback
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let key = steamid
            .clone()
            .unwrap_or_else(|| format!("fallback:{name}:{index}"));
        if let Some(current) = players.get_mut(&key) {
            if current.name.is_empty() {
                current.name = name;
            }
            continue;
        }
        let team_number = fallback_team_number(fallback).and_then(|final_side| {
            (!ambiguous_final_sides.contains(&final_side))
                .then(|| initial_team_by_final_side.get(&final_side).copied())
                .flatten()
        });
        players.insert(
            key,
            InitialPlayerIdentity {
                name,
                steamid,
                // End-of-match metadata cannot establish a stable team by itself. It can,
                // however, complete a roster when spawn evidence maps that final side to
                // Team A or Team B.
                team_number,
                first_tick: i64::MAX,
                source_priority: 2,
            },
        );
    }

    let mut players: Vec<InitialPlayerIdentity> = players.into_values().collect();
    players.sort_by(|left, right| {
        stable_team_rank(left.team_number)
            .cmp(&stable_team_rank(right.team_number))
            .then(left.first_tick.cmp(&right.first_tick))
            .then_with(|| left.name.cmp(&right.name))
    });
    players
        .into_iter()
        .map(|player| {
            let (stable_team, initial_side) = stable_team_identity(player.team_number);
            json!({
                "name": player.name,
                "steamid": player.steamid,
                "team_number": player.team_number,
                "stable_team": stable_team,
                "initial_side": initial_side,
            })
        })
        .collect()
}

fn fallback_team_number(player: &Value) -> Option<i64> {
    player
        .get("team_number")
        .and_then(number_as_i64)
        .filter(|team| matches!(team, 2 | 3))
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| {
        value
            .as_str()
            .map(str::to_string)
            .or_else(|| value.as_u64().map(|number| number.to_string()))
            .or_else(|| value.as_i64().map(|number| number.to_string()))
    })
}

fn stable_team_identity(team_number: Option<i64>) -> (Option<&'static str>, Option<&'static str>) {
    match team_number {
        Some(3) => (Some("A"), Some("CT")),
        Some(2) => (Some("B"), Some("T")),
        _ => (None, None),
    }
}

fn stable_team_rank(team_number: Option<i64>) -> u8 {
    match team_number {
        Some(3) => 0,
        Some(2) => 1,
        _ => 2,
    }
}

fn list_game_events_sync(path: &str) -> AppResult<ToolResult> {
    let mmap = open_demo(path)?;
    let huffman = create_huffman_lookup_table();
    let mut settings = base_settings(&huffman);
    settings.wanted_events = vec!["all".to_string()];
    let output = parse_demo(&mmap, settings)?;
    let mut events: Vec<String> = output.game_events_counter.into_iter().collect();
    events.sort();
    serialize_scalar(events)
}

fn query_events_sync(request: QueryEventsRequest) -> AppResult<ToolResult> {
    validate_filters(request.where_filter.as_ref())?;
    let rows = parse_event_rows(
        &request.path,
        request.event_names,
        request.player_props.unwrap_or_default(),
        request.other_props.unwrap_or_default(),
    )?;
    let mut original = 0;
    let mut data = Vec::with_capacity(rows.len().min(MAX_EVENT_ROWS));
    for row in rows {
        if request
            .where_filter
            .as_ref()
            .is_none_or(|filters| matches_filters(&row, filters))
        {
            original += 1;
            if data.len() < MAX_EVENT_ROWS {
                data.push(row);
            }
        }
    }
    bounded_rows(data, original, false)
}

fn query_ticks_sync(request: QueryTicksRequest) -> AppResult<ToolResult> {
    validate_properties(&request.wanted_props, PLAYER_PROPERTIES, "player")?;
    if request.ticks.is_none() && request.limit.is_none() {
        return Err(AppError::InvalidInput(
            "query_ticks without explicit ticks requires a limit".to_string(),
        ));
    }
    let ticks = request.ticks.unwrap_or_default();
    if ticks.len() > MAX_REQUESTED_TICKS {
        return Err(AppError::InvalidInput(format!(
            "query_ticks accepts at most {MAX_REQUESTED_TICKS} ticks"
        )));
    }
    if ticks.iter().any(|tick| *tick < 0) {
        return Err(AppError::InvalidInput(
            "ticks must be non-negative integers".to_string(),
        ));
    }
    let limit = request.limit.unwrap_or(MAX_TICK_ROWS);
    if !(1..=MAX_TICK_ROWS).contains(&limit) {
        return Err(AppError::InvalidInput(format!(
            "limit must be between 1 and {MAX_TICK_ROWS}"
        )));
    }
    let players = parse_steam_ids(request.players.unwrap_or_default())?;
    let rows = parse_tick_rows(&request.path, request.wanted_props, ticks, players)?;
    let original = rows.len();
    let sampled = original > limit;
    let rows = equidistant_sample(rows, limit);
    bounded_rows(rows, original, sampled)
}

fn query_grenades_sync(request: QueryGrenadesRequest) -> AppResult<ToolResult> {
    let extra = request.extra.unwrap_or_default();
    validate_properties(&extra, OTHER_PROPERTIES, "global")?;
    let real_extra = real_property_names(&extra)?;
    let name_map = property_name_map(&real_extra, &extra);
    let mmap = open_demo(&request.path)?;
    let huffman = create_huffman_lookup_table();
    let mut settings = base_settings(&huffman);
    settings.real_name_to_og_name = name_map;
    settings.wanted_other_props = real_extra;
    settings.parse_ents = true;
    settings.parse_projectiles = true;
    settings.parse_grenades = true;
    settings.only_header = true;
    let output = parse_demo(&mmap, settings)?;
    let rows = dataframe_rows(&output)?;
    let original = rows.len();
    let rows = rows.into_iter().take(MAX_EVENT_ROWS).collect();
    bounded_rows(rows, original, false)
}

fn get_round_summary_sync(path: &str) -> AppResult<ToolResult> {
    let events = parse_event_rows(
        path,
        vec![
            "round_end".to_string(),
            "player_death".to_string(),
            "round_freeze_end".to_string(),
        ],
        vec!["team_num".to_string()],
        vec![
            "total_rounds_played".to_string(),
            "is_warmup_period".to_string(),
        ],
    )?;
    let economy_rows = aggregate_economy(path, &events)?;
    let economy_by_round = index_by_round(&economy_rows);
    let mut rounds: BTreeMap<i64, RoundAccumulator> = BTreeMap::new();

    for event in &events {
        if event.get("is_warmup_period").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let event_name = event.get("event_name").and_then(Value::as_str);
        if !matches!(event_name, Some("round_end" | "player_death")) {
            continue;
        }
        let Some(total_rounds_played) = event_round(event) else {
            continue;
        };
        let accumulator = rounds.entry(total_rounds_played).or_default();
        match event_name {
            Some("round_end") => {
                accumulator.winner = event.get("winner").cloned().unwrap_or(Value::Null);
                accumulator.reason = event.get("reason").cloned().unwrap_or(Value::Null);
                accumulator.end_tick = event.get("tick").and_then(Value::as_i64);
            }
            Some("player_death") if is_counted_kill(event) => {
                accumulator.kills.push(select_fields(
                    event,
                    &[
                        "tick",
                        "user_name",
                        "user_steamid",
                        "attacker_name",
                        "attacker_steamid",
                        "assister_name",
                        "weapon",
                        "headshot",
                        "penetrated",
                        "thrusmoke",
                        "attackerblind",
                        "distance",
                        "noscope",
                    ],
                ));
            }
            _ => {}
        }
    }

    let rows: Vec<Value> = rounds
        .into_iter()
        .map(|(total_rounds_played, round)| {
            json!({
                "round": total_rounds_played + 1,
                "total_rounds_played": total_rounds_played,
                "winner": round.winner,
                "reason": round.reason,
                "end_tick": round.end_tick,
                "kills": round.kills,
                "economy": economy_by_round
                    .get(&(total_rounds_played + 1))
                    .cloned()
                    .unwrap_or(Value::Null),
            })
        })
        .collect();
    let count = rows.len();
    bounded_rows(rows, count, false)
}

fn get_economy_analysis_sync(path: &str) -> AppResult<ToolResult> {
    let freeze_events = parse_event_rows(
        path,
        vec!["round_freeze_end".to_string()],
        vec![],
        vec![
            "total_rounds_played".to_string(),
            "is_warmup_period".to_string(),
        ],
    )?;
    let rows = aggregate_economy(path, &freeze_events)?;
    let count = rows.len();
    bounded_rows(rows, count, false)
}

fn aggregate_economy(path: &str, events: &[Value]) -> AppResult<Vec<Value>> {
    let freeze_ticks: Vec<(i32, i64)> = events
        .iter()
        .filter(|event| event.get("event_name").and_then(Value::as_str) == Some("round_freeze_end"))
        .filter(|event| event.get("is_warmup_period").and_then(Value::as_bool) != Some(true))
        .filter_map(|event| {
            Some((
                i32::try_from(event.get("tick")?.as_i64()?).ok()?,
                event_round(event)?,
            ))
        })
        .collect();
    if freeze_ticks.is_empty() {
        return Ok(vec![]);
    }

    let tick_to_round: HashMap<i32, i64> = freeze_ticks.iter().copied().collect();
    let ticks: Vec<i32> = freeze_ticks.iter().map(|(tick, _)| *tick).collect();
    let tick_rows = parse_tick_rows(
        path,
        vec![
            "team_num".to_string(),
            "balance".to_string(),
            "current_equip_value".to_string(),
            "m_iStartAccount".to_string(),
            "m_iTotalCashSpent".to_string(),
        ],
        ticks,
        vec![],
    )?;
    let mut rounds: BTreeMap<i64, RoundEconomy> = BTreeMap::new();
    for row in tick_rows {
        let Some(tick) = row
            .get("tick")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
        else {
            continue;
        };
        let Some(total_rounds_played) = tick_to_round.get(&tick).copied() else {
            continue;
        };
        let team = row.get("team_num").and_then(number_as_i64);
        let economy = rounds.entry(total_rounds_played).or_default();
        match team {
            Some(2) => economy.t.add(&row),
            Some(3) => economy.ct.add(&row),
            _ => {}
        }
    }

    Ok(rounds
        .into_iter()
        .map(|(total_rounds_played, economy)| {
            json!({
                "round": total_rounds_played + 1,
                "total_rounds_played": total_rounds_played,
                "t": economy.t.to_value(),
                "ct": economy.ct.to_value(),
            })
        })
        .collect())
}

fn parse_event_rows(
    path: &str,
    event_names: Vec<String>,
    player_props: Vec<String>,
    other_props: Vec<String>,
) -> AppResult<Vec<Value>> {
    validate_event_names(&event_names)?;
    validate_properties(&player_props, PLAYER_PROPERTIES, "player")?;
    validate_properties(&other_props, OTHER_PROPERTIES, "global")?;
    let real_player_props = real_property_names(&player_props)?;
    let real_other_props = real_property_names(&other_props)?;
    let mut name_map = property_name_map(&real_player_props, &player_props);
    name_map.extend(property_name_map(&real_other_props, &other_props));
    let mmap = open_demo(path)?;
    let huffman = create_huffman_lookup_table();
    let mut settings = base_settings(&huffman);
    settings.real_name_to_og_name = name_map;
    settings.wanted_player_props = real_player_props;
    settings.wanted_other_props = real_other_props;
    settings.wanted_events = event_names;
    settings.parse_ents = true;
    settings.only_header = true;
    let output = parse_demo(&mmap, settings)?;
    to_value_array(output.game_events)
}

fn parse_tick_rows(
    path: &str,
    wanted_props: Vec<String>,
    wanted_ticks: Vec<i32>,
    wanted_players: Vec<u64>,
) -> AppResult<Vec<Value>> {
    validate_properties(&wanted_props, PLAYER_PROPERTIES, "player")?;
    let real_names = real_property_names(&wanted_props)?;
    let name_map = property_name_map(&real_names, &wanted_props);
    let mmap = open_demo(path)?;
    let huffman = create_huffman_lookup_table();
    let mut settings = base_settings(&huffman);
    settings.real_name_to_og_name = name_map;
    settings.wanted_players = wanted_players;
    settings.wanted_player_props = real_names;
    settings.wanted_ticks = wanted_ticks;
    settings.parse_ents = true;
    let output = parse_demo(&mmap, settings)?;
    dataframe_rows(&output)
}

fn dataframe_rows(output: &DemoOutput) -> AppResult<Vec<Value>> {
    let helper = OutputSerdeHelperStruct {
        prop_infos: output.prop_controller.prop_infos.clone(),
        inner: output.df.clone().into(),
    };
    let rows = soa_to_aos(helper);
    to_value_array(rows)
}

fn base_settings(huffman: &Vec<(u8, u8)>) -> ParserInputs<'_> {
    ParserInputs {
        wanted_players: vec![],
        real_name_to_og_name: AHashMap::default(),
        wanted_player_props: vec![],
        wanted_other_props: vec![],
        wanted_prop_states: AHashMap::default(),
        wanted_events: vec![],
        parse_ents: false,
        wanted_ticks: vec![],
        parse_projectiles: false,
        only_header: false,
        list_props: false,
        only_convars: false,
        huffman_lookup_table: huffman,
        order_by_steamid: false,
        fallback_bytes: None,
        parse_grenades: false,
    }
}

fn parse_demo(mmap: &Mmap, settings: ParserInputs<'_>) -> AppResult<DemoOutput> {
    #[cfg(test)]
    PARSE_DEMO_CALLS.fetch_add(1, Ordering::Relaxed);
    let mut parser = Parser::new(settings, ParsingMode::Normal);
    parser
        .parse_demo(mmap)
        .map_err(|error| AppError::DemoParse(error.to_string()))
}

fn open_demo(path: &str) -> AppResult<Mmap> {
    let path = validate_demo_path(path)?;
    let file = File::open(&path).map_err(|error| AppError::DemoFile(error.to_string()))?;
    // The app only opens user-selected demos read-only and never mutates them while mapped.
    unsafe { MmapOptions::new().map(&file) }.map_err(|error| AppError::DemoFile(error.to_string()))
}

fn validate_demo_path(value: &str) -> AppResult<PathBuf> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(
            "demo path must be absolute".to_string(),
        ));
    }
    let is_demo = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("dem"));
    if !is_demo {
        return Err(AppError::InvalidInput(
            "selected file must have a .dem extension".to_string(),
        ));
    }
    let metadata = path
        .metadata()
        .map_err(|error| AppError::DemoFile(error.to_string()))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(AppError::DemoFile(
            "selected demo is empty or not a regular file".to_string(),
        ));
    }
    path.canonicalize()
        .map_err(|error| AppError::DemoFile(error.to_string()))
}

fn validate_event_names(names: &[String]) -> AppResult<()> {
    if names.is_empty() || names.len() > MAX_EVENT_NAMES {
        return Err(AppError::InvalidInput(format!(
            "event_names must contain between 1 and {MAX_EVENT_NAMES} entries"
        )));
    }
    if names.iter().any(|name| {
        name.is_empty()
            || name.len() > 80
            || !name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
    }) {
        return Err(AppError::InvalidInput(
            "event names may only contain ASCII letters, digits, and underscores".to_string(),
        ));
    }
    validate_no_duplicates(names, "event names")?;
    Ok(())
}

fn validate_properties(values: &[String], allowed: &[&str], kind: &str) -> AppResult<()> {
    if values.len() > MAX_PROPERTIES {
        return Err(AppError::InvalidInput(format!(
            "at most {MAX_PROPERTIES} {kind} properties may be requested"
        )));
    }
    let invalid: Vec<&str> = values
        .iter()
        .map(String::as_str)
        .filter(|value| !allowed.contains(value))
        .collect();
    if !invalid.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "unsupported {kind} properties: {}",
            invalid.join(", ")
        )));
    }
    validate_no_duplicates(values, &format!("{kind} properties"))?;
    Ok(())
}

fn validate_no_duplicates(values: &[String], label: &str) -> AppResult<()> {
    let mut seen = HashSet::new();
    if let Some(duplicate) = values.iter().find(|value| !seen.insert(value.as_str())) {
        return Err(AppError::InvalidInput(format!(
            "duplicate {label} are not allowed: {duplicate}"
        )));
    }
    Ok(())
}

fn validate_filters(filters: Option<&HashMap<String, Value>>) -> AppResult<()> {
    let Some(filters) = filters else {
        return Ok(());
    };
    for (key, value) in filters {
        if !FILTER_FIELDS.contains(&key.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "unsupported where field: {key}"
            )));
        }
        if !value.is_null() && !value.is_boolean() && !value.is_number() && !value.is_string() {
            return Err(AppError::InvalidInput(format!(
                "where field {key} must be a string, number, boolean, or null"
            )));
        }
    }
    Ok(())
}

fn real_property_names(values: &[String]) -> AppResult<Vec<String>> {
    rm_user_friendly_names(&values.to_vec())
        .map_err(|error| AppError::InvalidInput(error.to_string()))
}

fn property_name_map(real: &[String], friendly: &[String]) -> AHashMap<String, String> {
    real.iter()
        .zip(friendly)
        .map(|(real, friendly)| (real.clone(), friendly.clone()))
        .collect()
}

fn parse_steam_ids(values: Vec<String>) -> AppResult<Vec<u64>> {
    if values.len() > MAX_STEAM_IDS {
        return Err(AppError::InvalidInput(format!(
            "query_ticks accepts at most {MAX_STEAM_IDS} Steam IDs"
        )));
    }
    let parsed: Vec<u64> = values
        .into_iter()
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| AppError::InvalidInput(format!("invalid Steam ID: {value}")))
        })
        .collect::<AppResult<_>>()?;
    let mut seen = HashSet::new();
    if let Some(duplicate) = parsed.iter().find(|value| !seen.insert(**value)) {
        return Err(AppError::InvalidInput(format!(
            "duplicate Steam IDs are not allowed: {duplicate}"
        )));
    }
    Ok(parsed)
}

fn matches_filters(row: &Value, filters: &HashMap<String, Value>) -> bool {
    filters
        .iter()
        .filter(|(_, expected)| !expected.is_null())
        .all(|(key, expected)| row.get(key) == Some(expected))
}

fn equidistant_sample(rows: Vec<Value>, limit: usize) -> Vec<Value> {
    if rows.len() <= limit {
        return rows;
    }
    equidistant_indices(rows.len(), limit)
        .into_iter()
        .map(|index| rows[index].clone())
        .collect()
}

fn equidistant_indices(row_count: usize, limit: usize) -> Vec<usize> {
    if limit == 0 || row_count == 0 {
        return vec![];
    }
    if limit >= row_count {
        return (0..row_count).collect();
    }
    if limit == 1 {
        return vec![0];
    }
    let last = row_count - 1;
    (0..limit).map(|index| index * last / (limit - 1)).collect()
}

fn bounded_rows(
    mut rows: Vec<Value>,
    original_row_count: usize,
    mut sampled: bool,
) -> AppResult<ToolResult> {
    let data_budget = MAX_SERIALIZED_ROWS_BYTES - ROW_METADATA_RESERVE_BYTES;
    let mut target = rows.len();
    let mut serialized_size = serialized_sample_size(&rows, target)?;
    while serialized_size > data_budget && target > 0 {
        let scaled = target.saturating_mul(data_budget) / serialized_size;
        target = scaled.min(target - 1);
        serialized_size = serialized_sample_size(&rows, target)?;
    }
    if target < rows.len() {
        rows = equidistant_sample(rows, target);
        sampled = true;
    }
    let result = ToolResult::rows_unchecked(rows, original_row_count, sampled);
    let serialized_size = serde_json::to_vec(&result)
        .map_err(|error| AppError::Serialization(error.to_string()))?
        .len();
    if serialized_size > MAX_SERIALIZED_ROWS_BYTES {
        return Err(AppError::Serialization(
            "bounded row result exceeded its serialization budget".to_string(),
        ));
    }
    Ok(result)
}

fn serialized_sample_size(rows: &[Value], limit: usize) -> AppResult<usize> {
    let selected: Vec<&Value> = equidistant_indices(rows.len(), limit)
        .into_iter()
        .map(|index| &rows[index])
        .collect();
    serde_json::to_vec(&selected)
        .map(|serialized| serialized.len())
        .map_err(|error| AppError::Serialization(error.to_string()))
}

fn serialize_scalar<T: Serialize>(value: T) -> AppResult<ToolResult> {
    serde_json::to_value(value)
        .map(ToolResult::scalar)
        .map_err(|error| AppError::Serialization(error.to_string()))
}

fn to_value_array<T: Serialize>(value: T) -> AppResult<Vec<Value>> {
    match serde_json::to_value(value).map_err(|error| AppError::Serialization(error.to_string()))? {
        Value::Array(rows) => Ok(rows),
        _ => Err(AppError::Serialization(
            "parser output was not an array".to_string(),
        )),
    }
}

fn event_round(event: &Value) -> Option<i64> {
    event.get("total_rounds_played").and_then(number_as_i64)
}

fn number_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number as i64))
}

fn number_as_f64(value: Option<&Value>) -> f64 {
    value
        .and_then(|value| value.as_f64().or_else(|| value.as_i64().map(|n| n as f64)))
        .unwrap_or_default()
}

fn is_counted_kill(event: &Value) -> bool {
    let attacker_id = event.get("attacker_steamid").and_then(Value::as_str);
    let victim_id = event.get("user_steamid").and_then(Value::as_str);
    if attacker_id.is_none() || attacker_id == victim_id {
        return false;
    }
    let attacker_team = event.get("attacker_team_num").and_then(number_as_i64);
    let victim_team = event.get("user_team_num").and_then(number_as_i64);
    matches!((attacker_team, victim_team), (Some(attacker), Some(victim)) if attacker != victim)
}

fn select_fields(value: &Value, fields: &[&str]) -> Value {
    let mut selected = Map::new();
    for field in fields {
        if let Some(value) = value.get(field) {
            selected.insert((*field).to_string(), value.clone());
        }
    }
    Value::Object(selected)
}

fn index_by_round(rows: &[Value]) -> HashMap<i64, Value> {
    rows.iter()
        .filter_map(|row| Some((row.get("round")?.as_i64()?, row.clone())))
        .collect()
}

#[derive(Default)]
struct RoundAccumulator {
    winner: Value,
    reason: Value,
    end_tick: Option<i64>,
    kills: Vec<Value>,
}

#[derive(Default)]
struct RoundEconomy {
    t: TeamEconomy,
    ct: TeamEconomy,
}

#[derive(Default)]
struct TeamEconomy {
    steam_ids: HashSet<String>,
    players: usize,
    total_balance: f64,
    total_equip_value: f64,
    total_start_balance: f64,
    total_cash_spent: f64,
}

impl TeamEconomy {
    fn add(&mut self, row: &Value) {
        let steam_id = row
            .get("steamid")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !steam_id.is_empty() && !self.steam_ids.insert(steam_id) {
            return;
        }
        self.players += 1;
        self.total_balance += number_as_f64(row.get("balance"));
        self.total_equip_value += number_as_f64(row.get("current_equip_value"));
        self.total_start_balance += number_as_f64(row.get("m_iStartAccount"));
        self.total_cash_spent += number_as_f64(row.get("m_iTotalCashSpent"));
    }

    fn to_value(&self) -> Value {
        let divisor = self.players.max(1) as f64;
        let average_equip_value = self.total_equip_value / divisor;
        json!({
            "players": self.players,
            "total_balance": self.total_balance,
            "average_balance": self.total_balance / divisor,
            "total_equip_value": self.total_equip_value,
            "average_equip_value": average_equip_value,
            "total_start_balance": self.total_start_balance,
            "total_cash_spent": self.total_cash_spent,
            "buy_type": classify_buy(average_equip_value),
        })
    }
}

fn classify_buy(average_equip_value: f64) -> &'static str {
    if average_equip_value < 2_000.0 {
        "eco"
    } else if average_equip_value < 3_500.0 {
        "semi-buy"
    } else if average_equip_value < 4_500.0 {
        "force-buy"
    } else {
        "full-buy"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_are_restricted() {
        assert!(validate_event_names(&["player_death".to_string()]).is_ok());
        assert!(validate_event_names(&["player-death".to_string()]).is_err());
        assert!(
            validate_event_names(&["player_death".to_string(), "player_death".to_string()])
                .is_err()
        );
        assert!(validate_event_names(&[]).is_err());
    }

    #[test]
    fn properties_use_an_explicit_allowlist() {
        assert!(validate_properties(&["health".to_string()], PLAYER_PROPERTIES, "player").is_ok());
        assert!(
            validate_properties(&["unknown".to_string()], PLAYER_PROPERTIES, "player").is_err()
        );
        assert!(validate_properties(
            &["health".to_string(), "health".to_string()],
            PLAYER_PROPERTIES,
            "player"
        )
        .is_err());
    }

    #[test]
    fn filters_use_an_explicit_allowlist_and_scalar_values() {
        assert!(validate_filters(Some(&HashMap::from([("tick".to_string(), json!(100))]))).is_ok());
        assert!(validate_filters(Some(&HashMap::from([(
            "weapon".to_string(),
            json!("ak47")
        )])))
        .is_err());
        assert!(
            validate_filters(Some(&HashMap::from([("tick".to_string(), json!([100]))]))).is_err()
        );
    }

    #[test]
    fn steam_ids_are_bounded_and_unique() {
        assert!(parse_steam_ids(vec!["76561198000000000".to_string()]).is_ok());
        assert!(parse_steam_ids(vec!["1".to_string(), "01".to_string()]).is_err());
        assert!(parse_steam_ids(vec!["1".to_string(); MAX_STEAM_IDS + 1]).is_err());
    }

    #[test]
    fn sampling_preserves_first_and_last_rows() {
        let rows = (0..10).map(|value| json!(value)).collect();
        assert_eq!(
            equidistant_sample(rows, 3),
            vec![json!(0), json!(4), json!(9)]
        );
    }

    #[test]
    fn player_info_uses_first_competitive_side_as_stable_team() {
        let events = vec![
            json!({
                "event_name": "player_spawn",
                "tick": 10,
                "is_warmup_period": true,
                "user_name": "Alpha",
                "user_steamid": "1",
                "user_team_num": 2,
            }),
            json!({
                "event_name": "player_first_connect",
                "tick": 20,
                "name": "Alpha",
                "steamid": "1",
                "user_team_num": 2,
            }),
            json!({
                "event_name": "player_spawn",
                "tick": 100,
                "is_warmup_period": false,
                "user_name": "Alpha",
                "user_steamid": "1",
                "user_team_num": 3,
            }),
            json!({
                "event_name": "player_spawn",
                "tick": 100,
                "is_warmup_period": false,
                "user_name": "Bravo",
                "user_steamid": "2",
                "user_team_num": 2,
            }),
            json!({
                "event_name": "player_spawn",
                "tick": 10_000,
                "is_warmup_period": false,
                "user_name": "Alpha",
                "user_steamid": "1",
                "user_team_num": 2,
            }),
        ];
        let fallback = vec![
            json!({ "name": "Alpha", "steamid": "1", "team_number": 2 }),
            json!({ "name": "Bravo", "steamid": "2", "team_number": 3 }),
            json!({ "name": "Unknown", "steamid": "3", "team_number": 3 }),
        ];

        let players = build_initial_player_info(&events, &fallback);

        assert_eq!(players[0]["name"], json!("Alpha"));
        assert_eq!(players[0]["team_number"], json!(3));
        assert_eq!(players[0]["stable_team"], json!("A"));
        assert_eq!(players[0]["initial_side"], json!("CT"));
        assert_eq!(players[1]["name"], json!("Bravo"));
        assert_eq!(players[1]["stable_team"], json!("B"));
        assert_eq!(players[2]["name"], json!("Unknown"));
        assert_eq!(players[2]["team_number"], json!(2));
        assert_eq!(players[2]["stable_team"], json!("B"));
    }

    #[test]
    fn player_info_does_not_guess_without_initial_side_evidence() {
        let players = build_initial_player_info(
            &[],
            &[json!({ "name": "Unknown", "steamid": "1", "team_number": 3 })],
        );

        assert!(players[0]["team_number"].is_null());
        assert!(players[0]["stable_team"].is_null());
    }

    #[test]
    fn byte_budget_uses_equidistant_sampling_and_updates_metadata() {
        let rows: Vec<Value> = (0..200)
            .map(|index| json!({ "index": index, "payload": "x".repeat(20_000) }))
            .collect();
        let result = bounded_rows(rows, 200, false).expect("rows should fit after sampling");
        let data = result
            .data
            .as_array()
            .expect("row result should be an array");

        assert!(serde_json::to_vec(&result).unwrap().len() <= MAX_SERIALIZED_ROWS_BYTES);
        assert!(result.meta.sampled);
        assert!(result.meta.truncated);
        assert_eq!(result.meta.original_row_count, Some(200));
        assert_eq!(result.meta.row_count, Some(data.len()));
        assert_eq!(
            data.first().and_then(|row| row.get("index")),
            Some(&json!(0))
        );
        assert_eq!(
            data.last().and_then(|row| row.get("index")),
            Some(&json!(199))
        );
    }

    #[test]
    fn kills_require_known_opposing_teams() {
        let valid = json!({
            "attacker_steamid": "1",
            "user_steamid": "2",
            "attacker_team_num": 2,
            "user_team_num": 3
        });
        let unknown_team = json!({
            "attacker_steamid": "1",
            "user_steamid": "2",
            "user_team_num": 3
        });
        let team_kill = json!({
            "attacker_steamid": "1",
            "user_steamid": "2",
            "attacker_team_num": 3,
            "user_team_num": 3
        });

        assert!(is_counted_kill(&valid));
        assert!(!is_counted_kill(&unknown_team));
        assert!(!is_counted_kill(&team_kill));
    }

    #[test]
    fn parser_state_allows_two_heavy_operations() {
        assert_eq!(DemoParseState::default().permits.available_permits(), 2);
    }

    #[test]
    fn buy_classification_has_stable_thresholds() {
        assert_eq!(classify_buy(1_999.0), "eco");
        assert_eq!(classify_buy(2_500.0), "semi-buy");
        assert_eq!(classify_buy(4_000.0), "force-buy");
        assert_eq!(classify_buy(5_000.0), "full-buy");
    }

    #[test]
    fn parses_a_demo_when_the_integration_fixture_is_configured() {
        let Ok(path) = std::env::var("CS_DEMO_AGENT_TEST_DEMO") else {
            return;
        };
        let header = get_demo_header_sync(&path).expect("fixture header should parse");
        assert_eq!(
            header.data.get("demo_version_name").and_then(Value::as_str),
            Some("valve_demo_2")
        );

        let players = get_player_info_sync(&path).expect("fixture player info should parse");
        let players = players
            .data
            .as_array()
            .expect("fixture player info should be an array");
        assert!(players.len() >= 10);
        assert!(players.iter().all(|player| matches!(
            player.get("stable_team").and_then(Value::as_str),
            Some("A" | "B")
        )));
        assert!(players
            .iter()
            .any(|player| player.get("stable_team") == Some(&json!("A"))));
        assert!(players
            .iter()
            .any(|player| player.get("stable_team") == Some(&json!("B"))));

        let events = query_events_sync(QueryEventsRequest {
            path: path.clone(),
            event_names: vec!["round_end".to_string()],
            player_props: None,
            other_props: Some(vec!["total_rounds_played".to_string()]),
            where_filter: None,
        })
        .expect("fixture events should parse");
        assert!(events.meta.original_row_count.unwrap_or_default() > 0);

        PARSE_DEMO_CALLS.store(0, Ordering::Relaxed);
        let rounds = get_round_summary_sync(&path).expect("fixture round summary should parse");
        assert!(rounds.meta.original_row_count.unwrap_or_default() > 0);
        assert_eq!(PARSE_DEMO_CALLS.load(Ordering::Relaxed), 2);

        let economy =
            get_economy_analysis_sync(&path).expect("fixture economy analysis should parse");
        assert!(economy.meta.original_row_count.unwrap_or_default() > 0);

        let grenades = query_grenades_sync(QueryGrenadesRequest {
            path,
            extra: Some(vec!["total_rounds_played".to_string()]),
        })
        .expect("fixture grenade trajectories should parse");
        assert!(grenades.data.is_array());
    }
}
