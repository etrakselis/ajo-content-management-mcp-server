# AJO Content MCP Server

A production-grade **Model Context Protocol (MCP) server** that exposes Adobe Journey Optimizer Content Management APIs to LLM-powered clients. AI agents can create, retrieve, update, delete,   content templates and create, retrieve, update, delete and publish content fragments directly through natural language.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Example Prompts](#example-prompts)
4. [Prerequisites](#prerequisites)
5. [Build & Run](#build--run)
6. [Configuration](#configuration)
7. [MCP Connection Examples](#mcp-connection-examples)
8. [Available Tools — Detailed](#available-tools--detailed)
9. [Observability](#observability)
10. [Security](#security)
11. [Development](#development)
12. [Troubleshooting](#troubleshooting)
13. [Architecture](#architecture)
14. [License](#license)

---

## Overview

This MCP server bridges LLM clients (Claude, Cursor, Codex) with the Adobe Journey Optimizer Content Management REST API. It exposes 15 tools covering the full template and fragment lifecycle, handles Adobe IMS authentication with token caching, and ships with enterprise-grade observability, security, and reliability features.

---

## Features

### Content Templates
| Tool | Description |
|------|-------------|
| `list_content_templates` | Paginated listing with filtering and sorting |
| `create_content_template` | Create email, push, SMS, in-app, code, direct mail, and landing page templates |
| `get_content_template` | Fetch a single template by ID (returns etag for updates) |
| `update_content_template` | Full replacement (PUT) with optimistic locking |
| `patch_content_template` | Partial update via JSON Patch (RFC 6902) |
| `delete_content_template` | Permanent deletion |

### Content Fragments
| Tool | Description |
|------|-------------|
| `list_content_fragments` | Paginated listing with status and type filtering |
| `create_content_fragment` | Create HTML or expression fragments |
| `get_content_fragment` | Fetch a fragment by ID (returns etag) |
| `update_content_fragment` | Full replacement (PUT) |
| `patch_content_fragment` | Partial update via JSON Patch |
| `publish_content_fragment` | Publish/freeze fragment (async) |
| `publish_fragment` | Alias for publish_content_fragment |
| `get_live_fragment` | Get content from last successful publication |
| `get_fragment_publication_status` | Poll publication progress |
| `archive_content_fragment` | Archive a fragment (fragments cannot be deleted via the API) |

---

## Example Prompts

Once your LLM client is connected to this MCP server, you can talk to it in plain language. Below are ready-to-use prompts organised by what you're trying to do — copy them directly or use them as inspiration.

---

### 🔍 Browsing & Discovery

**List everything**
> "Show me all the content templates in this sandbox."

> "List all content fragments, sorted by most recently modified."

> "How many content templates do we have? Give me a summary grouped by channel."

**Search and filter**
> "Find all email templates whose name starts with 'Cyber Monday'."

> "Show me all push notification templates created in the last 30 days."

> "List all content fragments that are currently in DRAFT status."

> "Find all fragments of type 'expression' on the shared channel."

> "Are there any templates that came from AEM? List them."

**Inspect a specific item**
> "Get the full details of template ID b6d70a45-a149-453b-85ba-809a5d40066d."

> "Show me the HTML content inside the 'Welcome Email' template."

> "Fetch fragment b6d70a45-a149-453b-85ba-809a5d40066d and tell me what channel it targets and what its current status is."

---

### ✏️ Creating Content

**Templates**
> "Create an HTML email template called 'Summer Sale Header' with this HTML: `<div>Hi {{profile.person.name}}, our summer sale is live!</div>`"

> "Create a push notification template called 'Flash Sale Alert' with the title 'Limited time offer 🔥' and message 'Tap to see deals ending in 2 hours.'"

> "Create an SMS template called 'Order Shipped' with the text 'Hi {{profile.person.name}}, your order {{order.id}} has shipped and will arrive by {{order.estimatedDelivery}}.'"

> "Create a new in-app message template called 'Loyalty Milestone' with an HTML body that congratulates the user on reaching Gold status."

> "Create a direct mail template called 'Holiday Catalog 2025' with a fileName of 'holiday-catalog' and include fields for first name, last name, and postal address."

> "Create a code-based template called 'Hero Banner JSON' on the code channel with subType JSON."

**Fragments**
> "Create an HTML fragment called 'Global Footer' with this content: `<footer>© 2025 Acme Corp | <a href='/unsubscribe'>Unsubscribe</a></footer>`. It should target the email channel."

> "Create an expression fragment called 'Personalised Greeting' with the expression `Hello {{profile.person.firstName}}, welcome back!` on the shared channel."

> "Create a new draft HTML fragment called 'Promo Banner' for the email channel. The content should be a red banner div with the text 'Up to 50% off selected items'."

---

### 🔄 Updating Content

**Rename or re-describe**
> "Rename template b6d70a45-... to 'Black Friday Email — v2'."

> "Update the description of fragment b6d70a45-... to 'Used in all promotional campaigns Q4 2025'."

> "Move template b6d70a45-... into folder a49dbe03-..."

**Edit content**
> "Update the 'Welcome Email' template. Keep everything the same but change the HTML to include a new hero image tag: `<img src='https://cdn.acme.com/hero.jpg' />`."

> "The 'Order Shipped' SMS template needs updating. Change the text to also include a tracking URL: `Track here: {{order.trackingUrl}}`."

> "I need to update fragment b6d70a45-... — fetch it first, then replace its HTML content with `<div class='banner'>New Year Sale — 40% off everything!</div>`."

---

### 🚀 Publishing Fragments

> "Publish fragment b6d70a45-... so it's ready to use in campaigns."

> "Publish the 'Global Footer' fragment and then check whether the publication succeeded."

> "What is the publication status of fragment b6d70a45-...? Is it live yet?"

> "Publish fragment b6d70a45-... and keep checking the status every few seconds until it's complete, then confirm it's live."

> "Show me the live published content of fragment b6d70a45-... — what HTML is actually being served to campaigns right now?"

---

### 🗑️ Deleting & Archiving Content

> "Delete template b6d70a45-a149-453b-85ba-809a5d40066d."

> "I need to clean up. List all templates with 'test' or 'draft' in the name, then delete them."

> "Delete all email templates that haven't been modified since January 2024." *(The LLM will list first and confirm before deleting.)*

> "Archive fragment b6d70a45-... — I no longer need it in the active library."

> "Archive all fragments that are still in DRAFT status and haven't been modified since January 2024."

---

### 🔁 Multi-Step Workflows

These prompts ask the LLM to chain multiple tools together autonomously.

> "Create a complete email template called 'Abandoned Cart' with a subject of 'You left something behind…' and HTML body reminding the user of their cart items using `{{cart.items}}`. Then show me the ID so I can reference it."

> "I want to set up a reusable unsubscribe footer fragment. Create an HTML fragment called 'Unsubscribe Footer' for the email channel, publish it, and confirm it's live."

> "Clone the template at ID b6d70a45-... — fetch its full content, create a new template with the same content but named 'Copy of [original name]', and return the new ID."

> "Audit our fragment library: list all fragments, identify which ones are still in DRAFT status, and give me a summary of how many are PUBLISHED vs DRAFT vs PUBLISHING."

> "We're doing a Q4 cleanup. List all templates that have 'summer' in the name and delete each one. Walk me through what you're deleting before you do it."

> "Create three SMS templates for an onboarding sequence: 'Onboarding Day 1', 'Onboarding Day 3', and 'Onboarding Day 7'. Each should have personalised text referencing `{{profile.person.firstName}}` and a relevant message for that day of onboarding."

---

### 💡 Tips for Best Results

**Be specific about IDs when you have them.** If you know the template or fragment ID, include it — the LLM won't need to search first.

> ✅ "Get template b6d70a45-a149-453b-85ba-809a5d40066d"
> vs.
> ⚠️ "Get my welcome email template" *(requires a search step)*

**Mention the channel when creating.** The API requires exactly one channel per template or fragment.

> ✅ "Create an email template called…"
> ✅ "Create a push notification template called…"

**For updates, you don't need to fetch the etag yourself.** Just ask the LLM to update something — it will automatically fetch the current version and etag before making the change.

> ✅ "Update the description of template b6d70a45-... to 'New description'"

**Publishing is async.** After asking to publish a fragment, the LLM can poll `get_fragment_publication_status` for you — just ask it to confirm when publication is complete.

> ✅ "Publish fragment b6d70a45-... and tell me when it's done."

**Pagination is handled automatically.** If you ask to list all templates, the LLM can page through results on your behalf.

> ✅ "List all templates in this sandbox, even if there are more than 20."

---

## Prerequisites

The only thing you need to build and run the server is **Docker Desktop** — dependencies are installed and the code is compiled inside the container, so you don't need Node.js installed on your machine. The steps are the same whether you're on **macOS** or **Windows**.

### Docker Desktop
- **Download:** [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
  - macOS: pick the **Apple Silicon** build for M1/M2/M3+ Macs, or the **Intel chip** build for older Macs.
  - Windows: download **Docker Desktop for Windows** (requires Windows 10/11 64-bit; WSL 2 is enabled by the installer).
- **After installing, launch Docker Desktop and wait until the whale icon shows "Docker Desktop is running."** The commands below will fail if the Docker engine isn't started.
- **Verify** in a terminal (macOS) or PowerShell (Windows):
  ```bash
  docker --version
  ```

> **Only contributing to the code?** To run the test suite or type-check outside Docker (see [Development](#development)), you'll also need [Node.js 18+ (LTS)](https://nodejs.org/en/download). It is **not** required just to build and run the server.

---

## Build & Run

From the project root, a single command builds the image and starts the server in the background. Everything — installing dependencies and compiling the code — happens inside the container, so you don't need to run `npm` yourself.

```bash
cd ajo-content-mcp
docker compose up -d --build
```

- `--build` builds the `ajo-content-mcp` image (only needed the first time, or after you change the code).
- `-d` runs the container detached, so your terminal stays free.

The setup UI is now available at **http://localhost:3000** — continue to [Configuration](#configuration).

Common follow-up commands:

```bash
docker compose logs -f     # watch the server logs (Ctrl+C to stop watching)
docker compose down        # stop and remove the container
docker compose up -d       # start it again later (no rebuild needed)
```

---

## Configuration

### 1. Open the UI

Navigate to `http://localhost:3000` in your browser.

### 2. Upload environment file

Drag and drop your credentials file. The expected format matches the Postman environment export from Adobe:

```json
{
  "values": [
    { "type": "text", "value": "your-client-secret", "key": "CLIENT_SECRET", "enabled": true },
    { "type": "text", "value": "your-api-key", "key": "API_KEY", "enabled": true },
    { "type": "text", "value": "your-token-if-pre-obtained", "key": "ACCESS_TOKEN", "enabled": true },
    { "type": "text", "value": ["openid", "AdobeID", "additional_info.projectedProductContext"], "key": "SCOPES", "enabled": true },
    { "type": "text", "value": "tech@techacct.adobe.com", "key": "TECHNICAL_ACCOUNT_ID", "enabled": true },
    { "type": "text", "value": "ims-na1.adobelogin.com", "key": "IMS", "enabled": true },
    { "type": "text", "value": "org@AdobeOrg", "key": "IMS_ORG", "enabled": true }
  ],
  "name": "name of the API project will display here"
}
```

Notes:
- **`SCOPES`** is an array of strings (not a comma-separated string).
- **`name`** labels the credential set — it's shown on the landing page after upload so you can confirm you loaded the right file.
- Only `API_KEY` and `IMS_ORG` are strictly required; provide `CLIENT_SECRET` (+ `TECHNICAL_ACCOUNT_ID`, `IMS`, `SCOPES`) for the OAuth server-to-server flow, or a pre-obtained `ACCESS_TOKEN` instead.

> Credentials are stored in memory only. They are never written to disk, logged, or returned through tools.

### 3. Enter sandbox name

Type the target Adobe Experience Platform sandbox (e.g. `prod` or `cjm-team`).

### 4. Click "Start MCP Server"

The server authenticates once, caches the token, and begins accepting MCP connections.

---

## MCP Connection Examples

> **Prerequisite:** finish [Build & Run](#build--run) and [Configuration](#configuration) first. There is **one** long-lived container (started by `docker compose up -d`) that you configure once at `http://localhost:3000`. Every client below connects to that same running server at `http://localhost:3000/mcp` — no client starts its own container, so the configuration you entered is shared by all of them and survives client restarts.

### Claude Code (HTTP)
```json
{
  "mcpServers": {
    "ajo-content": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Claude Desktop (via `mcp-remote` bridge)
Claude Desktop's config only speaks STDIO, so it can't point at an HTTP URL directly. The
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge connects it to the already-running
container — **do not** have Claude Desktop launch its own container, or it would collide with the
one from `docker compose up` (port 3000) and start unconfigured.

**Install Node.js first.** `npx` is not a standalone tool — it ships with npm, which ships with
[Node.js](https://nodejs.org/en/download). Without Node installed, Claude Desktop's `npx` command
fails with `spawn npx ENOENT`. This is the one client that needs Node locally; everything else
talks to the container directly over HTTP. After installing, verify with:
```bash
npx --version
```
You do **not** need to install `mcp-remote` separately — `npx -y mcp-remote` downloads and caches it
on first run (needs network access the first time).

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:
```json
{
  "mcpServers": {
    "ajo-content": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

> **If Claude Desktop still reports `npx` not found after installing Node:** Claude Desktop launches
> `npx` using the GUI app's `PATH`, which on macOS is often **not** the same as your terminal's
> `PATH` (common with `nvm`- or Homebrew-managed installs). Fix it either by installing Node via the
> official `.pkg` (macOS) / `.msi` (Windows) installer, which puts it in a standard system location,
> or by using the absolute path in the config — find it with `which npx` (macOS) / `where npx`
> (Windows) and set e.g. `"command": "/usr/local/bin/npx"`.

The container from [Build & Run](#build--run) must already be running and configured. Because that
container is long-lived, your credentials persist across Claude Desktop restarts — you only
configure once at `http://localhost:3000`.

### Cursor
Settings → MCP Servers → Add Server:
```json
{
  "ajo-content": {
    "url": "http://localhost:3000/mcp",
    "type": "http"
  }
}
```

### Codex CLI
`codex mcp add` only supports stdio servers, so add the streamable HTTP endpoint
to `~/.codex/config.toml`:
```toml
[mcp_servers.ajo-content]
url = "http://localhost:3000/mcp"
```

### Codex Desktop
The Codex IDE extension / desktop app reads the same config file as the CLI.
Add the block above to `~/.codex/config.toml`, then restart Codex.

### Generic HTTP Client
```
MCP Endpoint: http://localhost:3000/mcp
Protocol: Streamable HTTP (MCP 2024-11-05)
```

---

## Available Tools — Detailed

### `create_content_template`
```json
{
  "name": "Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": {
    "html": "<html>Hello {{profile.person.name}}</html>"
  }
}
```

### `get_content_template`
```json
{ "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```

### `update_content_template`
Always fetch first to get the etag:
```json
{
  "templateId": "b6d70a45-...",
  "etag": "\"v2\"",
  "name": "Updated Welcome Email",
  "templateType": "html",
  "channels": ["email"],
  "template": { "html": "<html>Updated content</html>" }
}
```

### `patch_content_template`
```json
{
  "templateId": "b6d70a45-...",
  "etag": "\"v2\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" }
  ]
}
```

### `publish_content_fragment`
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Publication is async. Poll `get_fragment_publication_status` until `status === "complete"`.

### `archive_content_fragment`
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Fragments cannot be deleted via the AJO Content REST API — archiving is the equivalent. An archived
fragment is removed from the active library and can no longer be referenced in new campaigns or
journeys.

> **Note:** This tool calls an internal AJO GraphQL API (`exc-unifiedcontent.experience.adobe.net`)
> that is not part of the public Content REST API. Adobe may change this endpoint without notice.

---

## Observability

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check — always 200 when running |
| `GET /ready` | Readiness — 200 only after credentials configured |
| `GET /metrics` | Prometheus metrics (tool calls, errors, latency, auth refreshes) |

### Prometheus Metrics
- `mcp_tool_calls_total{tool, status}` — total tool invocations
- `mcp_tool_call_duration_seconds{tool}` — latency histogram
- `mcp_auth_refresh_total` — IMS token refresh count
- `mcp_adobe_api_errors_total{endpoint, status_code}` — API errors

---

## Security

- Credentials stored in memory only, never logged or returned via tools
- Rate limiting: 200 req/min global, 5 req/min on `/api/configure`
- Helmet security headers
- Input validation via Zod on all tool inputs
- Non-root Docker user (`mcpuser`)
- Read-only container filesystem

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run with coverage
npm test -- --coverage

# Type-check only
npm run typecheck

# Run locally (no Docker)
npm run dev
```

---

## Troubleshooting

### Authentication issues
- Ensure `CLIENT_SECRET` and `API_KEY` are correct in your credentials file
- Alternatively, provide a pre-obtained `ACCESS_TOKEN` directly
- Check `/ready` endpoint for auth status

### Sandbox issues
- Sandbox name is case-sensitive
- Find the exact name in Adobe Experience Platform → Sandbox switcher

### Connectivity issues
- Verify the container is running: `docker ps`
- Check container logs: `docker logs ajo-content-mcp`
- Ensure port 3000 is not in use

### Adobe API issues
- `401 UNAUTHORIZED`: Token expired — restart the server to re-authenticate
- `403 FORBIDDEN`: Check that your API key has the required AJO Content permissions
- `404 NOT_FOUND`: Verify the template/fragment ID and sandbox
- `409 CONFLICT`: ETag mismatch — fetch the resource again to get the latest etag

### Tool not working
- Check `/ready` returns `{ "ready": true }`
- Verify the MCP client is connected to `http://localhost:3000/mcp`
- Review logs: `docker compose logs -f`

### Which server actually handled a request?
LLM clients **cannot reliably report their own MCP connections** — if you ask the model "which MCP servers are you connected to?" or "which server did you use?", it may omit this local server, list unrelated cloud connectors, or claim it was "proxied" through another server. That's the model guessing from tool names, not ground truth.

To confirm this server did the work, use authoritative signals instead:
- **Container logs** are the source of truth — every tool call is logged: `docker compose logs -f` (look for entries like `create_content_fragment`).
- The landing page's **Connected client** panel at `http://localhost:3000` shows the live connection (e.g. `Claude Desktop · http`).
- This server's tools are namespaced under **`ajo-content`** — that prefix is the real one.
- `mcp-remote` connects **directly** to `http://localhost:3000/mcp`; it does not route through any cloud service.

If a client also has **cloud Adobe/AJO connectors** enabled (e.g. via its connectors UI), their tools overlap in purpose with this server's and the model may conflate them. Disable the ones you aren't using so `ajo-content` is unambiguous.

### Connected-client list keeps showing a client after it closed
The **Connected client** panel tracks the live MCP connection and clears a client within ~10 seconds of it disconnecting (the landing page polls every few seconds). If a client lingers longer:
- Give it the full grace window — HTTP clients are removed shortly after their session stream closes, not instantly.
- For Claude Desktop, make sure the app fully quit (not just the window closed) so the `mcp-remote` bridge process actually exits.
- The list reflects connections to the **running container**; restarting the container (`docker compose restart`) clears it entirely.

---

## Architecture

```
src/
├── auth/           Token manager with caching + refresh
├── adobe/          AJO API client (axios + retry)
├── mcp/            MCP server, tool routing, STDIO/HTTP transports
├── tools/          Tool handlers — templates.ts + fragments.ts
├── ui/             Landing page HTML
├── validation/     Zod schemas for all inputs
├── telemetry/      Winston logging + Prometheus metrics
└── server/         Express app + main entry point
```

---

## License

MIT