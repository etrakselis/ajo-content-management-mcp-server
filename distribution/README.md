# AJO Content MCP Server — Quickstart

Run the **AJO Content MCP Server** from its pre-built container image — no source code, no build. This folder contains everything you need: this guide and a `docker-compose.yml`.

> **This is the abridged run guide.** For the project overview, the full tool catalog, personalization guidance, security model, and troubleshooting, see the **[main repository README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md)**.

---

## What you need first

1. **Git**, to download this folder. Check if it's already installed by running `git --version` in a terminal. If not:
   - **macOS:** install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) by running `xcode-select --install`, or install [Git directly](https://git-scm.com/download/mac).
   - **Windows:** download and install [Git for Windows](https://git-scm.com/download/win), which includes Git Bash.
2. **Docker Desktop**, installed and running (the whale icon shows "Docker Desktop is running"). Download: [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
3. **An Adobe API credentials file** (a Postman-environment JSON export from the Adobe Developer Console). Obtaining it requires admin access to the Adobe Developer Console and AJO — the **[full setup steps are in the main README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#prerequisites)**. You upload this file in Step 2 below.

---

## 0. Get this folder

If you haven't already, clone the repository and navigate into the distribution folder.

**macOS** (Terminal):
```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/etrakselis/ajo_content_mgmt_mcp.git && cd ajo_content_mgmt_mcp && git sparse-checkout set distribution && cd distribution
```

**Windows** (Command Prompt or PowerShell):
```
git clone --depth 1 --filter=blob:none --sparse https://github.com/etrakselis/ajo_content_mgmt_mcp.git
```
```
cd ajo_content_mgmt_mcp
```
```
git sparse-checkout set distribution
```
```
cd distribution
```

---

## 1. Start the server

> **Make sure Docker Desktop is running first** — look for the whale icon in your menu bar (macOS) or system tray (Windows) showing "Docker Desktop is running." The command below will fail if the Docker engine isn't started.

From this folder (the one containing `docker-compose.yml`):

```bash
docker compose up -d
```

The first run **pulls** the multi-arch image automatically and starts it in the background. Docker selects the right build for your CPU (Apple Silicon or Intel/AMD).

Then open **http://localhost:3000**.

> **Can't reach the page?** The server binds to loopback only by design. If `localhost` doesn't resolve, try **http://127.0.0.1:3000**.

### Everyday commands

```bash
docker compose logs -f     # watch logs (Ctrl+C to stop watching)
docker compose pull        # fetch the latest published image
docker compose up -d       # start (or restart after a pull)
docker compose down        # stop and remove the container
```

> **Pin a version** for reproducibility: edit `docker-compose.yml` and replace `:latest` with a specific tag, e.g. `ghcr.io/etrakselis/ajo-content-mcp:1.0.0`.

---

## 2. Configure MCP Server (in the browser)

The setup UI reveals one step at a time:

1. **Upload** your Adobe credentials (environment) file.
2. **Select** the sandbox (auto-populated from your credentials).
3. **Set the access mode** — read-only (default) or read & write.
4. **Enter your email** and click **Start MCP Server**.

Details for each step are in the **[MCP Server Configuration section of the main README](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#mcp-server-configuration)**.

---

## 3. Connect your client

### Claude Desktop

Claude Desktop only speaks STDIO, so it can't connect to an HTTP URL directly. The [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge handles this — **do not** have Claude Desktop launch its own container, or it will collide with the one already running on port 3000 and start unconfigured.

**Install Node.js first.** `npx` ships with npm, which ships with [Node.js](https://nodejs.org/en/download). Without it, Claude Desktop fails with `spawn npx ENOENT`. After installing, verify with:
```bash
npx --version
```
You do **not** need to install `mcp-remote` separately — `npx -y mcp-remote` downloads and caches it on first run.

Add the following to your Claude Desktop config file, then restart Claude Desktop:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

> **`npx` not found after installing Node?** Claude Desktop uses the GUI app's `PATH`, which on macOS often differs from your terminal's (common with `nvm` or Homebrew installs). Fix it by installing Node via the official `.pkg` (macOS) / `.msi` (Windows) installer, or use the absolute path: find it with `which npx` (macOS) / `where npx` (Windows) and set e.g. `"command": "/usr/local/bin/npx"`.

For other clients (Claude Code, Cursor, Codex), see the **[Client Connection Guide](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md#client-connection-guide)**.

---

Full documentation: **[github.com/etrakselis/ajo_content_mgmt_mcp](https://github.com/etrakselis/ajo_content_mgmt_mcp/blob/main/README.md)**
