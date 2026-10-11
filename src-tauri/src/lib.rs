mod collections;
mod commands;
mod detect;
mod projects;
mod skills;
mod skillspector;
pub mod workbench;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(workbench::SharedService::new().expect("cannot open workbench database"))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workbench::workbench_request,
            commands::list_tool_entries,
            commands::list_skills,
            commands::set_skill_enabled,
            commands::delete_skill,
            commands::read_skill_content,
            commands::write_skill_content,
            commands::create_skill,
            commands::list_collections,
            commands::browse_collection,
            commands::refresh_collection,
            commands::add_collection,
            commands::remove_collection,
            commands::install_skill,
            commands::list_detected_projects,
            commands::refresh_detected_projects,
            commands::list_project_skill_counts,
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::set_project_pinned,
            commands::touch_project,
            commands::list_project_skills,
            commands::check_scanner,
            commands::list_scan_results,
            commands::scan_installed_skill,
            commands::scan_all_skills,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
