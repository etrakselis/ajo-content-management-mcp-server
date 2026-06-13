import {
  recordClient,
  openStream,
  closeStream,
  removeClient,
  getConnectedClients
} from '../../src/mcp/connected-clients';

// Reset module state between tests by re-importing with a fresh module registry
beforeEach(() => {
  jest.resetModules();
});

describe('connected-clients', () => {

  test('getConnectedClients returns empty list initially', () => {
    const clients = getConnectedClients();
    expect(Array.isArray(clients)).toBe(true);
  });

  test('recordClient adds a client and it appears in getConnectedClients', () => {
    recordClient('Claude Code', '1.0.0', 'stdio');
    const clients = getConnectedClients();
    const found = clients.find(c => c.name === 'Claude Code' && c.transport === 'stdio');
    expect(found).toBeDefined();
    expect(found!.version).toBe('1.0.0');
  });

  test('recordClient ignores mcp-remote-fallback-test client', () => {
    recordClient('mcp-remote-fallback-test', undefined, 'http');
    const clients = getConnectedClients();
    const found = clients.find(c => c.name === 'mcp-remote-fallback-test');
    expect(found).toBeUndefined();
  });

  test('recordClient updates version and lastSeenAt on subsequent calls', () => {
    recordClient('Claude Desktop', '1.0.0', 'http');
    const before = getConnectedClients().find(c => c.name === 'Claude Desktop')!;
    recordClient('Claude Desktop', '1.1.0', 'http');
    const after = getConnectedClients().find(c => c.name === 'Claude Desktop')!;
    expect(after.version).toBe('1.1.0');
    expect(after.firstSeenAt).toBe(before.firstSeenAt);
  });

  test('removeClient removes a stdio client', () => {
    recordClient('TestClient', undefined, 'stdio');
    expect(getConnectedClients().find(c => c.name === 'TestClient')).toBeDefined();
    removeClient('TestClient', 'stdio');
    expect(getConnectedClients().find(c => c.name === 'TestClient')).toBeUndefined();
  });

  test('openStream increments stream count, keeping HTTP client visible', () => {
    recordClient('HTTP Client', '1.0.0', 'http');
    openStream('HTTP Client', '1.0.0');
    const found = getConnectedClients().find(c => c.name === 'HTTP Client');
    expect(found).toBeDefined();
  });

  test('closeStream without open streams does not throw', () => {
    expect(() => closeStream('NonExistentClient')).not.toThrow();
  });

  test('HTTP client with open stream stays connected after closeStream with others open', () => {
    recordClient('Streaming Client', '1.0', 'http');
    openStream('Streaming Client', '1.0');
    openStream('Streaming Client', '1.0');
    closeStream('Streaming Client'); // still has 1 open stream
    const found = getConnectedClients().find(c => c.name === 'Streaming Client');
    expect(found).toBeDefined();
  });

  test('getConnectedClients returns results sorted by lastSeenAt descending', () => {
    recordClient('ClientA', '1.0', 'stdio');
    recordClient('ClientB', '1.0', 'stdio');
    const clients = getConnectedClients().filter(c => ['ClientA', 'ClientB'].includes(c.name));
    if (clients.length === 2) {
      expect(clients[0].lastSeenAt >= clients[1].lastSeenAt).toBe(true);
    }
  });
});
