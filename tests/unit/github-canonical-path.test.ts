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
  createPullRequest: jest.fn().mockResolvedValue({ number: 7, html_url: 'https://github.com/o/r/pull/7' }),
  getPullRequest: jest.fn(), getPRFiles: jest.fn(), parsePRUrl: jest.fn()
}));

import { createApprovalPR, commitAuditTrail } from '../../src/github/sync';
import { commitFile, getFileSha, getFileContent } from '../../src/github/client';

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
