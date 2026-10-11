use super::*;
use std::path::Path;
struct Fixture {
    service: Service,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("skill-manager-test-{}", Uuid::new_v4()));
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let service = Service::new(home, root.join("data")).unwrap();
        Self { service, root }
    }
    fn skill(&self, relative: &str) -> PathBuf {
        let p = self.service.home.join(relative).join("SKILL.md");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p,"---\nname: example\ndescription: A test skill\n---\n# Example\n\nRead the source first.\n").unwrap();
        p
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
#[test]
fn revision_save_conflict_and_history() {
    let mut f = Fixture::new();
    let path = f.skill(".claude/skills/example");
    let original = f.service.read(&json!({"path":path})).unwrap();
    let revised = format!(
        "{}\nNew instruction.",
        original["content"].as_str().unwrap()
    );
    let saved = f
        .service
        .save(&json!({"path":path,"content":revised,"revision":original["revision"]}))
        .unwrap();
    assert_ne!(saved["revision"], original["revision"]);
    assert_eq!(
        f.service
            .history(&json!({"path":path}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let err = f
        .service
        .save(&json!({"path":path,"content":revised,"revision":original["revision"]}))
        .unwrap_err();
    assert!(err.starts_with("Conflict:"));
    assert_eq!(fs::read_to_string(path).unwrap(), revised);
}
#[test]
fn rejects_escape_and_credentials() {
    let f = Fixture::new();
    f.skill(".claude/skills/example");
    let secret = f.service.home.join(".claude/.credentials.json");
    fs::write(&secret, "private").unwrap();
    assert!(f.service.read(&json!({"path":secret})).is_err());
    assert!(f.service.checked_path("/etc/passwd", false).is_err());
    assert!(f
        .service
        .checked_path(
            &format!("{}/.claude/../.ssh/id_rsa", f.service.home.display()),
            false
        )
        .is_err());
}
#[test]
fn native_codex_toggle_preserves_shared_files_and_config() {
    let mut f = Fixture::new();
    let path = f.skill(".agents/skills/example");
    fs::create_dir_all(f.service.home.join(".codex")).unwrap();
    let config = f.service.home.join(".codex/config.toml");
    fs::write(&config, "# user setting\nmodel = \"test-model\"\n").unwrap();
    let list = f.service.inventory().unwrap();
    let id = &list[0]["id"];
    f.service.toggle(&json!({"id":id,"enabled":false})).unwrap();
    assert!(path.exists());
    assert_eq!(f.service.inventory().unwrap()[0]["enabled"], false);
    let content = fs::read_to_string(&config).unwrap();
    assert!(content.contains("# user setting"));
    assert!(content.contains("test-model"));
    f.service.toggle(&json!({"id":id,"enabled":true})).unwrap();
    assert_eq!(f.service.inventory().unwrap()[0]["enabled"], true);
}
#[test]
fn claude_toggle_identity_survives_restart() {
    let mut f = Fixture::new();
    let path = f.skill(".claude/skills/example");
    let id = f.service.inventory().unwrap()[0]["id"].clone();
    f.service
        .dispatch("rating", json!({"id":id,"rating":5}))
        .unwrap();
    let revision = f.service.read(&json!({"path":path})).unwrap()["revision"].clone();
    f.service.save(&json!({"path":path,"revision":revision,"content":"---\nname: example\ndescription: Revised example\n---\n# New version\n"})).unwrap();
    f.service.toggle(&json!({"id":id,"enabled":false})).unwrap();
    assert!(!path.exists());
    let list = f.service.inventory().unwrap();
    assert_eq!(list[0]["id"], id);
    assert_eq!(list[0]["rating"], 5);
    assert_eq!(list[0]["enabled"], false);
    assert!(!PathBuf::from(list[0]["path"].as_str().unwrap())
        .starts_with(f.service.home.join(".claude/skills")));
    assert_eq!(
        f.service
            .history(&json!({"path":list[0]["path"]}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut reopened = Service::new(f.service.home.clone(), f.service.data.clone()).unwrap();
    reopened.toggle(&json!({"id":id,"enabled":true})).unwrap();
    assert!(path.exists());
    assert_eq!(reopened.inventory().unwrap()[0]["id"], id);
}
#[cfg(unix)]
#[test]
fn symlink_toggle_keeps_shared_target() {
    let mut f = Fixture::new();
    let target = f.skill(".agents/skills/example");
    let dir = f.service.home.join(".claude/skills");
    fs::create_dir_all(&dir).unwrap();
    std::os::unix::fs::symlink("../../.agents/skills/example", dir.join("example")).unwrap();
    let list = f.service.inventory().unwrap();
    let id = list
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["agent"] == "claude")
        .unwrap()["id"]
        .clone();
    f.service.toggle(&json!({"id":id,"enabled":false})).unwrap();
    assert!(target.exists());
    assert!(dir
        .parent()
        .unwrap()
        .join("skills-disabled/example/SKILL.md")
        .exists());
    f.service.toggle(&json!({"id":id,"enabled":true})).unwrap();
    assert!(dir.join("example/SKILL.md").exists());
}
#[test]
fn plugin_readonly_copy_retains_support() {
    let mut f = Fixture::new();
    let path = f.skill(".codex/plugins/cache/demo/skills/example");
    fs::write(path.parent().unwrap().join("reference.md"), "support").unwrap();
    let file = f.service.read(&json!({"path":path})).unwrap();
    assert_eq!(file["readonly"], true);
    assert!(f
        .service
        .save(&json!({"path":path,"content":file["content"],"revision":file["revision"]}))
        .is_err());
    let copied = f
        .service
        .copy_skill(&json!({"path":path,"name":"example-local","agent":"codex"}))
        .unwrap();
    assert!(Path::new(copied["path"].as_str().unwrap())
        .parent()
        .unwrap()
        .join("reference.md")
        .exists());
}
#[test]
fn validates_skill_frontmatter() {
    assert!(files::validate_markdown(Path::new("SKILL.md"), "# No metadata").is_err());
    assert!(files::validate_markdown(Path::new("SKILL.md"), "---\nname: [broken\n---\n").is_err());
    assert!(files::validate_markdown(Path::new("plan.md"), "# Plan").is_ok());
}
#[test]
fn tokens_are_estimates() {
    assert_eq!(inventory::tokens(""), 0);
    assert_eq!(inventory::tokens("hello"), 2);
    assert_eq!(inventory::tokens("日本語です"), 2);
}
#[test]
fn index_deduplicates_and_reports_malformed_lines() {
    let mut f = Fixture::new();
    f.skill(".claude/skills/example");
    let logs = f.service.home.join(".claude/projects/demo");
    fs::create_dir_all(&logs).unwrap();
    let line = json!({"type":"assistant","timestamp":"2026-10-11T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"example"}}]}});
    fs::write(
        logs.join("session.jsonl"),
        format!("{line}\n{line}\n{{broken\n"),
    )
    .unwrap();
    let a = f.service.index_activity().unwrap();
    assert_eq!(a["range"]["events"], 1);
    assert_eq!(a["coverage"]["malformed"], 1);
    let b = f.service.index_activity().unwrap();
    assert_eq!(b["range"]["events"], 1);
    assert_eq!(b["coverage"]["malformed"], 1);
    assert_eq!(f.service.inventory().unwrap()[0]["stats"][0]["count"], 1);
}
#[test]
fn ambiguous_names_are_not_attributed() {
    let mut f = Fixture::new();
    f.skill(".claude/skills/example");
    f.skill(".claude/skills/duplicate");
    let logs = f.service.home.join(".claude/projects/demo");
    fs::create_dir_all(&logs).unwrap();
    fs::write(logs.join("session.jsonl"),json!({"type":"assistant","timestamp":"2026-10-11T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"example"}}]}}).to_string()).unwrap();
    assert_eq!(f.service.index_activity().unwrap()["range"]["events"], 0);
}
#[test]
fn interrupted_jobs_are_recoverable() {
    let f = Fixture::new();
    f.service
        .db
        .execute(
            "INSERT INTO jobs VALUES ('test',?)",
            [json!({"status":"running"}).to_string()],
        )
        .unwrap();
    let reopened = Service::new(f.service.home.clone(), f.service.data.clone()).unwrap();
    let job: String = reopened
        .db
        .query_row("SELECT value FROM jobs WHERE id='test'", [], |r| r.get(0))
        .unwrap();
    assert!(job.contains("interrupted"));
}
#[test]
fn improvement_only_includes_selected_local_material() {
    let f = Fixture::new();
    let path = f.skill(".claude/skills/example");
    let result = f
        .service
        .improve(&json!({"path":path,"provider":"claude","goal":"Clearer triggers"}))
        .unwrap();
    assert_eq!(result["url"], "https://claude.ai/new");
    assert!(result["prompt"]
        .as_str()
        .unwrap()
        .contains("Clearer triggers"));
    assert!(f
        .service
        .improve(&json!({"path":path,"provider":"unknown"}))
        .is_err());
}
