# Run the local workbench

The workbench is a browser interface for local Claude Code, Codex, and shared agent skills. It extends the MIT-licensed [upstream Skill Manager](https://github.com/abubakarsiddik31/skill-manager). Both browser and Tauri clients call the same Rust workbench service.

## Start the app

Install Node.js 22 or later, Rust, and the platform prerequisites for Tauri. Then run:

```sh
npm install
npm run dev
```

Open http://localhost:1420. Vite forwards API requests to the loopback service on port 4317. The first Rust build compiles the desktop dependencies and can take several minutes.

To run the production build:

```sh
npm run build
npm start
```

Open http://127.0.0.1:4317. To use the desktop client, run `npm run tauri dev`.

## Manage skills

1. Open **Skills** to search, filter, and sort your local inventory.
2. Select a skill to inspect its source, description, supporting files, and token estimates.
3. Use the switch to change its enabled state. A plugin switch affects the whole plugin. Codex changes require a new session or restart.
4. Use **Source** to edit a writable skill. Click **Save** to validate and save it.
5. Open **History** to review and restore a previous saved version.

Codex standalone switches update `skills.config` in its TOML configuration. Codex plugin switches update `plugins.<id>.enabled`. Claude standalone switches move the directory or symlink into the sibling `skills-disabled` directory, outside discovery roots. Claude plugin switches call its native CLI. Shared skill files stay in place when changing Codex preferences.

Managed plugin files and cloud-synced files are read-only. Click **Local copy** to create an editable standalone package. Editing a shared file affects every agent that reads that file.

## Install a bundle or collection skill

Open **Bundles**, choose an agent, and click **Install bundle**. Review the repository, license, pinned revision, and destination before installation. The manager clones the source at that revision and uses the agent's native plugin installer. Git, Claude Code, or Codex must be available on your PATH.

SuperClaude supports Claude Code. Ponytail and Caveman support Claude Code and Codex through their provider manifests. The manager does not install the separate Caveman proxy or unrelated products from that repository.

To browse another collection, enter its GitHub `owner/repository`. Portable skill installation accepts MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, and Unlicense repository licenses. Supporting files and root license notices are included. Review any per-file license restrictions in the source repository.

Installing a portable skill again updates it only if its files match the last manager installation. Local edits stop the update. Previous directories remain in the agent directory's `.skill-manager-backups` folder. Installation history records failures and interrupted operations; retry the installation after checking its reported state. Native plugin source checkouts remain under the manager's data directory, separated by resolved revision. SuperClaude's directory-style agent declaration is converted to explicit Markdown paths for compatibility with the native Claude installer; the agents themselves are retained.

## Improve a skill with AI

Click **Improve using AI**, choose a goal and provider, and select any supporting files to include. Save pending edits first. **Copy prompt & open chat** opens the provider's web chat and prepares the prompt. If clipboard access fails, copy the displayed prompt manually.

Choose a model and submit the prompt in that chat. Paste or import the returned Markdown into the manager. Review **Changes**, then click **Save**. Use **Export** to download the current Markdown for a cloud upload. The manager does not scrape conversations or apply AI-generated edits automatically. It does not install or toggle skills inside your ChatGPT or Claude web account.

## Read files and plans

Open **Files & Plans** and expand a directory. Source files have syntax highlighting. Markdown supports tables, checklists, code blocks, and Mermaid diagrams. Claude plans are under `~/.claude/plans`.

Register additional project directories in **Settings**. Credential paths and JSON files with recognized credential fields are protected. The editor accepts UTF-8 files up to 1 MB. Rendering a document never executes its code blocks.

## Interpret the metrics

Token counts estimate Unicode characters divided by four. Discovery-list estimates cover name, description, and path. Body estimates cover `SKILL.md`; supporting-file estimates are separate and cover UTF-8 files up to 1 MB within four directory levels. These are not provider billing counts or measurements of the active context window.

Click **Index local activity** to read Claude Code and Codex JSONL records. The index distinguishes explicit skill invocations, exact file-read requests, and explicit user mentions. It does not infer implicit skill loading, shell reads, task success, or a skill's share of session tokens. Ambiguous duplicate skill names remain unattributed. An unobserved skill displays **Unknown**.

Each pass considers the 500 newest log files, with a 256 MB read budget. The coverage panel reports skipped files and malformed records. Re-indexing deduplicates events. Personal ratings are independent of activity counts.

## Verify changes

```sh
npm run verify
node scripts/verify-native.mjs
node scripts/verify-bundles.mjs
```

`verify` runs type checking, unit tests, Rust checks and tests, the production build, and Playwright browser tests. Install Playwright's Chromium browser with `npx playwright install chromium` if needed. Browser tests and native installer tests use temporary agent configuration directories. They do not modify personal skills. `verify-bundles` additionally downloads the three real catalog bundles and verifies every supported Claude/Codex combination; it requires network access and both native CLIs.

The local service accepts these overrides for isolated verification:

| Variable | Default |
| --- | --- |
| `SKILL_MANAGER_HOME` | Your home directory |
| `SKILL_MANAGER_DATA` | `~/.local/share/skill-manager` |
| `SKILL_MANAGER_PORT` | `4317` |

The SQLite database stores preferences, stable installation IDs, revisions, ratings, activity evidence, and installation jobs. Skill files remain in their agent directories. HTTP operations require a local client header, a loopback host, and an allowed origin. Both transports validate filesystem paths before accessing files.
