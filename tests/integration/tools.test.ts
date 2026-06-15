/**
 * Integration tests for MCP tool handlers.
 * These tests mock the Adobe API client and verify tool behavior end-to-end.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: jest.fn(),
  getConfiguredSandboxName: jest.fn().mockReturnValue('my-sandbox'),
  getConfiguredOrgName: jest.fn().mockReturnValue(null),
  getConfiguredTenantId: jest.fn().mockReturnValue('mytenant'),
  getConfiguredAuthorEmail: jest.fn().mockReturnValue('author@example.com'),
  listTemplates: jest.fn(),
  createTemplate: jest.fn(),
  getTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  patchTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
  listFragments: jest.fn(),
  createFragment: jest.fn(),
  getFragment: jest.fn(),
  updateFragment: jest.fn(),
  patchFragment: jest.fn(),
  publishFragment: jest.fn(),
  getLiveFragment: jest.fn(),
  getLastPublicationStatus: jest.fn(),
  archiveFragment: jest.fn(),
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} })
}));

import {
  handleListContentTemplates,
  handleCreateContentTemplate,
  handleGetContentTemplate,
  handleUpdateContentTemplate,
  handlePatchContentTemplate,
  handleDeleteContentTemplate
} from '../../src/tools/templates';

import {
  handleListContentFragments,
  handleCreateContentFragment,
  handleGetContentFragment,
  handleUpdateContentFragment,
  handlePatchContentFragment,
  handlePublishContentFragment,
  handleGetFragmentPublicationStatus,
  handleGetLiveFragment,
  handleArchiveContentFragment
} from '../../src/tools/fragments';

import { handleGetServerContext } from '../../src/tools/context';

import * as client from '../../src/adobe/client';

const mockClient = client as jest.Mocked<typeof client>;
const VALID_UUID = 'b6d70a45-a149-453b-85ba-809a5d40066d';

// ─── Server Context Tool ──────────────────────────────────────────────────────

describe('get_server_context', () => {
  afterEach(() => jest.clearAllMocks());

  test('reports the author, sandbox, and tenant when configured', async () => {
    mockClient.isClientConfigured.mockReturnValue(true);
    const result = await handleGetServerContext({}) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data.authorEmail).toBe('author@example.com');
    expect(result.data.sandbox).toBe('my-sandbox');
    expect(result.data.tenantNamespace).toBe('_mytenant');
    expect(result.data).toHaveProperty('writeAccess');
  });

  test('returns NOT_CONFIGURED when the server is not set up', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetServerContext({}) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });
});

// ─── Template Tools ───────────────────────────────────────────────────────────

describe('Template Tools Integration', () => {

  beforeEach(() => { mockClient.isClientConfigured.mockReturnValue(true); });
  afterEach(() => jest.clearAllMocks());

  // list

  test('list_content_templates returns data on success', async () => {
    const mockData = { _page: { count: 2 }, items: [{ id: '1', name: 'T1' }] };
    mockClient.listTemplates.mockResolvedValue(mockData);
    const result = await handleListContentTemplates({ limit: 10 }) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
    expect(mockClient.listTemplates).toHaveBeenCalledWith({ limit: 10 });
  });

  test('list_content_templates returns NOT_CONFIGURED when client not ready', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleListContentTemplates({}) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('list_content_templates surfaces API errors', async () => {
    mockClient.listTemplates.mockRejectedValue(new Error('network failure'));
    const result = await handleListContentTemplates({}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  // create

  test('create_content_template validates required fields', async () => {
    const result = await handleCreateContentTemplate({ name: 'T' }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('create_content_template succeeds with valid payload', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'abc-123', location: '/templates/abc-123', etag: '"v1"' });
    const result = await handleCreateContentTemplate({
      name: 'Email Template',
      templateType: 'html',
      channels: ['email'],
      template: { html: '<html>Hi</html>' }
    }) as { success: boolean; id: string };
    expect(result.success).toBe(true);
    expect(result.id).toBe('abc-123');
  });

  test('create_content_template surfaces API errors', async () => {
    mockClient.createTemplate.mockRejectedValue(new Error('server error'));
    const result = await handleCreateContentTemplate({
      name: 'T', templateType: 'html', channels: ['email']
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  // get

  test('get_content_template requires valid UUID', async () => {
    const result = await handleGetContentTemplate({ templateId: 'not-a-uuid' }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('get_content_template returns data with etag', async () => {
    const mockTemplateData = { id: VALID_UUID, name: 'Test' };
    mockClient.getTemplate.mockResolvedValue({ data: mockTemplateData, etag: '"abc"' });
    const result = await handleGetContentTemplate({ templateId: VALID_UUID }) as { success: boolean; data: unknown; etag: string };
    expect(result.success).toBe(true);
    expect(result.etag).toBe('"abc"');
  });

  // update (PUT)

  test('update_content_template succeeds', async () => {
    mockClient.updateTemplate.mockResolvedValue({ success: true });
    const result = await handleUpdateContentTemplate({
      templateId: VALID_UUID,
      etag: '"v1"',
      name: 'Updated Template',
      templateType: 'html',
      channels: ['email'],
      template: { html: '<html>Updated</html>' }
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.updateTemplate).toHaveBeenCalledWith(VALID_UUID, expect.any(Object), '"v1"');
  });

  test('update_content_template returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleUpdateContentTemplate({
      templateId: VALID_UUID, etag: '"v1"', name: 'T', templateType: 'html', channels: ['email']
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('update_content_template validates required fields', async () => {
    const result = await handleUpdateContentTemplate({ templateId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  // patch

  test('patch_content_template succeeds', async () => {
    mockClient.patchTemplate.mockResolvedValue({ data: {}, etag: '"v2"' });
    const result = await handlePatchContentTemplate({
      templateId: VALID_UUID,
      etag: '"v1"',
      patches: [{ op: 'replace', path: '/name', value: 'New Name' }]
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.patchTemplate).toHaveBeenCalledWith(
      VALID_UUID,
      [{ op: 'replace', path: '/name', value: 'New Name' }],
      '"v1"'
    );
  });

  test('patch_content_template returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handlePatchContentTemplate({
      templateId: VALID_UUID, etag: '"v1"', patches: [{ op: 'replace', path: '/name', value: 'x' }]
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // delete

  test('delete_content_template calls correct API', async () => {
    mockClient.deleteTemplate.mockResolvedValue({ success: true });
    const result = await handleDeleteContentTemplate({ templateId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.deleteTemplate).toHaveBeenCalledWith(VALID_UUID);
  });

  test('delete_content_template surfaces API errors', async () => {
    mockClient.deleteTemplate.mockRejectedValue(new Error('not found'));
    const result = await handleDeleteContentTemplate({ templateId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('get_content_template surfaces API errors', async () => {
    mockClient.getTemplate.mockRejectedValue(new Error('not found'));
    const result = await handleGetContentTemplate({ templateId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('update_content_template surfaces API errors', async () => {
    mockClient.updateTemplate.mockRejectedValue(new Error('conflict'));
    const result = await handleUpdateContentTemplate({
      templateId: VALID_UUID, etag: '"v1"', name: 'T', templateType: 'html', channels: ['email']
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('patch_content_template surfaces API errors', async () => {
    mockClient.patchTemplate.mockRejectedValue(new Error('conflict'));
    const result = await handlePatchContentTemplate({
      templateId: VALID_UUID, etag: '"v1"', patches: [{ op: 'replace', path: '/name', value: 'x' }]
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });
});

// ─── Fragment Tools ───────────────────────────────────────────────────────────

describe('Fragment Tools Integration', () => {

  beforeEach(() => { mockClient.isClientConfigured.mockReturnValue(true); });
  afterEach(() => jest.clearAllMocks());

  // list

  test('list_content_fragments returns paginated data', async () => {
    const mockData = { _page: { count: 1 }, items: [{ id: 'f1', name: 'Frag1', status: 'DRAFT' }] };
    mockClient.listFragments.mockResolvedValue(mockData);
    const result = await handleListContentFragments({}) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
  });

  test('list_content_fragments returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleListContentFragments({}) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // create — source defaulting (regression for the source bug fix)

  test('create_content_fragment validates required fragment field', async () => {
    const result = await handleCreateContentFragment({
      name: 'Test', type: 'html', channels: ['email']
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('create_content_fragment defaults source to { origin: "ajo" } when omitted', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-123', location: '/fragments/f-123', etag: '"v1"' });
    await handleCreateContentFragment({
      name: 'Test Fragment', type: 'html', channels: ['email'],
      fragment: { content: '<div>Hi</div>' }
    });
    expect(mockClient.createFragment).toHaveBeenCalledWith(
      expect.objectContaining({ source: { origin: 'ajo' } })
    );
  });

  test('create_content_fragment preserves caller-supplied source', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-123', location: '/fragments/f-123', etag: '"v1"' });
    await handleCreateContentFragment({
      name: 'External Fragment', type: 'html', channels: ['email'],
      fragment: { content: '<div>Hi</div>' },
      source: { origin: 'external' }
    });
    expect(mockClient.createFragment).toHaveBeenCalledWith(
      expect.objectContaining({ source: { origin: 'external' } })
    );
  });

  test('create_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleCreateContentFragment({
      name: 'T', type: 'html', channels: ['email'], fragment: {}
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // get

  test('get_content_fragment returns data with etag', async () => {
    const mockData = { id: VALID_UUID, name: 'My Fragment', type: 'html', status: 'DRAFT' };
    mockClient.getFragment.mockResolvedValue({ data: mockData, etag: '"abc"' });
    const result = await handleGetContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; data: unknown; etag: string };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
    expect(result.etag).toBe('"abc"');
  });

  test('get_content_fragment requires valid UUID', async () => {
    const result = await handleGetContentFragment({ fragmentId: 'not-a-uuid' }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('get_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // update (PUT) — source defaulting (regression for the source bug fix)

  test('update_content_fragment defaults source to { origin: "ajo" } when omitted', async () => {
    mockClient.updateFragment.mockResolvedValue({ success: true });
    await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"',
      name: 'Updated Fragment', type: 'html', channels: ['email'],
      fragment: { content: '<div>Updated</div>' }
    });
    expect(mockClient.updateFragment).toHaveBeenCalledWith(
      VALID_UUID,
      expect.objectContaining({ source: { origin: 'ajo' } }),
      '"v1"'
    );
  });

  test('update_content_fragment preserves caller-supplied source', async () => {
    mockClient.updateFragment.mockResolvedValue({ success: true });
    await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"',
      name: 'External Fragment', type: 'html', channels: ['email'],
      fragment: { content: '<div>Updated</div>' },
      source: { origin: 'external' }
    });
    expect(mockClient.updateFragment).toHaveBeenCalledWith(
      VALID_UUID,
      expect.objectContaining({ source: { origin: 'external' } }),
      '"v1"'
    );
  });

  test('update_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', name: 'F', type: 'html', channels: ['email'], fragment: {}
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // patch

  test('patch_content_fragment succeeds', async () => {
    mockClient.patchFragment.mockResolvedValue({ success: true });
    const result = await handlePatchContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"',
      patches: [{ op: 'replace', path: '/name', value: 'New Name' }]
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.patchFragment).toHaveBeenCalledWith(
      VALID_UUID,
      [{ op: 'replace', path: '/name', value: 'New Name' }],
      '"v1"'
    );
  });

  test('patch_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handlePatchContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', patches: [{ op: 'replace', path: '/name', value: 'x' }]
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // publish

  test('publish_content_fragment accepts valid fragmentId', async () => {
    mockClient.publishFragment.mockResolvedValue({ accepted: true, location: '/publications/1', retryAfter: 5 });
    const result = await handlePublishContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; accepted: boolean };
    expect(result.success).toBe(true);
    expect(result.accepted).toBe(true);
    expect(mockClient.publishFragment).toHaveBeenCalledWith(VALID_UUID);
  });

  test('publish_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handlePublishContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // get live

  test('get_live_fragment returns published content', async () => {
    const mockData = { type: 'html', fragment: { content: '<div>Live</div>' } };
    mockClient.getLiveFragment.mockResolvedValue(mockData);
    const result = await handleGetLiveFragment({ fragmentId: VALID_UUID }) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
  });

  test('get_live_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetLiveFragment({ fragmentId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // publication status

  test('get_fragment_publication_status returns status object', async () => {
    mockClient.getLastPublicationStatus.mockResolvedValue({ status: 'complete', errors: [] });
    const result = await handleGetFragmentPublicationStatus({ fragmentId: VALID_UUID }) as { success: boolean; data: { status: string } };
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('complete');
  });

  test('get_fragment_publication_status returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetFragmentPublicationStatus({ fragmentId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  // archive

  test('archive_content_fragment succeeds', async () => {
    mockClient.archiveFragment.mockResolvedValue({ id: VALID_UUID, etag: '"v2"' });
    const result = await handleArchiveContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; id: string; etag: string };
    expect(result.success).toBe(true);
    expect(result.id).toBe(VALID_UUID);
    expect(result.etag).toBe('"v2"');
    expect(mockClient.archiveFragment).toHaveBeenCalledWith(VALID_UUID);
  });

  test('archive_content_fragment requires valid UUID', async () => {
    const result = await handleArchiveContentFragment({ fragmentId: 'not-a-uuid' }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('archive_content_fragment returns NOT_CONFIGURED', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleArchiveContentFragment({ fragmentId: VALID_UUID }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('archive_content_fragment surfaces API errors', async () => {
    mockClient.archiveFragment.mockRejectedValue(new Error('GraphQL error'));
    const result = await handleArchiveContentFragment({ fragmentId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('list_content_fragments surfaces API errors', async () => {
    mockClient.listFragments.mockRejectedValue(new Error('network failure'));
    const result = await handleListContentFragments({}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('create_content_fragment surfaces API errors', async () => {
    mockClient.createFragment.mockRejectedValue(new Error('server error'));
    const result = await handleCreateContentFragment({
      name: 'T', type: 'html', channels: ['email'], fragment: { content: '<div/>' }
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('get_content_fragment surfaces API errors', async () => {
    mockClient.getFragment.mockRejectedValue(new Error('not found'));
    const result = await handleGetContentFragment({ fragmentId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('update_content_fragment surfaces API errors', async () => {
    mockClient.updateFragment.mockRejectedValue(new Error('conflict'));
    const result = await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', name: 'F', type: 'html', channels: ['email'], fragment: {}
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('patch_content_fragment surfaces API errors', async () => {
    mockClient.patchFragment.mockRejectedValue(new Error('conflict'));
    const result = await handlePatchContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', patches: [{ op: 'replace', path: '/name', value: 'x' }]
    }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('publish_content_fragment surfaces API errors', async () => {
    mockClient.publishFragment.mockRejectedValue(new Error('fragment not publishable'));
    const result = await handlePublishContentFragment({ fragmentId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('get_live_fragment surfaces API errors', async () => {
    mockClient.getLiveFragment.mockRejectedValue(new Error('not published'));
    const result = await handleGetLiveFragment({ fragmentId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });

  test('get_fragment_publication_status surfaces API errors', async () => {
    mockClient.getLastPublicationStatus.mockRejectedValue(new Error('status unavailable'));
    const result = await handleGetFragmentPublicationStatus({ fragmentId: VALID_UUID }) as { success: boolean };
    expect(result.success).toBe(false);
  });
});
