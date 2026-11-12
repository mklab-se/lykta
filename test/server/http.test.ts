import { afterEach, describe, expect, test } from "bun:test";
import { DemoSource } from "../../src/server/demo-source.ts";
import { demoRoutes, startServer } from "../../src/server/http.ts";
import { Hub } from "../../src/server/hub.ts";

let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});

function boot(opts: { startSource?: boolean } = {}) {
  const hub = new Hub("0.0.1+test");
  const source = new DemoSource({ count: 14, running: 2, seed: 7, tickMs: 60_000 });
  if (opts.startSource !== false) source.start((inputs) => hub.update(inputs));
  const server = startServer({
    port: 0,
    hostname: "127.0.0.1",
    hub,
    source,
    routes: demoRoutes(source),
  });
  stops.push(() => {
    source.stop();
    server.stop(true);
  });
  return { hub, source, base: `http://127.0.0.1:${server.port}` };
}

async function firstEvent(base: string, name: string): Promise<unknown> {
  const res = await fetch(`${base}/events`);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended");
    buf += dec.decode(value);
    for (const block of buf.split("\n\n")) {
      if (block.startsWith(`event: ${name}`)) {
        reader.cancel();
        const data = block.split("\n").find((l) => l.startsWith("data: "));
        return JSON.parse((data ?? "").slice(6));
      }
    }
  }
}

describe("http", () => {
  test("healthz ok", async () => {
    const { base } = boot();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("readyz 503 before first update, 200 after", async () => {
    const { base, hub, source } = boot({ startSource: false });
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    source.start((inputs) => hub.update(inputs));
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  test("events sends snapshot on connect", async () => {
    const { base } = boot();
    const snap = (await firstEvent(base, "snapshot")) as { entries: unknown[]; version: string };
    expect(snap.entries).toHaveLength(14);
    expect(snap.version).toBe("0.0.1+test");
  });

  test("details 404 for unknown key", async () => {
    const { base } = boot();
    expect((await fetch(`${base}/api/entries/nope/details`)).status).toBe(404);
    const ok = await fetch(`${base}/api/entries/e1/details`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { runUrl: string }).runUrl).toContain("/actions/runs/");
  });

  test("root serves html", async () => {
    const { base } = boot();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(`id="root"`);
  });

  test("demo controls change running target", async () => {
    const { base, hub } = boot();
    const res = await fetch(`${base}/api/demo/running/5`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(hub.snapshot().entries.filter((e) => e.state === "running")).toHaveLength(5);
    expect((await fetch(`${base}/api/demo/break`, { method: "POST" })).status).toBe(200);
  });

  test("snapshot keeps completed runs light", () => {
    const { hub } = boot();
    for (const e of hub.snapshot().entries) expect(e.latestCompleted?.jobs ?? []).toEqual([]);
  });

  test("details for a specific run", async () => {
    const { base, hub } = boot();
    const e = hub.snapshot().entries.find((x) => x.latestCompleted);
    const id = e?.latestCompleted?.id;
    const res = await fetch(`${base}/api/entries/${e?.key}/details?run=${id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runUrl: string }).runUrl).toEndWith(`/actions/runs/${id}`);
    expect((await fetch(`${base}/api/entries/${e?.key}/details?run=1`)).status).toBe(404);
  });
});
