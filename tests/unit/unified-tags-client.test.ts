/**
 * Unit tests for the Unified Tags/Folders HTTP client. axios is mocked so the
 * request wrappers can be driven without a network: these assert the method, URL,
 * the shared auth/sandbox headers, Content-Type only on body requests, list-param
 * mapping, and path-segment encoding.
 */

jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getToken: jest.fn().mockResolvedValue('tok') }
}));

jest.mock('../../src/adobe/client', () => ({
  getConfiguredApiKey: () => 'api-key',
  getConfiguredImsOrg: () => 'org@AdobeOrg',
  getConfiguredSandboxName: () => 'my-sandbox'
}));

const request = jest.fn().mockResolvedValue({ data: { ok: true } });
jest.mock('axios', () => ({ __esModule: true, default: { request: (...a: unknown[]) => request(...a) }, request: (...a: unknown[]) => request(...a) }));

import * as ut from '../../src/adobe/unified-tags-client';

beforeEach(() => { request.mockClear(); request.mockResolvedValue({ data: { ok: true } }); });

const lastCall = () => request.mock.calls[request.mock.calls.length - 1][0] as {
  method: string; url: string; headers: Record<string, string>; params?: unknown; data?: unknown;
};

describe('auth + sandbox headers', () => {
  test('every request carries the IMS token, api key, org, and sandbox', async () => {
    await ut.getFolder('dataset', 'f1');
    const c = lastCall();
    expect(c.headers.Authorization).toBe('Bearer tok');
    expect(c.headers['x-api-key']).toBe('api-key');
    expect(c.headers['x-gw-ims-org-id']).toBe('org@AdobeOrg');
    expect(c.headers['x-sandbox-name']).toBe('my-sandbox');
  });

  test('read requests omit Content-Type; body requests set application/json', async () => {
    await ut.getTag('t1');
    expect(lastCall().headers['Content-Type']).toBeUndefined();
    await ut.createTag({ name: 'x' });
    expect(lastCall().headers['Content-Type']).toBe('application/json');
  });
});

describe('folders', () => {
  test('createFolder POSTs to the folder-type path with the body', async () => {
    await ut.createFolder('content-template', { name: 'A', parentFolderId: 'p' });
    const c = lastCall();
    expect(c.method).toBe('post');
    expect(c.url).toContain('/unifiedfolders/folders/content-template');
    expect(c.data).toEqual({ name: 'A', parentFolderId: 'p' });
  });

  test('updateFolder PATCHes the folder id with the patch ops', async () => {
    const ops = [{ op: 'replace', path: '/name', value: 'B' }];
    await ut.updateFolder('dataset', 'f1', ops);
    const c = lastCall();
    expect(c.method).toBe('patch');
    expect(c.url).toContain('/unifiedfolders/folders/dataset/f1');
    expect(c.data).toEqual(ops);
  });

  test('getSubfolders and validateFolder hit the right sub-paths', async () => {
    await ut.getSubfolders('dataset', 'f1');
    expect(lastCall().url).toContain('/unifiedfolders/folders/dataset/f1/subfolders');
    await ut.validateFolder('dataset', 'f1');
    expect(lastCall().url).toContain('/unifiedfolders/folders/dataset/f1/validate');
  });

  test('path segments are URL-encoded', async () => {
    await ut.getFolder('data set', 'a/b');
    expect(lastCall().url).toContain('/unifiedfolders/folders/data%20set/a%2Fb');
  });
});

