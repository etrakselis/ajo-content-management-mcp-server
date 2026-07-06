/**
 * Regression test: deploy_merged_changes must NOT replay the etag baked into an
 * approval-gate PR for update_* ops. That etag was captured when the PR was proposed;
 * by the time a human merges it is very likely stale, so a verbatim replay fails with
 * CONFLICT. The deploy path must re-fetch the live etag right before applying (and
 * retry once on a conflict), mirroring the promotion engine's deployOp.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/github/sync', () => ({
  readMergedPRContent: jest.fn(),
  checkPRStatus: jest.fn()
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  getConfiguredGitHubIntegration: () => ({ token: 't', owner: 'o', repo: 'r', defaultBranch: 'main' }),
  getConfiguredSandboxName: () => 'sbx',
  getConfiguredAuthorEmail: () => 'me@x',
  findContentIdByName: jest.fn(),
  getFragment: jest.fn(),
  getTemplate: jest.fn()
}));

// Mock every handler module github.ts pulls into DEPLOY_HANDLERS.
jest.mock('../../src/tools/fragments', () => ({
  handleCreateContentFragment: jest.fn(),
  handleUpdateContentFragment: jest.fn(),
  handlePatchContentFragment: jest.fn(),
  handlePublishContentFragment: jest.fn(),
  handleArchiveContentFragment: jest.fn()
}));
jest.mock('../../src/tools/templates', () => ({
  handleCreateContentTemplate: jest.fn(),
  handleUpdateContentTemplate: jest.fn(),
  handlePatchContentTemplate: jest.fn(),
  handleDeleteContentTemplate: jest.fn()
}));
jest.mock('../../src/tools/folders', () => ({
  handleCreateFolder: jest.fn(), handleUpdateFolder: jest.fn(), handleDeleteFolder: jest.fn()
}));
jest.mock('../../src/tools/tags', () => ({
  handleCreateTag: jest.fn(), handleUpdateTag: jest.fn(), handleDeleteTag: jest.fn()
}));

import { handleDeployMergedChanges } from '../../src/tools/github';
import { readMergedPRContent } from '../../src/github/sync';
import { getFragment } from '../../src/adobe/client';
import { handleUpdateContentFragment } from '../../src/tools/fragments';

const mockReadPR = readMergedPRContent as jest.Mock;
const mockGetFragment = getFragment as jest.Mock;
const mockUpdate = handleUpdateContentFragment as jest.Mock;

beforeEach(() => jest.clearAllMocks());

const updateOp = {
  toolName: 'update_content_fragment',
  filePath: 'sbx/content-fragments/F.json',
  args: { fragmentId: 'id1', etag: 'STALE', name: 'F', type: 'html', channels: ['email'], fragment: { content: 'x' } }
};

describe('deploy_merged_changes re-fetches a fresh etag for update ops', () => {
  test('applies the LIVE etag, not the stale one baked into the PR', async () => {
    mockReadPR.mockResolvedValue([updateOp]);
    mockGetFragment.mockResolvedValue({ data: { id: 'id1' }, etag: 'FRESH' });
    mockUpdate.mockResolvedValue({ success: true, id: 'id1' });

    const result = await handleDeployMergedChanges({ prUrl: 'https://github.com/o/r/pull/1' }) as { success: boolean };

    expect(result.success).toBe(true);
    expect(mockGetFragment).toHaveBeenCalledWith('id1');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ fragmentId: 'id1', etag: 'FRESH' });
    expect(mockUpdate.mock.calls[0][0].etag).not.toBe('STALE');
  });

  test('refuses to deploy a PR proposed for a DIFFERENT sandbox (no AJO write attempted)', async () => {
    // The active sandbox is 'sbx'; this op was proposed for 'other-sbx'.
    mockReadPR.mockResolvedValue([{ ...updateOp, filePath: 'other-sbx/content-fragments/F.json', sandbox: 'other-sbx' }]);

    const result = await handleDeployMergedChanges({ prUrl: 'https://github.com/o/r/pull/9' }) as { success: boolean; error?: { code?: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SANDBOX_MISMATCH');
    // Guard runs BEFORE the deploy loop — nothing is fetched or written.
    expect(mockGetFragment).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('deploys when the PR sandbox matches the active sandbox', async () => {
    mockReadPR.mockResolvedValue([{ ...updateOp, sandbox: 'sbx' }]);
    mockGetFragment.mockResolvedValue({ data: { id: 'id1' }, etag: 'FRESH' });
    mockUpdate.mockResolvedValue({ success: true, id: 'id1' });

    const result = await handleDeployMergedChanges({ prUrl: 'https://github.com/o/r/pull/1' }) as { success: boolean };

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('retries once with a re-fetched etag on a CONFLICT', async () => {
    mockReadPR.mockResolvedValue([updateOp]);
    mockGetFragment
      .mockResolvedValueOnce({ data: { id: 'id1' }, etag: 'FRESH1' })
      .mockResolvedValueOnce({ data: { id: 'id1' }, etag: 'FRESH2' });
    mockUpdate
      .mockResolvedValueOnce({ success: false, error: { code: 'CONFLICT' } })
      .mockResolvedValueOnce({ success: true, id: 'id1' });

    const result = await handleDeployMergedChanges({ prUrl: 'https://github.com/o/r/pull/1' }) as { success: boolean };

    expect(result.success).toBe(true);
    expect(mockGetFragment).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1][0].etag).toBe('FRESH2');
  });
});
