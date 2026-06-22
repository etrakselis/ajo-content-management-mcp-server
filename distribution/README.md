# AJO Content MCP Server — Quickstart

Run the **AJO Content MCP Server** from its pre-built container image — no source code, no build. This folder contains everything you need: this guide and a `docker-compose.yml`.

> **This is the abridged run guide.** For the project overview, the full tool catalog, personalization guidance, security model, and troubleshooting, see the **[main repository README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md)**.

---

## What you need first

1. **Docker Desktop**, installed and running (the whale icon shows "Docker Desktop is running"). Download: [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
2. **An Adobe API credentials file** (a Postman-environment JSON export from the Adobe Developer Console). Obtaining it requires admin access to the Adobe Developer Console and AJO — the **[full setup steps are in the main README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#prerequisites)**. You upload this file in Step 2 below.

---

## 1. Start the server

From this folder (the one containing `docker-compose.yml`):

```bash
docker compose up -d
```

The first run **pulls** the multi-arch image automatically and starts it in the background. Docker selects the right build for your CPU (Apple Silicon or Intel/AMD).

Then open **http://localhost:3000**.

> **Can't reach the page?** The server binds to loopback only by design. If `localhost` doesn't resolve, try **http://127.0.0.1:3000**.

---

## 2. Configure (in the browser)

The setup UI reveals one step at a time:

1. **Upload** your Adobe credentials (environment) file.
2. **Select** the sandbox (auto-populated from your credentials).
3. **Set the access mode** — read-only (default) or read & write.
4. **Enter your email** and click **Start MCP Server**.

Details for each field are in the **[Configuration section of the main README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#configuration)**.

---

## 3. Connect your client

Point your MCP client at **http://localhost:3000/mcp**. Per-client setup (Claude Code, Claude Desktop, Cursor, Codex) is in the **[Client Connection Guide](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#client-connection-guide)**.

---

## Everyday commands

```bash
docker compose logs -f     # watch logs (Ctrl+C to stop watching)
docker compose pull        # fetch the latest published image
docker compose up -d       # start (or restart after a pull)
docker compose down        # stop and remove the container
```

> **Pin a version** for reproducibility: edit `docker-compose.yml` and replace `:latest` with a specific tag, e.g. `ghcr.io/etrakselis/ajo-content-mcp:1.0.0`.

---

Full documentation: **[github.com/etrakselis/ajo_content_mgmt_mcp](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md)**
