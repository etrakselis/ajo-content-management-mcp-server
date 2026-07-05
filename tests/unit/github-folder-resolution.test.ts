/**
 * Regression test for the GitHub folder-resolution bug: an update/patch whose args don't
 * set a folder was committed to the type-dir root (orphaned) instead of the fragment's
 * actual folder. resolveCanonicalNaming must resolve parentFolderId with the precedence:
 * a folder the op explicitly sets wins; otherwise the object's CURRENT folder is fetched.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) }
}));

jest.mock('../../src/adobe/client', () => ({
  getFragment: jest.fn(),
  getTemplate: jest.fn(),
  // Referenced by server.ts's import list but not exercised here.
  isClientConfigured: jest.fn(), getConfiguredSandboxName: jest.fn(), getConfiguredOrgName: jest.fn(),
  getConfiguredTenantId: jest.fn(), getConfiguredAuthorEmail: jest.fn(), getConfiguredNamingConvention: jest.fn(),
  getConfiguredGitHubIntegration: jest.fn(), listFragments: jest.fn(), listTemplates: jest.fn(), buildError: jest.fn()
}));

jest.mock('../../src/adobe/unified-tags-client', () => ({
  resolveAjoFolderPath: jest.fn(), getTag: jest.fn(), getFolder: jest.fn()
}));

import { resolveCanonicalNaming } from '../../src/mcp/server';
import { getFragment } from '../../src/adobe/client';

const mockGetFragment = getFragment as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('resolveCanonicalNaming — GitHub folder resolution', () => {
  test('content-only update (name, no parentFolderId) fetches the fragment CURRENT folder', async () => {
    mockGetFragment.mockResolvedValue({ data: { name: 'ND_PD_ShopBag_Hero', parentFolderId: 'folder-shopbag' } });
    const r = await resolveCanonicalNaming('update_content_fragment', {
      fragmentId: 'frag-1', name: 'ND_PD_ShopBag_Hero', type: 'html'
    });
    expect(mockGetFragment).toHaveBeenCalledWith('frag-1');
    expect(r).toEqual({ name: 'ND_PD_ShopBag_Hero', parentFolderId: 'folder-shopbag' });
  });

  test('update that explicitly moves (name + parentFolderId) uses args, no fetch', async () => {
    const r = await resolveCanonicalNaming('update_content_fragment', {
      fragmentId: 'frag-1', name: 'X', parentFolderId: 'new-folder'
    });
    expect(mockGetFragment).not.toHaveBeenCalled();
    expect(r).toEqual({ name: 'X', parentFolderId: 'new-folder' });
  });

  test('patch move (/parentFolderId op) — the NEW folder wins over the current one', async () => {
    mockGetFragment.mockResolvedValue({ data: { name: 'Hero', parentFolderId: 'old-folder' } });
    const r = await resolveCanonicalNaming('patch_content_fragment', {
      fragmentId: 'frag-1', etag: '"e"',
      patches: [{ op: 'add', path: '/parentFolderId', value: 'new-folder' }]
    });
    expect(r).toEqual({ name: 'Hero', parentFolderId: 'new-folder' });
  });

  test('metadata patch (rename, no move) keeps the fragment current folder', async () => {
    mockGetFragment.mockResolvedValue({ data: { name: 'Hero', parentFolderId: 'folder-a' } });
    const r = await resolveCanonicalNaming('patch_content_fragment', {
      fragmentId: 'frag-1', etag: '"e"',
      patches: [{ op: 'add', path: '/name', value: 'HeroRenamed' }]
    });
    expect(r).toEqual({ name: 'Hero', parentFolderId: 'folder-a' });
  });
});
