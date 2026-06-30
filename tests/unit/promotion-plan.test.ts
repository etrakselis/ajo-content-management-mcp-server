/**
 * Unit tests for the cross-sandbox promotion PLANNER (engine.planPromotion).
 *
 * planPromotion is the read-only brain of promotion: it reads the source subtree from
 * the repo, builds the embed dependency graph, assigns phase levels (leaf fragments
 * first), and diffs against the target sandbox. The GitHub client and the target
 * id-lookup are mocked, so this exercises the pure orchestration — graph build, phase
 * ordering, dependency recursion, target-status diff, and the blocker paths
 * (ambiguous name, missing source file, an embed with no name= attribute) — without
 * any network. The execute path (live PRs across two sandboxes) stays an integration
 * concern and is intentionally excluded from coverage.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

// github/sync is imported by the engine; only stubs are needed for the plan path.
jest.mock('../../src/github/sync', () => ({
  createApprovalPR: jest.fn(),
  readMergedPRContent: jest.fn(),
  readPriorPromotionMeta: jest.fn()
}));

jest.mock('../../src/github/client', () => ({
  getBranchSha: jest.fn().mockResolvedValue('treesha123'),
  listRepoTree: jest.fn(),
  getFileContent: jest.fn(),
  // Imported by the engine but unused on the plan path.
  listPullRequests: jest.fn(), getPullRequest: jest.fn(),
  ensureLabelExists: jest.fn(), addLabelsToPr: jest.fn()
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

import { planPromotion } from '../../src/promotion/engine';
import { listRepoTree, getFileContent } from '../../src/github/client';
import { findContentIdByName } from '../../src/adobe/client';

const SB = 'etrakselis-sandbox';
const HERO_SOURCE_ID = '11111111-1111-1111-1111-111111111111';

const blob = (path: string) => ({ path, type: 'blob', sha: `sha-${path}` });

// Wire listRepoTree + getFileContent from a {path -> file object} map.
function mockRepo(files: Record<string, unknown>, truncated = false) {
  (listRepoTree as jest.Mock).mockResolvedValue({
    tree: Object.keys(files).map(blob), truncated
  });
  (getFileContent as jest.Mock).mockImplementation(
    (_t: string, _o: string, _r: string, path: string) => Promise.resolve(JSON.stringify(files[path]))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (findContentIdByName as jest.Mock).mockResolvedValue(undefined);
});

describe('planPromotion — dependency graph & phasing', () => {
  test('orders an embedded fragment before the template that embeds it, with diff status', async () => {
    mockRepo({
      [`${SB}/content-templates/Newsletter.json`]: {
        name: 'Newsletter', templateType: 'html', channels: ['email'],
        template: { html: `<div>{{ fragment id="ajo:${HERO_SOURCE_ID}" name="Hero" mode="inline" }}</div>` }
      },
      [`${SB}/content-fragments/Hero.json`]: {
        name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div>hero</div>' }
      }
    });
    // Hero already exists in the target; Newsletter does not.
    (findContentIdByName as jest.Mock).mockImplementation(
      (type: string, name: string) => Promise.resolve(type === 'fragment' && name === 'Hero' ? 'target-hero-id' : undefined)
    );

    const plan = await planPromotion({ templateName: 'Newsletter' }, SB, SB, 'main');

    expect(plan.blockers).toEqual([]);
    expect(plan.assets.map(a => a.name)).toEqual(['Hero', 'Newsletter']); // leaf first

    const hero = plan.assets.find(a => a.name === 'Hero')!;
    const news = plan.assets.find(a => a.name === 'Newsletter')!;
    expect(hero.phase).toBe(1);
    expect(news.phase).toBe(2);
    expect(hero.targetStatus).toBe('present');
    expect(hero.targetId).toBe('target-hero-id');
    expect(news.targetStatus).toBe('absent');
    expect(news.embeds).toEqual([{ name: 'Hero', sourceId: HERO_SOURCE_ID }]);

    // Phases group by level: phase 1 = {Hero}, phase 2 = {Newsletter}.
    expect(plan.phases).toEqual([
      { phase: 1, assets: [{ name: 'Hero', type: 'fragment' }] },
      { phase: 2, assets: [{ name: 'Newsletter', type: 'template' }] }
    ]);
  });

  test('derives the folder path from the repo file path', async () => {
    mockRepo({
      [`${SB}/content-fragments/NV/BIS/Restock.json`]: {
        name: 'Restock', type: 'html', channels: ['email'], fragment: { content: '<div/>' }
      }
    });
    const plan = await planPromotion({ fragmentName: 'Restock' }, SB, SB);
    expect(plan.assets[0].folderPath).toEqual(['NV', 'BIS']);
    expect(plan.sourceRef).toBe('main'); // defaulted from config.defaultBranch
  });
});

describe('planPromotion — blockers', () => {
  test('flags an ambiguous name (two source files) without reading either', async () => {
    mockRepo({
      [`${SB}/content-fragments/A/Hero.json`]: { name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div/>' } },
      [`${SB}/content-fragments/B/Hero.json`]: { name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div/>' } }
    });
    const plan = await planPromotion({ fragmentName: 'Hero' }, SB, SB);
    expect(plan.assets).toEqual([]);
    expect(plan.blockers.join(' ')).toMatch(/Ambiguous/i);
  });

  test('flags a selector that matches no source file', async () => {
    mockRepo({
      [`${SB}/content-fragments/Hero.json`]: { name: 'Hero', type: 'html', channels: ['email'], fragment: { content: '<div/>' } }
    });
    const plan = await planPromotion({ names: ['Ghost'] }, SB, SB);
    expect(plan.assets).toEqual([]);
    expect(plan.blockers.join(' ')).toMatch(/SOURCE_FILE_NOT_FOUND/);
  });

  test('flags an ajo embed that has no name= attribute (unresolvable from the repo)', async () => {
    mockRepo({
      [`${SB}/content-templates/Newsletter.json`]: {
        name: 'Newsletter', templateType: 'html', channels: ['email'],
        template: { html: `<div>{{ fragment id="ajo:${HERO_SOURCE_ID}" mode="inline" }}</div>` }
      }
    });
    const plan = await planPromotion({ templateName: 'Newsletter' }, SB, SB);
    expect(plan.blockers.join(' ')).toMatch(/no name= attribute/);
  });

  test('returns a blocker (not a throw) when GitHub is not configured', async () => {
    const { getConfiguredGitHubIntegration } = jest.requireMock('../../src/adobe/client') as { getConfiguredGitHubIntegration: jest.Mock };
    getConfiguredGitHubIntegration.mockReturnValueOnce(undefined);
    const plan = await planPromotion({ fragmentName: 'Hero' }, SB, SB);
    expect(plan.assets).toEqual([]);
    expect(plan.blockers.join(' ')).toMatch(/GitHub integration is not configured/);
  });
});
