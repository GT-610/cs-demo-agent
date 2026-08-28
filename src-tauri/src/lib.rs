mod demo;
mod error;
mod http;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http_state = http::HttpState::new().expect("failed to initialize provider HTTP client");
    tauri::Builder::default()
        .manage(demo::DemoParseState::default())
        .manage(http_state)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            demo::get_demo_header,
            demo::get_player_info,
            demo::list_game_events,
            demo::query_events,
            demo::query_ticks,
            demo::query_grenades,
            demo::get_round_summary,
            demo::get_economy_analysis,
            http::send_http_json,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CS Demo Agent");
}
