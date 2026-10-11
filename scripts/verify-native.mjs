import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = await mkdtemp(join(tmpdir(), "skill-manager-native-"));
const marketplace = join(root, "marketplace");
const plugin = join(marketplace, "plugin");
async function write(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
await write(join(plugin, ".claude-plugin/plugin.json"), {
  name: "workbench-fixture",
  description: "Disposable verification plugin",
  version: "1.0.0",
});
await write(join(plugin, ".codex-plugin/plugin.json"), {
  name: "workbench-fixture",
  description: "Disposable verification plugin",
  version: "1.0.0",
  skills: "./skills",
});
await write(
  join(plugin, "skills/fixture/SKILL.md"),
  "---\nname: workbench-fixture\ndescription: A disposable test skill.\n---\n# Fixture\nNo external actions.\n",
);
await write(join(marketplace, ".claude-plugin/marketplace.json"), {
  name: "workbench-test",
  owner: { name: "Skill Manager" },
  plugins: [{ name: "workbench-fixture", source: "./plugin" }],
});
await write(join(marketplace, ".agents/plugins/marketplace.json"), {
  name: "workbench-test",
  plugins: [
    {
      name: "workbench-fixture",
      source: { source: "local", path: "./plugin" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    },
  ],
});
const env = {
  ...process.env,
  CLAUDE_CONFIG_DIR: join(root, "claude"),
  CODEX_HOME: join(root, "codex"),
};
await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
await mkdir(env.CODEX_HOME, { recursive: true });
function run(bin, args) {
  const result = spawnSync(bin, args, {
    env,
    encoding: "utf8",
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(
      `${bin} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
  console.log(`${bin} ${args.slice(0, 3).join(" ")}: passed`);
  return result.stdout;
}
try {
  run("claude", ["plugin", "validate", plugin]);
  run("claude", ["plugin", "marketplace", "add", marketplace]);
  run("claude", ["plugin", "install", "workbench-fixture@workbench-test"]);
  run("claude", ["plugin", "disable", "workbench-fixture@workbench-test"]);
  run("claude", ["plugin", "enable", "workbench-fixture@workbench-test"]);
  run("codex", ["plugin", "marketplace", "add", marketplace]);
  run("codex", ["plugin", "add", "workbench-fixture@workbench-test"]);
  console.log(
    "Both native installers verified in isolated configuration directories.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
