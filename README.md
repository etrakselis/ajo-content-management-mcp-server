# AJO Content MCP Server

A production-grade **Model Context Protocol (MCP) server** that exposes Adobe Journey Optimizer Content Management APIs to LLM-powered clients. AI agents can create, retrieve, update, delete,   content templates and create, retrieve, update, archive and publish content fragments directly through natural language.

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

This MCP server bridges LLM clients (Claude, Cursor, Codex) with the Adobe Journey Optimizer Content Management REST API. It exposes 22 tools covering the full template and fragment lifecycle plus read-only Experience Platform Schema Registry (XDM) lookups, handles Adobe IMS authentication with token caching, and ships with enterprise-grade observability, security, and reliability features.

The Schema Registry tools let the LLM discover the **real personalization attribute paths** configured in a sandbox — most customers define custom field groups under their tenant namespace rather than using only default XDM fields — so generated content references attributes that actually exist instead of guessing `{{profile.person.firstName}}`.

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

### Schema Registry (XDM) — read-only
For discovering real personalization attribute paths. Requires the AEP Schema Registry API on the credential's Developer Console project.
| Tool | Description |
|------|-------------|
| `list_xdm_schemas` | List XDM schemas (tenant or global container) |
| `get_xdm_schema` | Retrieve a schema, fully resolved by default (all field groups inlined) |
| `list_xdm_field_groups` | List field groups — where custom attributes are defined |
| `get_xdm_field_group` | Retrieve a field group, fully resolved by default |
| `list_xdm_union_schemas` | List union schemas (merged per-class view, e.g. the full Profile) |
| `get_xdm_union_schema` | Retrieve a union schema — the complete attribute set for personalization |

---

## Example Prompts

Once your LLM client is connected to this MCP server, you can talk to it in plain language. Below are ready-to-use prompts organised by what you're trying to do — copy them directly or use them as inspiration.

---

### 🧭 Orientation — start here

Before doing any real work, confirm *what* you're connected to and *what you can do*. These are the prompts to run first.

**Which server / tenant / sandbox am I on?**
> "Which MCP server are you using to manage AJO content, and what tenant namespace and sandbox is it connected to?"

> "Before we start, confirm the Adobe Journey Optimizer environment: tenant namespace and sandbox name."

> "List one content template and tell me the org, tenant, and sandbox it came from." *(Every tool result is prefixed with `[tenant: … | sandbox: …]` — and `org: …` if an org name was supplied during setup — so this is the most reliable way to see the exact target.)*

**What can I do right now (read-only vs read-write)?**
> "Are you currently allowed to create or modify content through the ajo-content server, or is it read-only?"

> "Try to tell me whether write access is enabled. If it isn't, what do I need to do to turn it on?" *(If writes are off, write attempts return a `READ_ONLY_MODE` error pointing you to `http://localhost:3000`.)*

**What tools are available?**
> "What AJO content tools do you have access to? Group them into read vs. write operations."

> "Summarize what each ajo-content tool does, so I know what I can ask for."

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

### 🧬 Personalization — use real attribute paths

These use the Schema Registry (XDM) tools to find the attributes that actually exist in your sandbox, so content references real paths instead of generic guesses. (Requires the AEP Schema Registry API on your Developer Console project.)

> "What custom field groups are defined in this sandbox? List them."

> "Show me the full Profile union schema and list the personalization attributes available, with their paths."

> "Find the loyalty-related attributes in our XDM schemas and tell me the exact paths I'd use for personalization."

> "Create a welcome email fragment, but first look up our actual profile attributes and use the real first-name and loyalty-tier paths instead of the default XDM ones."

> "Before personalizing this template, check our tenant field groups and map each placeholder I want (first name, city, points balance) to its real attribute path."

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

#### What each field is for

**Always required** — every setup needs these two:

| Field | What it is |
|-------|------------|
| `API_KEY` | Your integration's Client ID from the Adobe Developer Console. |
| `IMS_ORG` | Your Adobe organization ID (looks like `XXedwin@AdobeOrg`). |

**Authentication — pick *one* of these two approaches:**

