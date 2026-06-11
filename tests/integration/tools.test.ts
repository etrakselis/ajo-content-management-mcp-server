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
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} })
}));

import {
  handleListContentTemplates,
  handleCreateContentTemplate,
  handleGetContentTemplate,
  handleDeleteContentTemplate
} from '../../src/tools/templates';

import {
  handleListContentFragments,
  handleCreateContentFragment,
  handlePublishContentFragment,
  handleGetFragmentPublicationStatus
} from '../../src/tools/fragments';

import * as client from '../../src/adobe/client';

const mockClient = client as jest.Mocked<typeof client>;

describe('Template Tools Integration', () => {

  beforeEach(() => {
    mockClient.isClientConfigured.mockReturnValue(true);
  });

  afterEach(() => jest.clearAllMocks());

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

  test('get_content_template requires valid UUID', async () => {
    const result = await handleGetContentTemplate({ templateId: 'not-a-uuid' }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('get_content_template returns data with etag', async () => {
    const mockTemplateData = { id: 'b6d70a45-a149-453b-85ba-809a5d40066d', name: 'Test' };
    mockClient.getTemplate.mockResolvedValue({ data: mockTemplateData, etag: '"abc"' });

    const result = await handleGetContentTemplate({
      templateId: 'b6d70a45-a149-453b-85ba-809a5d40066d'
    }) as { success: boolean; data: unknown; etag: string };

    expect(result.success).toBe(true);
    expect(result.etag).toBe('"abc"');
  });

  test('delete_content_template calls correct API', async () => {
    mockClient.deleteTemplate.mockResolvedValue({ success: true });
    const result = await handleDeleteContentTemplate({
      templateId: 'b6d70a45-a149-453b-85ba-809a5d40066d'
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.deleteTemplate).toHaveBeenCalledWith('b6d70a45-a149-453b-85ba-809a5d40066d');
  });
});

describe('Fragment Tools Integration', () => {

  beforeEach(() => {
    mockClient.isClientConfigured.mockReturnValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  test('list_content_fragments returns paginated data', async () => {
    const mockData = { _page: { count: 1 }, items: [{ id: 'f1', name: 'Frag1', status: 'DRAFT' }] };
    mockClient.listFragments.mockResolvedValue(mockData);

    const result = await handleListContentFragments({}) as { success: boolean; data: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
  });

  test('create_content_fragment validates required fragment field', async () => {
    const result = await handleCreateContentFragment({
      name: 'Test',
      type: 'html',
      channels: ['email']
      // missing fragment
    }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  test('publish_content_fragment accepts valid fragmentId', async () => {
    mockClient.publishFragment.mockResolvedValue({ accepted: true, location: '/publications/1', retryAfter: '5' });

    const result = await handlePublishContentFragment({
      fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d'
    }) as { success: boolean; accepted: boolean };

    expect(result.success).toBe(true);
    expect(result.accepted).toBe(true);
    expect(mockClient.publishFragment).toHaveBeenCalledWith('b6d70a45-a149-453b-85ba-809a5d40066d');
  });

  test('get_fragment_publication_status returns status object', async () => {
    mockClient.getLastPublicationStatus.mockResolvedValue({ status: 'complete', errors: [] });

    const result = await handleGetFragmentPublicationStatus({
      fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d'
    }) as { success: boolean; data: { status: string } };

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('complete');
  });
});
