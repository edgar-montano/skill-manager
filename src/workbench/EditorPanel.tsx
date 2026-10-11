import { lazy, Suspense, useEffect, useState } from "react";
import { z } from "zod";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  X,
  ArrowUpRight,
  Sparkles,
  Save,
  Copy,
  FileUp,
  Check,
  RotateCcw,
  FileText,
  History,
  Code2,
  Eye,
  GitCompare,
  Shield,
  ExternalLink,
  Download,
} from "lucide-react";
import {
  api,
  fileSchema,
  okSchema,
  message,
  shortPath,
  agentName,
  compact,
  type Skill,
  type SkillFile,
} from "./api";
import Markdown from "./Markdown";
import Tree from "./Tree";
const CodeEditor = lazy(() => import("./CodeEditor"));
type Tab = "preview" | "source" | "compare" | "history";
export default function EditorPanel({
  path,
  skill,
  onClose,
  onSaved,
  onDirty,
}: {
  path: string;
  skill?: Skill;
  onClose: () => void;
  onSaved: () => void;
  onDirty: (v: boolean) => void;
}) {
  const [file, setFile] = useState<SkillFile>(),
    [draft, setDraft] = useState(""),
    [tab, setTab] = useState<Tab>("preview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [improve, setImprove] = useState(false),
    [provider, setProvider] = useState<"claude" | "chatgpt">(
      skill?.agent === "claude" ? "claude" : "chatgpt",
    ),
    [goal, setGoal] = useState("Clearer triggers and instructions"),
    [prompt, setPrompt] = useState(""),
    [support, setSupport] = useState<string[]>([]),
    [history, setHistory] = useState<
      { id: string; content: string; created: number }[]
    >([]);
  useEffect(() => {
    let active = true;
    void api("read", { path }, fileSchema)
      .then((v) => {
        if (active) {
          setFile(v);
          setDraft(v.content);
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    onDirty(!!file && draft !== file.content);
  }, [draft, file, onDirty]);
  useEffect(() => {
    if (tab === "history")
      void api(
        "history",
        { path },
        z.array(
          z.object({
            id: z.string(),
            content: z.string(),
            created: z.number(),
          }),
        ),
      )
        .then(setHistory)
        .catch((e) => setError(message(e)));
  }, [tab, path]);
  useEffect(() => {
    if (skill?.agent === "agents")
      void api(
        "settings",
        {},
        z.object({ provider: z.enum(["claude", "chatgpt"]) }),
      )
        .then((v) => setProvider(v.provider))
        .catch(() => {});
  }, [skill?.agent]);
  const dirty = !!file && draft !== file.content;
  async function save() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api(
        "save",
        { path, content: draft, revision: file.revision },
        fileSchema,
      );
      setFile(saved);
      setNotice("Saved. Previous version is available in History.");
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function handoff() {
    setBusy(true);
    setError("");
    const destination =
      provider === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/";
    const desktop = isTauri();
    const chat = desktop ? null : window.open(destination, "_blank");
    if (chat) chat.opener = null;
    try {
      if (desktop) await openUrl(destination);
      const result = await api(
        "improve",
        { path, provider, goal, files: support },
        z.object({ url: z.string(), prompt: z.string() }),
      );
      setPrompt(result.prompt);
      try {
        await navigator.clipboard.writeText(result.prompt);
        setNotice("Prompt copied. Paste it into your new chat.");
      } catch {
        setNotice(
          "Copy the prepared prompt below and paste it into the new chat.",
        );
      }
      if (!chat && !desktop)
        setNotice("Your browser blocked the new tab. Use Open chat below.");
      await api("settings.save", { provider }, okSchema);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copyLocal() {
    if (!skill) return;
    const name = window.prompt(
      "Name for your editable copy",
      `${skill.name.replace(/[^a-zA-Z0-9-]/g, "-")}-local`,
    );
    if (!name) return;
    setBusy(true);
    try {
      await api(
        "copy",
        { path, name, agent: skill.agent === "claude" ? "claude" : "codex" },
        okSchema,
      );
      setNotice("Local copy created. Find it in your skill library.");
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor-panel" aria-label="Skill detail">
      <header className="detail-header">
        <div className="file-icon">
          <FileText size={18} />
        </div>
        <div>
          <h2>{skill?.name ?? path.split("/").pop()}</h2>
          <span className="muted">
            {skill
              ? `${agentName(skill.agent)} · ${skill.scope} skill`
              : "Local document"}
          </span>
        </div>
        <button
          className="icon-button"
          title="Close detail"
          aria-label="Close detail"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="detail-path" title={path}>
        {shortPath(path)}
      </div>
      {skill ? (
        <>
          <p className="detail-description">
            {skill.description || "No description provided."}
          </p>
          <div className="detail-metrics">
            <div>
              <strong>{compact(skill.tokens)}</strong>
              <span>body tokens ≈</span>
            </div>
            <div>
              <strong>{compact(skill.discoveryTokens)}</strong>
              <span>listing tokens ≈</span>
            </div>
            <div>
              <strong>{compact(skill.supportTokens)}</strong>
              <span>support tokens ≈</span>
            </div>
          </div>
          <div className="detail-actions">
            <button className="primary" onClick={() => setImprove(!improve)}>
              <Sparkles size={15} /> Improve using AI <ArrowUpRight size={14} />
            </button>
            {file?.readonly ? (
              <button onClick={() => void copyLocal()} disabled={busy}>
                <Copy size={14} /> Local copy
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {skill ? (
        <details className="provenance">
          <summary>Source & installation</summary>
          <p>
            {agentName(skill.agent)} · {skill.scope} ·{" "}
            {skill.plugin ?? "Standalone skill"}
          </p>
          <p>Readers: {skill.consumers.map(agentName).join(", ")}</p>
          {skill.provenance ? (
            <pre>{JSON.stringify(skill.provenance, null, 2)}</pre>
          ) : (
            <p>No collection provenance recorded for this local skill.</p>
          )}
        </details>
      ) : null}
      {error ? (
        <div className="notice error" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="notice" role="status">
          <Check size={14} />
          {notice}
        </div>
      ) : null}
      {improve ? (
        <div className="improve-box">
          <div className="section-eyebrow">REFINE YOUR SKILL</div>
          <div className="form-row">
            <select
              aria-label="AI provider"
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value === "claude" ? "claude" : "chatgpt")
              }
            >
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
            <select
              aria-label="Improvement goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            >
              <option>Clearer triggers and instructions</option>
              <option>Fewer tokens, same behavior</option>
              <option>Better examples and edge cases</option>
            </select>
          </div>
          <details>
            <summary>
              Include supporting files · {support.length} selected
            </summary>
            <Tree
              roots={[
                {
                  name: "Skill files",
                  path: path.slice(0, path.lastIndexOf("/")),
                },
              ]}
              onOpen={(p) =>
                setSupport((s) =>
                  s.includes(p) ? s.filter((x) => x !== p) : [...s, p],
                )
              }
            />
            {support.map((p) => (
              <button
                className="chip"
                key={p}
                onClick={() => setSupport((s) => s.filter((x) => x !== p))}
              >
                {p.split("/").pop()} ×
              </button>
            ))}
          </details>
          <button
            className="primary"
            disabled={busy || dirty}
            onClick={() => void handoff()}
          >
            <ExternalLink size={14} /> Copy prompt & open chat
          </button>
          {dirty ? (
            <small>Save your current edits before preparing the prompt.</small>
          ) : null}
          {prompt ? (
            <>
              <textarea
                aria-label="Prepared improvement prompt"
                className="prompt-box"
                readOnly
                value={prompt}
              />
              <div className="form-row">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(prompt)
                      .catch(() =>
                        setNotice("Select and copy the prompt above."),
                      )
                  }
                >
                  <Copy size={13} /> Copy prompt
                </button>
                <a
                  href={
                    provider === "claude"
                      ? "https://claude.ai/new"
                      : "https://chatgpt.com/"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Open chat ↗
                </a>
              </div>
            </>
          ) : null}
          <label className="return-label">Return from your AI chat</label>
          <textarea
            aria-label="Paste revised skill"
            placeholder="Paste the complete revised SKILL.md here to review it…"
            onChange={(e) => {
              const value = e.target.value
                .replace(/^```(?:markdown|md)?\n/, "")
                .replace(/\n```\s*$/, "");
              setDraft(value);
              setTab("compare");
            }}
          />
          <label className="file-upload">
            <FileUp size={14} /> Import revised Markdown
            <input
              type="file"
              accept=".md,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void f.text().then((v) => {
                    setDraft(v);
                    setTab("compare");
                  });
              }}
            />
          </label>
          <small>
            Changes are applied only when you click Save. Choose your model in
            the provider chat.
          </small>
        </div>
      ) : null}
      <div className="editor-tabs">
        {(
          [
            { id: "preview", label: "Preview", icon: Eye },
            { id: "source", label: "Source", icon: Code2 },
            { id: "compare", label: "Changes", icon: GitCompare },
            { id: "history", label: "History", icon: History },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>
      {file?.readonly ? (
        <div className="readonly-note">
          <Shield size={13} /> Managed source · read only
        </div>
      ) : null}
      <div className="editor-body">
        {!file ? (
          <div className="empty">
            {error ? "Unable to open this file" : "Opening document…"}
          </div>
        ) : tab === "preview" ? (
          <>
            <details className="outline">
              <summary>Document outline</summary>
              {draft
                .split("\n")
                .filter((l) => /^#{1,3} /.test(l))
                .map((l, i) => (
                  <div key={i}>{l.replace(/^#+ /, "")}</div>
                ))}
            </details>
            <Markdown content={draft} />
          </>
        ) : tab === "history" ? (
          <div className="history-list">
            {history.length ? (
              history.map((h) => (
                <article key={h.id}>
                  <div>
                    <History size={15} />
                    <strong>
                      {new Date(h.created * 1000).toLocaleString()}
                    </strong>
                  </div>
                  <p>
                    {h.content.length.toLocaleString()} characters · saved
                    before a change
                  </p>
                  <button
                    onClick={() => {
                      setDraft(h.content);
                      setTab("compare");
                    }}
                  >
                    <RotateCcw size={13} /> Review restore
                  </button>
                </article>
              ))
            ) : (
              <div className="empty">
                Previous versions appear here after your first save.
              </div>
            )}
          </div>
        ) : (
          <Suspense fallback={<div className="empty">Loading editor…</div>}>
            <CodeEditor
              value={draft}
              onChange={setDraft}
              path={path}
              original={tab === "compare" ? file.content : undefined}
              readonly={file.readonly}
            />
          </Suspense>
        )}
      </div>
      <footer className="editor-footer">
        <span>
          {dirty ? (
            <>
              <i className="dot amber" /> Unsaved changes ·{" "}
              {Math.ceil(draft.length / 4) -
                (skill?.tokens ?? Math.ceil((file?.content.length ?? 0) / 4)) >
              0
                ? "+"
                : ""}
              {Math.ceil(draft.length / 4) -
                (skill?.tokens ??
                  Math.ceil((file?.content.length ?? 0) / 4))}{" "}
              tokens ≈
            </>
          ) : (
            <>
              <i className="dot" /> Saved on disk
            </>
          )}
        </span>
        <button
          disabled={!file}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([draft], { type: "text/markdown;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = path.split("/").pop() ?? "SKILL.md";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={14} /> Export
        </button>
        <button
          className="primary"
          disabled={!dirty || busy || file?.readonly}
          onClick={() => void save()}
        >
          <Save size={14} /> Save
        </button>
      </footer>
    </section>
  );
}
