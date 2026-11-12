/**
 * `lykta demo`: the dashboard driven by simulated workflows.
 */
import { VERSION } from "../meta.ts";
import { DemoSource } from "../server/demo-source.ts";
import { startServer } from "../server/http.ts";
import { Hub } from "../server/hub.ts";

export interface DemoCommandOptions {
  port: number;
  host: string;
  count: number;
  running: number;
  lowPower: boolean;
}

export const buildVersion = () => `${VERSION}+${process.env.LYKTA_BUILD_ID ?? Date.now()}`;

export async function runDemo(opts: DemoCommandOptions): Promise<void> {
  const hub = new Hub(
    buildVersion(),
    { lowPower: opts.lowPower ? "on" : "auto", demo: true },
    "Demo",
  );
  const source = new DemoSource({ count: opts.count, running: opts.running });
  source.start((inputs) => hub.update(inputs));
  const server = startServer({ port: opts.port, hostname: opts.host, hub, source });
  const shown = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  console.log(`Lykta demo running at http://${shown}:${server.port}  (Ctrl+C to stop)`);
  await new Promise(() => {});
}
