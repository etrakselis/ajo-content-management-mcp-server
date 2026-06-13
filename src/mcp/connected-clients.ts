// Tracks which MCP clients have connected to this server, captured from the
// `clientInfo` carried in the MCP `initialize` handshake. Surfaced on the
// landing page so the user can see which client the server is serving (e.g.
// the Claude Desktop app connected via the mcp-remote bridge) instead of being
// shown generic connection instructions.
//
// Liveness model: HTTP clients (e.g. Claude Desktop via mcp-remote) hold open a
// long-lived GET SSE stream for the life of the session. We treat an open
// stream as "connected" and remove the client shortly after it closes — there
// is no keepalive traffic to lean on, so the stream lifecycle is the reliable
// signal. STDIO clients are 1:1 with the process and are removed explicitly on
// transport close.

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

// Grace period after the last SSE stream closes before an HTTP client drops off
// the list. Absorbs brief stream reconnects without lingering after disconnect.
const HTTP_GRACE_MS = 10_000;

// mcp-remote probes the transport with this synthetic identity before
// forwarding the real client — ignore it so only the actual client shows.
const IGNORED_CLIENT_NAMES = new Set(['mcp-remote-fallback-test']);

const clients = new Map<string, Entry>();

const keyOf = (name: string, transport: TransportKind): string => `${transport}:${name}`;

function touch(name: string, version: string | undefined, transport: TransportKind): Entry | null {
  if (IGNORED_CLIENT_NAMES.has(name)) return null;
  const key = keyOf(name, transport);
  const now = new Date().toISOString();
  let e = clients.get(key);
  if (e) {
    if (version) e.version = version;
    e.lastSeenAt = now;
  } else {
    e = { name, version, transport, firstSeenAt: now, lastSeenAt: now, openStreams: 0 };
    clients.set(key, e);
  }
  return e;
}

export function recordClient(name: string, version: string | undefined, transport: TransportKind): void {
  touch(name, version, transport);
}

/** An SSE stream opened for this client (HTTP transport). */
export function openStream(name: string, version: string | undefined): void {
  const e = touch(name, version, 'http');
  if (e) e.openStreams += 1;
}

/** A previously-opened SSE stream closed (HTTP transport). */
export function closeStream(name: string): void {
  const e = clients.get(keyOf(name, 'http'));
  if (!e) return;
  e.openStreams = Math.max(0, e.openStreams - 1);
  e.lastSeenAt = new Date().toISOString();
}

/** Remove a client outright (STDIO transport close). */
export function removeClient(name: string, transport: TransportKind): void {
  clients.delete(keyOf(name, transport));
}

export function getConnectedClients(): ConnectedClient[] {
  const now = Date.now();
  const out: ConnectedClient[] = [];
  for (const [key, e] of clients) {
    // STDIO stays until explicitly removed; HTTP stays while a stream is open
    // or within the grace window after the last one closed.
    const connected =
      e.transport === 'stdio' ||
      e.openStreams > 0 ||
      now - Date.parse(e.lastSeenAt) < HTTP_GRACE_MS;
    if (!connected) {
      clients.delete(key);
      continue;
    }
    out.push({
      name: e.name,
      version: e.version,
      transport: e.transport,
      firstSeenAt: e.firstSeenAt,
      lastSeenAt: e.lastSeenAt
    });
  }
  return out.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}
