import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
test("real inventory, search, toggles and persistent ratings", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your skills, in focus." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search skills" })
    .fill("review-flow");
  await expect(
    page.getByRole("button", { name: "review-flow", exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Disable review-flow" }).click();
  await expect(
    page.getByRole("switch", { name: "Enable review-flow" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enable review-flow" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Enable review-flow" }).click();
  await page.getByRole("button", { name: "Rate review-flow: 0 of 5" }).click();
  await expect(
    page.getByRole("button", { name: "Rate review-flow: 1 of 5" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/library.png", fullPage: true });
});
test("Markdown, AI handoff, returned edit, save and history", async ({
  page,
  context,
}) => {
  await context.route("https://claude.ai/**", (route) =>
    route.fulfill({ body: "Provider chat test destination" }),
  );
  await context.route("https://chatgpt.com/**", (route) =>
    route.fulfill({ body: "Provider chat test destination" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.locator(".skill-name").filter({ hasText: "review-flow" }).click();
  await expect(page.locator(".markdown h1")).toHaveText("Review flow");
  await page.getByRole("button", { name: "Improve using AI" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Copy prompt & open chat" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/claude.ai/);
  await expect(
    page.getByRole("textbox", { name: "Prepared improvement prompt" }),
  ).toHaveValue(/Preserve its intended behavior/);
  await page
    .getByRole("textbox", { name: "Paste revised skill" })
    .fill(
      "---\nname: review-flow\ndescription: Review behavior with specific evidence.\n---\n# Improved review\n\nUse concrete examples.\n",
    );
  await expect(
    page.getByText("Unsaved changes", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Saved. Previous version is available in History."),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review restore" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review restore" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".markdown h1")).toHaveText("Review flow");
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
});
test("file tree renders plans and protects credentials", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Files & Plans", exact: true })
    .click();
  await page
    .locator(".tree-node")
    .filter({ hasText: /^Claude$/ })
    .click();
  await expect(
    page.locator(".tree-node").filter({ hasText: ".credentials.json" }),
  ).toBeDisabled();
  await page
    .locator(".tree-node")
    .filter({ hasText: /^plans$/ })
    .click();
  await page.locator(".tree-node").filter({ hasText: "launch.md" }).click();
  await expect(page.locator(".markdown h1")).toHaveText("Launch plan");
  await expect(page.locator(".markdown table")).toBeVisible();
  await expect(page.locator(".markdown svg")).toBeVisible();
  await expect(page.locator(".markdown svg")).toContainText("Plan");
  await page.screenshot({ path: "test-results/plan.png", fullPage: true });
});
test("activity reports evidence without double counting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page
    .getByRole("button", { name: "Index local activity" })
    .first()
    .click();
  await expect(page.locator(".event-row")).toHaveCount(1);
  await expect(page.locator(".event-row")).toContainText("invocation");
  await page.getByRole("button", { name: "Index local activity" }).click();
  await expect(page.locator(".event-row")).toHaveCount(1);
});
test("bundle compatibility and adding a collection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Bundles", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "SuperClaude", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Install agent").selectOption("codex");
  await expect(
    page
      .locator(".bundle-card")
      .filter({ hasText: "SuperClaude" })
      .getByRole("button", { name: "Unavailable" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "GitHub repository" })
    .fill("vercel-labs/agent-skills");
  await page.getByRole("button", { name: "Add collection" }).click();
  await expect(
    page.getByRole("heading", { name: "agent-skills", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/bundles.png", fullPage: true });
});
test("API rejects cross-origin writes, credential reads and stale revisions", async ({
  request,
}) => {
  const call = (action: string, data: unknown, origin?: string) =>
    request.post(`/api/${action}`, {
      data,
      headers: {
        "X-Skill-Manager": "local",
        ...(origin ? { Origin: origin } : {}),
      },
    });
  const settings = await (await call("settings", {})).json();
  const path = `${settings.home}/.claude/skills/review-flow/SKILL.md`;
  expect(
    (
      await call("read", { path: `${settings.home}/.claude/.credentials.json` })
    ).status(),
  ).toBe(400);
  expect(
    (
      await call(
        "settings.save",
        { provider: "claude" },
        "https://evil.example",
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/settings.save", { data: { provider: "claude" } })
    ).status(),
  ).toBe(403);
  const file = await (await call("read", { path })).json();
  await writeFile(path, file.content + "\nExternal change.\n");
  expect(
    (
      await call("save", {
        path,
        content: file.content,
        revision: file.revision,
      })
    ).status(),
  ).toBe(409);
  expect(await readFile(path, "utf8")).toContain("External change.");
  await writeFile(path, file.content);
});

test("source editor, validation, diff and unsaved-change protection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.locator(".skill-name").filter({ hasText: "review-flow" }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("# Invalid skill without metadata");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("SKILL.md requires YAML frontmatter"),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Skill detail" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Close detail" }).click();
  await expect(page.getByRole("region", { name: "Skill detail" })).toHaveCount(
    0,
  );
});
