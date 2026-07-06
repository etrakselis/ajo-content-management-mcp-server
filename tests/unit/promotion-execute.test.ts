/**
 * Unit tests for the cross-sandbox promotion EXECUTOR state machine
 * (engine.executePromotion) and the same-sandbox repo deploy (deployRepoToSandbox).
 *
 * These are the phased/resumable write paths the plan suite doesn't touch. GitHub
 * (repo tree + PRs) and the AJO content handlers are mocked, so the tests exercise the
 * real orchestration — PR-state derivation, phase gating (a template waits for the
 * fragment it embeds), deploy-then-advance, rejected-PR blocking, source-hash
 * "unchanged" detection, and dependency-ordered direct deploy — without any network.
 * withSandbox + the content transforms (tools/utils) run for real.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/github/sync', () => ({
  createApprovalPR: jest.fn(),
  readMergedPRContent: jest.fn(),
  readPriorPromotionMeta: jest.fn()
}));

jest.mock('../../src/github/client', () => ({
  getBranchSha: jest.fn().mockResolvedValue('treesha123'),
  listRepoTree: jest.fn(),
  getFileContent: jest.fn(),
  listPullRequests: jest.fn(),
  getPullRequest: jest.fn(),
  ensureLabelExists: jest.fn().mockResolvedValue(undefined),
  addLabelsToPr: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../src/adobe/client', () => ({
  getConfiguredGitHubIntegration: jest.fn().mockReturnValue({
    owner: 'o', repo: 'r', token: 't', defaultBranch: 'main', requireApproval: true
  }),
  findContentIdByName: jest.fn().mockResolvedValue(undefined),
  getConfiguredAuthorEmail: jest.fn().mockReturnValue('author@example.com'),
  getConfiguredTenantId: jest.fn().mockReturnValue('acme'),
  getFragment: jest.fn(), getTemplate: jest.fn(),
  buildError: (e: unknown) => ({ code: 'API_ERROR', message: String(e), details: {} })
}));

jest.mock('../../src/adobe/unified-tags-client', () => ({
  listTags: jest.fn().mockResolvedValue({ tags: [] }),
  createTag: jest.fn().mockResolvedValue({ id: 'tag-1' })
}));

jest.mock('../../src/tools/folders', () => ({
  handleEnsureFolderPath: jest.fn().mockResolvedValue({ success: true, leafFolderId: 'folder-1' })
}));
jest.mock('../../src/tools/fragments', () => ({
  handleCreateContentFragment: jest.fn().mockResolvedValue({ success: true, id: 'frag-created' }),
  handleUpdateContentFragment: jest.fn().mockResolvedValue({ success: true, id: 'frag-updated' })
}));
jest.mock('../../src/tools/templates', () => ({
  handleCreateContentTemplate: jest.fn().mockResolvedValue({ success: true, id: 'tmpl-created' }),
  handleUpdateContentTemplate: jest.fn().mockResolvedValue({ success: true, id: 'tmpl-updated' })
}));

import { executePromotion, deployRepoToSandbox } from '../../src/promotion/engine';
import { listRepoTree, getFileContent, listPullRequests, getPullRequest, addLabelsToPr } from '../../src/github/client';
import { createApprovalPR, readMergedPRContent, readPriorPromotionMeta } from '../../src/github/sync';
import { findContentIdByName } from '../../src/adobe/client';
import { handleCreateContentFragment } from '../../src/tools/fragments';
import { handleCreateContentTemplate } from '../../src/tools/templates';

const SB = 'src-sandbox';
const TB = 'tgt-sandbox';
const HERO_ID = '11111111-1111-1111-1111-111111111111';

const blob = (path: string) => ({ path, type: 'blob', sha: `sha-${path}` });
function mockRepo(files: Record<string, unknown>, truncated = false) {
  (listRepoTree as jest.Mock).mockResolvedValue({ tree: Object.keys(files).map(blob), truncated });
  (getFileContent as jest.Mock).mockImplementation(
    (_t: string, _o: string, _r: string, path: string) => Promise.resolve(JSON.stringify(files[path]))
  );
}

// A template that embeds the Hero fragment by name + a matching Hero fragment.
function newsletterEmbeddingHero() {
  return {
    [`${SB}/content-templates/Newsletter.json`]: {
      name: 'Newsletter', templateType: 'html', channels: ['email'],
      template: { html: `<div>{{ fragment id="ajo:${HERO_ID}" name="Hero" mode="inline" }}</div>` }
    },
    [`${SB}/content-fragments/Hero.json`]: {
      name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' }
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (findContentIdByName as jest.Mock).mockResolvedValue(undefined);
  (listPullRequests as jest.Mock).mockResolvedValue([]);
  (readPriorPromotionMeta as jest.Mock).mockResolvedValue(undefined);
  (createApprovalPR as jest.Mock).mockResolvedValue({ prNumber: 1, prUrl: 'https://github.com/o/r/pull/1', filePath: 'x' });
});

describe('executePromotion — dry run', () => {
  test('validates every asset and writes nothing to GitHub', async () => {
    mockRepo(newsletterEmbeddingHero());
    const res = await executePromotion({ templateName: 'Newsletter' }, SB, TB, true);

    expect(res.dryRun).toBe(true);
    expect(res.status).toBe('complete');
    expect(res.validated?.map(v => v.name).sort()).toEqual(['Hero', 'Newsletter']);
    expect(res.validated?.every(v => v.action === 'create')).toBe(true);
    expect(createApprovalPR).not.toHaveBeenCalled();
  });
});

describe('executePromotion — phased PR opening', () => {
  test('first run opens a PR for the leaf fragment only; the template waits for it', async () => {
    mockRepo(newsletterEmbeddingHero());
    const res = await executePromotion({ templateName: 'Newsletter' }, SB, TB, false);

    expect(res.status).toBe('awaiting_merge');
    expect(res.openPrs.map(p => p.name)).toEqual(['Hero']);          // leaf only
    expect(createApprovalPR).toHaveBeenCalledTimes(1);
    expect((createApprovalPR as jest.Mock).mock.calls[0][2]).toBe('create_content_fragment');
  });
});

describe('executePromotion — deploy merged PR then advance a phase', () => {
  test('deploys a merged leaf PR, then opens the dependent template PR', async () => {
    mockRepo(newsletterEmbeddingHero());
    // A merged-but-undeployed PR exists for Hero (closed + merged + no deployed label).
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 1, state: 'closed', html_url: 'https://github.com/o/r/pull/1', head: { ref: 'ajo-promote-fragment-Hero-123' } }
    ]);
    (getPullRequest as jest.Mock).mockResolvedValue({
      number: 1, merged: true, labels: [], html_url: 'https://github.com/o/r/pull/1'
    });
    (readMergedPRContent as jest.Mock).mockResolvedValue([
      { toolName: 'create_content_fragment', args: { name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' } } }
    ]);
    (handleCreateContentFragment as jest.Mock).mockResolvedValue({ success: true, id: 'target-hero-id' });

    const res = await executePromotion({ templateName: 'Newsletter' }, SB, TB, false);

    // Pass 1 deployed Hero...
    expect(res.deployed).toEqual([{ name: 'Hero', type: 'fragment', targetId: 'target-hero-id', action: 'created' }]);
    expect(addLabelsToPr).toHaveBeenCalledTimes(1);
    // ...pass 2 then opened the Newsletter PR (its dependency is now live in the target).
    expect(res.openPrs.map(p => p.name)).toEqual(['Newsletter']);
    expect((createApprovalPR as jest.Mock).mock.calls.some(c => c[2] === 'create_content_template')).toBe(true);
    expect(res.status).toBe('awaiting_merge');
  });
});

describe('executePromotion — merged PR that fails to deploy is NOT marked deployed (regression)', () => {
  test('an empty/failed deploy leaves the PR unlabeled and blocks the asset so it retries', async () => {
    mockRepo({
      [`${SB}/content-fragments/Hero.json`]: {
        name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' }
      }
    });
    // A merged-but-undeployed PR exists for Hero...
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 7, state: 'closed', html_url: 'https://github.com/o/r/pull/7', head: { ref: 'ajo-promote-fragment-Hero-123' } }
    ]);
    (getPullRequest as jest.Mock).mockResolvedValue({
      number: 7, merged: true, labels: [], html_url: 'https://github.com/o/r/pull/7'
    });
    (readMergedPRContent as jest.Mock).mockResolvedValue([
      { toolName: 'create_content_fragment', args: { name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' } } }
    ]);
    // ...but applying it fails (deployOp returns undefined → deployMergedPr yields no results).
    (handleCreateContentFragment as jest.Mock).mockResolvedValue({ success: false, error: { code: 'VALIDATION_ERROR', message: 'nope' } });

    const res = await executePromotion({ fragmentName: 'Hero' }, SB, TB, false);

    expect(res.deployed).toEqual([]);
    // The fix: the deployed-label must NOT be stamped when nothing applied — otherwise the
    // PR flips to merged-deployed and the asset is skipped (update silently lost) forever.
    expect(addLabelsToPr).not.toHaveBeenCalled();
    expect(res.status).toBe('blocked');
    expect(res.blockers.join(' ')).toMatch(/did not deploy cleanly/i);
  });
});

describe('executePromotion — rejected PR', () => {
  test('a closed-unmerged leaf PR blocks the leaf and everything that embeds it', async () => {
    mockRepo(newsletterEmbeddingHero());
    (listPullRequests as jest.Mock).mockResolvedValue([
      { number: 1, state: 'closed', html_url: 'https://github.com/o/r/pull/1', head: { ref: 'ajo-promote-fragment-Hero-123' } }
    ]);
    (getPullRequest as jest.Mock).mockResolvedValue({
      number: 1, merged: false, labels: [], html_url: 'https://github.com/o/r/pull/1'
    });

    const res = await executePromotion({ templateName: 'Newsletter' }, SB, TB, false);

    expect(res.status).toBe('blocked');
    expect(res.openPrs).toEqual([]);
    expect(res.blockers.join(' ')).toMatch(/closed without merging/i);
    expect(createApprovalPR).not.toHaveBeenCalled();
  });
});

describe('executePromotion — unchanged detection (source content hash)', () => {
  test('an already-present asset whose source hash matches the prior promotion is skipped', async () => {
    mockRepo({
      [`${SB}/content-fragments/Hero.json`]: {
        name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' }
      }
    });
    // Hero already exists in the target.
    (findContentIdByName as jest.Mock).mockResolvedValue('existing-hero-id');

    // Run 1: no prior promotion recorded → it opens an UPDATE PR carrying the source hash.
    const run1 = await executePromotion({ fragmentName: 'Hero' }, SB, TB, false);
    expect(run1.openPrs.map(p => p.action)).toEqual(['update']);
    const meta = (createApprovalPR as jest.Mock).mock.calls[0][8] as { sourceContentHash: string };
    expect(typeof meta.sourceContentHash).toBe('string');

    // Run 2: prior promotion recorded with that SAME hash → nothing to do.
    (createApprovalPR as jest.Mock).mockClear();
    (readPriorPromotionMeta as jest.Mock).mockResolvedValue({ sourceContentHash: meta.sourceContentHash });

    const run2 = await executePromotion({ fragmentName: 'Hero' }, SB, TB, false);
    expect(run2.unchanged).toEqual([{ name: 'Hero', type: 'fragment' }]);
    expect(run2.status).toBe('complete');
    expect(createApprovalPR).not.toHaveBeenCalled();
  });
});

describe('deployRepoToSandbox — same-sandbox direct deploy', () => {
  test('creates assets in dependency order (fragment before the template that embeds it)', async () => {
    mockRepo(newsletterEmbeddingHero());
    (handleCreateContentFragment as jest.Mock).mockResolvedValue({ success: true, id: 'h1' });
    (handleCreateContentTemplate as jest.Mock).mockResolvedValue({ success: true, id: 't1' });

    const res = await deployRepoToSandbox({}, SB, false);

    expect(res.blockers).toEqual([]);
    expect(res.deployed.map(d => d.name)).toEqual(['Hero', 'Newsletter']); // leaf first
    expect(res.deployed.every(d => d.action === 'created')).toBe(true);
    expect(res.deployed.find(d => d.name === 'Newsletter')?.targetId).toBe('t1');
  });

  test('reuses an asset already present in the sandbox (idempotent)', async () => {
    mockRepo({
      [`${SB}/content-fragments/Hero.json`]: {
        name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' }
      }
    });
    (findContentIdByName as jest.Mock).mockResolvedValue('existing-hero-id');

    const res = await deployRepoToSandbox({ fragmentName: 'Hero' }, SB, false);

    expect(res.deployed).toEqual([{ name: 'Hero', type: 'fragment', targetId: 'existing-hero-id', action: 'reused' }]);
    expect(handleCreateContentFragment).not.toHaveBeenCalled();
  });
});
