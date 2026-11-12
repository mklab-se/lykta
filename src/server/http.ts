/**
 * HTTP server: the web app, the Server-Sent Events stream, details for overlays,
 * and health/readiness probes.
 */
import type { Server } from "bun";
import index from "../web/index.html";
import type { DemoSource } from "./demo-source.ts";
import type { Hub } from "./hub.ts";
import type { Source } from "./source.ts";

export interface ServerOptions {
  port: number;
  hostname?: string;
  hub: Hub;
  source: Source;
  /** Extra routes (demo controls). */
  routes?: Record<
    string,
    (req: Request & { params: Record<string, string> }) => Response | Promise<Response>
  >;
}

const PING_MS = 15_000;

/** A client that has stopped reading: more than this many bytes queued and it is dropped. */
const MAX_QUEUED_BYTES = 2_000_000;

function events(hub: Hub): Response {
  let cleanup = () => {};
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let unsubscribe = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        cleanup = () => {
          unsubscribe();
          if (ping) clearInterval(ping);
          ping = undefined;
        };
        const send = (event: string, json: string) => {
          if ((controller.desiredSize ?? 0) < -MAX_QUEUED_BYTES) {
            cleanup();
            try {
              controller.close();
            } catch {}
            return;
          }
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${json}\n\n`));
          } catch {
            cleanup();
          }
        };
        send("snapshot", hub.serialized());
        unsubscribe = hub.subscribe((json) => send("snapshot", json));
        ping = setInterval(
          () => send("ping", JSON.stringify({ at: new Date().toISOString() })),
          PING_MS,
        );
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: MAX_QUEUED_BYTES, size: (chunk) => chunk.byteLength },
  );
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

export function startServer(opts: ServerOptions): Server<undefined> {
  const { hub, source } = opts;
  return Bun.serve({
    port: opts.port,
    hostname: opts.hostname ?? "0.0.0.0",
    // SSE connections stay open; pings every 15 s keep them inside this timeout.
    idleTimeout: 60,
    routes: {
      "/": index,
      "/events": () => events(hub),
      "/healthz": () => new Response("ok"),
      "/readyz": () =>
        hub.ready ? new Response("ready") : new Response("not ready", { status: 503 }),
      "/api/entries/:key/details": async (req) => {
        const run = new URL(req.url).searchParams.get("run");
        const runId = run === null ? undefined : Number.parseInt(run, 10);
        if (runId !== undefined && !Number.isFinite(runId))
          return new Response("bad request", { status: 400 });
        const details = await source.details(req.params.key, runId);
        return details ? Response.json(details) : new Response("not found", { status: 404 });
      },
      ...(opts.routes ?? {}),
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
}

/** Controls for demo mode only: change how many workflows run, or break one. */
export function demoRoutes(source: DemoSource): NonNullable<ServerOptions["routes"]> {
  return {
    "/api/demo/running/:n": (req) => {
      const n = Number.parseInt(req.params.n ?? "", 10);
      if (req.method !== "POST" || !Number.isFinite(n) || n < 0 || n > 50) {
        return new Response("bad request", { status: 400 });
      }
      source.setRunning(n);
      return new Response("ok");
    },
    "/api/demo/break": (req) => {
      if (req.method !== "POST") return new Response("bad request", { status: 400 });
      source.breakOne();
      return new Response("ok");
    },
  };
}
