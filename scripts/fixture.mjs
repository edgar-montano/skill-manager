import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function fixture(root) {
  const files = {
    ".claude/skills/review-flow/SKILL.md":
      "---\nname: review-flow\ndescription: Review changes for correctness and clear intent.\n---\n# Review flow\n\nRead the source before suggesting a change.\n\n## Checklist\n\n- [ ] Check behavior\n- [ ] Explain findings\n\n```typescript\nconst ready = true;\n```\n",
    ".claude/skills/review-flow/references/examples.md":
      "# Examples\n\nReview a small change first.\n",
    ".agents/skills/focused-work/SKILL.md":
      "---\nname: focused-work\ndescription: Keep work focused on the requested outcome.\n---\n# Focused work\n\nComplete the smallest useful change.\n",
    ".claude/plans/launch.md":
      "# Launch plan\n\n## Build\n\n- [x] Inspect requirements\n- [ ] Ship the app\n\n| Step | Status |\n|---|---|\n| Design | Complete |\n\n```mermaid\ngraph LR\n  A[Plan] --> B[Build]\n  B --> C[Verify]\n```\n",
    ".claude/.credentials.json": '{"accessToken":"test-secret-never-render"}',
    ".codex/config.toml": '# preserve this setting\nmodel = "fixture-model"\n',
    ".claude/projects/fixture/session.jsonl":
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-11T12:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Skill",
              input: { skill: "review-flow" },
            },
          ],
        },
      }) + "\n",
  };
  for (const [path, content] of Object.entries(files)) {
    const p = join(root, path);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, content);
  }
  await mkdir(join(root, ".codex/skills"), { recursive: true });
  await mkdir(join(root, ".codex/plugins"), { recursive: true });
  return root;
}
