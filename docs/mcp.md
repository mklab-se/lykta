# Ask Lykta from an AI harness (MCP)

Lykta can answer the questions people ask when they look at the wall, for an AI assistant:
*what is broken, since when, where did it fail, and what did the error say?* It speaks the
[Model Context Protocol](https://modelcontextprotocol.io), so Claude Code, Claude Desktop, Cursor
and other MCP clients can connect to it.

It is **read-only** (nothing can be re-run or changed through it) and **off unless enabled**,
because the wall itself has no sign-in: anyone who can reach Lykta can use it.

## Turn it on

```yaml
# lykta.yaml
mcp:
  enabled: true
```

or `LYKTA_MCP=on` in the environment (`mcp.enabled: true` in the Helm chart). The endpoint is
`http://<lykta>/mcp` (Streamable HTTP). `lykta demo` always has it on, to try it out:

```sh
docker run --rm -p 8080:8080 ghcr.io/mklab-se/lykta demo
```

## Connect

Claude Code:

```sh
claude mcp add --transport http lykta http://lykta.internal:8080/mcp
```

Other clients take the same URL as a "Streamable HTTP" or "HTTP" server.

## What it can answer

| Tool | Answers |
| --- | --- |
| `list_failures` | What is in the pit: failing or missing workflows, since when, the failed job and step, the error lines |
| `list_workflows` | Every workflow on the wall in wall order: state, labels, running or latest run, recent results |
| `list_labels` | The labels teams gave their workflows, with how many each has |
| `get_workflow` | One workflow by name: its jobs, its run, and where and why it fails |

`list_workflows` and `list_failures` take a `label`, so a team asks only about its own
workflows: *"What is failing for #mobile?"*

## Build output is data, not instructions

Error lines and log excerpts are written by whoever can push code, and could contain text aimed
at an AI ("ignore your instructions and ..."). Lykta hands them over in a field named
`untrustedBuildOutput`, and every tool description tells the assistant to treat them as data to
report, never as instructions.
