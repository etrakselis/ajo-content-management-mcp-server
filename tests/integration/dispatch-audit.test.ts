/**
 * Integration tests for CallTool orchestration branches in mcp/server.ts that the
 * existing dispatch-gate / elicitation suites don't reach:
 *   - the read-only gate rejects a real write with READ_ONLY_MODE (defense in depth);
 *   - a write's args are pre-validated BEFORE the confirmation gate (bad payload →
 *     VALIDATION_ERROR on the first call, never a confirm-then-fail);
 *   - GitHub approval-gate PR creation failure → structured GITHUB_PR_FAILED;
 *   - GitHub audit-trail mode: a successful write applies to AJO AND fires the
 *     fire-and-forget commit, whose outcome is later reported by get_server_context
 *     (githubIntegration.lastAuditSync) — both the ok and the failed cases;
 *   - a metadata op (archive) resolves the asset's canonical NAME before the write so
 *     the audit commit lands on the canonical path;
 *   - an unexpected throw inside a handler is caught and returned as INTERNAL_ERROR.
 *
 * Drives the real createMcpServer over an in-memory transport (no elicitation, so the
 * confirm-and-retry path is exercised); Adobe + GitHub are mocked so no network is hit.
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
  createFragment: jest.fn().mockResolvedValue({ id: 'frag-new', location: '/fragments/frag-new', etag: '"v1"' }),
  getFragment: jest.fn().mockResolvedValue({ data: { name: 'Archived Frag' }, etag: '"v1"' }),
  archiveFragment: jest.fn().mockResolvedValue({ id: 'frag-1', etag: '"v2"' }),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  listTemplates: jest.fn(), createTemplate: jest.fn(), getTemplate: jest.fn(),
  updateTemplate: jest.fn(), patchTemplate: jest.fn(), deleteTemplate: jest.fn(),
  updateFragment: jest.fn(), patchFragment: jest.fn(),
  publishFragment: jest.fn(), getLiveFragment: jest.fn(), getLastPublicationStatus: jest.fn()
}));

jest.mock('../../src/adobe/unified-tags-client', () => ({
  createTag: jest.fn(), updateTag: jest.fn(), deleteTag: jest.fn(), listTags: jest.fn(), getTag: jest.fn(),
  validateTags: jest.fn(), listTagCategories: jest.fn(), getTagCategory: jest.fn(),
  createFolder: jest.fn(), getFolder: jest.fn(), updateFolder: jest.fn(),
  deleteFolder: jest.fn(), getSubfolders: jest.fn(), validateFolder: jest.fn(),
  clearFolderPathCache: jest.fn(), resolveAjoFolderPath: jest.fn().mockResolvedValue(undefined)
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server';
import { setWritesAllowed } from '../../src/mcp/access-policy';
import { resetGitHubAuditStatus } from '../../src/mcp/github-audit-status';
import { createFragment, getConfiguredGitHubIntegration } from '../../src/adobe/client';
import { commitAuditTrail, createApprovalPR } from '../../src/github/sync';
import { toolCallDuration } from '../../src/telemetry/index';

const VALID_FRAGMENT = {
  name: 'Header Banner', type: 'html' as const, channels: ['email'], fragment: { content: '<div>hi</div>' }
};
const AUDIT_TRAIL = { owner: 'o', repo: 'r', token: 't', defaultBranch: 'main', requireApproval: false };
const APPROVAL_GATE = { owner: 'o', repo: 'r', token: 't', defaultBranch: 'main', requireApproval: true };

type ToolResult = {
  isError?: boolean;
  structuredContent?: {
    success?: boolean; error?: { code?: string };
    data?: { githubIntegration?: { mode?: string; lastAuditSync?: { ok?: boolean } } };
  };
};

async function connectClient() {
  const server = createMcpServer('http');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'TestClient', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// Flush the fire-and-forget audit-trail commit chain (scheduled after the tool result
// returns) so a follow-up get_server_context sees its recorded outcome.
const flush = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  setWritesAllowed(true);
  resetGitHubAuditStatus();
  (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(undefined);
});

describe('CallTool gates', () => {
  test('read-only mode rejects a real write with READ_ONLY_MODE (even with confirmWrite)', async () => {
    setWritesAllowed(false);
    const client = await connectClient();

    const res = await client.callTool({
      name: 'create_content_fragment', arguments: { ...VALID_FRAGMENT, confirmWrite: true }
    }) as ToolResult;

    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('READ_ONLY_MODE');
    expect(createFragment).not.toHaveBeenCalled();
  });

  test('a malformed write is rejected with VALIDATION_ERROR before the confirmation gate', async () => {
    const client = await connectClient();

    // Missing required `name`; no confirmWrite. Pre-validation must fire FIRST, so we
    // get VALIDATION_ERROR — not WRITE_CONFIRMATION_REQUIRED.
    const res = await client.callTool({
      name: 'create_content_fragment', arguments: { type: 'html', channels: ['email'], fragment: { content: '<div/>' } }
    }) as ToolResult;

    expect(res.structuredContent?.error?.code).toBe('VALIDATION_ERROR');
    expect(createFragment).not.toHaveBeenCalled();
  });

  test('an unexpected throw inside a handler is returned as INTERNAL_ERROR', async () => {
    const client = await connectClient();
    // Fault-inject: the telemetry timer throws for the next tool call, so the handler
    // rejects and the dispatch catch converts it to a structured INTERNAL_ERROR.
    (toolCallDuration.startTimer as jest.Mock).mockImplementationOnce(() => { throw new Error('boom'); });

    const res = await client.callTool({ name: 'list_content_fragments', arguments: {} }) as ToolResult;

    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe('INTERNAL_ERROR');
  });
});

describe('CallTool GitHub approval gate', () => {
  test('a PR-creation failure surfaces as GITHUB_PR_FAILED (write not applied to AJO)', async () => {
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(APPROVAL_GATE);
    (createApprovalPR as jest.Mock).mockRejectedValue(new Error('token lacks repo scope'));
    const client = await connectClient();

    const res = await client.callTool({
      name: 'create_content_fragment', arguments: { ...VALID_FRAGMENT, confirmWrite: true }
    }) as ToolResult;

    expect(res.structuredContent?.error?.code).toBe('GITHUB_PR_FAILED');
    expect(createFragment).not.toHaveBeenCalled();
  });
});

describe('CallTool GitHub audit-trail mode', () => {
  test('a successful write applies to AJO and fires the audit commit; get_server_context reports ok', async () => {
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(AUDIT_TRAIL);
    (commitAuditTrail as jest.Mock).mockResolvedValue(undefined); // undefined = success
    const client = await connectClient();

    const res = await client.callTool({
      name: 'create_content_fragment', arguments: { ...VALID_FRAGMENT, confirmWrite: true }
    }) as ToolResult;

    expect(res.structuredContent?.success).toBe(true);
    expect(createFragment).toHaveBeenCalledTimes(1);       // audit-trail applies to AJO
    await flush();
    expect(commitAuditTrail).toHaveBeenCalledTimes(1);     // then commits fire-and-forget

    const ctx = await client.callTool({ name: 'get_server_context', arguments: {} }) as ToolResult;
    expect(ctx.structuredContent?.data?.githubIntegration?.mode).toBe('audit-trail');
    expect(ctx.structuredContent?.data?.githubIntegration?.lastAuditSync?.ok).toBe(true);
  });

  test('a failed audit commit is recorded (ok:false) and reported by get_server_context', async () => {
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(AUDIT_TRAIL);
    (commitAuditTrail as jest.Mock).mockResolvedValue(false); // false = commit failed
    const client = await connectClient();

    await client.callTool({ name: 'create_content_fragment', arguments: { ...VALID_FRAGMENT, confirmWrite: true } });
    await flush();

    const ctx = await client.callTool({ name: 'get_server_context', arguments: {} }) as ToolResult;
    expect(ctx.structuredContent?.data?.githubIntegration?.lastAuditSync?.ok).toBe(false);
  });

  test('a metadata op (archive) resolves the canonical name before the write for the audit commit', async () => {
    (getConfiguredGitHubIntegration as jest.Mock).mockReturnValue(AUDIT_TRAIL);
    (commitAuditTrail as jest.Mock).mockResolvedValue(undefined);
    const client = await connectClient();

    // archive is addressed by id and carries no `name`; the dispatch reads it via
    // getFragment BEFORE the (destructive) write so the commit lands on <name>.json.
    await client.callTool({
      name: 'archive_content_fragment',
      arguments: { fragmentId: '11111111-1111-1111-1111-111111111111', confirmWrite: true }
    });
    await flush();

    expect(commitAuditTrail).toHaveBeenCalledTimes(1);
    const call = (commitAuditTrail as jest.Mock).mock.calls[0];
    expect(call[2]).toBe('archive_content_fragment'); // tool name
    expect(call[8]).toBe('Archived Frag');            // canonicalName (resolved via getFragment)
  });
});
