/**
 * Unit tests for the Adobe content client: HTTP wrappers (templates, fragments,
 * publication, archive), the error mapping that lifts the actionable message to
 * the top level (P1-2 / P2-2), and the array query-param serialization that makes
 * content-list `property` filters actually reach AJO (P0-2).
 *
 * axios is mocked so the wrappers can be driven without a network; the real
 * AxiosError / isAxiosError are kept so buildError behaves as in production.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  adobeApiErrorCounter: { inc: jest.fn() }
}));
jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getToken: jest.fn().mockResolvedValue('tok') }
}));
jest.mock('axios-retry', () => ({ __esModule: true, default: jest.fn() }));

const mockInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } }
};

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockInstance),
      post: jest.fn(),
      isAxiosError: actual.isAxiosError,
      AxiosError: actual.AxiosError
    },
    isAxiosError: actual.isAxiosError,
    AxiosError: actual.AxiosError
  };
});

import axios from 'axios';
import * as client from '../../src/adobe/client';

const realAxios = jest.requireActual('axios');

function axiosError(status: number, data: unknown) {
  return new realAxios.AxiosError(
    'Request failed with status code ' + status,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    { status, data, statusText: '', headers: {}, config: {} as never }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client.configureAdobeClient({ sandboxName: 'sb', imsOrg: 'org@AdobeOrg', apiKey: 'key' });
});

describe('configuration getters', () => {
  test('expose the configured identity', () => {
    expect(client.isClientConfigured()).toBe(true);
    expect(client.getConfiguredSandboxName()).toBe('sb');
    expect(client.getConfiguredImsOrg()).toBe('org@AdobeOrg');
    expect(client.getConfiguredApiKey()).toBe('key');
    client.resetAdobeClient();
    expect(client.isClientConfigured()).toBe(false);
  });
});

describe('template HTTP wrappers', () => {
  test('listTemplates forwards pagination/filter params', async () => {
    mockInstance.get.mockResolvedValue({ data: { items: [] } });
    await client.listTemplates({ limit: 10, property: ['name~^X'] });
    expect(mockInstance.get).toHaveBeenCalledWith('/templates', expect.objectContaining({
      params: { limit: 10, property: ['name~^X'] }
    }));
  });

  test('createTemplate returns id/location/etag from response headers', async () => {
    mockInstance.post.mockResolvedValue({ headers: { 'x-resource-id': 'id1', location: '/templates/id1', etag: '"v1"' } });
    const res = await client.createTemplate({ name: 'T' });
    expect(res).toEqual({ id: 'id1', location: '/templates/id1', etag: '"v1"' });
  });

  test('getTemplate returns data + etag', async () => {
    mockInstance.get.mockResolvedValue({ data: { id: 'id1' }, headers: { etag: '"v1"' } });
    const res = await client.getTemplate('id1');
    expect(res).toEqual({ data: { id: 'id1' }, etag: '"v1"' });
  });

  test('updateTemplate sends If-Match and returns the new etag (P1)', async () => {
    mockInstance.put.mockResolvedValue({ headers: { etag: '"v2"' } });
    const res = await client.updateTemplate('id1', { name: 'T' }, '"v1"');
    expect(res).toEqual({ success: true, etag: '"v2"' });
    expect(mockInstance.put).toHaveBeenCalledWith('/templates/id1', { name: 'T' }, expect.objectContaining({
      headers: expect.objectContaining({ 'If-Match': '"v1"' })
    }));
  });

  test('updateTemplate falls back to a read when PUT returns no etag header (P1)', async () => {
    mockInstance.put.mockResolvedValue({ headers: {} });
    mockInstance.get.mockResolvedValue({ data: {}, headers: { etag: '"vGET"' } });
    expect(await client.updateTemplate('id1', { name: 'T' }, '"v1"')).toEqual({ success: true, etag: '"vGET"' });
  });

  test('updateTemplate never throws after the PUT commits even if the fallback read fails (P0)', async () => {
    mockInstance.put.mockResolvedValue({ headers: {} });
    mockInstance.get.mockRejectedValue(new Error('read failed'));
    expect(await client.updateTemplate('id1', { name: 'T' }, '"v1"')).toEqual({ success: true });
  });

  test('patchTemplate returns the new etag, no data (P0 parity with fragment sibling)', async () => {
    mockInstance.patch.mockResolvedValue({ data: { id: 'id1' }, headers: { etag: '"v2"' } });
    expect(await client.patchTemplate('id1', [{ op: 'replace', path: '/name', value: 'x' }], '"v1"'))
      .toEqual({ success: true, etag: '"v2"' });
  });

  test('patchTemplate tolerates a 204/empty body with no etag header (P0)', async () => {
    mockInstance.patch.mockResolvedValue({ data: '', headers: {} });
    expect(await client.patchTemplate('id1', [{ op: 'replace', path: '/name', value: 'x' }], '"v1"'))
      .toEqual({ success: true });
  });

  test('deleteTemplate resolves success', async () => {
    mockInstance.delete.mockResolvedValue({});
    expect(await client.deleteTemplate('id1')).toEqual({ success: true });
  });
});

describe('fragment HTTP wrappers', () => {
  test('listFragments forwards params', async () => {
    mockInstance.get.mockResolvedValue({ data: { items: [] } });
    await client.listFragments({ start: 'cursor', orderBy: '-modifiedAt' });
    expect(mockInstance.get).toHaveBeenCalledWith('/fragments', expect.objectContaining({
      params: { start: 'cursor', orderBy: '-modifiedAt' }
    }));
  });

  test('createFragment returns id/location/etag', async () => {
    mockInstance.post.mockResolvedValue({ headers: { 'x-resource-id': 'f1', location: '/fragments/f1', etag: '"v1"' } });
    expect(await client.createFragment({ name: 'F' })).toEqual({ id: 'f1', location: '/fragments/f1', etag: '"v1"' });
  });

  test('getFragment returns data + etag', async () => {
    mockInstance.get.mockResolvedValue({ data: { id: 'f1' }, headers: { etag: '"v1"' } });
    expect(await client.getFragment('f1')).toEqual({ data: { id: 'f1' }, etag: '"v1"' });
  });

  test('updateFragment returns the new etag; patchFragment resolves success (P1/P0)', async () => {
    mockInstance.put.mockResolvedValue({ headers: { etag: '"v2"' } });
    mockInstance.patch.mockResolvedValue({});
    expect(await client.updateFragment('f1', { name: 'F' }, '"v1"')).toEqual({ success: true, etag: '"v2"' });
    expect(await client.patchFragment('f1', [{ op: 'replace', path: '/name', value: 'x' }], '"v1"')).toEqual({ success: true });
  });

  test('publishFragment keeps a small Retry-After as seconds (P3)', async () => {
    mockInstance.post.mockResolvedValue({ headers: { location: '/fragments/f1/publishStatus', 'retry-after': '5' } });
    const res = await client.publishFragment('f1');
    expect(res).toEqual({ accepted: true, location: '/fragments/f1/publishStatus', retryAfter: 5 });
  });

  test('publishFragment normalizes a millisecond Retry-After to seconds (P3)', async () => {
    mockInstance.post.mockResolvedValue({ headers: { location: '/x', 'retry-after': '1000' } });
    expect((await client.publishFragment('f1')).retryAfter).toBe(1);
  });

  test('publishFragment omits retryAfter when the header is absent', async () => {
    mockInstance.post.mockResolvedValue({ headers: { location: '/x' } });
    expect((await client.publishFragment('f1')).retryAfter).toBeUndefined();
  });

  test('getLiveFragment / getLastPublicationStatus return data', async () => {
    mockInstance.get.mockResolvedValue({ data: { status: 'complete' } });
    expect(await client.getLiveFragment('f1')).toEqual({ status: 'complete' });
    expect(await client.getLastPublicationStatus('f1')).toEqual({ status: 'complete' });
  });

  test('archiveFragment returns id/etag from the GraphQL mutation', async () => {
    (axios as unknown as { post: jest.Mock }).post.mockResolvedValue({
      data: { data: { updateAjoFragmentState: { id: 'f1', etag: '"v2"' } } }
    });
    expect(await client.archiveFragment('f1')).toEqual({ id: 'f1', etag: '"v2"' });
  });

  test('archiveFragment throws when the mutation returns GraphQL errors', async () => {
    (axios as unknown as { post: jest.Mock }).post.mockResolvedValue({ data: { errors: [{ message: 'denied' }] } });
    await expect(client.archiveFragment('f1')).rejects.toThrow(/Archive mutation error/);
  });
});

describe('buildError — actionable message surfacing (P1-2)', () => {
  test('lifts the deepest detailedMessage to the top-level message', () => {
    const e = client.buildError(axiosError(400, {
      title: 'Bad Request. Validation failed.',
      report: { additionalContext: { detailedMessage: 'Patch on path /subject not allowed' } }
    }));
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('Patch on path /subject not allowed');
    expect((e.details as { title?: string }).title).toBe('Bad Request. Validation failed.');
  });

  test('joins a field-level errors array into one sentence', () => {
    const e = client.buildError(axiosError(400, { errors: [{ message: 'subject is required' }, { message: 'html must be an object' }] }));
    expect(e.message).toBe('subject is required; html must be an object');
  });

  test('falls back to title when nothing deeper exists', () => {
    expect(client.buildError(axiosError(400, { title: 'Bad Request. Validation failed.' })).message)
      .toBe('Bad Request. Validation failed.');
  });

  test('non-axios errors map to INTERNAL_ERROR', () => {
    expect(client.buildError(new Error('boom')).code).toBe('INTERNAL_ERROR');
  });

  test('strips internal service-routing fields from details', () => {
    const e = client.buildError(axiosError(500, { title: 'oops', 'error-chain': ['x'], invokingServiceId: 'svc' }));
    expect(e.details).not.toHaveProperty('error-chain');
    expect(e.details).not.toHaveProperty('invokingServiceId');
  });
});

describe('buildError — upstream timeout mapping (C1b)', () => {
  test('a timed-out request maps to a retryable TIMEOUT error', () => {
    const timeoutErr = new realAxios.AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED');
    const e = client.buildError(timeoutErr);
    expect(e.code).toBe('TIMEOUT');
    expect(e.message).toMatch(/retry/i);
  });
});

describe('buildError — 409 recovery wording (P2-2)', () => {
  test('names the get_* tool to call to recover from a stale etag', () => {
    const e = client.buildError(axiosError(409, { title: 'The resource was updated in another tab.' }));
    expect(e.code).toBe('CONFLICT');
    expect(e.message).toMatch(/get_content_template \/ get_content_fragment/);
    expect(e.message).toMatch(/stale etag/i);
  });
});

describe('array query-param serialization (P0-2)', () => {
  test('a property array serializes as repeated keys, not bracketed', () => {
    // Mirrors the exact option the content client is created with.
    const inst = realAxios.create({ paramsSerializer: { indexes: null } });
    const uri = inst.getUri({ url: '/templates', params: { property: ['name~^Welcome', 'status==PUBLISHED'] } });
    expect(uri).not.toMatch(/property\[\]/);
    expect((uri.match(/(^|[?&])property=/g) || []).length).toBe(2);
  });
});
