import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "skill-manager-bundles-"));
await mkdir(join(root, "home/.claude"), { recursive: true });
await mkdir(join(root, "home/.codex"), { recursive: true });
const child = spawn(resolve("src-tauri/target/debug/server"), [], {
  env: {
    ...process.env,
    SKILL_MANAGER_HOME: join(root, "home"),
    SKILL_MANAGER_DATA: join(root, "data"),
    SKILL_MANAGER_PORT: "4319",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
async function call(action, data = {}) {
  const response = await fetch(`http://127.0.0.1:4319/api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Skill-Manager": "local" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}
try {
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch("http://127.0.0.1:4319/api/health");
      break;
    } catch (error) {
      if (attempt > 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  for (const bundle of await call("catalog")) {
    for (const agent of bundle.agents) {
      const preview = await call("install.preview", { ...bundle, agent });
      const result = await call("install", { previewId: preview.id });
      assert.equal(result.status, "complete", JSON.stringify(result));
      console.log(`${bundle.name} / ${agent}: ${result.message}`);
    }
  }
  assert.ok((await call("inventory")).length > 0);
  console.log("All supported bundled installations passed in isolated homes.");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(root, { recursive: true, force: true });
}
