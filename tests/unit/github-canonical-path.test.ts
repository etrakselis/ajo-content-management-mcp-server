/**
 * Unit tests for the GitHub content-mirror behavior:
 *  - metadata ops (patch/archive/delete) commit to the asset's canonical <name>.json
 *    (no orphan id-named files), driven by a caller-resolved canonical name;
 *  - the repo MIRRORS sandbox content: a patch applies its metadata change onto the
 *    committed content (preserving the body), and a delete/archive PRESERVES the content
 *    body and only flags _meta.deleted — a sandbox delete never removes content from the repo;
 *  - the committed file still carries the operation's args so deploy can replay it.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) }
}));

jest.mock('../../src/adobe/sandbox-context', () => ({ withSandbox: (_s: string, fn: () => Promise<unknown>) => fn() }));
jest.mock('../../src/adobe/unified-tags-client', () => ({ getTag: jest.fn() }));

jest.mock('../../src/github/client', () => ({
  getBranchSha: jest.fn().mockResolvedValue('basesha'),
  createBranch: jest.fn().mockResolvedValue(undefined),
  getFileSha: jest.fn().mockResolvedValue('existingsha'),
  getFileContent: jest.fn(),
  commitFile: jest.fn().mockResolvedValue(undefined),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  listRepoTree: jest.fn().mockResolvedValue({ tree: [], truncated: false }),
  createPullRequest: jest.fn().mockResolvedValue({ number: 7, html_url: 'https://github.com/o/r/pull/7' }),
  updatePullRequest: jest.fn().mockResolvedValue(undefined),
  listPullRequests: jest.fn().mockResolvedValue([]),
  getPullRequest: jest.fn(), getPRFiles: jest.fn(), parsePRUrl: jest.fn()
}));

import { createApprovalPR, commitAuditTrail } from '../../src/github/sync';
import { commitFile, getFileSha, getFileContent, deleteFile, listRepoTree, createBranch, createPullRequest, updatePullRequest, listPullRequests, getPRFiles } from '../../src/github/client';

const config = { token: 't', owner: 'o', repo: 'r', defaultBranch: 'main', requireApproval: true } as never;
const committedPath = () => (commitFile as jest.Mock).mock.calls[0][3] as string;
const committedBody = () => JSON.parse((commitFile as jest.Mock).mock.calls[0][4] as string);

// A prior canonical content file (what create/update committed).
const PRIOR_FRAGMENT = JSON.stringify({
  _meta: { operation: 'create_content_fragment', ajoId: 'b9426d74' },
  name: 'LM_PD_ClaudeReview_Hero', type: 'html', channels: ['email'],
  tagIds: ['tag-old'], fragment: { content: '<div>HERO BODY</div>' }
});

beforeEach(() => {
  jest.clearAllMocks();
  (getFileSha as jest.Mock).mockResolvedValue('existingsha');
  (getFileContent as jest.Mock).mockResolvedValue(PRIOR_FRAGMENT);
  (deleteFile as jest.Mock).mockResolvedValue(undefined);
  (listRepoTree as jest.Mock).mockResolvedValue({ tree: [], truncated: false });
  (createPullRequest as jest.Mock).mockResolvedValue({ number: 7, html_url: 'https://github.com/o/r/pull/7' });
  (listPullRequests as jest.Mock).mockResolvedValue([]);
  (getPRFiles as jest.Mock).mockResolvedValue([]);
  (updatePullRequest as jest.Mock).mockResolvedValue(undefined);
});

describe('canonical path (no orphan id-named files)', () => {
  test('a delete commits to the canonical <name>.json path, not an id-named file', async () => {
    await createApprovalPR(
      config, 'etrakselis-sandbox', 'delete_content_template',
      { templateId: 'c93b918d-1111-2222-3333-444455556666' }, 'me@x',
      'LM/PD/ClaudeReview', undefined, undefined, undefined, 'LM_PD_ClaudeReview'
    );
    expect(committedPath()).toBe('etrakselis-sandbox/content-templates/LM/PD/ClaudeReview/LM_PD_ClaudeReview.json');
    expect(committedPath()).not.toMatch(/c93b918d/);
  });

  test('falls back to the id-based path when no name and no prior file', async () => {
    (getFileSha as jest.Mock).mockResolvedValue(null);
    (getFileContent as jest.Mock).mockRejectedValue(new Error('not found'));
    await createApprovalPR(
      config, 'etrakselis-sandbox', 'delete_content_template',
      { templateId: 'c93b918d-1111-2222-3333-444455556666' }, 'me@x', 'LM/PD/ClaudeReview'
    );
    expect(committedPath()).toBe('etrakselis-sandbox/content-templates/LM/PD/ClaudeReview/c93b918d-1111-2222-3333-444455556666.json');
  });
});

describe('content mirror — approval gate (createApprovalPR)', () => {
  test('delete PRESERVES the content body and flags _meta.deleted, and carries the id for deploy', async () => {
    await createApprovalPR(
      config, 'etrakselis-sandbox', 'archive_content_fragment',
      { fragmentId: 'b9426d74-aaaa-bbbb-cccc-dddddddddddd' }, 'me@x',
      'LM/PD/ClaudeReview', undefined, undefined, undefined, 'LM_PD_ClaudeReview_Hero'
    );
    const body = committedBody();
    expect(body._meta.deleted).toBe(true);                         // flagged deleted
    expect(body.fragment.content).toBe('<div>HERO BODY</div>');    // content PRESERVED, not removed
    expect(body.name).toBe('LM_PD_ClaudeReview_Hero');             // content preserved
    expect(body.fragmentId).toBe('b9426d74-aaaa-bbbb-cccc-dddddddddddd'); // id present → deploy can replay the delete
  });

  test('patch MIRRORS the metadata change onto the preserved content, and carries patch args for deploy', async () => {
    await createApprovalPR(
      config, 'etrakselis-sandbox', 'patch_content_fragment',
      { fragmentId: 'b9426d74-aaaa', etag: '"e"', patches: [{ op: 'add', path: '/tagIds', value: ['tag-new'] }] },
      'me@x', 'LM/PD/ClaudeReview', undefined, undefined, undefined, 'LM_PD_ClaudeReview_Hero'
    );
    const body = committedBody();
    expect(body.tagIds).toEqual(['tag-new']);                      // metadata change applied
    expect(body.fragment.content).toBe('<div>HERO BODY</div>');    // body preserved
    expect(body.patches).toBeDefined();                            // patch args present → deploy replays
    expect(body.etag).toBe('"e"');
  });
});

describe('PR-creation is resilient to non-idempotent POST errors (no duplicate on retry)', () => {
  const createArgs = { name: 'NV_BIS_X', templateType: 'content', channels: ['email'], template: {} };

  test('recovers when createPullRequest errors but the PR was actually created on the head branch', async () => {
    (createPullRequest as jest.Mock).mockRejectedValueOnce(new Error('GitHub API 404 on POST /pulls: Not Found'));
    // A PR exists on the (unique, per-call) head branch — the create went through despite the error.
    (listPullRequests as jest.Mock).mockImplementation(async () => {
      // Empty on the dedup lookup (before the branch is created), then the just-created
      // branch's PR on the post-error recovery lookup.
      const branch = (createBranch as jest.Mock).mock.calls[0]?.[3];
      return branch ? [{ number: 28, html_url: 'https://github.com/o/r/pull/28', state: 'open', title: 't', head: { ref: branch } }] : [];
    });

    const res = await createApprovalPR(config, 'etrakselis-sandbox', 'create_content_template', createArgs, 'me@x', 'NV/BIS');

    // Recovered the existing PR instead of throwing → caller sees success → no retry → no duplicate.
    expect(res.prNumber).toBe(28);
    expect(res.prUrl).toBe('https://github.com/o/r/pull/28');
  });

  test('re-throws when createPullRequest errors and no PR was actually created (safe to retry)', async () => {
    (createPullRequest as jest.Mock).mockRejectedValueOnce(new Error('GitHub API 404: Not Found'));
    (listPullRequests as jest.Mock).mockResolvedValue([]); // nothing was created

    await expect(
      createApprovalPR(config, 'etrakselis-sandbox', 'create_content_template', createArgs, 'me@x', 'NV/BIS')
    ).rejects.toThrow(/Not Found/);
  });

  test('does not match a PR on a different head branch', async () => {
    (createPullRequest as jest.Mock).mockRejectedValueOnce(new Error('Not Found'));
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 99, html_url: 'https://github.com/o/r/pull/99', state: 'open', title: 't', head: { ref: 'some-other-branch' } }
    ]);

    await expect(
      createApprovalPR(config, 'etrakselis-sandbox', 'create_content_template', createArgs, 'me@x', 'NV/BIS')
    ).rejects.toThrow(/Not Found/);
  });
});

describe('dedup genuine double-calls (reuse an open PR for the same asset)', () => {
  const updateArgs = { name: 'NV_BIS_X', etag: '"e"', templateType: 'content', channels: ['email'], template: {} };
  const ASSET_FILE = 'etrakselis-sandbox/content-templates/NV/BIS/NV_BIS_X.json';

  test('reuses the open PR that already changed this asset file — commits to its branch, no new PR', async () => {
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 50, html_url: 'https://github.com/o/r/pull/50', state: 'open', title: 't', head: { ref: 'ajo-update-content-template-111' } }
    ]);
    (getPRFiles as jest.Mock).mockResolvedValue([{ filename: ASSET_FILE, status: 'modified' }]);

    const res = await createApprovalPR(config, 'etrakselis-sandbox', 'update_content_template', updateArgs, 'me@x', 'NV/BIS');

    expect(res.prNumber).toBe(50);                       // reused the existing PR
    expect(createBranch).not.toHaveBeenCalled();         // committed onto the existing branch
    expect(createPullRequest).not.toHaveBeenCalled();    // no second PR opened
    expect((commitFile as jest.Mock).mock.calls[0][6]).toBe('ajo-update-content-template-111');
    // The reused PR's title/body are refreshed to the latest operation.
    expect(updatePullRequest).toHaveBeenCalledWith('t', 'o', 'r', 50,
      expect.objectContaining({ title: '[AJO] update content template: NV_BIS_X' }));
  });

  test('opens a new PR when the open PR changes a DIFFERENT asset', async () => {
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 51, html_url: 'https://github.com/o/r/pull/51', state: 'open', title: 't', head: { ref: 'ajo-update-content-template-222' } }
    ]);
    (getPRFiles as jest.Mock).mockResolvedValue([{ filename: 'etrakselis-sandbox/content-templates/NV/BIS/OTHER.json', status: 'modified' }]);

    const res = await createApprovalPR(config, 'etrakselis-sandbox', 'update_content_template', updateArgs, 'me@x', 'NV/BIS');

    expect(createBranch).toHaveBeenCalled();
    expect(createPullRequest).toHaveBeenCalled();
    expect(res.prNumber).toBe(7);
  });

  test('ignores promotion PRs (ajo-promote-*) when looking for a reuse target', async () => {
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 53, html_url: 'https://github.com/o/r/pull/53', state: 'open', title: 't', head: { ref: 'ajo-promote-template-NV_BIS_X-999' } }
    ]);
    (getPRFiles as jest.Mock).mockResolvedValue([{ filename: ASSET_FILE, status: 'modified' }]);

    const res = await createApprovalPR(config, 'etrakselis-sandbox', 'update_content_template', updateArgs, 'me@x', 'NV/BIS');

    expect(getPRFiles).not.toHaveBeenCalled();   // a promotion PR is never inspected/reused
    expect(createPullRequest).toHaveBeenCalled();
    expect(res.prNumber).toBe(7);
  });

  test('promotion (branchName supplied) is exempt — dedup is skipped entirely', async () => {
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 54, html_url: 'https://github.com/o/r/pull/54', state: 'open', title: 't', head: { ref: 'ajo-update-content-template-444' } }
    ]);
    (getPRFiles as jest.Mock).mockResolvedValue([{ filename: ASSET_FILE, status: 'modified' }]);

    await createApprovalPR(
      config, 'etrakselis-sandbox', 'update_content_template', updateArgs, 'me@x', 'NV/BIS',
      undefined, 'ajo-promote-template-NV_BIS_X-999'
    );

    expect(getPRFiles).not.toHaveBeenCalled();   // dedup block is gated on !branchName
    expect(createPullRequest).toHaveBeenCalled();
  });
});

describe('content mirror — audit trail (commitAuditTrail)', () => {
  test('delete preserves content + flags deleted (no content removed from the repo)', async () => {
    await commitAuditTrail(
      config, 'prod', 'archive_content_fragment',
      { fragmentId: 'b9426d74-aaaa' }, {}, 'me@x',
      'LM/PD/ClaudeReview', undefined, 'LM_PD_ClaudeReview_Hero'
    );
    expect(committedPath()).toBe('prod/content-fragments/LM/PD/ClaudeReview/LM_PD_ClaudeReview_Hero.json');
    const body = committedBody();
    expect(body._meta.deleted).toBe(true);
    expect(body.fragment.content).toBe('<div>HERO BODY</div>'); // content lives on
  });

  test('patch mirrors the metadata change while preserving the body', async () => {
    await commitAuditTrail(
      config, 'prod', 'patch_content_fragment',
      { fragmentId: 'b9426d74-aaaa', etag: '"e"', patches: [{ op: 'add', path: '/tagIds', value: ['tag-new'] }] },
      { success: true }, 'me@x', 'LM/PD/ClaudeReview', undefined, 'LM_PD_ClaudeReview_Hero'
    );
    const body = committedBody();
    expect(body.tagIds).toEqual(['tag-new']);
    expect(body.fragment.content).toBe('<div>HERO BODY</div>');
    // Audit-trail files are pure mirrors (no deploy) — no patch plumbing leaks in.
    expect(body.patches).toBeUndefined();
  });
});

// Filing a previously-unfiled asset into a folder (or moving it between folders) changes
// its canonical repo path. The mirror writes a fresh file at the new path; without a prune
// the file at the OLD path is orphaned (the create-at-root → file-into-folder pattern).
describe('relocation prune (remove the stale copy after a folder move)', () => {
  const AJO_ID = 'b9426d74-aaaa';
  const ROOT = 'prod/content-fragments/LM_PD_ClaudeReview_Hero.json';               // old (orphan) path
  const FOLDERED = 'prod/content-fragments/LM/PD/ClaudeReview/LM_PD_ClaudeReview_Hero.json'; // new canonical path
  const fileWithId = (id: unknown) => JSON.stringify({
    _meta: { operation: 'create_content_fragment', ajoId: id },
    name: 'LM_PD_ClaudeReview_Hero', fragment: { content: '<div>x</div>' }
  });

  beforeEach(() => {
    (listRepoTree as jest.Mock).mockResolvedValue({
      tree: [
        { path: ROOT, type: 'blob', sha: 'rootblob' },
        { path: FOLDERED, type: 'blob', sha: 'foldblob' },
        { path: 'prod/content-fragments/LM/PD/ClaudeReview/OTHER.json', type: 'blob', sha: 'otherblob' },
      ],
      truncated: false,
    });
    (getFileContent as jest.Mock).mockResolvedValue(fileWithId(AJO_ID));
  });

  const fileIntoFolder = () => commitAuditTrail(
    config, 'prod', 'patch_content_fragment',
    { fragmentId: AJO_ID, etag: '"e"', patches: [{ op: 'add', path: '/parentFolderId', value: 'folder-1' }] },
    { success: true }, 'me@x', 'LM/PD/ClaudeReview', undefined, 'LM_PD_ClaudeReview_Hero'
  );

  test('deletes the stale root copy (same ajoId) by its blob sha, keeping the foldered file', async () => {
    await fileIntoFolder();
    expect((commitFile as jest.Mock).mock.calls[0][3]).toBe(FOLDERED); // committed to the new path
    expect(deleteFile).toHaveBeenCalledWith('t', 'o', 'r', ROOT, 'rootblob', expect.any(String), 'main');
    // the just-written canonical file is never deleted, and a different-named sibling is untouched
    const deleted = (deleteFile as jest.Mock).mock.calls.map(c => c[3]);
    expect(deleted).not.toContain(FOLDERED);
    expect(deleted).not.toContain('prod/content-fragments/LM/PD/ClaudeReview/OTHER.json');
  });

  test('does NOT delete a same-named file that belongs to a DIFFERENT asset', async () => {
    (getFileContent as jest.Mock).mockImplementation(async (_t, _o, _r, path: string) =>
      fileWithId(path === ROOT ? 'a-different-asset' : AJO_ID)
    );
    await fileIntoFolder();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('a create/patch with no resolvable id skips the scan entirely (no listRepoTree)', async () => {
    await commitAuditTrail(
      config, 'prod', 'create_content_fragment',
      { name: 'BrandNew', type: 'html', channels: ['email'] }, {}, 'me@x', undefined, undefined, undefined
    );
    expect(listRepoTree).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('a failed prune never fails the write (best-effort)', async () => {
    (listRepoTree as jest.Mock).mockRejectedValue(new Error('tree listing blew up'));
    await expect(fileIntoFolder()).resolves.toBe(true); // commit still reported success
    expect(commitFile).toHaveBeenCalled();
  });
});
