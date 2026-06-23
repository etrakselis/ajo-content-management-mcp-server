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
jest.mock('../../src/github/sync', () => ({
  commitAuditTrail: jest.fn().mockResolvedValue(undefined),
  createApprovalPR: jest.fn()
}));

jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getStatus: jest.fn().mockReturnValue({ configured: true, tokenCached: true }) }
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: jest.fn().mockReturnValue(true),
  getConfiguredSandboxName: jest.fn().mockReturnValue('etrakselis-sandbox'),
  getConfiguredOrgName: jest.fn().mockReturnValue('Acme'),
  getConfiguredTenantId: jest.fn().mockReturnValue('acme'),
  getConfiguredAuthorEmail: jest.fn().mockReturnValue('author@example.com'),
  getConfiguredNamingConvention: jest.fn().mockReturnValue(undefined),
  getConfiguredGitHubIntegration: jest.fn().mockReturnValue(undefined),
  listFragments: jest.fn().mockResolvedValue({ items: [] }),
  archiveFragment: jest.fn().mockResolvedValue({ id: 'frag-1', etag: '"v2"' }),
  createFragment: jest.fn().mockResolvedValue({ id: 'frag-new', location: '/fragments/frag-new' }),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  // Unused by these tests but imported by the tool modules at load time.
  listTemplates: jest.fn(), createTemplate: jest.fn(), getTemplate: jest.fn(),
  updateTemplate: jest.fn(), patchTemplate: jest.fn(), deleteTemplate: jest.fn(),
  getFragment: jest.fn(), updateFragment: jest.fn(), patchFragment: jest.fn(),
  publishFragment: jest.fn().mockResolvedValue({ accepted: true, location: '/fragments/frag-1/publishStatus' }),
  getLiveFragment: jest.fn(), getLastPublicationStatus: jest.fn()
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/mcp/server';
import { setWritesAllowed } from '../../src/mcp/access-policy';
import { archiveFragment, createFragment, publishFragment, listFragments } from '../../src/adobe/client';

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

  test('publishing is re-confirmed every time (irreversible, never cached)', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    await client.callTool({ name: 'publish_content_fragment', arguments: { fragmentId: UUID } });
    await client.callTool({ name: 'publish_content_fragment', arguments: { fragmentId: UUID } });

    // Publishing cannot be undone, so it is confirmed on every call (not cached).
    expect(elicitHandler).toHaveBeenCalledTimes(2);
    expect(publishFragment).toHaveBeenCalledTimes(2);
  });

  test('publishing is blocked when the user declines the confirmation', async () => {
    const { client } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'decline' as const })
    });

    const res = await client.callTool({ name: 'publish_content_fragment', arguments: { fragmentId: UUID } }) as {
      structuredContent?: { error?: { code?: string } };
    };
    expect(res.structuredContent?.error?.code).toBe('WRITE_CANCELLED');
    expect(publishFragment).not.toHaveBeenCalled();
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

  test('write tools advertise the confirmWrite flag; read tools do not', async () => {
    const { client } = await connectClient({ elicitation: false });
    const { tools } = await client.listTools();

    const archive = tools.find(t => t.name === 'archive_content_fragment')!;
    const props = archive.inputSchema.properties as Record<string, unknown> | undefined;
    expect(props?.confirmWrite).toBeDefined();
    // Optional — the gate holds the write when it's absent, so it must not be required.
    expect(archive.inputSchema.required as string[] | undefined).not.toContain('confirmWrite');

    const read = tools.find(t => t.name === 'list_content_fragments')!;
    expect((read.inputSchema.properties as Record<string, unknown> | undefined)?.confirmWrite).toBeUndefined();
  });

  test('confirmWrite description matches each tool\'s actual first-call behavior (A′)', async () => {
    const { client } = await connectClient({ elicitation: false });
    const { tools } = await client.listTools();
    const confirmDesc = (name: string) => {
      const t = tools.find(x => x.name === name)!;
      return ((t.inputSchema.properties as Record<string, { description?: string }>).confirmWrite?.description) ?? '';
    };

    // Non-destructive: held once per target per session, then proceeds.
    const create = confirmDesc('create_content_fragment');
    expect(create).toMatch(/FIRST write to a given target/);
    expect(create).toMatch(/later non-destructive writes proceed/i);
    expect(create).not.toMatch(/EVERY call/);

    // Destructive / irreversible: re-confirmed on every call.
    for (const name of ['archive_content_fragment', 'delete_content_template', 'publish_content_fragment']) {
      expect(confirmDesc(name)).toMatch(/EVERY call/);
    }
  });

  test('reads are never gated by confirmation', async () => {
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    await client.callTool({ name: 'list_content_fragments', arguments: {} });

    expect(elicitHandler).not.toHaveBeenCalled();
  });

  test('read-only mode rejects a write before confirmation is even attempted', async () => {
    setWritesAllowed(false);
    const { client, elicitHandler } = await connectClient({
      elicitation: true,
      respond: () => ({ action: 'accept', content: { confirm: true } })
    });

    const res = await client.callTool({ name: 'archive_content_fragment', arguments: { fragmentId: UUID } }) as {
      isError?: boolean; structuredContent?: { error?: { code?: string } };
    };

    // READ_ONLY_MODE is enforced ahead of the confirmation gate, so the user is
    // never prompted and the handler never runs.
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('READ_ONLY_MODE');
    expect(elicitHandler).not.toHaveBeenCalled();
    expect(archiveFragment).not.toHaveBeenCalled();
  });
});

