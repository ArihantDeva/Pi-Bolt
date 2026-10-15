# Other agents (Model Context Protocol)

`pi-bolt --mcp` runs Pi-Bolt as a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server on stdin and stdout:
another agent, or any MCP client, gives Pi-Bolt a task with a tool call and gets Pi's answer back. It is built in, so there is
nothing to install. The MCP server code loads only when `--mcp` is given; the terminal UI, `-p`, and RPC mode do not load it.

Clients launched from the desktop may not see your shell's `PATH`: give them the full path of the executable (`which pi-bolt`).

## Setting it up

**Claude Code**:

```bash
claude mcp add pi-bolt -- /full/path/to/pi-bolt --mcp
```

**Codex**, in `~/.codex/config.toml`:

```toml
[mcp_servers.pi-bolt]
command = "/full/path/to/pi-bolt"
args = ["--mcp"]
```

**Cursor, VS Code, Claude Desktop and others**: add a stdio server with the command `pi-bolt` and the argument `--mcp`, for
example in Cursor's `mcp.json`:

```json
{
  "mcpServers": {
    "pi-bolt": { "command": "/full/path/to/pi-bolt", "args": ["--mcp"] }
  }
}
```

Other flags work as on the command line, for example `["--mcp", "--model", "anthropic/claude-sonnet-4-5"]` or
`["--mcp", "--no-mcp"]` (no MCP servers of Pi's own).

## Tools

**`prompt`** gives Pi a task and returns its answer: the text of Pi's last message, and the session it ran in.

| Argument | |
|---|---|
| `prompt` | The task or question |
| `cwd` | Absolute path of the directory Pi works in. Default: the server's working directory |
| `sessionId` | Continue this session instead of starting one |
| `model` | Model to use from now on in the session, as `provider/model` |
| `thinking` | Thinking level to use from now on in the session: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

The result has Pi's answer and a `sessionId: <id>` line, and as structured content `sessionId`, `text`, `stopReason`
(`end_turn`, `max_tokens`, `cancelled` or `error`) and `usage` (tokens, and the cost when the model has prices). A failed
model request is a tool error with the provider's message. A prompt that starts with `/` runs an extension command, prompt
template or skill, as `-p` does.

**`list_sessions`** lists the sessions of a directory (`cwd`, default the server's), most recent first, with their id, title
and last activity; `limit` sets how many (default 20, at most 100).

## What the client gets

- **Your Pi setup.** Each session is a Pi session made as the terminal makes one: settings, models and logins (`/login` in
  `pi-bolt`), extensions, skills, prompt templates, context files and `mcp.json` all apply. Pi runs its own tools in `cwd`: it
  reads and edits files there and runs commands.
- **Progress** while Pi works, when the call asks for it (`progressToken`): each tool Pi runs (`Read src/app.ts`, the command it
  runs) and the first line of each of its messages. Clients that reset their timeout on progress wait for long tasks; for others,
  raise the tool timeout (in Claude Code, `MCP_TOOL_TIMEOUT` in milliseconds).
- **Cancellation**: a cancelled call stops the model and any running tool. The session stays usable.
- **Sessions** that last: a session stays open for later calls in the same server process (the eight used most recently; others
  are closed and reopened from their file when needed). Prompts to the same session run one after the other; different sessions
  run at the same time. Sessions are Pi's session files, so a later server process continues them too, and
  `pi-bolt --session <id>` opens one in the terminal.
- **Questions from extensions**: extensions that ask the user (`confirm`, `select`, `input`, `editor`) reach the client as an
  elicitation form, when the client offers forms. Otherwise they get no answer, as with `-p`.

When no model is set up, the call fails with how to set one up: run `pi-bolt` in a terminal and use `/login`, or give the server
a provider's API key in its environment (`env` in the client's server settings).

## Project trust

A project with its own extensions, settings or packages in `.pi/` is trusted as in the other headless modes: by a decision saved
earlier, or by the `defaultProjectTrust` setting. MCP sessions cannot ask, so to trust a project, open it once with `pi-bolt` in a
terminal and trust it there. (`--approve` in the server's arguments trusts every project a call names.)
