import { spawnSync } from "node:child_process";
const steps = [
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  [
    "cargo",
    ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"],
  ],
  ["cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]],
  [
    "cargo",
    [
      "clippy",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ],
  ],
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["npm", ["run", "build"]],
  [
    "cargo",
    ["build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "server"],
  ],
  ["npm", ["run", "test:browser"]],
  ["node", ["scripts/verify-native.mjs"]],
];
for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
