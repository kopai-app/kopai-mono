---
"@kopai/app": minor
---

Serve the read-only MCP server from `@kopai/mcp` at `/mcp`, backed by the same
SQLite data as the rest of the API. An MCP client on the same machine connects
with one command:

```bash
claude mcp add --transport http local-kopai http://localhost:8000/mcp
```

The endpoint has no authentication, like the rest of the local app. It refuses
any request whose `Host` or browser `Origin` is not a loopback name
(`localhost`, `127.0.0.1`, `[::1]`), whatever `HOST` the server binds to. That
keeps web pages, including DNS-rebinding ones, out of `/mcp`. It covers `/mcp`
only: the REST routes, dashboard and collector do not check `Host` or `Origin`
yet, so a DNS-rebinding page can still read local telemetry through them, and
write telemetry that an agent later reads through `/mcp`.
MCP clients outside a browser send no `Origin` — measured for Claude Code, curl
and Node `fetch` — so they are unaffected.

It is not network access control: with `HOST=0.0.0.0`, as in the Docker image,
a client on the network can send any `Host`, exactly as it can already reach
the REST routes.

The startup banner gains an `MCP` row with the local URL, or says MCP is
unavailable when `HOST` is a specific non-loopback address, where no URL would
work. `/documentation` lists `POST /mcp` with how to connect, and hides the
GET and DELETE routes that exist only to answer 405.