- **Option A — let the server log in for you (recommended).** Provide `CLIENT_SECRET`, `TECHNICAL_ACCOUNT_ID`, `IMS`, and `SCOPES`. The server uses these to fetch an access token automatically and refreshes it as needed. In this case you can leave `ACCESS_TOKEN` blank.
- **Option B — supply your own token.** Paste a token you already obtained into `ACCESS_TOKEN` and leave the Option A fields blank. Note the server **cannot refresh** this token, so it stops working once the token expires and you'll need to upload a new one.

**Formatting / informational:**

- **`SCOPES`** must be a JSON **array of strings** (e.g. `["openid", "AdobeID", ...]`), not a single comma-separated string.
- **`name`** is just a label for the credential set. After you upload the file it's displayed on the landing page so you can confirm you loaded the right one.
- **`type`** and **`enabled`** come from Adobe's Postman export — leave them as they are.

> Credentials are stored in memory only. They are never written to disk, logged, or returned through tools.

### 3. Enter sandbox name

You can find the sandbox name from the url of your AJO instance, look for the parameter called "sname:". Traditionally the sandboxes are named like "dev", "staging", "prod" but the exact name needs to be verified since they aren't enforced and can vary slightly between the orgs.

### 4. Set the access mode

Use the **Allow write operations** toggle to choose what connected LLM clients can do:

- **Off — read-only (default).** Only *list* and *get* operations run. Write tools (create, update, delete, publish, archive) are rejected at execution with a `READ_ONLY_MODE` error.
- **On — read & write.** Write tools execute normally.

Read-only is the safe default — leave it off unless you explicitly want clients to modify content.

The full tool set is **always advertised** to clients regardless of this setting, and enforcement happens when a tool is *called*. This is deliberate: many clients (e.g. Claude Desktop) cache the tool list when they connect and don't react to a mid-session tool-list change, so hiding write tools would strand them in read-only even after you turned writes on. Instead, the server tells the LLM that writes are runtime-gated, so it attempts the operation when asked and surfaces the `READ_ONLY_MODE` error if it's currently off. Because of this, flipping the toggle **takes effect immediately with no client restart** — once you switch to On, the next write attempt simply succeeds.

### 5. Click "Start MCP Server"

The server authenticates once, caches the token, and begins accepting MCP connections. The connection summary then shows the active **tenant namespace**, **sandbox**, and **access mode**.

---

## MCP Connection Examples

