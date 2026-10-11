use super::files::atomic_write;
use super::*;
use std::{collections::HashSet, path::Path};
use toml_edit::{value, ArrayOfTables, DocumentMut, Item, Table};

pub fn tokens(s: &str) -> usize {
    s.chars().count().div_ceil(4)
}
impl Service {
    pub fn skill_roots(&self) -> Vec<(String, PathBuf)> {
        let real_home = dirs::home_dir().unwrap_or_default();
        let mut roots = crate::skills::all_adapters()
            .into_iter()
            .map(|a| {
                let path = a.skills_dir();
                let p = path
                    .strip_prefix(&real_home)
                    .map(|r| self.home.join(r))
                    .unwrap_or(path);
                (format!("{:?}", a.tool()).to_lowercase(), p)
            })
            .collect::<Vec<_>>();
        roots.push(("codex".into(), self.home.join(".codex/skills")));
        for project in self.projects() {
            for a in crate::skills::all_adapters() {
                roots.push((
                    format!("{:?}", a.tool()).to_lowercase(),
                    project.join(a.project_subpath()),
                ));
            }
        }
        let disabled = roots
            .iter()
            .map(|(agent, root)| (agent.clone(), root.with_file_name("skills-disabled")))
            .collect::<Vec<_>>();
        roots.extend(disabled);
        roots
    }
    pub fn inventory(&self) -> Result<Value> {
        let mut items = Vec::new();
        let mut seen = HashSet::new();
        let mut roots = self.skill_roots();
        roots.push(("claude".into(), self.home.join(".claude/plugins/cache")));
        roots.push(("codex".into(), self.home.join(".codex/plugins/cache")));
        let config = self.codex_config()?;
        for (agent, root) in roots {
            if !root.is_dir() {
                continue;
            }
            for entry in walkdir::WalkDir::new(&root)
                .follow_links(true)
                .max_depth(10)
                .into_iter()
                .filter_entry(|e| !super::files::protected(e.path()))
                .filter_map(|e| e.ok())
            {
                if entry.file_name() != "SKILL.md" || !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if entry.metadata().is_ok_and(|m| m.len() > 1024 * 1024) {
                    continue;
                }
                if path.starts_with(self.home.join(".claude/plugins/cache"))
                    && self.plugin_id(path, &agent).is_none()
                {
                    continue;
                }
                if self.checked_path(&path.to_string_lossy(), false).is_err() {
                    continue;
                }
                if !seen.insert(path.to_path_buf()) {
                    continue;
                }
                let Ok(content) = fs::read_to_string(path) else {
                    continue;
                };
                let (mut name, description) = crate::skills::parse_frontmatter(&content);
                if name.is_empty() {
                    name = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                }
                let logical = path
                    .to_string_lossy()
                    .replace("/.disabled/", "/")
                    .replace("/skills-disabled/", "/skills/");
                self.db.execute("INSERT INTO installations(id,logical_path,path) VALUES (?,?,?) ON CONFLICT(logical_path) DO UPDATE SET path=excluded.path WHERE installations.path != excluded.path",params![Uuid::new_v4().to_string(),logical,path.to_string_lossy()]).map_err(err)?;
                let id: String = self
                    .db
                    .query_row(
                        "SELECT id FROM installations WHERE logical_path=?",
                        [&logical],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let readonly = self.is_managed(path)
                    || self.checked_path(&path.to_string_lossy(), true).is_err();
                let consumers = if agent == "agents" {
                    vec!["codex", "shared"]
                } else {
                    vec![agent.as_str()]
                };
                let disabled = path
                    .components()
                    .any(|c| c.as_os_str() == ".disabled" || c.as_os_str() == "skills-disabled");
                let codex_enabled = !config
                    .get("skills")
                    .and_then(|v| v.get("config"))
                    .and_then(Item::as_array_of_tables)
                    .is_some_and(|tables| {
                        tables.iter().any(|t| {
                            t.get("path").and_then(Item::as_str) == path.to_str()
                                && t.get("enabled").and_then(Item::as_bool) == Some(false)
                        })
                    });
                let rating = self
                    .db
                    .query_row("SELECT rating FROM ratings WHERE id=?", [&id], |r| {
                        r.get::<_, i64>(0)
                    })
                    .unwrap_or(0);
                let plugin = self.plugin_id(path, &agent);
                let enabled = if agent == "codex" || agent == "agents" {
                    !disabled
                        && codex_enabled
                        && plugin.as_ref().is_none_or(|id| {
                            config
                                .get("plugins")
                                .and_then(|p| p.get(id))
                                .and_then(|p| p.get("enabled"))
                                .and_then(Item::as_bool)
                                != Some(false)
                        })
                } else if let Some(ref plugin) = plugin {
                    self.claude_plugin_enabled(plugin)
                } else {
                    !disabled
                };
                let support = walkdir::WalkDir::new(path.parent().unwrap_or(&root))
                    .max_depth(4)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.file_type().is_file()
                            && e.path() != path
                            && !super::files::protected(e.path())
                    })
                    .filter(|e| e.metadata().is_ok_and(|m| m.len() <= 1024 * 1024))
                    .filter_map(|e| fs::read_to_string(e.path()).ok())
                    .filter(|text| !text.contains('\0'))
                    .map(|text| tokens(&text))
                    .sum::<usize>();
                let mut q=self.db.prepare("SELECT kind,count(*),max(time),count(DISTINCT session) FROM events WHERE skill=? GROUP BY kind").map_err(err)?;
                let stats=q.query_map([&logical],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"count":r.get::<_,i64>(1)?,"last":r.get::<_,String>(2)?,"sessions":r.get::<_,i64>(3)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
                let provenance = fs::read_to_string(
                    path.parent()
                        .unwrap_or(&root)
                        .join(".collection-source.json"),
                )
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
                items.push(json!({"id":id,"path":path,"logicalPath":logical,"name":name,"description":description,"agent":agent,"consumers":consumers,"scope":if path.starts_with(&self.home)&&!self.projects().iter().any(|p|path.starts_with(p)){"user"}else{"project"},"enabled":enabled,"readonly":readonly,"plugin":plugin,"canToggle":!readonly||agent=="codex"||agent=="agents"||plugin.is_some(),"tokens":tokens(&content),"discoveryTokens":tokens(&format!("{name} {description} {}",path.display())),"supportTokens":support,"rating":rating,"stats":stats,"provenance":provenance,"revision":hash(content.as_bytes())}));
            }
        }
        items.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        Ok(json!(items))
    }
    fn codex_config(&self) -> Result<DocumentMut> {
        let path = self.home.join(".codex/config.toml");
        let content = if path.exists() {
            fs::read_to_string(path).map_err(err)?
        } else {
            String::new()
        };
        content
            .parse()
            .map_err(|e| format!("Cannot parse Codex config: {e}"))
    }
    fn plugin_id(&self, path: &Path, agent: &str) -> Option<String> {
        if agent == "codex" {
            let relative = path
                .strip_prefix(self.home.join(".codex/plugins/cache"))
                .ok()?;
            let mut parts = relative.components();
            let marketplace = parts.next()?.as_os_str().to_str()?;
            let name = parts.next()?.as_os_str().to_str()?;
            return Some(format!("{name}@{marketplace}"));
        }
        if agent != "claude" || !path.starts_with(self.home.join(".claude/plugins/cache")) {
            return None;
        }
        let data: Value = serde_json::from_str(
            &fs::read_to_string(self.home.join(".claude/plugins/installed_plugins.json")).ok()?,
        )
        .ok()?;
        data["plugins"]
            .as_object()?
            .iter()
            .find_map(|(id, entries)| {
                entries
                    .as_array()?
                    .iter()
                    .find(|entry| {
                        entry["installPath"]
                            .as_str()
                            .is_some_and(|root| path.starts_with(root))
                    })
                    .map(|_| id.clone())
            })
    }
    fn claude_plugin_enabled(&self, id: &str) -> bool {
        fs::read_to_string(self.home.join(".claude/settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v["enabledPlugins"][id].as_bool())
            .unwrap_or(true)
    }
    pub fn toggle(&mut self, input: &Value) -> Result<Value> {
        let id = text(input, "id")?;
        let enabled = input["enabled"].as_bool().ok_or("Missing enabled state")?;
        let items = self.inventory()?;
        let item = items
            .as_array()
            .and_then(|a| a.iter().find(|v| v["id"] == id))
            .ok_or("Skill no longer exists")?;
        let path = PathBuf::from(text(item, "path")?);
        let agent = text(item, "agent")?;
        if agent == "codex" || agent == "agents" {
            let mut config = self.codex_config()?;
            if let Some(plugin) = item["plugin"].as_str() {
                config["plugins"][plugin]["enabled"] = value(enabled);
                let config_path = self.home.join(".codex/config.toml");
                if let Ok(old) = fs::read_to_string(&config_path) {
                    self.db
                        .execute(
                            "INSERT INTO revisions VALUES (?,?,?,?)",
                            params![
                                Uuid::new_v4().to_string(),
                                config_path.to_string_lossy(),
                                old,
                                now()
                            ],
                        )
                        .map_err(err)?;
                }
                atomic_write(&config_path, config.to_string().as_bytes())?;
                return Ok(
                    json!({"ok":true,"message":"Plugin preference saved. Restart Codex to apply. All skills and hooks in this plugin are affected."}),
                );
            }
            if config.get("skills").is_none() {
                config["skills"] = Item::Table(Table::new());
            }
            if config["skills"].get("config").is_none() {
                config["skills"]["config"] = Item::ArrayOfTables(ArrayOfTables::new());
            }
            let tables = config["skills"]["config"]
                .as_array_of_tables_mut()
                .ok_or("Unsupported skills.config format")?;
            let existing = tables
                .iter()
                .position(|t| t.get("path").and_then(Item::as_str) == path.to_str());
            if let Some(table) = existing.and_then(|i| tables.get_mut(i)) {
                table["enabled"] = value(enabled);
            } else {
                let mut table = Table::new();
                table["path"] = value(path.to_string_lossy().to_string());
                table["enabled"] = value(enabled);
                tables.push(table);
            }
            let config_path = self.home.join(".codex/config.toml");
            if let Ok(old) = fs::read_to_string(&config_path) {
                self.db
                    .execute(
                        "INSERT INTO revisions VALUES (?,?,?,?)",
                        params![
                            Uuid::new_v4().to_string(),
                            config_path.to_string_lossy(),
                            old,
                            now()
                        ],
                    )
                    .map_err(err)?;
            }
            atomic_write(&config_path, config.to_string().as_bytes())?;
            return Ok(
                json!({"ok":true,"message":"Codex preference saved. Restart Codex to apply. Other agents are unchanged."}),
            );
        }
        if let Some(plugin) = item["plugin"].as_str() {
            self.run_agent(
                "claude",
                &["plugin", if enabled { "enable" } else { "disable" }, plugin],
            )?;
            return Ok(
                json!({"ok":true,"message":"Plugin state updated. All skills in this plugin are affected."}),
            );
        }
        if item["readonly"] == true {
            return Err("Managed skill cannot be toggled independently".into());
        }
        let original_path = self.checked_path(&path.to_string_lossy(), true)?;
        if item["enabled"].as_bool() == Some(enabled) {
            return Ok(json!({"ok":true,"message":"Already in requested state"}));
        }
        let folder = path.parent().ok_or("Invalid skill path")?;
        let legacy = path.components().any(|c| c.as_os_str() == ".disabled");
        let moved = if legacy {
            crate::skills::toggle_enabled(&path, enabled).map_err(err)?
        } else {
            let roots = self.skill_roots();
            let root = roots
                .iter()
                .filter(|(a, r)| a == agent && folder.starts_with(r))
                .max_by_key(|(_, r)| r.components().count())
                .map(|(_, r)| r)
                .ok_or("Skill root no longer exists")?;
            let destination_root =
                root.with_file_name(if enabled { "skills" } else { "skills-disabled" });
            let destination = destination_root.join(folder.strip_prefix(root).map_err(err)?);
            if fs::symlink_metadata(&destination).is_ok() {
                return Err("A skill already exists at the destination. Resolve the conflict before toggling.".into());
            }
            fs::create_dir_all(destination.parent().ok_or("Invalid destination")?).map_err(err)?;
            fs::rename(folder, &destination).map_err(err)?;
            destination.join("SKILL.md")
        };
        self.db
            .execute(
                "UPDATE installations SET path=? WHERE id=?",
                params![moved.to_string_lossy(), id],
            )
            .map_err(err)?;
        self.db
            .execute(
                "UPDATE revisions SET path=? WHERE path=?",
                params![
                    fs::canonicalize(&moved).map_err(err)?.to_string_lossy(),
                    original_path.to_string_lossy()
                ],
            )
            .map_err(err)?;
        Ok(json!({"ok":true,"message":"Skill state updated"}))
    }
    pub fn copy_skill(&mut self, input: &Value) -> Result<Value> {
        let source = self.checked_path(text(input, "path")?, false)?;
        if source.file_name().is_none_or(|n| n != "SKILL.md") {
            return Err("Select a skill manifest".into());
        }
        let name = text(input, "name")?;
        crate::commands::validate_skill_folder_name(name)?;
        let agent = text(input, "agent")?;
        let root = self.home.join(match agent {
            "claude" => ".claude/skills",
            "codex" => ".agents/skills",
            _ => return Err("Unsupported target".into()),
        });
        let folder = source.parent().ok_or("Missing source folder")?;
        let mut files = Vec::new();
        for e in walkdir::WalkDir::new(folder)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && !super::files::protected(e.path()))
        {
            files.push(crate::collections::install::SkillFile {
                relative_path: e
                    .path()
                    .strip_prefix(folder)
                    .map_err(err)?
                    .to_string_lossy()
                    .into(),
                bytes: fs::read(e.path()).map_err(err)?,
                mode: 0o644,
            });
        }
        for file in &mut files {
            if file.relative_path == "SKILL.md" {
                let original = String::from_utf8(file.bytes.clone()).map_err(err)?;
                let updated = original
                    .lines()
                    .map(|line| {
                        if line.starts_with("name:") {
                            format!("name: {name}")
                        } else {
                            line.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
                    + "\n";
                file.bytes = updated.into_bytes();
            }
        }
        let provenance = crate::collections::Provenance {
            owner: "local".into(),
            repo: "editable-copy".into(),
            path: source.to_string_lossy().into(),
            branch: hash(&fs::read(&source).map_err(err)?),
            installed_at: now(),
            collection_id: "local-copy".into(),
        };
        let path = crate::collections::install_skill_files(
            std::slice::from_ref(&root),
            &root,
            name,
            &files,
            &provenance,
            false,
        )?;
        Ok(json!({"ok":true,"path":path}))
    }
}
