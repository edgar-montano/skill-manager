import { spawn } from "node:child_process";
const children = [
  spawn(
    "cargo",
    ["run", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "server"],
    { stdio: "inherit" },
  ),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit" }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => close(code ?? 0));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
