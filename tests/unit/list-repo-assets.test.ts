/**
 * Unit test: list_repo_assets surfaces fragments, templates, AND tags committed under a
 * sandbox's repo subtree (tags read from <sandbox>/tags/*.json, indexed separately from
 * the fragment/template content so promotion is untouched).
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) }
}));

jest.mock('../../src/adobe/client', () => ({
  getConfiguredGitHubIntegration: () => ({ owner: 'o', repo: 'r', token: 't', defaultBranch: 'main' }),
  getFragment: jest.fn(), getTemplate: jest.fn(), findContentIdByName: jest.fn(),
  getConfiguredAuthorEmail: jest.fn(), getConfiguredTenantId: jest.fn()
}));
jest.mock('../../src/adobe/sandbox-context', () => ({ withSandbox: (_s: string, fn: () => Promise<unknown>) => fn() }));
jest.mock('../../src/adobe/unified-tags-client', () => ({ listTags: jest.fn(), createTag: jest.fn() }));
jest.mock('../../src/tools/folders', () => ({ handleEnsureFolderPath: jest.fn() }));
jest.mock('../../src/tools/fragments', () => ({ handleCreateContentFragment: jest.fn(), handleUpdateContentFragment: jest.fn() }));
jest.mock('../../src/tools/templates', () => ({ handleCreateContentTemplate: jest.fn(), handleUpdateContentTemplate: jest.fn() }));
jest.mock('../../src/github/sync', () => ({ createApprovalPR: jest.fn(), readMergedPRContent: jest.fn(), readPriorPromotionMeta: jest.fn() }));
jest.mock('../../src/github/client', () => ({
  getBranchSha: jest.fn(async () => 'sha123'),
  listRepoTree: jest.fn(async () => ({
    tree: [
      { path: 'sb/content-fragments/LM/PD/X/Frag.json', type: 'blob', sha: 'a' },
      { path: 'sb/content-templates/LM/PD/X/Tmpl.json', type: 'blob', sha: 'b' },
      { path: 'sb/tags/brand-lm.json', type: 'blob', sha: 'c' },
      { path: 'sb/tags/trigger-x.json', type: 'blob', sha: 'd' },
      { path: 'sb/content-fragments/LM/PD/X', type: 'tree', sha: 'e' },     // a dir, ignored
      { path: 'other-sandbox/tags/foo.json', type: 'blob', sha: 'f' },      // different sandbox, ignored
    ],
    truncated: false
  })),
  listPullRequests: jest.fn(), getPullRequest: jest.fn(), ensureLabelExists: jest.fn(), addLabelsToPr: jest.fn(), getFileContent: jest.fn()
}));

import { listRepoAssets } from '../../src/promotion/engine';

test('lists fragments, templates, and tags from the sandbox subtree', async () => {
  const { assets } = await listRepoAssets('sb');
  const byName = (n: string) => assets.find(a => a.name === n);

  expect(byName('Frag')).toMatchObject({ type: 'fragment', path: 'sb/content-fragments/LM/PD/X/Frag.json' });
  expect(byName('Tmpl')).toMatchObject({ type: 'template', path: 'sb/content-templates/LM/PD/X/Tmpl.json' });
  expect(byName('brand-lm')).toMatchObject({ type: 'tag', path: 'sb/tags/brand-lm.json' });
  expect(byName('trigger-x')).toMatchObject({ type: 'tag', path: 'sb/tags/trigger-x.json' });

  // Exactly these four — the directory entry and the other sandbox's tag are excluded.
  expect(assets).toHaveLength(4);
  expect(assets.filter(a => a.type === 'tag')).toHaveLength(2);
});

test('returns no tags when the subtree has none', async () => {
  const { listRepoTree } = jest.requireMock('../../src/github/client') as { listRepoTree: jest.Mock };
  listRepoTree.mockResolvedValueOnce({ tree: [{ path: 'sb/content-fragments/A.json', type: 'blob', sha: '1' }], truncated: false });
  const { assets } = await listRepoAssets('sb');
  expect(assets.filter(a => a.type === 'tag')).toHaveLength(0);
  expect(assets).toHaveLength(1);
});
