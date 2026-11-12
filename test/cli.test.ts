import { describe, expect, test } from "bun:test";
import { buildProgram } from "../src/cli.ts";
import { generateCompletion } from "../src/commands/completion.ts";
import { TOOL, VERSION } from "../src/meta.ts";

const env = { ...process.env, LYKTA_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("cli", () => {
  test("no command shows the banner and the coming-soon note", async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`v${VERSION}`);
    expect(r.stdout).toContain("The workflow dashboard is coming soon.");
  });

  test("--version prints the package version", async () => {
    expect((await run("--version")).stdout.trim()).toBe(VERSION);
  });

  test("version shows the banner and version", async () => {
    const r = await run("version");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`v${VERSION}`);
  });

  test("an unknown shell is rejected", async () => {
    const r = await run("completion", "nope");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Allowed choices are bash, zsh, fish");
  });
});

describe("completion", () => {
  test("every shell script names the tool and its commands", () => {
    const program = buildProgram();
    for (const shell of ["bash", "zsh", "fish"] as const) {
      const script = generateCompletion(shell, TOOL, program);
      expect(script).toContain(TOOL);
      expect(script).toContain("version");
      expect(script).toContain("completion");
    }
  });
});
