// Tracks which MCP clients are connected, for display on the landing page.
//
// HTTP clients run over a *stateful* Streamable HTTP session: each client is
// assigned a session ID at `initialize` and includes it on every subsequent
// request, so even tool calls (which carry no clientInfo) are reliably
// attributable to the right client — this is what makes the list correct when
// more than one client (e.g. Claude Code + Claude Desktop) is connected at once.
// HTTP clients are therefore keyed by session ID. STDIO clients are 1:1 with the
// process and keyed by name.

export type TransportKind = 'stdio' | 'http';

export interface ConnectedClient {
  name: string;
  version?: string;
  transport: TransportKind;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface Entry extends ConnectedClient {
  openStreams: number;
}

// Safety net: drop an HTTP session from the display this long after its last
// activity once it has no open stream, in case `onclose` never fires (unclean
// disconnect). Clean exits are removed immediately via removeSession().
const HTTP_STALE_MS = 10_000;

// mcp-remote probes the transport with this synthetic identity before forwarding
// the real client — ignore it so only the actual client shows.
const IGNORED_CLIENT_NAMES = new Set(['mcp-remote-fallback-test']);

const clients = new Map<string, Entry>();

const nowIso = () => new Date().toISOString();
const stdioKey = (name: string) => `stdio:${name}`;

// ── STDIO transport (1:1 with the process, keyed by name) ───────────────────

/** Record/refresh a STDIO client. Returns false if the name is filtered. */
export function recordClient(name: string, version: string | undefined): boolean {
  if (IGNORED_CLIENT_NAMES.has(name)) return false;
  const key = stdioKey(name);
  const e = clients.get(key);
  if (e) {
    if (version) e.version = version;
    e.lastSeenAt = nowIso();
  } else {
    clients.set(key, { name, version, transport: 'stdio', firstSeenAt: nowIso(), lastSeenAt: nowIso(), openStreams: 0 });
  }
  return true;
}

export function removeClient(name: string): void {
  clients.delete(stdioKey(name));
}

// ── HTTP transport (keyed by MCP session ID) ────────────────────────────────

export function addSession(sessionId: string, name: string, version: string | undefined): void {
  if (IGNORED_CLIENT_NAMES.has(name)) return;
  clients.set(sessionId, { name, version, transport: 'http', firstSeenAt: nowIso(), lastSeenAt: nowIso(), openStreams: 0 });
}

/** Mark activity on a session (any request). */
export function touchSession(sessionId: string): void {
  const e = clients.get(sessionId);
  if (e) e.lastSeenAt = nowIso();
}

export function openSessionStream(sessionId: string): void {
  const e = clients.get(sessionId);
  if (e) { e.openStreams += 1; e.lastSeenAt = nowIso(); }
}

export function closeSessionStream(sessionId: string): void {
  const e = clients.get(sessionId);
  if (e) { e.openStreams = Math.max(0, e.openStreams - 1); e.lastSeenAt = nowIso(); }
}

export function removeSession(sessionId: string): void {
  clients.delete(sessionId);
}

export function getConnectedClients(): ConnectedClient[] {
  const t = Date.now();
  // Prune HTTP sessions that have gone quiet with no open stream (unclean exits).
  for (const [key, e] of clients) {
    if (e.transport === 'http' && e.openStreams <= 0 && t - Date.parse(e.lastSeenAt) > HTTP_STALE_MS) {
      clients.delete(key);
    }
  }
  // De-duplicate by client name — multiple sessions of the same app show once,
  // keeping the most recently active.
  const byName = new Map<string, Entry>();
  for (const e of clients.values()) {
    const existing = byName.get(e.name);
    if (!existing || existing.lastSeenAt < e.lastSeenAt) byName.set(e.name, e);
  }
  return [...byName.values()]
    .map(e => ({ name: e.name, version: e.version, transport: e.transport, firstSeenAt: e.firstSeenAt, lastSeenAt: e.lastSeenAt }))
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}
