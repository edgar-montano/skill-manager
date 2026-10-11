use super::*;
use crate::collections::github::{GithubHttp, UreqGithubHttp};
use std::io::Read;
use std::process::{Command, Stdio};

fn seeds() -> Value {
    json!([
     {"id":"superclaude","name":"SuperClaude","repo":"SuperClaude-Org/SuperClaude_Framework","description":"Structured development with specialized commands, agents, confidence checks, and research workflows.","license":"MIT","agents":["claude"],"components":["Skills","Commands","Agents","Hooks","MCP"],"path":"plugins/superclaude","kind":"bundle","color":"orange"},
     {"id":"ponytail","name":"Ponytail","repo":"DietrichGebert/ponytail","description":"The smallest correct solution. Review complexity, reduce unnecessary code, and keep engineering focused.","license":"MIT","agents":["claude","codex"],"components":["Skills","Commands","Hooks"],"path":"","kind":"bundle","color":"purple"},
     {"id":"caveman","name":"Caveman","repo":"JuliusBrussee/caveman","description":"Fewer words, same technical substance. A compact communication style for your coding agents.","license":"Apache-2.0","agents":["claude","codex"],"components":["Skills","Commands","Hooks"],"path":"","kind":"bundle","color":"green"}
    ])
}
impl Service {
    pub fn catalog(&self) -> Result<Value> {
        let mut entries = seeds().as_array().cloned().unwrap_or_default();
        entries.extend(
            self.setting("collections", json!([]))
                .as_array()
                .cloned()
                .unwrap_or_default(),
        );
        Ok(json!(entries))
    }
    pub fn add_collection(&self, input: &Value) -> Result<Value> {
        let repo = text(input, "repo")?
            .trim()
            .trim_start_matches("https://github.com/")
            .trim_end_matches('/')
            .trim_end_matches(".git");
        let (_, name) =
            crate::collections::split_repo(repo).ok_or("Use a GitHub owner/repository")?;
        let mut entries = self
            .setting("collections", json!([]))
            .as_array()
            .cloned()
            .unwrap_or_default();
        if !entries.iter().any(|v| v["repo"] == repo) {
            entries.push(json!({"id":Uuid::new_v4().to_string(),"name":name,"repo":repo,"description":"Custom GitHub skill collection","license":"Verify per skill","agents":["claude","codex"],"components":["Skills"],"path":"","kind":"collection","color":"blue"}));
            self.set_setting("collections", &json!(entries))?;
        }
        self.catalog()
    }
    pub fn browse(&self, input: &Value) -> Result<Value> {
        let repo = text(input, "repo")?;
        let (owner, name) = crate::collections::split_repo(repo).ok_or("Invalid repository")?;
        let tree = UreqGithubHttp.fetch_tree(&owner, &name, "HEAD")?;
        if tree.truncated {
            return Err("Repository tree was truncated; use a smaller collection".into());
        }
        let items = tree
            .tree
            .iter()
            .filter(|e| e.path.ends_with("SKILL.md") && e.kind == "blob" && e.mode != "120000")
            .map(|e| {
                let folder = e.path.strip_suffix("/SKILL.md").unwrap_or("");
                json!({"name":folder.rsplit('/').next().unwrap_or(&name),"path":folder,"repo":repo})
            })
            .collect::<Vec<_>>();
        Ok(json!(items))
    }
    pub fn install_preview(&self, input: &Value) -> Result<Value> {
        let repo = text(input, "repo")?;
        let (owner, name) = crate::collections::split_repo(repo).ok_or("Invalid repository")?;
        let agent = text(input, "agent")?;
        if agent != "claude" && agent != "codex" {
            return Err("Unsupported agent".into());
        }
        let commit: Value = serde_json::from_str(&UreqGithubHttp.get_text(&format!(
            "https://api.github.com/repos/{owner}/{name}/commits/HEAD"
        ))?)
        .map_err(err)?;
        let revision = text(&commit, "sha")?;
        let metadata: Value = serde_json::from_str(
            &UreqGithubHttp.get_text(&format!("https://api.github.com/repos/{owner}/{name}"))?,
        )
        .map_err(err)?;
        let license = metadata["license"]["spdx_id"].as_str().unwrap_or("Unknown");
        let kind = text(input, "kind")?;
        if kind == "bundle" {
            let seeds = seeds();
            let bundle = seeds
                .as_array()
                .and_then(|a| a.iter().find(|v| v["repo"] == repo))
                .ok_or("Unknown bundle")?;
            if !bundle["agents"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v == agent))
            {
                return Err("This full bundle does not support the selected agent".into());
            }
        }
        let destination = self.home.join(if kind == "bundle" {
            if agent == "claude" {
                ".claude/plugins"
            } else {
                ".codex/plugins"
            }
        } else if agent == "claude" {
            ".claude/skills"
        } else {
            ".agents/skills"
        });
        let mut plan = input.clone();
        plan["revision"] = json!(revision);
        plan["license"] = json!(license);
        plan["destination"] = json!(destination);
        plan["created"] = json!(now());
        let id = Uuid::new_v4().to_string();
        self.set_setting(&format!("preview:{id}"), &plan)?;
        Ok(
            json!({"id":id,"plan":plan,"message":if kind=="bundle"{"Installs the native plugin, including declared hooks and dependencies. Existing editable copies are preserved."}else{"Installs this skill and its supporting files. A prior manager installation is updated only if none of its files have local edits; its previous version is retained as a backup."}}),
        )
    }
    pub fn install(&mut self, input: &Value) -> Result<Value> {
        let preview = text(input, "previewId")?;
        let plan = self.setting(&format!("preview:{preview}"), Value::Null);
        if plan.is_null() {
            return Err("Preview this installation first".into());
        }
        if now().saturating_sub(plan["created"].as_u64().unwrap_or(0)) > 3600 {
            return Err("Preview expired. Review the installation again.".into());
        }
        let job_id = Uuid::new_v4().to_string();
        let mut job = json!({"id":job_id,"status":"running","repo":plan["repo"],"agent":plan["agent"],"created":now(),"message":"Installing","revision":plan["revision"]});
        self.db
            .execute(
                "INSERT INTO jobs VALUES (?,?)",
                params![job_id, job.to_string()],
            )
            .map_err(err)?;
        let result = self.perform_install(&plan);
        match result {
            Ok(message) => {
                job["status"] = json!("complete");
                job["message"] = json!(message)
            }
            Err(error) => {
                job["status"] = json!("failed");
                job["message"] = json!(error)
            }
        }
        self.db
            .execute(
                "UPDATE jobs SET value=? WHERE id=?",
                params![job.to_string(), job_id],
            )
            .map_err(err)?;
        Ok(job)
    }
    fn perform_install(&self, plan: &Value) -> Result<String> {
        let repo = text(plan, "repo")?;
        let (owner, name) = crate::collections::split_repo(repo).ok_or("Invalid repository")?;
        let agent = text(plan, "agent")?;
        let revision = text(plan, "revision")?;
        if text(plan, "kind")? == "bundle" {
            let catalog = seeds();
            let bundle = catalog
                .as_array()
                .and_then(|a| a.iter().find(|b| b["repo"] == repo))
                .ok_or("Unknown bundle")?;
            let id = text(bundle, "id")?;
            let marketplace = format!("skill-manager-{id}-{agent}");
            let root = self.data.join("marketplaces").join(&marketplace);
            let source = root.join("revisions").join(revision);
            fs::create_dir_all(source.parent().ok_or("Invalid source path")?).map_err(err)?;
            fs::create_dir_all(&root).map_err(err)?;
            if !source.join(".git").exists() {
                run_command(
                    Command::new("git")
                        .args([
                            "clone",
                            "--filter=blob:none",
                            "--depth=1",
                            "--no-checkout",
                            &format!("https://github.com/{repo}.git"),
                        ])
                        .arg(&source),
                )?;
            }
            run_command(
                Command::new("git")
                    .arg("-C")
                    .arg(&source)
                    .args(["fetch", "--depth", "1", "origin", revision]),
            )?;
            run_command(
                Command::new("git")
                    .arg("-C")
                    .arg(&source)
                    .args(["checkout", "--detach", revision]),
            )?;
            let plugin_path = if agent == "codex" && id == "caveman" {
                "plugins/caveman"
            } else {
                text(bundle, "path")?
            };
            if agent == "claude" && id == "superclaude" {
                let manifest_path = source.join(plugin_path).join(".claude-plugin/plugin.json");
                let mut manifest: Value =
                    serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(err)?)
                        .map_err(err)?;
                if manifest["agents"]
                    .as_str()
                    .is_some_and(|p| p.ends_with('/'))
                {
                    let mut agents = walkdir::WalkDir::new(source.join(plugin_path).join("agents"))
                        .into_iter()
                        .filter_map(|e| e.ok())
                        .filter(|e| {
                            e.file_type().is_file()
                                && e.path().extension().is_some_and(|x| x == "md")
                        })
                        .map(|e| {
                            e.path()
                                .strip_prefix(source.join(plugin_path))
                                .map(|p| format!("./{}", p.display()))
                                .map_err(err)
                        })
                        .collect::<Result<Vec<_>>>()?;
                    agents.sort();
                    manifest["agents"] = json!(agents);
                    files::atomic_write(
                        &manifest_path,
                        serde_json::to_string_pretty(&manifest)
                            .map_err(err)?
                            .as_bytes(),
                    )?;
                }
            }
            for notice in ["LICENSE", "LICENSE.md", "LICENSE.txt", "NOTICE"] {
                let origin = source.join(notice);
                let destination = source.join(plugin_path).join(notice);
                if origin.is_file() && !destination.exists() {
                    fs::copy(origin, destination).map_err(err)?;
                }
            }
            if agent == "claude" {
                let path = text(bundle, "path")?;
                let manifest = json!({"name":marketplace,"owner":{"name":"Skill Manager"},"plugins":[{"name":id,"source":if path.is_empty(){format!("./revisions/{revision}")}else{format!("./revisions/{revision}/{path}")}}]});
                fs::create_dir_all(root.join(".claude-plugin")).map_err(err)?;
                fs::write(
                    root.join(".claude-plugin/marketplace.json"),
                    manifest.to_string(),
                )
                .map_err(err)?;
                self.run_agent(
                    agent,
                    &["plugin", "marketplace", "add", &root.to_string_lossy()],
                )?;
                self.run_agent(
                    agent,
                    &[
                        "plugin",
                        if self
                            .home
                            .join(".claude/plugins/installed_plugins.json")
                            .exists()
                            && fs::read_to_string(
                                self.home.join(".claude/plugins/installed_plugins.json"),
                            )
                            .unwrap_or_default()
                            .contains(&format!("{id}@{marketplace}"))
                        {
                            "update"
                        } else {
                            "install"
                        },
                        &format!("{id}@{marketplace}"),
                        "--scope",
                        "user",
                    ],
                )?;
            } else {
                let subpath = if id == "caveman" {
                    "plugins/caveman"
                } else {
                    ""
                };
                let source_value = json!({"source":"local","path":if subpath.is_empty(){format!("./revisions/{revision}")}else{format!("./revisions/{revision}/{subpath}")}});
                let manifest = json!({"name":marketplace,"plugins":[{"name":id,"source":source_value,"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Productivity"}]});
                fs::create_dir_all(root.join(".agents/plugins")).map_err(err)?;
                fs::write(
                    root.join(".agents/plugins/marketplace.json"),
                    manifest.to_string(),
                )
                .map_err(err)?;
                self.run_agent(
                    agent,
                    &["plugin", "marketplace", "add", &root.to_string_lossy()],
                )?;
                self.run_agent(agent, &["plugin", "add", &format!("{id}@{marketplace}")])?;
            }
            return Ok(format!(
                "Installed {id} at {}. Start a new agent session to load it.",
                &revision[..8]
            ));
        }
        let folder = text(plan, "path")?;
        let tarball = UreqGithubHttp.fetch_tarball(&owner, &name, revision)?;
        let (mut files, _) = crate::collections::files_from_tarball(&tarball, folder)?;
        let license = text(plan, "license")?;
        if ![
            "MIT",
            "Apache-2.0",
            "BSD-2-Clause",
            "BSD-3-Clause",
            "ISC",
            "CC0-1.0",
            "Unlicense",
        ]
        .contains(&license)
        {
            return Err("Repository license needs review before redistribution. This collection remains browsable.".into());
        }
        for filename in ["LICENSE", "NOTICE"] {
            if !files.iter().any(|f| f.relative_path == filename) {
                if let Ok(bytes) = UreqGithubHttp.get_bytes(&format!(
                    "https://raw.githubusercontent.com/{repo}/{revision}/{filename}"
                )) {
                    files.push(crate::collections::install::SkillFile {
                        relative_path: filename.into(),
                        bytes,
                        mode: 0o644,
                    });
                }
            }
        }
        let root = PathBuf::from(text(plan, "destination")?);
        let skill_name = text(plan, "name")?;
        crate::commands::validate_skill_folder_name(skill_name)?;
        let target = root.join(skill_name);
        let baseline_key = format!("installed:{}", target.display());
        let overwrite = target.exists();
        if overwrite {
            let expected = self.setting(&baseline_key, Value::Null);
            if expected.is_null() || expected != folder_fingerprint(&target)? {
                return Err("Local files differ from the last manager installation, or were installed elsewhere. Preserve them as a local copy before updating.".into());
            }
        }
        let provenance = crate::collections::Provenance {
            owner,
            repo: name,
            path: folder.into(),
            branch: revision.into(),
            installed_at: now(),
            collection_id: repo.into(),
        };
        crate::collections::install_skill_files(
            std::slice::from_ref(&root),
            &root,
            skill_name,
            &files,
            &provenance,
            overwrite,
        )?;
        self.set_setting(&baseline_key, &folder_fingerprint(&target)?)?;
        Ok(format!(
            "Installed {skill_name}. Supporting files and license notices were preserved."
        ))
    }
    pub fn run_agent(&self, agent: &str, args: &[&str]) -> Result<String> {
        let mut command = Command::new(agent);
        command
            .args(args)
            .env("CLAUDE_CONFIG_DIR", self.home.join(".claude"))
            .env("CODEX_HOME", self.home.join(".codex"));
        run_command(&mut command)
    }
}
fn run_command(command: &mut Command) -> Result<String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(err)?;
    let stdout = child.stdout.take().ok_or("Missing command output")?;
    let stderr = child.stderr.take().ok_or("Missing error output")?;
    let out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.take(2_000_000).read_to_string(&mut s);
        s
    });
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.take(2_000_000).read_to_string(&mut s);
        s
    });
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(err)? {
            break s;
        }
        if start.elapsed().as_secs() > 180 {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Installation timed out. Inspect the job and retry.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    let output = out.join().unwrap_or_default();
    let error = errors.join().unwrap_or_default();
    if status.success() {
        Ok(output)
    } else {
        Err(format!(
            "Command failed: {}",
            if error.is_empty() { output } else { error }
        ))
    }
}

fn folder_fingerprint(root: &std::path::Path) -> Result<Value> {
    let mut values = serde_json::Map::new();
    for entry in walkdir::WalkDir::new(root).into_iter() {
        let entry = entry.map_err(err)?;
        if entry.file_type().is_symlink() {
            return Err("Cannot update a linked installation".into());
        }
        if entry.file_type().is_file() {
            values.insert(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(err)?
                    .to_string_lossy()
                    .into_owned(),
                json!(hash(&fs::read(entry.path()).map_err(err)?)),
            );
        }
    }
    Ok(Value::Object(values))
}
