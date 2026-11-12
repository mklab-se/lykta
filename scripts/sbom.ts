#!/usr/bin/env bun
/**
 * Writes a CycloneDX 1.5 SBOM (JSON) for one release target to stdout.
 *
 * Lists what is compiled into the `bun build --compile` binary: the Bun runtime
 * that was embedded, and the production dependency closure resolved from
 * bun.lock (dev dependencies are not shipped and are left out).
 *
 *   bun scripts/sbom.ts --target aarch64-apple-darwin > tool-vX.Y.Z-aarch64-apple-darwin.cdx.json
 */
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };

type LockPackage = [string, string, { dependencies?: Record<string, string> }?, string?];

interface Lock {
  workspaces: Record<string, { dependencies?: Record<string, string> }>;
  packages: Record<string, LockPackage>;
}

export interface Component {
  name: string;
  version: string;
  integrity?: string;
}

/** Production dependency closure, sorted by name. */
export function productionClosure(lock: Lock): Component[] {
  const seen = new Map<string, Component>();
  const queue = Object.keys(lock.workspaces[""]?.dependencies ?? {});
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    const entry = lock.packages[name];
    if (!entry) throw new Error(`bun.lock has no entry for ${name}`);
    const [id, , meta, integrity] = entry;
    const version = id.slice(id.lastIndexOf("@") + 1);
    seen.set(name, { name, version, integrity });
    queue.push(...Object.keys(meta?.dependencies ?? {}));
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function purl(name: string, version: string): string {
  return `pkg:npm/${name.replace("@", "%40")}@${version}`;
}

function hash(integrity?: string) {
  const match = integrity?.match(/^sha512-(.+)$/);
  if (!match?.[1]) return undefined;
  return [{ alg: "SHA-512", content: Buffer.from(match[1], "base64").toString("hex") }];
}

export function buildSbom(lock: Lock, target: string, bunVersion: string, timestamp: string) {
  const deps = productionClosure(lock);
  const root = `${purl(pkg.name, pkg.version)}?target=${target}`;
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      tools: { components: [{ type: "application", name: "scripts/sbom.ts" }] },
      component: {
        type: "application",
        "bom-ref": root,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        licenses: [{ license: { id: pkg.license } }],
        purl: root,
        properties: [{ name: "target", value: target }],
      },
    },
    components: [
      {
        type: "platform",
        "bom-ref": `bun@${bunVersion}`,
        name: "bun",
        version: bunVersion,
        description: "Bun runtime embedded by bun build --compile",
        externalReferences: [{ type: "website", url: "https://bun.com" }],
      },
      ...deps.map((d) => ({
        type: "library",
        "bom-ref": purl(d.name, d.version),
        name: d.name,
        version: d.version,
        purl: purl(d.name, d.version),
        hashes: hash(d.integrity),
      })),
    ],
    dependencies: [
      { ref: root, dependsOn: [`bun@${bunVersion}`, ...deps.map((d) => purl(d.name, d.version))] },
    ],
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { target: { type: "string" } } });
  if (!values.target) {
    console.error("usage: bun scripts/sbom.ts --target <target-triple>");
    process.exit(2);
  }
  const lock = Bun.JSONC.parse(await Bun.file("bun.lock").text()) as Lock;
  const sbom = buildSbom(lock, values.target, Bun.version, new Date().toISOString());
  console.log(JSON.stringify(sbom, null, 2));
}
