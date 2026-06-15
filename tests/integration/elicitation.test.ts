/**
 * Integration tests for write-confirmation via elicitation.
 *
 * Drives the real createMcpServer over an in-memory transport with a simulated
 * client. Verifies that write tools are confirmed with the user when the client
 * supports elicitation (declines block the write; accepts let it through),
 * destructive writes are re-confirmed every time, non-destructive writes are
 * confirmed once per sandbox per session, and clients without elicitation
 * support fall back to the confirm-and-retry gate (writes held with
 * WRITE_CONFIRMATION_REQUIRED until re-invoked with confirmWrite: true).
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/telemetry/audit', () => ({ recordAudit: jest.fn() }));

jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getStatus: jest.fn().mockReturnValue({ configured: true, tokenCached: true }) }
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: jest.fn().mockReturnValue(true),
  getConfiguredSandboxName: jest.fn().mockReturnValue('etrakselis-sandbox'),
  getConfiguredOrgName: jest.fn().mockReturnValue('Acme'),
  getConfiguredTenantId: jest.fn().mockReturnValue('acme'),
  getConfiguredAuthorEmail: jest.fn().mockReturnValue('author@example.com'),
  listFragments: jest.fn().mockResolvedValue({ items: [] }),
  archiveFragment: jest.fn().mockResolvedValue({ id: 'frag-1', etag: '"v2"' }),
  createFragment: jest.fn().mockResolvedValue({ id: 'frag-new', location: '/fragments/frag-new' }),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  // Unused by these tests but imported by the tool modules at load time.
  listTemplates: jest.fn(), createTemplate: jest.fn(), getTemplate: jest.fn(),
  updateTemplate: jest.fn(), patchTemplate: jest.fn(), deleteTemplate: jest.fn(),
  getFragment: jest.fn(), updateFragment: jest.fn(), patchFragment: jest.fn(),
  publishFragment: jest.fn(), getLiveFragment: jest.fn(), getLastPublicationStatus: jest.fn()
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/mcp/server';
import { setWritesAllowed } from '../../src/mcp/access-policy';
import { archiveFragment, createFragment } from '../../src/adobe/client';

const UUID = 'b6d70a45-a149-453b-85ba-809a5d40066d';

type ElicitResult = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };

async function connectClient(opts: { elicitation: boolean; respond?: () => ElicitResult }) {
  const elicitHandler = jest.fn(async () => (opts.respond ? opts.respond() : { action: 'decline' as const }));
  const server = createMcpServer('http');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'TestClient', version: '1.0.0' },
    { capabilities: opts.elicitation ? { elicitation: {} } : {} }
  );
  if (opts.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, elicitHandler);
  }
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, elicitHandler };
}

describe('write-confirmation via elicitation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWritesAllowed(true);
  });

  test('blocks the write with WRITE_CANCELLED when the user declines', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'decline' })
    });

    const res = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      isError?: boolean; structuredContent?: { success?: boolean; error?: { code?: string } };
    };

    expect(elicitHandler).toHaveBeenCalledTimes(1);
    expect(archiveFragment).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.success).toBe(false);
    expect(res.structuredContent?.error?.code).toBe('WRITE_CANCELLED');
  });

  test('blocks the write when the user accepts but does not confirm', async () => {
    const { client } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: false } })
    });

    const res = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      structuredContent?: { error?: { code?: string } };
    };

    expect(archiveFragment).not.toHaveBeenCalled();
    expect(res.structuredContent?.error?.code).toBe('WRITE_CANCELLED');
  });

  test('performs the write when the user confirms', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    const res = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      isError?: boolean; structuredContent?: { success?: boolean; id?: string };
    };

    expect(elicitHandler).toHaveBeenCalledTimes(1);
    expect(archiveFragment).toHaveBeenCalledWith(UUID);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.success).toBe(true);
  });

  test('destructive writes are re-confirmed every time (never cached)', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } });
    await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } });

    expect(elicitHandler).toHaveBeenCalledTimes(2);
    expect(archiveFragment).toHaveBeenCalledTimes(2);
  });

  test('non-destructive writes are confirmed once per sandbox per session', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    const args = { name: 'Banner', type: 'html', channels: ['email'], fragment: { content: '<div/>' } };
    await client.callTool({ name: 'create_content_fragment', arguments: args });
    await client.callTool({ name: 'create_content_fragment', arguments: args });

    // Prompted only on the first write; the second reuses the session confirmation.
    expect(elicitHandler).toHaveBeenCalledTimes(1);
    expect(createFragment).toHaveBeenCalledTimes(2);
  });

  test('clients without elicitation: a write is held with WRITE_CONFIRMATION_REQUIRED until confirmed', async () => {
    const { client } = await connectClient({ elicitation: false });

    const res = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      isError?: boolean; structuredContent?: { success?: boolean; error?: { code?: string } };
    };

    expect(archiveFragment).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('WRITE_CONFIRMATION_REQUIRED');
  });

  test('clients without elicitation: re-invoking with confirmWrite:true executes the write', async () => {
    const { client } = await connectClient({ elicitation: false });

    const res = await client.callTool({
      name: 'archive_content_fragment',
      arguments: { fragmentId: UUID, confirmWrite: true }
    }) as { isError?: boolean; structuredContent?: { success?: boolean } };

    // The synthetic confirmWrite flag is stripped before reaching the handler.
    expect(archiveFragment).toHaveBeenCalledWith(UUID);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.success).toBe(true);
  });

  test('clients without elicitation: non-destructive writes are confirmed once per session', async () => {
    const { client } = await connectClient({ elicitation: false });
    const args = { name: 'Banner', type: 'html', channels: ['email'], fragment: { content: '<div/>' } };

    // First call without confirmation is held.
    const first = await client.callTool({ name: 'create_content_fragment', arguments: args }) as {
      structuredContent?: { error?: { code?: string } };
    };
    expect(first.structuredContent?.error?.code).toBe('WRITE_CONFIRMATION_REQUIRED');
    expect(createFragment).not.toHaveBeenCalled();

    // Confirmed call executes and caches the target for the session.
    await client.callTool({ name: 'create_content_fragment', arguments: { ...args, confirmWrite: true } });
    // A later non-destructive write reuses the session confirmation — no flag needed.
    await client.callTool({ name: 'create_content_fragment', arguments: args });

    expect(createFragment).toHaveBeenCalledTimes(2);
  });

  test('clients without elicitation: destructive writes require confirmWrite every time', async () => {
    const { client } = await connectClient({ elicitation: false });

    await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID, confirmWrite: true } });
    // Second destructive call without the flag is held again (never cached).
    const second = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      structuredContent?: { error?: { code?: string } };
    };

    expect(second.structuredContent?.error?.code).toBe('WRITE_CONFIRMATION_REQUIRED');
    expect(archiveFragment).toHaveBeenCalledTimes(1);
  });

  test('reads are never gated by confirmation', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    await client.callTool({ name: 'list_content_fragments', arguments: {} });

    expect(elicitHandler).not.toHaveBeenCalled();
  });
});
