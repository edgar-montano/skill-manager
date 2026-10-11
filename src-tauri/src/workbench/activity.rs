use super::*;
use std::io::{BufRead, BufReader};

pub fn evidence(record: &Value) -> Vec<(String, String)> {
    let mut found = Vec::new();
    if record["type"] == "assistant" {
        if let Some(blocks) = record["message"]["content"].as_array() {
            for b in blocks {
                if b["type"] == "tool_use" {
                    let name = b["name"].as_str().unwrap_or("");
                    let input = &b["input"];
                    if name == "Skill" || name == "Workflow" {
                        if let Some(skill) =
                            input["skill"].as_str().or_else(|| input["name"].as_str())
                        {
                            found.push(("invocation".into(), skill.into()));
                        }
                    } else if matches!(name, "Read" | "read_file") {
                        if let Some(path) = input["file_path"]
                            .as_str()
                            .or_else(|| input["path"].as_str())
                        {
                            found.push(("read".into(), path.into()));
                        }
                    }
                }
            }
        }
    }
    if record["type"] == "response_item" && record["payload"]["type"] == "function_call" {
        let payload = &record["payload"];
        let name = payload["name"].as_str().unwrap_or("");
        if let Some(args) = payload["arguments"]
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            if matches!(name, "read_file" | "Read") {
                if let Some(p) = args["path"].as_str().or_else(|| args["file_path"].as_str()) {
                    found.push(("read".into(), p.into()));
                }
            }
        }
    }
    if record["type"] == "user" {
        if let Some(s) = record["message"]["content"].as_str() {
            found.push(("mention".into(), s.into()));
        }
    }
    if record["type"] == "event_msg" && record["payload"]["type"] == "user_message" {
        if let Some(s) = record["payload"]["message"].as_str() {
            found.push(("mention".into(), s.into()));
        }
    }
    found
}
impl Service {
    pub fn index_activity(&mut self) -> Result<Value> {
        if self.setting("activityParserVersion", json!(0)) != json!(2) {
            self.db.execute("DELETE FROM indexed", []).map_err(err)?;
            self.set_setting("activityParserVersion", &json!(2))?;
        }
        let inventory = self.inventory()?;
        let skills = inventory.as_array().ok_or("Invalid inventory")?;
        let mut files = Vec::new();
        for (agent, root) in [
            ("claude", self.home.join(".claude/projects")),
            ("codex", self.home.join(".codex/sessions")),
        ] {
            for entry in walkdir::WalkDir::new(root)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            {
                if let Ok(meta) = entry.metadata() {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    files.push((agent, entry.into_path(), meta.len(), modified));
                }
            }
        }
        files.sort_by_key(|f| std::cmp::Reverse(f.3));
        let total = files.len();
        let mut malformed = 0;
        let mut processed = 0;
        let mut skipped = 0;
        let mut bytes = 0;
        let mut records = 0;
        for (agent, path, size, modified) in files.into_iter().take(500) {
            if bytes + size > 256 * 1024 * 1024 {
                skipped += 1;
                continue;
            }
            let path_str = path.to_string_lossy();
            let previous = self
                .db
                .query_row(
                    "SELECT size,modified FROM indexed WHERE path=?",
                    [path_str.as_ref()],
                    |r| Ok((r.get::<_, u64>(0)?, r.get::<_, u64>(1)?)),
                )
                .ok();
            let coverage_key = format!("coverage-file:{path_str}");
            if previous == Some((size, modified)) {
                let prior = self.setting(&coverage_key, Value::Null);
                malformed += prior["malformed"].as_u64().unwrap_or(0) as usize;
                records += prior["records"].as_u64().unwrap_or(0) as usize;
                processed += 1;
                continue;
            }
            bytes += size;
            let Ok(file) = fs::File::open(&path) else {
                skipped += 1;
                continue;
            };
            let session = path.file_stem().unwrap_or_default().to_string_lossy();
            let malformed_before = malformed;
            let records_before = records;
            let tx = self.db.transaction().map_err(err)?;
            tx.execute(
                "DELETE FROM events WHERE session=? AND agent=?",
                params![session, agent],
            )
            .map_err(err)?;
            for line in BufReader::new(file).lines() {
                let Ok(line) = line else {
                    malformed += 1;
                    continue;
                };
                let Ok(record) = serde_json::from_str::<Value>(&line) else {
                    malformed += 1;
                    continue;
                };
                records += 1;
                let time = record["timestamp"].as_str().unwrap_or("");
                if time.is_empty() {
                    continue;
                }
                for (kind, value) in evidence(&record) {
                    for skill in skills {
                        let compatible = skill["agent"] == agent
                            || (agent == "codex" && skill["agent"] == "agents");
                        if !compatible {
                            continue;
                        }
                        let name = skill["name"].as_str().unwrap_or("");
                        let path = skill["path"].as_str().unwrap_or("");
                        let matches = match kind.as_str() {
                            "invocation" => value == name || value.rsplit(':').next() == Some(name),
                            "read" => value == path || skill["logicalPath"] == value,
                            "mention" => value.split_whitespace().any(|word| {
                                word == format!("${name}") || word == format!("/{name}")
                            }),
                            _ => false,
                        };
                        if !matches {
                            continue;
                        }
                        if kind != "read"
                            && skills
                                .iter()
                                .filter(|s| {
                                    s["name"] == name
                                        && (s["agent"] == agent
                                            || (agent == "codex" && s["agent"] == "agents"))
                                })
                                .count()
                                != 1
                        {
                            continue;
                        }
                        let logical = skill["logicalPath"].as_str().unwrap_or(path);
                        let id = hash(
                            format!("{agent}:{session}:{}:{kind}:{logical}", record).as_bytes(),
                        );
                        tx.execute(
                            "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)",
                            params![id, logical, kind, session, agent, time],
                        )
                        .map_err(err)?;
                    }
                }
            }
            tx.execute(
                "INSERT OR REPLACE INTO indexed VALUES (?,?,?)",
                params![path_str, size, modified],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
            self.set_setting(
                &coverage_key,
                &json!({"malformed":malformed-malformed_before,"records":records-records_before}),
            )?;
            processed += 1;
        }
        self.set_setting("coverage",&json!({"indexedAt":now(),"files":processed,"totalFiles":total,"skipped":skipped+total.saturating_sub(500),"malformed":malformed,"records":records,"note":"Explicit Skill calls, exact file-read requests, and user mentions only. Shell reads and implicit skill loading are not inferred. Duplicate skill names remain unattributed."}))?;
        self.activity()
    }
    pub fn activity(&self) -> Result<Value> {
        let mut q = self
            .db
            .prepare(
                "SELECT skill,kind,session,agent,time FROM events ORDER BY time DESC LIMIT 500",
            )
            .map_err(err)?;
        let events=q.query_map([],|r|Ok(json!({"skill":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"session":r.get::<_,String>(2)?,"agent":r.get::<_,String>(3)?,"time":r.get::<_,String>(4)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
        let mut q=self.db.prepare("SELECT substr(time,1,10),kind,count(*) FROM events GROUP BY 1,2 ORDER BY 1 DESC LIMIT 90").map_err(err)?;
        let days=q.query_map([],|r|Ok(json!({"date":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"count":r.get::<_,u64>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
        let range=self.db.query_row("SELECT min(time),max(time),count(*),count(DISTINCT session) FROM events",[],|r|Ok(json!({"first":r.get::<_,Option<String>>(0)?,"last":r.get::<_,Option<String>>(1)?,"events":r.get::<_,u64>(2)?,"sessions":r.get::<_,u64>(3)?}))).map_err(err)?;
        Ok(
            json!({"events":events,"days":days,"range":range,"coverage":self.setting("coverage",Value::Null)}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn evidence_is_not_free_text_inference() {
        assert!(
            evidence(&json!({"type":"assistant","message":{"content":"I used a skill"}}))
                .is_empty()
        );
        let event = json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"ponytail"}}]}});
        assert_eq!(
            evidence(&event),
            vec![("invocation".into(), "ponytail".into())]
        );
    }
}
