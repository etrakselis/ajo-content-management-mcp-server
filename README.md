# AJO Content MCP Server

A production-grade **Model Context Protocol (MCP) server** that exposes Adobe Journey Optimizer Content Management APIs to LLM-powered clients. AI agents can create, retrieve, update, delete, and publish content templates and fragments directly through natural language.

---

## Overview

This MCP server bridges LLM clients (Claude, Cursor, Continue, Codex) with the Adobe Journey Optimizer Content Management REST API. It exposes 15 tools covering the full template and fragment lifecycle, handles Adobe IMS authentication with token caching, and ships with enterprise-grade observability, security, and reliability features.

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

---

## Build Instructions

```bash
# Clone or extract the project
cd ajo-content-mcp

# Build the Docker image
docker build -t ajo-content-mcp .
```

---

## Run Instructions

```bash
# Start the server (UI available at http://localhost:3000)
docker run -p 3000:3000 --name ajo-content-mcp ajo-content-mcp

# Or with docker-compose
docker-compose up
```

---

## Configuration

### 1. Open the UI

Navigate to `http://localhost:3000` in your browser.

### 2. Upload environment file

Drag and drop your `environment-variables.json` credentials file. The expected format matches the Postman environment export from Adobe:

```json
{
  "values": [
    { "key": "CLIENT_SECRET", "value": "your-secret", "enabled": true },
    { "key": "API_KEY",       "value": "your-api-key", "enabled": true },
    { "key": "IMS_ORG",       "value": "org@AdobeOrg", "enabled": true },
    { "key": "TECHNICAL_ACCOUNT_ID", "value": "tech@techacct.adobe.com", "enabled": true },
    { "key": "IMS",           "value": "ims-na1.adobelogin.com", "enabled": true },
    { "key": "ACCESS_TOKEN",  "value": "your-token-if-pre-obtained", "enabled": true }
  ]
}
```

> Credentials are stored in memory only. They are never written to disk, logged, or returned through tools.

### 3. Enter sandbox name

Type the target Adobe Experience Platform sandbox (e.g. `prod` or `cjm-team`).

### 4. Click "Start MCP Server"

The server authenticates once, caches the token, and begins accepting MCP connections.

---

## MCP Connection Examples

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

### Claude Desktop (STDIO via Docker)
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "ajo-content": {
      "command": "docker",
      "args": ["exec", "-i", "ajo-content-mcp", "node", "dist/server/index.js", "--stdio"]
    }
  }
}
```

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

### Continue
`.continue/config.json`:
```json
{
  "experimental": {
    "modelContextProtocolServers": [{
      "transport": {
        "type": "streamableHttp",
        "url": "http://localhost:3000/mcp"
      }
    }]
  }
}
```

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
- Review logs: `docker logs ajo-content-mcp --follow`

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
