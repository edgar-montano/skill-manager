import { z } from "zod";
import { isTauri, invoke } from "@tauri-apps/api/core";

export const skillSchema = z.object({
  id: z.string(),
  path: z.string(),
  logicalPath: z.string(),
  name: z.string(),
  description: z.string(),
  agent: z.string(),
  consumers: z.array(z.string()),
  scope: z.string(),
  enabled: z.boolean(),
  readonly: z.boolean(),
  canToggle: z.boolean(),
  plugin: z.string().nullable(),
  tokens: z.number(),
  discoveryTokens: z.number(),
  supportTokens: z.number(),
  rating: z.number(),
  revision: z.string(),
  stats: z.array(
    z.object({
      kind: z.string(),
      count: z.number(),
      last: z.string(),
      sessions: z.number(),
    }),
  ),
  provenance: z.unknown(),
});
export type Skill = z.infer<typeof skillSchema>;
export const fileSchema = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string(),
  readonly: z.boolean(),
});
export type SkillFile = z.infer<typeof fileSchema>;
export const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  directory: z.boolean(),
  protected: z.boolean(),
  symlink: z.boolean(),
});
export type Entry = z.infer<typeof entrySchema>;
export const rootSchema = z.object({ name: z.string(), path: z.string() });
export const bundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
  description: z.string(),
  license: z.string(),
  agents: z.array(z.string()),
  components: z.array(z.string()),
  path: z.string(),
  kind: z.string(),
  color: z.string(),
});
export type Bundle = z.infer<typeof bundleSchema>;
export const eventSchema = z.object({
  skill: z.string(),
  kind: z.string(),
  session: z.string(),
  agent: z.string(),
  time: z.string(),
});
export const activitySchema = z.object({
  events: z.array(eventSchema),
  days: z.array(
    z.object({ date: z.string(), kind: z.string(), count: z.number() }),
  ),
  range: z.object({
    first: z.string().nullable(),
    last: z.string().nullable(),
    events: z.number(),
    sessions: z.number(),
  }),
  coverage: z
    .object({
      indexedAt: z.number(),
      files: z.number(),
      totalFiles: z.number(),
      skipped: z.number(),
      malformed: z.number(),
      records: z.number(),
      note: z.string(),
    })
    .nullable(),
});
export type Activity = z.infer<typeof activitySchema>;
export const settingsSchema = z.object({
  projects: z.array(z.string()),
  provider: z.enum(["chatgpt", "claude"]),
  home: z.string(),
  data: z.string(),
});
export const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  repo: z.string(),
  agent: z.string(),
  created: z.number(),
  message: z.string(),
  revision: z.string(),
});
export const okSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  path: z.string().optional(),
});
export async function api<T>(
  action: string,
  input: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  let data: unknown;
  if (isTauri()) data = await invoke("workbench_request", { action, input });
  else {
    const response = await fetch(`/api/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Skill-Manager": "local",
      },
      body: JSON.stringify(input),
    });
    data = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(data);
      throw new Error(
        failure.success
          ? failure.data.error
          : `Request failed (${response.status})`,
      );
    }
  }
  return schema.parse(data);
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
export function count(skill: Skill, kind = "invocation") {
  return skill.stats.find((s) => s.kind === kind)?.count ?? 0;
}
export function agentName(agent: string) {
  return (
    (
      {
        claude: "Claude Code",
        codex: "Codex",
        agents: "Shared",
        cursor: "Cursor",
        opencode: "OpenCode",
        gemini: "Gemini CLI",
      } as Record<string, string>
    )[agent] ?? agent
  );
}
export function compact(n: number) {
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
