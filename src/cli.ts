#!/usr/bin/env bun
/**
 * lykta command-line entry point.
 *
 * `buildProgram()` defines the CLI (commander); `main()` runs it, wires the global
 * flags and the background update check. Add commands under `src/commands/` and
 * register them in `buildProgram()`.
 */
import { Argument, Command } from "commander";
import { printBannerWithVersion } from "./banner.ts";
import { dim, setColorEnabled, yellow } from "./color.ts";
import { generateCompletion, SHELLS, type Shell } from "./commands/completion.ts";
import { runDemo } from "./commands/demo.ts";
import { DESCRIPTION, NO_UPDATE_CHECK_ENV, PACKAGE_NAME, TOOL, VERSION } from "./meta.ts";
import { checkForUpdate } from "./update.ts";

export interface GlobalOptions {
  verbose: number;
  quiet: boolean;
  color: boolean;
}

export function buildProgram(): Command {
  const program = new Command(TOOL)
    .description(DESCRIPTION)
    .version(VERSION, "-V, --version", "print the version")
    .option(
      "-v, --verbose",
      "increase output verbosity (repeatable)",
      (_: string, prev: number) => prev + 1,
      0,
    )
    .option("-q, --quiet", "suppress non-essential output")
    .option("--no-color", "disable colored output")
    .addHelpText(
      "after",
      `
Lykta (Swedish for "lantern") shows at a glance which GitHub Actions workflows are running, which have failed and which are green. Try it with "lykta demo"; connecting to GitHub comes next.`,
    )
    .hook("preAction", (cmd) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      if (!opts.color) setColorEnabled(false);
    })
    // No command: the dashboard will start here. Until it exists, show the
    // banner and a short note. `--help` still works.
    .action(() => {
      printBannerWithVersion();
      console.log("Run `lykta demo` to see the dashboard with simulated workflows.");
    });

  program
    .command("version")
    .description("show the banner and version")
    .action(() => printBannerWithVersion());

  program
    .command("demo")
    .description("serve the dashboard with simulated workflows")
    .option("-p, --port <port>", "port to listen on", (v) => Number.parseInt(v, 10), 8080)
    .option("--host <host>", "address to listen on", "0.0.0.0")
    .option("--count <n>", "number of monitored workflows", (v) => Number.parseInt(v, 10), 14)
    .option("--running <n>", "workflows running at once", (v) => Number.parseInt(v, 10), 2)
    .option("--low-power", "force low-power mode (fewer effects)", false)
    .action(
      (o: { port: number; host: string; count: number; running: number; lowPower: boolean }) =>
        runDemo(o),
    );

  program
    .command("completion")
    .description("generate a shell completion script")
    .addArgument(new Argument("<shell>", "target shell").choices(SHELLS))
    .action((shell: Shell) => {
      process.stdout.write(generateCompletion(shell, TOOL, program));
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  const args = argv.slice(2);
  const quiet = args.includes("-q") || args.includes("--quiet");
  const wantsUpdateCheck =
    !quiet && !process.env[NO_UPDATE_CHECK_ENV] && !args.includes("completion");
  const update = wantsUpdateCheck
    ? checkForUpdate({ packageName: PACKAGE_NAME, currentVersion: VERSION })
    : Promise.resolve(null);

  await program.parseAsync(argv);

  // Give a slow network at most a moment; never delay the user for long.
  const newer = await Promise.race([update, Bun.sleep(1500).then(() => null)]);
  if (newer) {
    console.error(
      `\n${yellow(`A new version of ${TOOL} is available: ${VERSION} -> ${newer}`)}\n${dim(
        `Upgrade with: brew upgrade ${TOOL}  (or: bun add -g ${PACKAGE_NAME})`,
      )}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
