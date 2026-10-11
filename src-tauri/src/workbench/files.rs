use super::*;
use std::{
    io::Write,
    path::{Component, Path},
};

pub fn protected(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy().to_lowercase();
        s == ".git"
            || s == "node_modules"
            || s == ".ssh"
            || s.starts_with(".env")
            || s.contains("credential")
            || s.contains("secret")
            || s == "auth.json"
            || s.ends_with(".key")
            || s.ends_with(".pem")
            || s.ends_with(".sqlite3")
            || s.ends_with(".db")
    })
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Invalid file path")?;
    fs::create_dir_all(parent).map_err(err)?;
    let tmp = parent.join(format!(".skill-manager-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(err)?;
        if let Ok(meta) = fs::metadata(path) {
            fs::set_permissions(&tmp, meta.permissions()).map_err(err)?;
        }
        f.write_all(bytes).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::rename(&tmp, path).map_err(err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub fn validate_markdown(path: &Path, content: &str) -> Result<()> {
    if path.file_name().is_some_and(|n| n == "SKILL.md") {
        let yaml = content
            .strip_prefix("---\n")
            .or_else(|| content.strip_prefix("---\r\n"))
            .and_then(|s| s.split_once("\n---").map(|(y, _)| y))
            .ok_or("SKILL.md requires YAML frontmatter")?;
        let parsed: serde_yaml::Value =
            serde_yaml::from_str(yaml).map_err(|e| format!("Invalid YAML: {e}"))?;
        for key in ["name", "description"] {
            if parsed[key].as_str().is_none_or(|s| s.trim().is_empty()) {
                return Err(format!("Skill {key} must be a nonempty string"));
            }
        }
    }
    Ok(())
}
impl Service {
    pub fn projects(&self) -> Vec<PathBuf> {
        self.setting("projects", json!([]))
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(PathBuf::from))
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn file_roots(&self) -> Vec<Value> {
        let mut roots = vec![
            json!({"name":"Claude","path":self.home.join(".claude")}),
            json!({"name":"Shared skills","path":self.home.join(".agents/skills")}),
            json!({"name":"Codex skills","path":self.home.join(".codex/skills")}),
            json!({"name":"Codex plugins","path":self.home.join(".codex/plugins")}),
        ];
        roots.extend(
            self.projects().iter().map(
                |p| json!({"name":p.file_name().unwrap_or_default().to_string_lossy(),"path":p}),
            ),
        );
        for (_, root) in self.skill_roots() {
            if !roots
                .iter()
                .any(|v| root.starts_with(Path::new(v["path"].as_str().unwrap_or(""))))
            {
                roots.push(json!({"name":root.parent().and_then(|p|p.file_name()).unwrap_or_default().to_string_lossy(),"path":root}));
            }
        }
        roots.retain(|v| v["path"].as_str().is_some_and(|p| Path::new(p).is_dir()));
        roots
    }
    pub fn checked_path(&self, path: &str, write: bool) -> Result<PathBuf> {
        let p = Path::new(path);
        if !p.is_absolute()
            || p.components().any(|c| matches!(c, Component::ParentDir))
            || protected(p)
        {
            return Err("Protected or invalid path".into());
        }
        let resolved = fs::canonicalize(p).map_err(err)?;
        if protected(&resolved) {
            return Err("Protected file".into());
        }
        let allowed = self
            .file_roots()
            .iter()
            .filter_map(|v| v["path"].as_str())
            .filter_map(|p| fs::canonicalize(p).ok())
            .any(|root| resolved.starts_with(root));
        if !allowed {
            return Err("Path is outside registered roots".into());
        }
        if write && (self.is_managed(&resolved) || !self.writable_location(&resolved)) {
            return Err(
                "Managed or protected file. Create a local copy to edit this skill.".into(),
            );
        }
        Ok(resolved)
    }
    pub fn is_managed(&self, p: &Path) -> bool {
        [
            ".claude/plugins",
            ".claude/skills/synced",
            ".codex/plugins",
            ".codex/skills/.system",
        ]
        .iter()
        .any(|root| p.starts_with(self.home.join(root)))
    }
    fn writable_location(&self, p: &Path) -> bool {
        let mut roots = self
            .skill_roots()
            .into_iter()
            .map(|(_, p)| p)
            .collect::<Vec<_>>();
        roots.push(self.home.join(".claude/plans"));
        roots
            .iter()
            .filter_map(|r| fs::canonicalize(r).ok())
            .any(|r| p.starts_with(r))
            || self
                .projects()
                .iter()
                .filter_map(|r| fs::canonicalize(r).ok())
                .any(|r| p.starts_with(r))
    }
    pub fn tree(&self, input: &Value) -> Result<Value> {
        let path = self.checked_path(text(input, "path")?, false)?;
        let mut entries=fs::read_dir(path).map_err(err)?.filter_map(|e|e.ok()).map(|e| {let p=e.path();json!({"name":e.file_name().to_string_lossy(),"path":p,"directory":p.is_dir(),"protected":protected(&p),"symlink":e.file_type().is_ok_and(|t|t.is_symlink())})}).collect::<Vec<_>>();
        entries.sort_by(|a, b| {
            b["directory"]
                .as_bool()
                .cmp(&a["directory"].as_bool())
                .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
        });
        Ok(json!(entries))
    }
    pub fn read(&self, input: &Value) -> Result<Value> {
        let path = self.checked_path(text(input, "path")?, false)?;
        let metadata = fs::metadata(&path).map_err(err)?;
        if metadata.len() > 1024 * 1024 {
            return Err("File exceeds the 1 MB editor limit".into());
        }
        let content =
            fs::read_to_string(&path).map_err(|_| "This file is not UTF-8 text".to_string())?;
        if content.contains('\0') {
            return Err("Binary files cannot be opened".into());
        }
        if path.extension().is_some_and(|e| e == "json")
            && [
                "\"apiKey\"",
                "\"api_key\"",
                "\"accessToken\"",
                "\"refreshToken\"",
                "\"ANTHROPIC_API_KEY\"",
                "\"OPENAI_API_KEY\"",
            ]
            .iter()
            .any(|k| content.contains(k))
        {
            return Err("This file contains credential fields and is protected".into());
        }
        Ok(
            json!({"path":path,"content":content,"revision":hash(content.as_bytes()),"readonly":self.is_managed(&path)||!self.writable_location(&path)}),
        )
    }
    pub fn save(&mut self, input: &Value) -> Result<Value> {
        let path = self.checked_path(text(input, "path")?, true)?;
        let content = text(input, "content")?;
        if content.len() > 1024 * 1024 {
            return Err("File exceeds the 1 MB editor limit".into());
        }
        validate_markdown(&path, content)?;
        let old = fs::read_to_string(&path).map_err(err)?;
        if hash(old.as_bytes()) != text(input, "revision")? {
            return Err("Conflict: the file changed on disk. Reload it before saving.".into());
        }
        self.db
            .execute(
                "INSERT INTO revisions VALUES (?,?,?,?)",
                params![
                    Uuid::new_v4().to_string(),
                    path.to_string_lossy(),
                    old,
                    now()
                ],
            )
            .map_err(err)?;
        atomic_write(&path, content.as_bytes())?;
        self.read(input)
    }
    pub fn history(&self, input: &Value) -> Result<Value> {
        let path = self.checked_path(text(input, "path")?, false)?;
        let mut q=self.db.prepare("SELECT id,content,created FROM revisions WHERE path=? ORDER BY rowid DESC LIMIT 50").map_err(err)?;
        let rows=q.query_map([path.to_string_lossy().to_string()],|r|Ok(json!({"id":r.get::<_,String>(0)?,"content":r.get::<_,String>(1)?,"created":r.get::<_,u64>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
        Ok(json!(rows))
    }
}
