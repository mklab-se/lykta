/**
 * Builds the single-file binary and checks it serves the whole dashboard with nothing next
 * to it. Slow, so it only runs with LYKTA_COMPILED_TEST=1 (CI's build job runs it).
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const enabled = process.env.LYKTA_COMPILED_TEST === "1";
let dir = "";
let proc: ReturnType<typeof Bun.spawn> | undefined;

afterAll(async () => {
  proc?.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test.if(enabled)(
  "compiled binary serves the dashboard",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "lykta-bin-"));
    const out = join(dir, "lykta");
    const build = Bun.spawnSync([
      "bun",
      "build",
      "src/cli.ts",
      "--compile",
      "--minify",
      "--outfile",
      out,
    ]);
    expect(build.exitCode).toBe(0);
    const port = 18_000 + Math.floor(Math.random() * 1000);
    // run from an empty directory so nothing can be read from the source tree
    proc = Bun.spawn([out, "demo", "--port", String(port), "--host", "127.0.0.1"], {
      cwd: dir,
      env: { ...process.env, LYKTA_NO_UPDATE_CHECK: "1" },
      stdout: "pipe",
    });
    const base = `http://127.0.0.1:${port}`;
    let html = "";
    for (let i = 0; i < 50 && !html; i++) {
      await Bun.sleep(100);
      html = await fetch(`${base}/`).then(
        (r) => (r.ok ? r.text() : ""),
        () => "",
      );
    }
    expect(html).toContain(`id="root"`);
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1] as string);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) expect((await fetch(`${base}${a}`)).status).toBe(200);
    const css = assets.find((a) => a.endsWith(".css"));
    expect(css).toBeDefined();
    const text = await (await fetch(`${base}${css}`)).text();
    // fonts are bundled (inlined or served by the binary), never fetched from the internet
    expect(text).toContain("woff2");
    expect(text).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    // only the Latin subsets: light enough for a Raspberry Pi to load
    expect(text.length).toBeLessThan(200_000);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  },
  60_000,
);
