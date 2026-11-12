/**
 * The job graph shown for a running workflow (spec section 3.3): columns by dependency depth,
 * big matrices folded into group nodes, and long pipelines collapsed around the active part.
 */
import type { JobRecord } from "./types.ts";

export type NodeKind = "job" | "group" | "done" | "later";
export type NodeStatus = "queued" | "running" | "success" | "failure" | "skipped";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  jobs: JobRecord[];
}

export interface GraphModel {
  columns: GraphNode[][];
  edges: [from: string, to: string][];
}

const GROUP_MIN = 4;

/** Dependency depth per job id. Unknown needs are ignored; cycles do not recurse forever. */
export function jobDepths(jobs: JobRecord[]): Map<string, number> {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  const visit = (j: JobRecord): number => {
    const known = depth.get(j.id);
    if (known !== undefined) return known;
    if (onPath.has(j.id)) return 0;
    onPath.add(j.id);
    let d = 0;
    for (const n of j.needs) {
      const dep = byId.get(n);
      if (dep && !onPath.has(dep.id)) d = Math.max(d, visit(dep) + 1);
    }
    onPath.delete(j.id);
    depth.set(j.id, d);
    return d;
  };
  for (const j of jobs) visit(j);
  return depth;
}

function statusOf(jobs: JobRecord[]): NodeStatus {
  const has = (s: JobRecord["status"]) => jobs.some((j) => j.status === s);
  const all = (s: JobRecord["status"]) => jobs.every((j) => j.status === s);
  if (has("failure")) return "failure";
  if (all("success")) return "success";
  if (all("skipped") || all("cancelled")) return "skipped";
  if (has("running") || has("success")) return "running";
  return "queued";
}

function columnNodes(column: JobRecord[]): GraphNode[] {
  const groups = new Map<string, JobRecord[]>();
  for (const j of column) if (j.group) groups.set(j.group, [...(groups.get(j.group) ?? []), j]);
  const nodes: GraphNode[] = [];
  const folded = new Set<string>();
  for (const j of column) {
    const g = j.group ? groups.get(j.group) : undefined;
    if (g && g.length >= GROUP_MIN && j.group) {
      if (folded.has(j.group)) continue;
      folded.add(j.group);
      nodes.push({
        id: `g-${j.group}`,
        kind: "group",
        label: `${j.group} ×${g.length}`,
        status: statusOf(g),
        jobs: g,
      });
    } else {
      nodes.push({ id: j.id, kind: "job", label: j.name, status: statusOf([j]), jobs: [j] });
    }
  }
  return nodes;
}

export function buildGraph(jobs: JobRecord[], maxColumns: number): GraphModel {
  const depths = jobDepths(jobs);
  const raw: JobRecord[][] = [];
  for (const j of jobs) {
    const d = depths.get(j.id) ?? 0;
    raw[d] = [...(raw[d] ?? []), j];
  }
  const all = raw.filter(Boolean).map(columnNodes);

  let first = 0;
  let last = all.length - 1;
  if (all.length > maxColumns) {
    let active = all.findIndex((c) => c.some((n) => n.status !== "success"));
    if (active < 0) active = all.length - 1;
    first = Math.max(0, active - 1);
    let slots = maxColumns - (first > 0 ? 1 : 0);
    if (all.length - first > slots) slots -= 1;
    slots = Math.max(1, slots);
    if (first + slots > all.length) first = Math.max(0, all.length - slots);
    last = first + slots - 1;
  }

  const columns: GraphNode[][] = [];
  const flat = (cols: GraphNode[][]) => cols.flat().flatMap((n) => n.jobs);
  if (first > 0) {
    const done = flat(all.slice(0, first));
    columns.push([
      {
        id: "done",
        kind: "done",
        label: `${done.length} jobs done`,
        status: statusOf(done),
        jobs: done,
      },
    ]);
  }
  columns.push(...all.slice(first, last + 1));
  if (last < all.length - 1) {
    const later = flat(all.slice(last + 1));
    columns.push([
      { id: "later", kind: "later", label: `+${later.length} jobs`, status: "queued", jobs: later },
    ]);
  }

  const nodeOf = new Map<string, string>();
  for (const n of columns.flat()) for (const j of n.jobs) nodeOf.set(j.id, n.id);
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  for (const j of jobs) {
    const to = nodeOf.get(j.id);
    for (const need of j.needs) {
      const from = nodeOf.get(need);
      if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      edges.push([from, to]);
    }
  }
  return { columns, edges };
}
