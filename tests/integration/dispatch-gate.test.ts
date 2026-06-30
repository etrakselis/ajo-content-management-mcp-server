/**
 * Integration tests for the CallTool DISPATCH MATRIX — the branches in the central
 * CallTool handler that the elicitation suite doesn't exercise:
 *   - a validateOnly create is a dry run: it bypasses BOTH the read-only gate and the
 *     write-confirmation gate, and persists nothing;
 *   - GitHub PR Approval Gate: a write opens a PR instead of touching AJO;
 *   - an unknown tool name returns a structured TOOL_NOT_FOUND (never throws);
 *   - read-only mode still ADVERTISES every write tool (enforcement is at call time,
 *     not by hiding tools, so clients that cache the list aren't stranded).
 *
 * Drives the real createMcpServer over an in-memory transport, same as the
 * elicitation suite; the Adobe client + GitHub sync are mocked so no network is hit.
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
  createFragment: jest.fn().mockResolvedValue({ id: 'frag-new', location: '/fragments/frag-new', etag: '"v1"' }),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  listTemplates: jest.fn(), createTemplate: jest.fn(), getTemplate: jest.fn(),
  updateTemplate: jest.fn(), patchTemplate: jest.fn(), deleteTemplate: jest.fn(),
  getFragment: jest.fn(), updateFragment: jest.fn(), patchFragment: jest.fn(),
  publishFragment: jest.fn(), getLiveFragment: jest.fn(), getLastPublicationStatus: jest.fn()
}));

// The Unified Tags/Folders client backs the tag + folder tools. create_tag resolves
// to a real id here so we can assert it flows back through the dispatch (bypassing the
// approval gate) instead of being turned into a PR.
jest.mock('../../src/adobe/unified-tags-client', () => ({
  createTag: jest.fn().mockResolvedValue({ id: 'tag-new-123', name: 'brand-test' }),
  updateTag: jest.fn(), deleteTag: jest.fn(), listTags: jest.fn(), getTag: jest.fn(),
  validateTags: jest.fn(), listTagCategories: jest.fn(), getTagCategory: jest.fn(),
  createFolder: jest.fn(), getFolder: jest.fn(), updateFolder: jest.fn(),
  deleteFolder: jest.fn(), getSubfolders: jest.fn(), validateFolder: jest.fn(),
  clearFolderPathCache: jest.fn(), resolveAjoFolderPath: jest.fn().mockResolvedValue(undefined)
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server';
import { setWritesAllowed } from '../../src/mcp/access-policy';
import { createFragment, getConfiguredGitHubIntegration } from '../../src/adobe/client';
import { createTag } from '../../src/adobe/unified-tags-client';
import { createApprovalPR } from '../../src/github/sync';

const VALID_FRAGMENT = {
  name: 'Header Banner',
  type: 'html' as const,
  channels: ['email'],
  fragment: { content: '<div>hi</div>' }
};

type ToolResult = {
  isError?: boolean;
  structuredContent?: {
    success?: boolean; validated?: boolean; prCreated?: boolean;
    prUrl?: string; error?: { code?: string }; data?: { id?: string };
  };
};

async function connectClient() {
  const server = createMcpServer('http');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // No elicitation capability — keeps the focus on the dispatch branches, not the
  // confirmation dialog (covered by the elicitation suite).
  const client = new Client({ name: 'TestClient', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('CallTool dispatch matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWritesAllowed(true);
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(undefined);
  });

  test('a validateOnly create is a dry run: bypasses read-only + confirmation, persists nothing', async () => {
    // Read-only ON would normally reject a create, and a no-elicitation client would
    // normally hold it with WRITE_CONFIRMATION_REQUIRED. A dry run skips BOTH.
    setWritesAllowed(false);
    const client = await connectClient();

    const res = await client.callTool({
      name: 'create_content_fragment',
      arguments: { ...VALID_FRAGMENT, validateOnly: true }
    }) as ToolResult;

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.success).toBe(true);
    expect(res.structuredContent?.validated).toBe(true);
    expect(createFragment).not.toHaveBeenCalled(); // nothing persisted
  });

  test('GitHub PR Approval Gate: a write opens a PR instead of writing to AJO', async () => {
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue({
      owner: 'o', repo: 'r', token: 't', defaultBranch: 'main', requireApproval: true
    });
    (createApprovalPR as jest.Mock).mockResolvedValue({
      prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', filePath: 'etrakselis-sandbox/content-fragments/Header Banner.json'
    });
    const client = await connectClient();

    const res = await client.callTool({
      // confirmWrite clears the no-elicitation confirmation gate so we reach the PR branch.
      name: 'create_content_fragment',
      arguments: { ...VALID_FRAGMENT, confirmWrite: true }
    }) as ToolResult;

    expect(createApprovalPR).toHaveBeenCalledTimes(1);
    expect(createFragment).not.toHaveBeenCalled(); // routed to a PR, not to AJO
    expect(res.structuredContent?.success).toBe(true);
    expect(res.structuredContent?.prCreated).toBe(true);
    expect(res.structuredContent?.prUrl).toBe('https://github.com/o/r/pull/7');
  });

  test('create_tag in approval-gate applies directly (bypasses the PR gate) and returns an id', async () => {
    // Tag writes are in GITHUB_BYPASS_TOOLS: even in approval-gate mode they apply to
    // AJO directly so the new tag's id is available immediately (no merge+deploy first).
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue({
      owner: 'o', repo: 'r', token: 't', defaultBranch: 'main', requireApproval: true
    });
    const client = await connectClient();

    const res = await client.callTool({
      name: 'create_tag',
      arguments: { name: 'brand-test', confirmWrite: true }
    }) as ToolResult;

    expect(createTag).toHaveBeenCalledTimes(1);   // applied to AJO
    expect(createApprovalPR).not.toHaveBeenCalled(); // NOT routed to a PR
    expect(res.structuredContent?.success).toBe(true);
    expect(res.structuredContent?.prCreated).toBeUndefined();
    expect(res.structuredContent?.data?.id).toBe('tag-new-123'); // real id surfaced
  });

  test('an unknown tool returns a structured TOOL_NOT_FOUND (does not throw)', async () => {
    const client = await connectClient();

    const res = await client.callTool({ name: 'does_not_exist', arguments: {} }) as ToolResult;

    expect(res.isError).toBe(true);
    expect(res.structuredContent?.success).toBe(false);
    expect(res.structuredContent?.error?.code).toBe('TOOL_NOT_FOUND');
  });

  test('read-only mode still advertises every write tool (enforcement is at call time)', async () => {
    setWritesAllowed(false);
    const client = await connectClient();

    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    // Write tools must remain advertised so clients that cache the list at connect
    // (and ignore tools/list_changed) aren't stranded when write access is enabled.
    for (const w of ['create_content_fragment', 'archive_content_fragment', 'delete_tag', 'update_content_template']) {
      expect(names).toContain(w);
    }
  });
});