describe('folder path cache', () => {
  // Each case starts from a clean cache so a prior test's resolve can't satisfy it.
  beforeEach(() => ut.clearFolderPathCache());

  test('resolveAjoFolderSegments caches by sandbox+type+id (second call does not re-fetch)', async () => {
    request.mockResolvedValue({ data: { name: 'Leaf', parentFolderId: null } });

    const first = await ut.resolveAjoFolderSegments('fragment', 'fid-1');
    expect(first).toEqual(['Leaf']);
    const callsAfterFirst = request.mock.calls.length;

    // Served from cache — no new HTTP request.
    const second = await ut.resolveAjoFolderSegments('fragment', 'fid-1');
    expect(second).toEqual(['Leaf']);
    expect(request.mock.calls.length).toBe(callsAfterFirst);
  });

  test('clearFolderPathCache forces the next resolve to re-fetch (picks up a rename)', async () => {
    request.mockResolvedValue({ data: { name: 'Old', parentFolderId: null } });
    expect(await ut.resolveAjoFolderSegments('fragment', 'fid-2')).toEqual(['Old']);
    const callsAfterFirst = request.mock.calls.length;

    // Simulate a rename upstream, then invalidate the cache: the next resolve must
    // re-fetch and return the NEW name rather than the stale cached one.
    request.mockResolvedValue({ data: { name: 'New', parentFolderId: null } });
    ut.clearFolderPathCache();
    expect(await ut.resolveAjoFolderSegments('fragment', 'fid-2')).toEqual(['New']);
    expect(request.mock.calls.length).toBe(callsAfterFirst + 1);
  });
});

describe('tags + tag categories', () => {
  test('listTags maps sort/filter params to query params', async () => {
    await ut.listTags({ limit: 10, property: 'name', sortBy: 'name', sortOrder: 'asc', start: '5' });
    expect(lastCall().params).toEqual({ limit: 10, property: 'name', sortBy: 'name', sortOrder: 'asc', start: '5' });
  });

  test('listTagCategories drops undefined params', async () => {
    await ut.listTagCategories({ limit: 5 });
    expect(lastCall().params).toEqual({ limit: 5 });
  });

  test('updateTag sends the BARE JSON-Patch array (the gateway adds the patchRequestList envelope) (Issue 6)', async () => {
    await ut.updateTag('t1', [{ op: 'replace', path: 'archived', value: 'true' }]);
    const c = lastCall();
    expect(c.method).toBe('patch');
    expect(c.url).toContain('/unifiedtags/tags/t1');
    // Bare array on the wire — NOT pre-wrapped in patchRequestList (which the gateway
    // would then double-wrap and the backend would reject).
    expect(c.data).toEqual([{ op: 'replace', path: 'archived', value: 'true' }]);
    expect(Array.isArray(c.data)).toBe(true);
    expect(c.headers['Content-Type']).toBe('application/json');
  });

  test('updateTag normalizes an already-enveloped object back to a bare array (never sends a wrapper)', async () => {
    // Defensive: a pre-wrapped { patchRequestList: [...] } must be unwrapped to a bare
    // array so the gateway's envelope can never double up.
    await ut.updateTag('t1', { patchRequestList: [{ op: 'replace', path: 'archived', value: 'true' }] } as never);
    const data = lastCall().data;
    expect(data).toEqual([{ op: 'replace', path: 'archived', value: 'true' }]);
    expect(Array.isArray(data)).toBe(true);
  });

  test('validateTags POSTs the ids body to the validate path', async () => {
    await ut.validateTags({ ids: ['a', 'b'] });
    const c = lastCall();
    expect(c.method).toBe('post');
    expect(c.url).toContain('/unifiedtags/tags/validate');
    expect(c.data).toEqual({ ids: ['a', 'b'] });
  });

  test('deleteTag issues a DELETE to the tag path', async () => {
    await ut.deleteTag('t1');
    const c = lastCall();
    expect(c.method).toBe('delete');
    expect(c.url).toContain('/unifiedtags/tags/t1');
  });

  test('getTagCategory is a read (GET) to the category path', async () => {
    await ut.getTagCategory('c1');
    const c = lastCall();
    expect(c.method).toBe('get');
    expect(c.url).toContain('/unifiedtags/tagCategory/c1');
    expect(c.headers['Content-Type']).toBeUndefined();
  });

  test('returns the upstream response body', async () => {
    request.mockResolvedValueOnce({ data: { id: 'x' } });
    expect(await ut.getTag('t1')).toEqual({ id: 'x' });
  });
});