> **Prerequisite:** finish [Build & Run](#build--run) and [Configuration](#configuration) first. There is **one** long-lived container (started by `docker compose up -d`) that you configure once at `http://localhost:3000`. Every client below connects to that same running server at `http://localhost:3000/mcp` — no client starts its own container, so the configuration you entered is shared by all of them and survives client restarts.

### Claude Code (HTTP)
Run this from your terminal — it registers the server in the right place automatically (no file editing needed):
```bash
claude mcp add --transport http et-ajo-content-mgmt http://localhost:3000/mcp
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
    "et-ajo-content-mgmt": {
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
Add via **Settings → MCP Servers → Add Server**, or edit `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (project root) directly:
```json
{
  "mcpServers": {
    "et-ajo-content-mgmt": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### Codex CLI
`codex mcp add` only supports stdio servers, so add the streamable HTTP endpoint
to `~/.codex/config.toml`:
```toml
[mcp_servers.et-ajo-content-mgmt]
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

All 22 tools, with typical arguments. Full input schemas live in `src/tools/`. **Read** tools are always available; **write** tools (marked) run only when write access is enabled (see [Access mode](#configuration)).

### Content templates

#### `list_content_templates` *(read)*
```json
{ "limit": 20, "orderBy": "-modifiedAt", "property": ["channels==email", "name~^Welcome"] }
```
All fields optional. Pass `_page.next` from the response as `start` to fetch the next page.

#### `create_content_template` *(write)*
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
`templateType`: `html` | `html_primary_page` | `html_sub_page` | `content`. `channels`: exactly one of `email`, `push`, `inapp`, `sms`, `code`, `directMail`, `landingpage`, `shared`.

#### `get_content_template` *(read)*
```json
{ "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the template and its etag (needed for updates/patches).

#### `update_content_template` *(write)*
Full replacement (PUT). Always fetch first to get the etag:
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

#### `patch_content_template` *(write)*
Metadata-only changes via JSON Patch (`/name`, `/description`, `/parentFolderId`). For content/type/channel changes use `update_content_template`.
```json
{
  "templateId": "b6d70a45-...",
  "etag": "\"v2\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" }
  ]
}
```

#### `delete_content_template` *(write)*
```json
{ "templateId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Permanent deletion.

### Content fragments

#### `list_content_fragments` *(read)*
```json
{ "limit": 20, "orderBy": "-modifiedAt", "property": ["status==PUBLISHED"] }
```
All fields optional. Paginate with `start` = `_page.next`.

#### `create_content_fragment` *(write)*
```json
{
  "name": "Global Footer",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<footer>© 2026 Acme Corp</footer>" }
}
```
For an expression fragment: `"type": "expression"`, `"channels": ["shared"]`, `"fragment": { "expression": "Hello {{profile.person.firstName}}" }`.

#### `get_content_fragment` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the fragment and its etag.

#### `update_content_fragment` *(write)*
Full replacement (PUT). Fetch first for the etag:
```json
{
  "fragmentId": "b6d70a45-...",
  "etag": "\"v3\"",
  "name": "Global Footer",
  "type": "html",
  "channels": ["email"],
  "fragment": { "content": "<footer>Updated footer</footer>" }
}
```

#### `patch_content_fragment` *(write)*
Metadata-only changes via JSON Patch (`/name`, `/description`, `/parentFolderId`). For content changes use `update_content_fragment`.
```json
{
  "fragmentId": "b6d70a45-...",
  "etag": "\"v3\"",
  "patches": [
    { "op": "replace", "path": "/name", "value": "New Name" }
  ]
}
```

#### `publish_content_fragment` *(write)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Publication is async. Poll `get_fragment_publication_status` until `status === "complete"`.

#### `publish_fragment` *(write)*
Alias of `publish_content_fragment` — identical arguments and behavior.

#### `get_live_fragment` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Returns the content from the fragment's last successful publication — what campaigns and journeys actually serve right now.

#### `get_fragment_publication_status` *(read)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Reports the status of the most recent publication request (poll until `status === "complete"`).

#### `archive_content_fragment` *(write)*
```json
{ "fragmentId": "b6d70a45-a149-453b-85ba-809a5d40066d" }
```
Fragments cannot be deleted via the AJO Content REST API — archiving is the equivalent. An archived
fragment is removed from the active library and can no longer be referenced in new campaigns or
journeys.

> **Note:** This tool calls an internal AJO GraphQL API (`exc-unifiedcontent.experience.adobe.net`)
> that is not part of the public Content REST API. Adobe may change this endpoint without notice.

### Schema Registry / XDM

All read-only. These query the AEP Schema Registry to discover the **actual** personalization attribute paths in the sandbox. Use them before inserting personalization fields so content references attributes that really exist. **Requires the AEP Schema Registry API enabled on the credential's Developer Console project** (otherwise they return `FORBIDDEN` / 403).

> Typical flow: `list_xdm_field_groups` (find the customer's custom groups) → `get_xdm_field_group` (read its attribute paths), or `get_xdm_union_schema` for the complete merged Profile view. Custom attributes are nested under the tenant namespace key (e.g. `_yourtenant`) in the schema's `properties` — that nesting is the personalization path.

#### `list_xdm_schemas` *(read)*
```json
{ "container": "tenant", "property": "title~Profile" }
```
`container` defaults to `tenant` (customer-defined); use `global` for standard XDM. Returns concise summaries (title, `$id`, `meta:altId`, version).

#### `get_xdm_schema` *(read)*
```json
{ "schemaId": "https://ns.adobe.com/_yourtenant/schemas/abc123", "full": true }
```
`full` defaults to `true` (fully resolved — all field groups inlined, complete property tree). Pass the `$id` or `meta:altId` from `list_xdm_schemas`.

#### `list_xdm_field_groups` *(read)*
```json
{ "container": "tenant" }
```
Lists field groups; custom ones (tenant container) are where non-default personalization attributes live.

#### `get_xdm_field_group` *(read)*
```json
{ "fieldGroupId": "https://ns.adobe.com/_yourtenant/mixins/abc123", "full": true }
```

#### `list_xdm_union_schemas` *(read)*
```json
{}
```
Lists union schemas (tenant). A union merges all field groups of a class into one schema — e.g. the full Profile.

#### `get_xdm_union_schema` *(read)*
```json
{ "unionId": "https://ns.adobe.com/xdm/context/profile__union", "full": true }
```
The resolved Profile union is the complete attribute set available for personalization.

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
- This server's tools are namespaced under **`et-ajo-content-mgmt`** — that prefix is the real one.
- `mcp-remote` connects **directly** to `http://localhost:3000/mcp`; it does not route through any cloud service.

If a client also has **cloud Adobe/AJO connectors** enabled (e.g. via its connectors UI), their tools overlap in purpose with this server's and the model may conflate them. Disable the ones you aren't using so `et-ajo-content-mgmt` is unambiguous.

### Connected-client list seems out of date
Each client gets its own MCP **session**, and the **Connected client** panel tracks those sessions — so the list stays correct even with several clients connected at once (e.g. Claude Code and Claude Desktop). Activity on one client's session never refreshes another's.
- **A client you just closed still shows:** when a client disconnects cleanly its session ends and it's removed promptly. If it lingers, give it up to ~10 seconds (the safety-net window for an unclean exit). For Claude Desktop, make sure the app fully quit (not just the window closed) so the `mcp-remote` bridge process actually exits.
- **A connected client isn't listed:** it appears as soon as it sends anything, and every tool call keeps it listed. If it's missing, run any tool and it'll reappear.
- The list reflects connections to the **running container**; restarting it (`docker compose restart`) clears the list entirely.

---

## Architecture

```
.
├── src/
│   ├── server/
│   │   ├── index.ts            Entry point — starts STDIO + HTTP transports, graceful shutdown
│   │   └── app.ts              Express app — landing page, /api/* config endpoints, /mcp endpoint
│   ├── mcp/
│   │   ├── server.ts           MCP server factory, tool routing, STDIO/HTTP transport setup
│   │   ├── connected-clients.ts  Tracks which MCP clients are connected (for the landing page)
│   │   └── sdk-types.d.ts      Local type declarations for the MCP SDK
│   ├── tools/
│   │   ├── templates.ts        Content template tool definitions + handlers
│   │   ├── fragments.ts        Content fragment tool definitions + handlers
│   │   └── schema-registry.ts  XDM schema / field group / union lookup tools (read-only)
│   ├── adobe/
│   │   ├── client.ts           AJO Content API client (axios + retry, injects auth headers)
│   │   └── schema-registry-client.ts  AEP Schema Registry (XDM) read client
│   ├── auth/
│   │   └── token-manager.ts    Adobe IMS token acquisition with caching + refresh
│   ├── validation/
│   │   └── schemas.ts          Zod schemas for the credentials file and tool inputs
│   ├── telemetry/
│   │   └── index.ts            Winston logging + Prometheus metrics registry
│   └── ui/
│       └── landing.ts          Single-page setup UI (HTML/CSS/JS), served at /
├── Dockerfile                  Multi-stage build (npm ci → tsc → slim runtime image)
├── docker-compose.yml          Builds the image and runs the container
├── package.json                Dependencies and scripts
├── tsconfig.json               TypeScript compiler configuration

```

The server boots both transports in `src/server/index.ts`: an **STDIO** transport and an **HTTP streaming** transport (Express, port 3000) that also serves the landing page. The HTTP transport is **stateful** — each client is assigned an MCP session ID at `initialize` and includes it on every subsequent request. This lets the server attribute all activity (including tool calls, which carry no client identity) to the right client, so the **Connected client** panel stays accurate even when several clients are connected at once (`mcp/connected-clients.ts` keys HTTP clients by session ID). Credentials submitted via the UI are validated (`validation/`), used to obtain an IMS token (`auth/`), and applied to the API client (`adobe/`); MCP tool calls are routed through `mcp/server.ts` to the handlers in `tools/`.

---

## License

MIT