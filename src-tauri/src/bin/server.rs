#[tokio::main]
async fn main() {
    if let Err(error) = skill_manager_lib::workbench::serve().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
