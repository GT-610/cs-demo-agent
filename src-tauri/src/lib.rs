mod demo;
mod error;
mod http;
mod persistence;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http_state = http::HttpState::new().expect("failed to initialize provider HTTP client");
    tauri::Builder::default()
        .manage(demo::DemoParseState::default())
        .manage(http_state)
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?
                .join("workspace.sqlite3");
            let database = persistence::DatabaseState::initialize(database_path)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(database);
            Ok(())
        })
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
            http::stream_http_json,
            persistence::load_workspace,
            persistence::load_session,
            persistence::save_settings,
            persistence::create_session,
            persistence::rename_session,
            persistence::delete_session,
            persistence::save_session_content,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CS Demo Agent");
}
