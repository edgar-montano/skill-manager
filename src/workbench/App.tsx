import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  LayoutDashboard,
  Layers,
  Package,
  FolderTree,
  Activity as ActivityIcon,
  Settings,
  Search,
  RefreshCw,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Command,
  Plus,
  Check,
  Star,
  Link2,
  X,
  Loader2,
  Terminal,
  SlidersHorizontal,
  ExternalLink,
  FileText,
  ArrowRight,
  ShieldCheck,
  PanelLeftClose,
} from "lucide-react";
import {
  api,
  skillSchema,
  rootSchema,
  settingsSchema,
  activitySchema,
  okSchema,
  message,
  shortPath,
  compact,
  agentName,
  count,
  type Skill,
  type Activity,
} from "./api";
import EditorPanel from "./EditorPanel";
import Tree from "./Tree";
import Bundles from "./Bundles";
import "./styles.css";

type Page =
  "Overview" | "Skills" | "Bundles" | "Files & Plans" | "Activity" | "Settings";
const navigation = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Skills", icon: Layers },
  { name: "Bundles", icon: Package },
  { name: "Files & Plans", icon: FolderTree },
  { name: "Activity", icon: ActivityIcon },
  { name: "Settings", icon: Settings },
] satisfies { name: Page; icon: typeof Layers }[];
function Toggle({
  enabled,
  disabled,
  onClick,
  label,
}: {
  enabled: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={`toggle ${enabled ? "enabled" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span />
    </button>
  );
}
function AgentIcon({ agent }: { agent: string }) {
  return (
    <span className={`agent-icon ${agent}`}>
      {agent === "claude"
        ? "✳"
        : agent === "codex"
          ? "◎"
          : agent === "agents"
            ? "↗"
            : agent.charAt(0).toUpperCase()}
    </span>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>("Overview"),
    [skills, setSkills] = useState<Skill[]>([]),
    [roots, setRoots] = useState<{ name: string; path: string }[]>([]),
    [settings, setSettings] = useState<z.infer<typeof settingsSchema>>(),
    [activity, setActivity] = useState<Activity>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [query, setQuery] = useState(""),
    [agent, setAgent] = useState("all"),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("name"),
    [selected, setSelected] = useState<string>(),
    [filePath, setFilePath] = useState<string>(),
    [checked, setChecked] = useState<Set<string>>(new Set()),
    [dirty, setDirty] = useState(false),
    [project, setProject] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [s, r, c, a] = await Promise.all([
        api("inventory", {}, z.array(skillSchema)),
        api("roots", {}, z.array(rootSchema)),
        api("settings", {}, settingsSchema),
        api("activity", {}, activitySchema),
      ]);
      setSkills(s);
      setRoots(r);
      setSettings(c);
      setActivity(a);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const canLeave = () => !dirty || window.confirm("Discard unsaved changes?");
  function navigate(p: Page) {
    if (canLeave()) {
      setPage(p);
      setSelected(undefined);
      setFilePath(undefined);
      setDirty(false);
      setQuery("");
      setChecked(new Set());
    }
  }
  function openSkill(s: Skill) {
    if (canLeave()) {
      setSelected(s.id);
      setFilePath(undefined);
      setDirty(false);
    }
  }
  function openFile(path: string) {
    if (canLeave()) {
      setFilePath(path);
      setSelected(undefined);
      setDirty(false);
    }
  }
  const chosen = skills.find((s) => s.id === selected);
  const path = chosen?.path ?? filePath;
  const visible = useMemo(
    () =>
      skills
        .filter(
          (s) =>
            (agent === "all" ||
              s.agent === agent ||
              s.consumers.includes(agent)) &&
            (status === "all" || (status === "enabled") === s.enabled) &&
            `${s.name} ${s.description} ${s.path}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "tokens"
            ? b.tokens - a.tokens
            : sort === "usage"
              ? count(b) - count(a)
              : sort === "rating"
                ? b.rating - a.rating
                : sort === "recent"
                  ? (
                      b.stats
                        .map((s) => s.last)
                        .sort()
                        .at(-1) ?? ""
                    ).localeCompare(
                      a.stats
                        .map((s) => s.last)
                        .sort()
                        .at(-1) ?? "",
                    )
                  : a.name.localeCompare(b.name),
        ),
    [skills, query, agent, status, sort],
  );
  const enabled = skills.filter((s) => s.enabled);
  const listing = enabled.reduce((n, s) => n + s.discoveryTokens, 0);
  const bodies = skills.reduce((n, s) => n + s.tokens, 0);
  const agents = [...new Set(skills.map((s) => s.agent))];
  async function work(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function toggle(s: Skill, enabled: boolean) {
    if (
      s.plugin &&
      !window.confirm(
        `This changes the entire ${s.plugin} plugin, including all its skills. Continue?`,
      )
    )
      return;
    await work(s.id, async () => {
      const result = await api("toggle", { id: s.id, enabled }, okSchema);
      setNotice(result.message ?? "Updated");
      await refresh();
    });
  }
  async function bulk(enabled: boolean) {
    await work("bulk", async () => {
      const failures: string[] = [];
      for (const s of skills.filter((s) => checked.has(s.id))) {
        if (!s.canToggle || s.plugin) {
          failures.push(`${s.name}: manage plugin separately`);
          continue;
        }
        try {
          await api("toggle", { id: s.id, enabled }, okSchema);
        } catch (e) {
          failures.push(`${s.name}: ${message(e)}`);
        }
      }
      await refresh();
      setNotice(
        `${checked.size - failures.length} skills updated.${failures.length ? ` ${failures.join("; ")}` : ""}`,
      );
      setChecked(new Set());
    });
  }
  function setCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function index() {
    await work("index", async () => {
      setActivity(await api("activity.index", {}, activitySchema));
      await refresh();
      setNotice("Local activity indexed. Coverage and gaps are shown below.");
    });
  }
  const table = (
    <div className="table-wrap">
      <table className="skills-table">
        <thead>
          <tr>
            <th className="check-col">
              <input
                type="checkbox"
                aria-label="Select all visible skills"
                checked={
                  visible.length > 0 && visible.every((s) => checked.has(s.id))
                }
                onChange={(e) =>
                  setChecked(
                    e.target.checked
                      ? new Set(visible.map((s) => s.id))
                      : new Set(),
                  )
                }
              />
            </th>
            <th>
              Skill <ChevronDown size={11} />
            </th>
            <th>Agent</th>
            <th>Tokens ≈</th>
            <th>Observed use</th>
            <th>Rating</th>
            <th>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.id} className={selected === s.id ? "selected" : ""}>
              <td>
                <input
                  aria-label={`Select ${s.name}`}
                  type="checkbox"
                  checked={checked.has(s.id)}
                  onChange={() => setCheck(s.id)}
                />
              </td>
              <td>
                <button className="skill-name" onClick={() => openSkill(s)}>
                  <span className={`skill-glyph ${s.agent}`}>
                    <Command size={16} />
                  </span>
                  <span>
                    <strong>
                      {s.name}
                      {s.readonly ? <ShieldCheck size={11} /> : null}
                    </strong>
                    <span className="skill-description">
                      {s.description || "No description provided"}
                    </span>
                  </span>
                </button>
              </td>
              <td>
                <span className="agent-cell">
                  <AgentIcon agent={s.agent} />
                  {agentName(s.agent)}
                </span>
                <small className="scope-label">
                  {s.scope}
                  {s.plugin ? " · plugin" : ""}
                </small>
              </td>
              <td className="mono">
                {compact(s.tokens)}
                <span className="token-line">
                  <i style={{ width: `${Math.min(s.tokens / 80, 100)}%` }} />
                </span>
              </td>
              <td title="Identified skill invocations. Read requests and mentions are separate in Activity.">
                {s.stats.length ? (
                  <>
                    <span>{count(s).toLocaleString()} calls</span>
                    <small className="scope-label">
                      {count(s, "read")} read requests
                    </small>
                    <small className="scope-label">
                      Last{" "}
                      {new Date(
                        s.stats
                          .map((stat) => stat.last)
                          .sort()
                          .at(-1) ?? "",
                      ).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </>
                ) : (
                  <span className="unknown">Unknown</span>
                )}
              </td>
              <td>
                <button
                  className={`rating ${s.rating ? "rated" : ""}`}
                  aria-label={`Rate ${s.name}: ${s.rating} of 5`}
                  title="Click to cycle your personal usefulness rating"
                  onClick={() =>
                    void work("rating", async () => {
                      await api(
                        "rating",
                        { id: s.id, rating: (s.rating + 1) % 6 },
                        okSchema,
                      );
                      await refresh();
                    })
                  }
                >
                  <Star size={13} fill={s.rating ? "currentColor" : "none"} />
                  {s.rating || "—"}
                </button>
              </td>
              <td>
                <Toggle
                  enabled={s.enabled}
                  disabled={!!busy || !s.canToggle}
                  onClick={() => void toggle(s, !s.enabled)}
                  label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!visible.length ? (
        <div className="empty">
          <Search size={22} />
          <h3>No skills found</h3>
          <p>Try a different filter or add a project in Settings.</p>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="workbench">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-logo">
            <Layers size={23} />
          </span>
          <span>
            skill<span className="brand-light">manager</span>
            <small>YOUR AGENT WORKBENCH</small>
          </span>
        </a>
        <div className="workspace-picker">
          <span className="workspace-avatar">E</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Local to this Mac</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="sidebar-label">WORKSPACE</span>
        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              className={page === name ? "active" : ""}
              onClick={() => navigate(name)}
            >
              <Icon size={17} />
              <span>{name}</span>
              {name === "Skills" ? <em>{skills.length}</em> : null}
              {name === "Bundles" ? <span className="nav-new">3</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <span className="sidebar-label">CONNECTED AGENTS</span>
          <button
            className="icon-button"
            title="Manage agents"
            onClick={() => navigate("Settings")}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="agent-nav">
          {["claude", "codex", "agents"].map((a) => (
            <button
              key={a}
              onClick={() => {
                navigate("Skills");
                setAgent(a);
              }}
            >
              <AgentIcon agent={a} />
              <span>{agentName(a)}</span>
              <i
                className={`dot ${skills.some((s) => s.agent === a) ? "" : "dim"}`}
              />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <ShieldCheck size={16} />
            <strong>On your machine. Yours.</strong>
            <p>
              Your files and activity stay local.
              <br />
              No account. No API keys.
            </p>
          </div>
          <a
            href="https://github.com/edgar-montano/skill-manager"
            target="_blank"
            rel="noreferrer"
          >
            <Terminal size={14} /> Open source <ArrowUpRight size={13} />
          </a>
          <div className="version">
            <span>
              <i className="dot" /> Local service
            </span>
            <span>v0.4.2+</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-pill">
              <i className="dot" /> LOCAL
            </span>
            <button
              className="icon-button"
              aria-label="Refresh inventory"
              disabled={loading || !!busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
            <span className="user-avatar">E</span>
          </div>
        </header>
        <div className={`content-shell ${path ? "with-editor" : ""}`}>
          <main className="main-content">
            {error ? (
              <div className="notice error" role="alert">
                {error}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            ) : null}
            {notice ? (
              <div className="notice" role="status">
                <Check size={14} />
                {notice}
                <button
                  className="icon-button"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="empty loading">
                <Loader2 className="spin" size={25} />
                <h3>Reading your skill library</h3>
                <p>Discovering local agents and installed plugins…</p>
              </div>
            ) : page === "Bundles" ? (
              <Bundles onInstalled={() => void refresh()} />
            ) : page === "Overview" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="section-eyebrow">
                      A LITTLE ORDER FOR YOUR AGENTS
                    </div>
                    <h1>
                      Your skills, in focus<span className="title-dot">.</span>
                    </h1>
                    <p>
                      Know what’s installed. Keep what works. Make the rest
                      better.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => navigate("Bundles")}
                  >
                    <Plus size={15} /> Explore bundles
                  </button>
                </div>
                <div className="metric-grid">
                  <article className="metric-card">
                    <div>
                      <span>Total skills</span>
                      <Layers size={16} />
                    </div>
                    <strong>
                      {skills.length}
                      <small>across {agents.length} agents</small>
                    </strong>
                    <footer>
                      <span className="mini-pill">
                        {enabled.length} enabled
                      </span>
                      <span>{skills.length - enabled.length} disabled</span>
                    </footer>
                  </article>
                  <article className="metric-card">
                    <div>
                      <span>Discovery context</span>
                      <Command size={16} />
                    </div>
                    <strong>
                      {compact(listing)}
                      <small>estimated tokens</small>
                    </strong>
                    <footer>
                      <span className="dot amber" />
                      <span>Names, descriptions & paths</span>
                    </footer>
                  </article>
                  <article className="metric-card">
                    <div>
                      <span>Observed activity</span>
                      <ActivityIcon size={16} />
                    </div>
                    <strong>
                      {activity?.coverage
                        ? compact(activity.range.events)
                        : "—"}
                      <small>
                        {activity?.coverage
                          ? "recorded events"
                          : "not indexed yet"}
                      </small>
                    </strong>
                    <footer>
                      <button
                        className="text-link"
                        disabled={!!busy}
                        onClick={() => void index()}
                      >
                        {busy === "index"
                          ? "Indexing local activity…"
                          : "Index local activity"}
                        <ArrowUpRight size={13} />
                      </button>
                    </footer>
                  </article>
                  <article className="metric-card">
                    <div>
                      <span>Your useful skills</span>
                      <Star size={16} />
                    </div>
                    <strong>
                      {skills.filter((s) => s.rating >= 4).length}
                      <small>rated 4 stars or higher</small>
                    </strong>
                    <footer>
                      <span>Personal ratings, backed by you</span>
                    </footer>
                  </article>
                </div>
                <div className="overview-columns">
                  <section className="panel agent-panel">
                    <div className="panel-heading">
                      <h3>Your agents</h3>
                      <button
                        className="text-link"
                        onClick={() => navigate("Settings")}
                      >
                        Manage <ArrowUpRight size={13} />
                      </button>
                    </div>
                    {agents.slice(0, 5).map((a) => {
                      const owned = skills.filter((s) => s.agent === a);
                      return (
                        <button
                          className="agent-overview"
                          key={a}
                          onClick={() => {
                            navigate("Skills");
                            setAgent(a);
                          }}
                        >
                          <AgentIcon agent={a} />
                          <div>
                            <strong>{agentName(a)}</strong>
                            <span>
                              {owned.length} skills <i>·</i>{" "}
                              {owned.filter((s) => s.enabled).length} enabled
                            </span>
                          </div>
                          <span className="agent-context">
                            {compact(
                              owned.reduce((n, s) => n + s.discoveryTokens, 0),
                            )}
                            <small>listing tokens ≈</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      );
                    })}
                  </section>
                  <section className="panel context-panel">
                    <div className="panel-heading">
                      <h3>Where your context goes</h3>
                      <span className="chip">ESTIMATED</span>
                    </div>
                    <div className="context-total">
                      {compact(bodies)}
                      <span>tokens across all skill bodies</span>
                    </div>
                    <div className="context-bar">
                      {agents.map((a, i) => (
                        <span
                          key={a}
                          style={{
                            width: `${(skills.filter((s) => s.agent === a).reduce((n, s) => n + s.tokens, 0) / Math.max(bodies, 1)) * 100}%`,
                            background: [
                              "#bce48b",
                              "#bd9bea",
                              "#db9b80",
                              "#86b9d4",
                              "#d6c686",
                            ][i % 5],
                          }}
                          title={agentName(a)}
                        />
                      ))}
                    </div>
                    <div className="context-legend">
                      {agents.slice(0, 5).map((a, i) => (
                        <span key={a}>
                          <i
                            style={{
                              background: [
                                "#bce48b",
                                "#bd9bea",
                                "#db9b80",
                                "#86b9d4",
                                "#d6c686",
                              ][i],
                            }}
                          />
                          {agentName(a)}
                        </span>
                      ))}
                    </div>
                    <p>
                      Skill bodies load on demand. This is your library’s size,
                      not your session’s token usage.
                    </p>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h3>Skills worth a closer look</h3>
                    <button
                      className="text-link"
                      onClick={() => {
                        navigate("Skills");
                        setSort("tokens");
                      }}
                    >
                      View library <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="spotlight-list">
                    {[...skills]
                      .sort((a, b) => b.tokens - a.tokens)
                      .slice(0, 4)
                      .map((s) => (
                        <button key={s.id} onClick={() => openSkill(s)}>
                          <span className={`skill-glyph ${s.agent}`}>
                            <FileText size={17} />
                          </span>
                          <div>
                            <strong>{s.name}</strong>
                            <p>{s.description}</p>
                          </div>
                          <span className="chip">
                            {compact(s.tokens)} tokens ≈
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                  </div>
                </section>
                <div className="page-footnote">
                  <ShieldCheck size={13} /> Real local inventory · Token
                  estimates use characters ÷ 4 · No content is sent to an AI
                  until you paste it into a chat
                </div>
              </>
            ) : page === "Skills" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="section-eyebrow">
                      THE CAPABILITIES YOU KEEP
                    </div>
                    <h1>
                      Skill library<span className="title-dot">.</span>
                    </h1>
                    <p>
                      {skills.length} skills. Every agent. One place to make
                      them better.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => navigate("Bundles")}
                  >
                    <Plus size={15} /> Install skills
                  </button>
                </div>
                <div className="library-toolbar">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="Search skills"
                      placeholder="Search skills, descriptions, or paths…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>⌕</kbd>
                  </label>
                  <select
                    aria-label="Filter agent"
                    value={agent}
                    onChange={(e) => setAgent(e.target.value)}
                  >
                    <option value="all">All agents</option>
                    {agents.map((a) => (
                      <option key={a} value={a}>
                        {agentName(a)}
                      </option>
                    ))}
                    {!agents.includes("codex") ? (
                      <option value="codex">Codex</option>
                    ) : null}
                  </select>
                  <select
                    aria-label="Filter status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">All states</option>
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <select
                    aria-label="Sort skills"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="name">Name A–Z</option>
                    <option value="tokens">Most tokens</option>
                    <option value="usage">Most used</option>
                    <option value="recent">Recently used</option>
                    <option value="rating">Highest rated</option>
                  </select>
                </div>
                <div className="library-summary">
                  <span>
                    {visible.length} skills <i>·</i>{" "}
                    {visible.filter((s) => s.enabled).length} enabled
                  </span>
                  {checked.size ? (
                    <div>
                      <strong>{checked.size} selected</strong>
                      <button disabled={!!busy} onClick={() => void bulk(true)}>
                        Enable
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => void bulk(false)}
                      >
                        Disable
                      </button>
                    </div>
                  ) : (
                    <span>
                      <SlidersHorizontal size={13} /> Your setup, your rules
                    </span>
                  )}
                </div>
                <section className="panel library-panel">{table}</section>
                <div className="page-footnote">
                  Usage is based on identifiable local evidence. Unknown means
                  there is no attributed evidence in the indexed records.
                </div>
              </>
            ) : page === "Files & Plans" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="section-eyebrow">LOOK UNDER THE HOOD</div>
                    <h1>
                      Files & plans<span className="title-dot">.</span>
                    </h1>
                    <p>Your agent directories, with room to read and refine.</p>
                  </div>
                  <button
                    onClick={() => {
                      if (settings)
                        openFile(`${settings.home}/.claude/CLAUDE.md`);
                    }}
                  >
                    <FileText size={15} /> CLAUDE.md
                  </button>
                </div>
                <div className="files-layout">
                  <section className="panel explorer-panel">
                    <div className="panel-heading">
                      <h3>EXPLORER</h3>
                      <PanelLeftClose size={15} />
                    </div>
                    <Tree roots={roots} onOpen={openFile} selected={filePath} />
                  </section>
                  <section className="file-welcome">
                    <div className="welcome-orbit">
                      <FolderTree size={40} />
                    </div>
                    <h2>A home for the details.</h2>
                    <p>
                      Open a file from the tree to read its source or rendered
                      Markdown. Claude plans live in{" "}
                      <code>~/.claude/plans</code>.
                    </p>
                    <div>
                      <span>
                        <Check size={14} /> Syntax highlighting
                      </span>
                      <span>
                        <Check size={14} /> Markdown & diagrams
                      </span>
                      <span>
                        <Check size={14} /> Revision history
                      </span>
                    </div>
                  </section>
                </div>
              </>
            ) : page === "Activity" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="section-eyebrow">
                      EVIDENCE, NOT GUESSWORK
                    </div>
                    <h1>
                      Skill activity<span className="title-dot">.</span>
                    </h1>
                    <p>
                      Understand when skills show up in your local sessions.
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => void index()}
                  >
                    <RefreshCw
                      size={15}
                      className={busy === "index" ? "spin" : ""}
                    />
                    {busy === "index" ? "Indexing…" : "Index local activity"}
                  </button>
                </div>
                {activity?.coverage ? (
                  <>
                    <div className="coverage">
                      <span>
                        <Check size={15} /> {activity.coverage.files} log files
                        indexed
                      </span>
                      <span>{activity.coverage.skipped} outside coverage</span>
                      <span>
                        {activity.coverage.malformed} malformed records
                      </span>
                      <span>
                        {new Date(
                          activity.coverage.indexedAt * 1000,
                        ).toLocaleString()}
                      </span>
                    </div>
                    <p className="muted activity-note">
                      {activity.coverage.note}
                    </p>
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>Activity over time</h3>
                        <span className="muted">
                          Observed events · {activity.range.sessions} sessions
                        </span>
                      </div>
                      <div className="activity-chart">
                        {activity.days.length ? (
                          activity.days
                            .slice(0, 30)
                            .reverse()
                            .map((d, i) => (
                              <div
                                key={`${d.date}-${d.kind}`}
                                title={`${d.date}: ${d.count} ${d.kind} events`}
                              >
                                <span
                                  style={{
                                    height: `${Math.max(5, (d.count / Math.max(...activity.days.map((x) => x.count))) * 110)}px`,
                                  }}
                                />
                                <small>
                                  {i % 5 === 0 ? d.date.slice(5) : ""}
                                </small>
                              </div>
                            ))
                        ) : (
                          <div className="empty">
                            No attributable skill events in this coverage.
                          </div>
                        )}
                      </div>
                    </section>
                    <section className="panel event-list">
                      <div className="panel-heading">
                        <h3>Evidence log</h3>
                        <span className="muted">
                          Latest {activity.events.length} events
                        </span>
                      </div>
                      {activity.events.map((e, i) => (
                        <div className="event-row" key={`${e.session}-${i}`}>
                          <span className={`event-icon ${e.kind}`}>
                            <ActivityIcon size={15} />
                          </span>
                          <div>
                            <strong>
                              {e.skill.split("/").slice(-2, -1).join("")}
                            </strong>
                            <p title={e.skill}>{shortPath(e.skill)}</p>
                          </div>
                          <span className="chip">
                            {e.kind === "read" ? "read request" : e.kind}
                          </span>
                          <span className="muted">{agentName(e.agent)}</span>
                          <time>{new Date(e.time).toLocaleDateString()}</time>
                        </div>
                      ))}
                    </section>
                  </>
                ) : (
                  <section className="empty panel activity-empty">
                    <ActivityIcon size={34} />
                    <h2>Start with what actually happened.</h2>
                    <p>
                      Read existing Claude Code and Codex logs on this machine.
                      Indexing stays local and does not change your agents.
                    </p>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => void index()}
                    >
                      Index local activity <ArrowRight size={14} />
                    </button>
                  </section>
                )}
              </>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <div className="section-eyebrow">MAKE THIS SPACE YOURS</div>
                    <h1>
                      Settings<span className="title-dot">.</span>
                    </h1>
                    <p>
                      Choose your projects and how you work with your skills.
                    </p>
                  </div>
                </div>
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <h3>Project directories</h3>
                    <span className="chip">LOCAL</span>
                  </div>
                  <p>
                    Register a project to browse its files and manage its agent
                    skills.
                  </p>
                  {settings?.projects.map((p) => (
                    <div className="project-row" key={p}>
                      <FolderTree size={16} />
                      <code>{shortPath(p)}</code>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${p}`}
                        onClick={() =>
                          void work("settings", async () => {
                            await api(
                              "settings.save",
                              {
                                projects: settings.projects.filter(
                                  (x) => x !== p,
                                ),
                              },
                              okSchema,
                            );
                            await refresh();
                          })
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <form
                    className="form-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void work("settings", async () => {
                        await api(
                          "settings.save",
                          {
                            projects: [
                              ...new Set([
                                ...(settings?.projects ?? []),
                                project,
                              ]),
                            ],
                          },
                          okSchema,
                        );
                        setProject("");
                        await refresh();
                      });
                    }}
                  >
                    <input
                      aria-label="Project directory"
                      placeholder="/Users/you/code/project"
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                      required
                    />
                    <button disabled={!!busy}>
                      <Plus size={15} /> Add project
                    </button>
                  </form>
                </section>
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <h3>AI handoff</h3>
                    <SparklesIcon />
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Default provider for shared skills</strong>
                      <p>
                        Opens a new chat and prepares a prompt. Choose the model
                        in that chat.
                      </p>
                    </div>
                    <select
                      aria-label="Default AI provider"
                      value={settings?.provider ?? "chatgpt"}
                      onChange={(e) =>
                        void work("settings", async () => {
                          await api(
                            "settings.save",
                            { provider: e.target.value },
                            okSchema,
                          );
                          await refresh();
                        })
                      }
                    >
                      <option value="chatgpt">ChatGPT</option>
                      <option value="claude">Claude</option>
                    </select>
                  </div>
                </section>
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <h3>Storage & transparency</h3>
                    <ShieldCheck size={16} />
                  </div>
                  <dl>
                    <dt>Local database</dt>
                    <dd className="mono">{settings?.data}/workbench.sqlite3</dd>
                    <dt>Token estimator</dt>
                    <dd>
                      Characters ÷ 4. An approximation, not a provider bill.
                    </dd>
                    <dt>Cloud skills</dt>
                    <dd>
                      Use export/import and chat handoff. Local changes do not
                      sync to your web accounts.
                    </dd>
                    <dt>Upstream</dt>
                    <dd>
                      <a
                        href="https://github.com/abubakarsiddik31/skill-manager"
                        target="_blank"
                        rel="noreferrer"
                      >
                        abubakarsiddik31/skill-manager · MIT{" "}
                        <ExternalLink size={12} />
                      </a>
                    </dd>
                  </dl>
                </section>
              </>
            )}
          </main>
          {path ? (
            <EditorPanel
              key={path}
              path={path}
              skill={chosen}
              onDirty={setDirty}
              onClose={() => {
                if (canLeave()) {
                  setSelected(undefined);
                  setFilePath(undefined);
                  setDirty(false);
                }
              }}
              onSaved={() => void refresh()}
            />
          ) : null}
        </div>
        <footer className="statusbar">
          <span>
            <i className="dot" />{" "}
            {loading ? "Connecting" : "Connected to local filesystem"}
          </span>
          <span>
            {skills.length} skills <i>·</i> {enabled.length} enabled <i>·</i>{" "}
            All data stays on this device
          </span>
        </footer>
      </div>
    </div>
  );
}
function SparklesIcon() {
  return <Link2 size={16} />;
}
