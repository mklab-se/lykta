/**
 * Static shell completions, generated from the commander program itself, so new
 * commands and options are picked up without touching this file.
 */
import type { Command } from "commander";

export const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

interface Spec {
  commands: { name: string; description: string; subcommands: string[] }[];
  options: string[];
}

function visible(cmd: Command): Command[] {
  // `_hidden` is commander's internal flag for `.command(name, { hidden: true })`.
  return cmd.commands.filter((c) => !(c as unknown as { _hidden?: boolean })._hidden);
}

function spec(program: Command): Spec {
  return {
    commands: visible(program).map((c) => ({
      name: c.name(),
      description: c.description(),
      subcommands: visible(c).map((s) => s.name()),
    })),
    options: program.options.flatMap((o) => [o.short, o.long].filter((f): f is string => !!f)),
  };
}

function bash(tool: string, s: Spec): string {
  const fn = `_${tool.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const top = [...s.commands.map((c) => c.name), ...s.options, "--help", "--version"].join(" ");
  const cases = s.commands
    .filter((c) => c.subcommands.length > 0)
    .map(
      (c) =>
        `    ${c.name}) COMPREPLY=($(compgen -W "${c.subcommands.join(" ")}" -- "$cur")); return ;;`,
    )
    .join("\n");
  return `# bash completion for ${tool}
${fn}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${top}" -- "$cur"))
    return
  fi
  case "\${COMP_WORDS[1]}" in
${cases}
  esac
}
complete -F ${fn} ${tool}
`;
}

function zsh(tool: string, s: Spec): string {
  const esc = (t: string) => t.replace(/'/g, "'\\''").replace(/:/g, "\\:");
  const cmds = s.commands.map((c) => `    '${c.name}:${esc(c.description)}'`).join("\n");
  const cases = s.commands
    .filter((c) => c.subcommands.length > 0)
    .map(
      (c) =>
        `      ${c.name}) _values 'subcommand' ${c.subcommands.map((n) => `'${n}'`).join(" ")} ;;`,
    )
    .join("\n");
  return `#compdef ${tool}
_${tool.replace(/[^a-zA-Z0-9]/g, "_")}() {
  local -a commands
  commands=(
${cmds}
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    _values 'option' ${[...s.options, "--help", "--version"].map((o) => `'${o}'`).join(" ")}
    return
  fi
  case "$words[2]" in
${cases}
  esac
}
compdef _${tool.replace(/[^a-zA-Z0-9]/g, "_")} ${tool}
`;
}

function fish(tool: string, s: Spec): string {
  const esc = (t: string) => t.replace(/'/g, "\\'");
  const lines = [`# fish completion for ${tool}`, `complete -c ${tool} -f`];
  for (const c of s.commands) {
    lines.push(
      `complete -c ${tool} -n '__fish_use_subcommand' -a '${c.name}' -d '${esc(c.description)}'`,
    );
    if (c.subcommands.length > 0) {
      lines.push(
        `complete -c ${tool} -n '__fish_seen_subcommand_from ${c.name}' -a '${c.subcommands.join(" ")}'`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function generateCompletion(shell: Shell, tool: string, program: Command): string {
  const s = spec(program);
  switch (shell) {
    case "bash":
      return bash(tool, s);
    case "zsh":
      return zsh(tool, s);
    case "fish":
      return fish(tool, s);
  }
}
