import { useEffect, useState } from "react";
import { z } from "zod";
import {
  ArrowUpRight,
  Package,
  Plus,
  Download,
  Check,
  X,
  ShieldCheck,
  GitBranch,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  api,
  bundleSchema,
  jobSchema,
  message,
  agentName,
  shortPath,
  type Bundle,
} from "./api";
const previewSchema = z.object({
  id: z.string(),
  plan: z.object({
    repo: z.string(),
    agent: z.string(),
    revision: z.string(),
    license: z.string(),
    destination: z.string(),
  }),
  message: z.string(),
});
type Preview = z.infer<typeof previewSchema>;
export default function Bundles({ onInstalled }: { onInstalled: () => void }) {
  const [bundles, setBundles] = useState<Bundle[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [repo, setRepo] = useState(""),
    [agent, setAgent] = useState("claude"),
    [preview, setPreview] = useState<Preview>(),
    [remote, setRemote] = useState<
      { name: string; path: string; repo: string }[]
    >([]),
    [jobs, setJobs] = useState<z.infer<typeof jobSchema>[]>([]);
  const reload = () =>
    void Promise.all([
      api("catalog", {}, z.array(bundleSchema)).then(setBundles),
      api("jobs", {}, z.array(jobSchema)).then(setJobs),
    ]).catch((e) => setError(message(e)));
  useEffect(reload, []);
  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function prepare(bundle: Bundle) {
    await run(bundle.id, async () =>
      setPreview(
        await api(
          "install.preview",
          {
            repo: bundle.repo,
            kind: "bundle",
            agent,
            name: bundle.id,
            path: bundle.path,
          },
          previewSchema,
        ),
      ),
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="section-eyebrow">YOUR NEXT CAPABILITY</div>
          <h1>
            Discover bundles<span className="title-dot">.</span>
          </h1>
          <p>Good workflows are worth keeping. Install them where you work.</p>
        </div>
        <select
          aria-label="Install agent"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        >
          <option value="claude">Install for Claude Code</option>
          <option value="codex">Install for Codex</option>
        </select>
      </div>
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="catalog-banner">
        <div className="banner-symbol">
          <Package size={28} />
        </div>
        <div>
          <strong>A small, considered collection.</strong>
          <p>
            Native plugins, complete dependencies, and a clear source for every
            skill.
          </p>
        </div>
        <span className="chip">
          <ShieldCheck size={13} /> Source licenses included
        </span>
      </div>
      <div className="bundle-grid">
        {bundles.map((b, i) => (
          <article className={`bundle-card ${b.color}`} key={b.id}>
            <div className="bundle-top">
              <div className="bundle-mark">
                {b.id === "ponytail"
                  ? "p."
                  : b.id === "caveman"
                    ? "c_"
                    : b.id === "superclaude"
                      ? "sc"
                      : "↗"}
              </div>
              <span className="chip">{b.license}</span>
            </div>
            <span className="section-eyebrow">
              {b.kind === "bundle" ? `COLLECTION 0${i + 1}` : "YOUR COLLECTION"}
            </span>
            <h2>{b.name}</h2>
            <p>{b.description}</p>
            <div className="bundle-components">
              {b.components.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <a
              className="repo-link"
              href={`https://github.com/${b.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {b.repo}
              <ArrowUpRight size={13} />
            </a>
            <footer>
              <span className="muted">
                {b.agents.map(agentName).join(" · ")}
              </span>
              {b.kind === "bundle" ? (
                <button
                  disabled={!!busy || !b.agents.includes(agent)}
                  onClick={() => void prepare(b)}
                  title={
                    !b.agents.includes(agent)
                      ? "Full bundle is not supported by this agent"
                      : ""
                  }
                >
                  {busy === b.id ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}{" "}
                  {b.agents.includes(agent) ? "Install bundle" : "Unavailable"}
                </button>
              ) : (
                <button
                  disabled={!!busy}
                  onClick={() =>
                    void run(b.id, async () =>
                      setRemote(
                        await api(
                          "catalog.browse",
                          { repo: b.repo },
                          z.array(
                            z.object({
                              name: z.string(),
                              path: z.string(),
                              repo: z.string(),
                            }),
                          ),
                        ),
                      ),
                    )
                  }
                >
                  <FolderOpen size={14} /> Browse skills
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
      <form
        className="add-collection"
        onSubmit={(e) => {
          e.preventDefault();
          void run("add", async () => {
            setBundles(
              await api("catalog.add", { repo }, z.array(bundleSchema)),
            );
            setRepo("");
          });
        }}
      >
        <div>
          <h3>Bring your own collection</h3>
          <p>Add a GitHub repository containing SKILL.md packages.</p>
        </div>
        <input
          aria-label="GitHub repository"
          placeholder="owner / repository"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
        />
        <button disabled={!!busy}>
          <Plus size={15} /> Add collection
        </button>
      </form>
      {remote.length ? (
        <section className="panel">
          <div className="panel-heading">
            <h3>
              Collection skills <span>{remote.length}</span>
            </h3>
            <button
              className="icon-button"
              aria-label="Close collection"
              onClick={() => setRemote([])}
            >
              <X size={16} />
            </button>
          </div>
          <div className="remote-list">
            {remote.map((r, i) => (
              <div key={`${r.repo}/${r.path}`}>
                <div>
                  <strong>{r.name}</strong>
                  <p className="mono muted">{r.path || "Repository root"}</p>
                </div>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    void run(`remote-${i}`, async () =>
                      setPreview(
                        await api(
                          "install.preview",
                          { ...r, kind: "skill", agent },
                          previewSchema,
                        ),
                      ),
                    )
                  }
                >
                  <Download size={14} /> Install
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {jobs.length ? (
        <section className="panel">
          <div className="panel-heading">
            <h3>Installation history</h3>
            <span className="muted">Recorded locally</span>
          </div>
          {jobs.map((j) => (
            <div className="job" key={j.id}>
              <span
                className={`status ${j.status === "complete" ? "on" : "off"}`}
              >
                {j.status === "complete" ? <Check size={12} /> : null}
                {j.status}
              </span>
              <div>
                <strong>{j.repo}</strong>
                <p>{j.message}</p>
              </div>
              <span className="mono muted">{j.revision.slice(0, 8)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {preview ? (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Review installation"
          >
            <header>
              <div className="file-icon">
                <Package size={22} />
              </div>
              <button
                className="icon-button"
                disabled={!!busy}
                aria-label="Close installation preview"
                onClick={() => setPreview(undefined)}
              >
                <X size={18} />
              </button>
            </header>
            <h2>Ready to install?</h2>
            <p>{preview.message}</p>
            <dl>
              <dt>Repository</dt>
              <dd>{preview.plan.repo}</dd>
              <dt>Agent</dt>
              <dd>{agentName(preview.plan.agent)}</dd>
              <dt>License</dt>
              <dd>{preview.plan.license}</dd>
              <dt>Revision</dt>
              <dd className="mono">
                <GitBranch size={12} /> {preview.plan.revision.slice(0, 12)}
              </dd>
              <dt>Destination</dt>
              <dd className="mono">{shortPath(preview.plan.destination)}</dd>
            </dl>
            <footer>
              <button disabled={!!busy} onClick={() => setPreview(undefined)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void run("install", async () => {
                    const job = await api(
                      "install",
                      { previewId: preview.id },
                      jobSchema,
                    );
                    setPreview(undefined);
                    reload();
                    onInstalled();
                    if (job.status !== "complete") setError(job.message);
                  })
                }
              >
                {busy === "install" ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Download size={15} />
                )}{" "}
                {busy === "install" ? "Installing…" : "Install now"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
