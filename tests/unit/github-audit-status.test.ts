/**
 * Unit tests for the GitHub audit-trail status surfacing (#3). In audit-trail mode
 * the GitHub commit is fire-and-forget after the tool result returns, so a failure
 * is otherwise only an MCP logging notification many clients never show the model.
 * The last outcome is recorded and surfaced through get_server_context so the model
 * has a reliable, pull-based way to learn an AJO write was not recorded in GitHub.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/mcp/access-policy', () => ({ getWritesAllowed: () => true }));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  getConfiguredSandboxName: () => 'sb',
  getConfiguredOrgName: () => undefined,
  getConfiguredTenantId: () => 'acme',
  getConfiguredAuthorEmail: () => 'a@b.com',
  getConfiguredNamingConvention: () => undefined,
  getConfiguredGitHubIntegration: jest.fn()
}));

import { handleGetServerContext } from '../../src/tools/context';
import { recordGitHubAuditStatus, getLastGitHubAuditStatus, resetGitHubAuditStatus } from '../../src/mcp/github-audit-status';
import * as client from '../../src/adobe/client';

const mockClient = client as jest.Mocked<typeof client>;

beforeEach(() => {
  jest.clearAllMocks();
  resetGitHubAuditStatus();
});

describe('github-audit-status module', () => {
  test('records and returns the last status; reset clears it', () => {
    expect(getLastGitHubAuditStatus()).toBeNull();
    recordGitHubAuditStatus({ at: '2026-06-29T00:00:00.000Z', tool: 'create_content_fragment', ok: false, error: 'boom' });
    expect(getLastGitHubAuditStatus()).toMatchObject({ tool: 'create_content_fragment', ok: false, error: 'boom' });
    resetGitHubAuditStatus();
    expect(getLastGitHubAuditStatus()).toBeNull();
  });
});

type Ctx = {
  success: boolean;
  data?: { githubIntegration?: { mode?: string; lastAuditSync?: { ok: boolean; tool: string } } };
};

describe('get_server_context surfaces the audit-trail sync outcome', () => {
  test('audit-trail mode includes lastAuditSync when a failure was recorded', async () => {
    mockClient.getConfiguredGitHubIntegration.mockReturnValue({ owner: 'o', repo: 'r', token: 't', requireApproval: false, defaultBranch: 'main' });
    recordGitHubAuditStatus({ at: '2026-06-29T00:00:00.000Z', tool: 'update_content_fragment', ok: false, error: 'commit failed' });
    const result = await handleGetServerContext({}) as Ctx;
    expect(result.success).toBe(true);
    expect(result.data?.githubIntegration?.mode).toBe('audit-trail');
    expect(result.data?.githubIntegration?.lastAuditSync).toMatchObject({ ok: false, tool: 'update_content_fragment' });
  });

  test('approval-gate mode never surfaces lastAuditSync (no fire-and-forget commit there)', async () => {
    mockClient.getConfiguredGitHubIntegration.mockReturnValue({ owner: 'o', repo: 'r', token: 't', requireApproval: true, defaultBranch: 'main' });
    recordGitHubAuditStatus({ at: '2026-06-29T00:00:00.000Z', tool: 'update_content_fragment', ok: false });
    const result = await handleGetServerContext({}) as Ctx;
    expect(result.data?.githubIntegration?.mode).toBe('approval-gate');
    expect(result.data?.githubIntegration?.lastAuditSync).toBeUndefined();
  });

  test('no lastAuditSync key until the first audit-trail commit', async () => {
    mockClient.getConfiguredGitHubIntegration.mockReturnValue({ owner: 'o', repo: 'r', token: 't', requireApproval: false, defaultBranch: 'main' });
    const result = await handleGetServerContext({}) as Ctx;
    expect(result.data?.githubIntegration?.mode).toBe('audit-trail');
    expect(result.data?.githubIntegration?.lastAuditSync).toBeUndefined();
  });
});
