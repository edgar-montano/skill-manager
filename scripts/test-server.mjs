import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fixture } from "./fixture.mjs";
const root = await mkdtemp(join(tmpdir(), "skill-manager-browser-"));
await fixture(join(root, "home"));
const child = spawn(resolve("src-tauri/target/debug/server"), [], {
  stdio: "inherit",
  env: {
    ...process.env,
    SKILL_MANAGER_HOME: join(root, "home"),
    SKILL_MANAGER_DATA: join(root, "data"),
    SKILL_MANAGER_PORT: "4318",
  },
});
async function close() {
  child.kill("SIGTERM");
  await rm(root, { recursive: true, force: true });
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
