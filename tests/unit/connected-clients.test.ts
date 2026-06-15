import {
  recordClient,
  removeClient,
  addSession,
  openSessionStream,
  closeSessionStream,
  removeSession,
  getConnectedClients
} from '../../src/mcp/connected-clients';

// Note: the module keeps a single in-memory client map, so state carries across
// tests in this file. Assertions therefore look up clients by name rather than
// asserting exact list lengths.

describe('connected-clients', () => {

  test('getConnectedClients returns an array initially', () => {
    expect(Array.isArray(getConnectedClients())).toBe(true);
  });

  // ── STDIO clients (keyed by name) ──────────────────────────────────────────

  test('recordClient adds a stdio client that appears in the list', () => {
    recordClient('Claude Code', '1.0.0');
    const found = getConnectedClients().find(c => c.name === 'Claude Code' && c.transport === 'stdio');
    expect(found).toBeDefined();
    expect(found!.version).toBe('1.0.0');
  });

  test('recordClient ignores the mcp-remote-fallback-test probe', () => {
    const added = recordClient('mcp-remote-fallback-test', undefined);
    expect(added).toBe(false);
    expect(getConnectedClients().find(c => c.name === 'mcp-remote-fallback-test')).toBeUndefined();
  });

  test('recordClient updates version and preserves firstSeenAt on repeat calls', () => {
    recordClient('Cursor', '1.0.0');
    const before = getConnectedClients().find(c => c.name === 'Cursor')!;
    recordClient('Cursor', '1.1.0');
    const after = getConnectedClients().find(c => c.name === 'Cursor')!;
    expect(after.version).toBe('1.1.0');
    expect(after.firstSeenAt).toBe(before.firstSeenAt);
  });

  test('removeClient removes a stdio client', () => {
    recordClient('TempClient', undefined);
    expect(getConnectedClients().find(c => c.name === 'TempClient')).toBeDefined();
    removeClient('TempClient');
    expect(getConnectedClients().find(c => c.name === 'TempClient')).toBeUndefined();
  });

  // ── HTTP clients (keyed by MCP session id) ──────────────────────────────────

  test('addSession registers an HTTP client keyed by session id', () => {
    addSession('sess-1', 'Claude Desktop', '2.0.0');
    const found = getConnectedClients().find(c => c.name === 'Claude Desktop' && c.transport === 'http');
    expect(found).toBeDefined();
    expect(found!.version).toBe('2.0.0');
  });

  test('addSession ignores the mcp-remote-fallback-test probe', () => {
    addSession('sess-probe', 'mcp-remote-fallback-test', undefined);
    expect(getConnectedClients().find(c => c.name === 'mcp-remote-fallback-test')).toBeUndefined();
  });

  test('an HTTP session with an open stream stays visible', () => {
    addSession('sess-stream', 'Streaming Client', '1.0');
    openSessionStream('sess-stream');
    openSessionStream('sess-stream');
    closeSessionStream('sess-stream'); // one stream still open
    expect(getConnectedClients().find(c => c.name === 'Streaming Client')).toBeDefined();
  });

  test('closeSessionStream / removeSession on unknown ids do not throw', () => {
    expect(() => closeSessionStream('nope')).not.toThrow();
    expect(() => removeSession('nope')).not.toThrow();
  });

  test('removeSession removes an HTTP client', () => {
    addSession('sess-remove', 'Removable', '1.0');
    expect(getConnectedClients().find(c => c.name === 'Removable')).toBeDefined();
    removeSession('sess-remove');
    expect(getConnectedClients().find(c => c.name === 'Removable')).toBeUndefined();
  });

  test('results are sorted by lastSeenAt descending', () => {
    recordClient('ClientA', '1.0');
    recordClient('ClientB', '1.0');
    const clients = getConnectedClients();
    for (let i = 1; i < clients.length; i++) {
      expect(clients[i - 1].lastSeenAt >= clients[i].lastSeenAt).toBe(true);
    }
  });
});
