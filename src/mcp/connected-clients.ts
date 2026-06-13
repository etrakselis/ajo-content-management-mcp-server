// Tracks which MCP clients have connected to this server, captured from the
// `clientInfo` carried in the MCP `initialize` handshake. Surfaced on the
// landing page so the user can see which client the server is serving (e.g.
// the Claude Desktop app that launched the container) instead of being shown
// generic connection instructions.

export type TransportKind = 'stdio' | 'http';

export interface ConnectedClient {
  name: string;
  version?: string;
  transport: TransportKind;
  firstSeenAt: string;
  lastSeenAt: string;
}

const clients = new Map<string, ConnectedClient>();

const keyOf = (name: string, transport: TransportKind): string => `${transport}:${name}`;

export function recordClient(name: string, version: string | undefined, transport: TransportKind): void {
  const key = keyOf(name, transport);
  const now = new Date().toISOString();
  const existing = clients.get(key);
  if (existing) {
    if (version) existing.version = version;
    existing.lastSeenAt = now;
  } else {
    clients.set(key, { name, version, transport, firstSeenAt: now, lastSeenAt: now });
  }
}

export function removeClient(name: string, transport: TransportKind): void {
  clients.delete(keyOf(name, transport));
}

export function getConnectedClients(): ConnectedClient[] {
  return Array.from(clients.values()).sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}
