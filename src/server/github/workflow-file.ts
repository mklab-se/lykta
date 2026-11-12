/**
 * The job graph comes from the workflow file at the run's commit: GitHub's jobs API has no
 * `needs`. API jobs are matched to their definitions by display name, following GitHub's
 * naming (verified on real runs):
 *   - plain jobs: their `name`, or the job id
 *   - matrix jobs with a `name` template: the template filled in ("Build ${{ matrix.target }}")
 *   - matrix jobs without one: "<name> (<values>)"
 *   - reusable workflow jobs: "<caller name> / <callee job name>"
 * Anything that cannot be matched keeps an empty `needs` (a flat list). Never throws.
 */
import type { JobRecord } from "../../core/types.ts";

export interface JobDef {
  id: string;
  name?: string;
  needs: string[];
  matrix: boolean;
  uses?: string;
}

export interface WorkflowDef {
  jobs: JobDef[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseWorkflow(yamlText: string): WorkflowDef | null {
  try {
    const raw = Bun.YAML.parse(yamlText);
    if (!isObj(raw) || !isObj(raw.jobs)) return null;
    const jobs: JobDef[] = [];
    for (const [id, j] of Object.entries(raw.jobs)) {
      if (!isObj(j)) continue;
      const needs =
        typeof j.needs === "string"
          ? [j.needs]
          : Array.isArray(j.needs)
            ? j.needs.filter((n): n is string => typeof n === "string")
            : [];
      jobs.push({
        id,
        name: typeof j.name === "string" ? j.name : undefined,
        needs,
        matrix: isObj(j.strategy) && j.strategy.matrix !== undefined,
        uses: typeof j.uses === "string" ? j.uses : undefined,
      });
    }
    return { jobs };
  } catch {
    return null;
  }
}

const EXPR = /\$\{\{[^}]*\}\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const display = (d: JobDef) => d.name ?? d.id;

/** Does an API job name belong to this definition? */
function nameMatches(def: JobDef, apiName: string): boolean {
  const shown = display(def);
  if (shown.includes("${{")) {
    const pattern = shown.split(EXPR).map(escapeRe).join(".+");
    return new RegExp(`^${pattern}$`).test(apiName);
  }
  if (apiName === shown) return true;
  return def.matrix && apiName.startsWith(`${shown} (`) && apiName.endsWith(")");
}

/** "Build ${{ matrix.target }}" / "Build (${{ … }})" -> "Build". */
export function groupName(def: JobDef): string {
  return display(def)
    .replace(EXPR, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s\-:/,]+$/, "")
    .trim();
}

/**
 * GitHub creates a job only when it is about to run, so early in a run the API knows only
 * the first jobs. Every definition with no job yet becomes a waiting node, so the whole
 * pipeline is visible from the start.
 */
function placeholders(
  caller: WorkflowDef,
  called: Record<string, WorkflowDef | null>,
  matches: Map<string, Match>,
): JobRecord[] {
  const paths = [...matches.values()].map((m) => m.path);
  const covered = (path: string) => paths.some((p) => p === path || p.startsWith(`${path}/`));
  const out: JobRecord[] = [];
  const add = (path: string, name: string, m: Match) => {
    const id = `wf:${path}`;
    matches.set(id, m);
    out.push({
      id,
      name,
      status: "queued",
      needs: [],
      group: m.group,
      steps: [],
      startedAt: null,
      completedAt: null,
    });
  };
  for (const top of caller.jobs) {
    if (covered(top.id)) continue;
    const inner = top.uses ? called[top.uses] : undefined;
    if (top.uses && inner) {
      for (const callee of inner.jobs) {
        if (callee.uses) continue;
        const name = `${display(top)} / ${callee.matrix ? groupName(callee) : display(callee)}`;
        add(`${top.id}/${callee.id}`, name, {
          path: `${top.id}/${callee.id}`,
          group: display(top),
          top,
          callee,
        });
      }
    } else {
      const name = top.matrix ? groupName(top) : display(top);
      add(top.id, name, { path: top.id, group: top.matrix ? name : undefined, top });
    }
  }
  return out;
}

interface Match {
  path: string; // "build", or "ci/lint" for a reusable workflow's job
  group?: string;
  top: JobDef; // the definition in the caller workflow
  callee?: JobDef;
}

function matchJob(
  apiName: string,
  caller: WorkflowDef,
  called: Record<string, WorkflowDef | null>,
): Match | null {
  for (const def of caller.jobs) {
    if (def.uses) {
      // a call that never ran (skipped) appears under the caller's name alone
      if (apiName === display(def)) return { path: def.id, top: def };
      const prefix = `${display(def)} / `;
      if (!apiName.startsWith(prefix)) continue;
      const inner = called[def.uses];
      const rest = apiName.slice(prefix.length);
      const callee = inner?.jobs.find((d) => !d.uses && nameMatches(d, rest));
      return {
        path: callee ? `${def.id}/${callee.id}` : `${def.id}/?`,
        group: display(def),
        top: def,
        callee,
      };
    }
    if (nameMatches(def, apiName))
      return { path: def.id, group: def.matrix ? groupName(def) : undefined, top: def };
  }
  return null;
}

export function attachGraph(
  jobs: JobRecord[],
  caller: WorkflowDef | null,
  called: Record<string, WorkflowDef | null>,
  opts: { finished?: boolean } = {},
): JobRecord[] {
  if (!caller) return jobs.map((j) => ({ ...j, needs: [] }));
  try {
    const matches = new Map<string, Match>();
    for (const j of jobs) {
      const m = matchJob(j.name, caller, called);
      if (m) matches.set(j.id, m);
    }
    // in a finished run, jobs GitHub never created did not run (skipped), they do not wait
    const extra = placeholders(caller, called, matches).map((j) =>
      opts.finished ? { ...j, status: "skipped" as const } : j,
    );
    jobs = [...jobs, ...extra];
    // all API job ids under a definition path ("ci" covers every "ci/…" job)
    const under = (path: string) =>
      jobs
        .filter((j) => {
          const p = matches.get(j.id)?.path;
          return p === path || (p?.startsWith(`${path}/`) ?? false);
        })
        .map((j) => j.id);
    return jobs.map((j) => {
      const m = matches.get(j.id);
      if (!m) return { ...j, needs: [] };
      const fromTop = m.top.needs.flatMap(under);
      const inner = m.callee ? m.callee.needs.flatMap((n) => under(`${m.top.id}/${n}`)) : [];
      const needs = [...new Set([...fromTop, ...inner])].filter((id) => id !== j.id);
      return { ...j, needs, group: m.group ?? j.group };
    });
  } catch {
    return jobs.map((j) => ({ ...j, needs: [] }));
  }
}