describe('write result safety (P0-1 / P2-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWritesAllowed(true);
  });

  test('a committed write whose result cannot be serialized is not reported as a failure (P0-1)', async () => {
    // A BigInt slipping into the passthrough payload makes JSON.stringify throw;
    // an unguarded result would be rejected by the SDK as an invalid tool result —
    // a false negative for a write that already committed. toToolResult must fall
    // back to a valid, success-preserving structured result instead.
    (createFragment as jest.Mock).mockResolvedValueOnce({ id: 'frag-new', location: '/fragments/frag-new', weird: 10n });
    const { client } = await connectClient({ elicitation: false });

    const res = await client.callTool({
      name: 'create_content_fragment',
      arguments: { name: 'Banner', type: 'html', channels: ['email'], fragment: { content: '<div/>' }, confirmWrite: true }
    }) as { isError?: boolean; structuredContent?: { success?: boolean } };

    expect(createFragment).toHaveBeenCalledTimes(1);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.success).toBe(true);
  });

  test('confirmWrite:true preset on the first call does not bypass payload validation (P2-3)', async () => {
    const { client } = await connectClient({ elicitation: false });

    const res = await client.callTool({
      name: 'create_content_fragment',
      // Invalid: html fragment with no fragment.content.
      arguments: { name: 'Bad', type: 'html', channels: ['email'], fragment: {}, confirmWrite: true }
    }) as { isError?: boolean; structuredContent?: { error?: { code?: string } } };

    expect(res.structuredContent?.error?.code).toBe('VALIDATION_ERROR');
    expect(createFragment).not.toHaveBeenCalled();
  });
});

describe('structured errors (C1a)', () => {
  test('an unexpected handler error surfaces as a structured error, never a bare opaque string', async () => {
    (listFragments as jest.Mock).mockRejectedValueOnce(new Error('kaboom'));
    const { client } = await connectClient({ elicitation: false });
    const res = await client.callTool({ name: 'list_content_fragments', arguments: {} }) as {
      isError?: boolean; structuredContent?: { success?: boolean; error?: { code?: string } };
    };
    expect(res.structuredContent?.success).toBe(false);
    expect(typeof res.structuredContent?.error?.code).toBe('string');
    expect((res.structuredContent?.error?.code ?? '').length).toBeGreaterThan(0);
  });
});

describe('tool display titles', () => {
  test('annotations.title is synthesized from the top-level title for every tool', async () => {
    const { client } = await connectClient({ elicitation: false });
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      // Mirrored into the older annotation field for clients that read it, without
      // the source definitions repeating the string in two places.
      expect(tool.annotations?.title).toBe(tool.title);
    }
  });
});
