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
  getConfiguredNamingConvention: jest.fn().mockReturnValue(undefined),
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
import { handleGetVisualDesignerRequirements } from '../../src/tools/visual-designer';

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
    // Resource routing catalog: present, and each entry has an access hint so the
    // model knows how to obtain content it can't read as an MCP resource directly.
    const resources = result.data.resources as Array<{ uri: string; access: string }>;
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every(r => typeof r.access === 'string' && r.access.length > 0)).toBe(true);
    const errorCodes = resources.find(r => r.uri === 'ajo://error-codes');
    expect(errorCodes).toBeDefined();
    const visual = resources.find(r => r.uri === 'ajo://visual-designer-requirements');
    expect(visual?.access).toContain('get_visual_designer_requirements');
  });

  test('omits orgName entirely when it is not configured', async () => {
    mockClient.isClientConfigured.mockReturnValue(true);
    mockClient.getConfiguredOrgName.mockReturnValue(null);
    const result = await handleGetServerContext({}) as { data: Record<string, unknown> };
    expect(result.data).not.toHaveProperty('orgName');
  });

  test('includes orgName (trimmed) when it is configured', async () => {
    mockClient.isClientConfigured.mockReturnValue(true);
    mockClient.getConfiguredOrgName.mockReturnValue('  Acme Corp  ');
    const result = await handleGetServerContext({}) as { data: Record<string, unknown> };
    expect(result.data.orgName).toBe('Acme Corp');
  });

  test('returns NOT_CONFIGURED when the server is not set up', async () => {
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetServerContext({}) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NOT_CONFIGURED');
  });
});

// ─── Visual Designer Requirements Tool ────────────────────────────────────────

describe('get_visual_designer_requirements', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns the full spec without requiring configuration', async () => {
    // Pure static reference — must work even when the server is not configured.
    mockClient.isClientConfigured.mockReturnValue(false);
    const result = await handleGetVisualDesignerRequirements({}) as { success: boolean; requirements: string };
    expect(result.success).toBe(true);
    expect(typeof result.requirements).toBe('string');
    // Spot-check that the catalog and verbatim <head> markers are present.
    expect(result.requirements).toContain('richtext.structure_1_1_column');
    expect(result.requirements).toContain('button:2');
    expect(result.requirements).toContain('content-version');
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
      name: 'T', templateType: 'html', channels: ['email'], template: { html: '<html/>' }
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
    const result = await handleGetContentTemplate({ templateId: VALID_UUID }) as { success: boolean; data: unknown; etag: string; embeddedFragments: unknown[] };
    expect(result.success).toBe(true);
    expect(result.etag).toBe('"abc"');
    expect(result.embeddedFragments).toEqual([]);
  });

  test('get_content_template derives embeddedFragments from {{ fragment }} helper embeds (P2)', async () => {
    const uuid1 = 'b6d70a45-a149-453b-85ba-809a5d40066d';
    const uuid2 = 'c7e81b56-b25a-564c-96cb-91ab6e51177e';
    const helper = (ref: string) => `{{ fragment id="${ref}" name="F" mode="inline" }}`;
    mockClient.getTemplate.mockResolvedValue({
      data: {
        id: VALID_UUID,
        templateType: 'content',
        template: { html: { body: `<th>${helper(`ajo:${uuid1}`)}</th><th>${helper(`aem:${uuid2}`)}</th><th>${helper(`ajo:${uuid1}`)}</th>` } },
        referencedFragments: []
      },
      etag: '"abc"'
    });
    const result = await handleGetContentTemplate({ templateId: VALID_UUID }) as {
      embeddedFragments: Array<{ reference: string; source: string; id: string }>;
    };
    // Deduped, source preserved, even though referencedFragments is empty upstream.
    expect(result.embeddedFragments).toEqual([
      { reference: `ajo:${uuid1}`, source: 'ajo', id: uuid1 },
      { reference: `aem:${uuid2}`, source: 'aem', id: uuid2 }
    ]);
  });

  test('get_content_template surfaces prefix-less {{ fragment }} helper ids as invalidFragmentReferences (#3)', async () => {
    const bareUuid = '301c64ce-4085-4e86-8afc-254854d3c34c';
    mockClient.getTemplate.mockResolvedValue({
      data: { id: VALID_UUID, templateType: 'content', template: { html: { body: `<th>{{ fragment id="${bareUuid}" name="F" mode="inline" }}</th>` } } },
      etag: '"abc"'
    });
    const result = await handleGetContentTemplate({ templateId: VALID_UUID }) as {
      embeddedFragments: unknown[]; invalidFragmentReferences?: string[];
    };
    expect(result.embeddedFragments).toEqual([]);
    expect(result.invalidFragmentReferences).toEqual([bareUuid]);
  });

  test('create_content_template warns when a {{ fragment }} helper id lacks an ajo:/aem:/external: prefix (#3)', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'df1', location: '/templates/df1', etag: '"v1"' });
    const bareUuid = '301c64ce-4085-4e86-8afc-254854d3c34c';
    const nativeHtml = `<html><head><meta name="content-version" content="1"></head><body><div class="acr-structure"><th>{{ fragment id="${bareUuid}" name="F" mode="inline" }}</th></div></body></html>`;
    const result = await handleCreateContentTemplate({
      name: 'Embed', templateType: 'content', channels: ['email'],
      template: { subject: 'Hi', html: { body: nativeHtml } }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    // native HTML → no compat warning; but the bare-UUID helper id → a malformed-ref warning.
    expect(result.warnings?.some(w => w.includes('missing a required ajo:/aem:/external: prefix'))).toBe(true);
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

  test('patch_content_template succeeds and returns the etag (no data) (P0)', async () => {
    mockClient.patchTemplate.mockResolvedValue({ success: true, etag: '"v2"' });
    const result = await handlePatchContentTemplate({
      templateId: VALID_UUID,
      etag: '"v1"',
      patches: [{ op: 'replace', path: '/name', value: 'New Name' }]
    }) as { success: boolean; etag?: string; data?: unknown };
    expect(result.success).toBe(true);
    expect(result.etag).toBe('"v2"');
    expect(result).not.toHaveProperty('data');
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

  test('patch_content_template normalizes replace→add for /tagIds (Issue 2)', async () => {
    mockClient.patchTemplate.mockResolvedValue({ success: true, etag: '"v2"' });
    await handlePatchContentTemplate({
      templateId: VALID_UUID, etag: '"v1"',
      patches: [{ op: 'replace', path: '/tagIds', value: ['b4d081a7-fe4b-4c24-9491-2a246902c9ab'] }]
    });
    expect(mockClient.patchTemplate).toHaveBeenCalledWith(
      VALID_UUID,
      [{ op: 'add', path: '/tagIds', value: ['b4d081a7-fe4b-4c24-9491-2a246902c9ab'] }],
      '"v1"'
    );
  });

  // create/update — organization (Issue 1 two-step, Issue 3 tagIds)

  test('create_content_template files into a folder via a follow-up add PATCH (Issue 1)', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 't-fold', location: '/templates/t-fold', etag: '"v1"' });
    mockClient.patchTemplate.mockResolvedValue({ success: true, etag: '"v2"' });
    const result = await handleCreateContentTemplate({
      name: 'Filed', templateType: 'html', channels: ['email'],
      template: { html: '<html>x</html>' }, parentFolderId: '05472be1-a554-40a7-ac03-67b31d62f61f'
    }) as { success: boolean; etag?: string };
    expect(result.success).toBe(true);
    expect(mockClient.createTemplate).toHaveBeenCalledWith(expect.not.objectContaining({ parentFolderId: expect.anything() }));
    expect(mockClient.patchTemplate).toHaveBeenCalledWith('t-fold', [{ op: 'add', path: '/parentFolderId', value: '05472be1-a554-40a7-ac03-67b31d62f61f' }], '"v1"');
    expect(result.etag).toBe('"v2"');
  });

  test('update_content_template strips parentFolderId from the PUT body (Issue 1)', async () => {
    mockClient.updateTemplate.mockResolvedValue({ success: true });
    await handleUpdateContentTemplate({
      templateId: VALID_UUID, etag: '"v1"', name: 'T', templateType: 'html', channels: ['email'],
      template: { html: '<html>x</html>' }, parentFolderId: '05472be1-a554-40a7-ac03-67b31d62f61f', tagIds: ['b4d081a7-fe4b-4c24-9491-2a246902c9ab']
    });
    const payload = mockClient.updateTemplate.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('parentFolderId');
    expect(payload).toHaveProperty('tagIds', ['b4d081a7-fe4b-4c24-9491-2a246902c9ab']);
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
      templateId: VALID_UUID, etag: '"v1"', name: 'T', templateType: 'html', channels: ['email'], template: { html: '<html/>' }
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

  // P1-1: per-(channel, templateType) content-shape enforcement, pre-write.

  test('create_content_template rejects email "content" with template.html as a STRING (P1-1)', async () => {
    const result = await handleCreateContentTemplate({
      name: 'Welcome', templateType: 'content', channels: ['email'],
      template: { subject: 'Hi', html: '<html>oops a string</html>' }
    }) as { success: boolean; error: { code: string; details: Array<{ path: string; message: string }> } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
    const htmlIssue = result.error.details.find(d => d.path === 'template.html');
    expect(htmlIssue?.message).toMatch(/object \{ body: string \}/);
    expect(mockClient.createTemplate).not.toHaveBeenCalled();
  });

  test('create_content_template accepts the correct email "content" shape (P1-1)', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'c1', location: '/templates/c1', etag: '"v1"' });
    const result = await handleCreateContentTemplate({
      name: 'Welcome', templateType: 'content', channels: ['email'],
      template: { subject: 'Hi', html: { body: '<html>ok</html>' } }
    }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.createTemplate).toHaveBeenCalled();
  });

  test('create_content_template rejects sms without template.text (P1-1)', async () => {
    const result = await handleCreateContentTemplate({
      name: 'SMS', templateType: 'content', channels: ['sms'], template: { body: 'wrong field' }
    }) as { success: boolean; error: { code: string; details: Array<{ path: string; message: string }> } };
    expect(result.success).toBe(false);
    expect(result.error.details.some(d => d.path === 'template.text')).toBe(true);
  });

  test('create_content_template validates code body keys (html/expression/condition), rejects content (#2)', async () => {
    const bad = await handleCreateContentTemplate({
      name: 'Code', templateType: 'content', channels: ['code'], subType: 'HTML',
      template: { content: '<html/>' }
    }) as { success: boolean; error: { code: string; details: Array<{ path: string; message: string }> } };
    expect(bad.success).toBe(false);
    expect(bad.error.code).toBe('VALIDATION_ERROR');
    expect(bad.error.details.some(d => d.path === 'template' && /html.*expression.*condition/.test(d.message))).toBe(true);
    expect(mockClient.createTemplate).not.toHaveBeenCalled();

    mockClient.createTemplate.mockResolvedValue({ id: 'c2', location: '/templates/c2', etag: '"v1"' });
    const ok = await handleCreateContentTemplate({
      name: 'Code', templateType: 'content', channels: ['code'], subType: 'HTML',
      template: { html: '<div>x</div>' }
    }) as { success: boolean };
    expect(ok.success).toBe(true);
  });

  test('create_content_template keeps shared channel free-form', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'sh1', location: '/templates/sh1', etag: '"v1"' });
    const result = await handleCreateContentTemplate({
      name: 'Shared', templateType: 'content', channels: ['shared'],
      template: { anything: { goes: true } }
    }) as { success: boolean };
    expect(result.success).toBe(true);
  });

  // P1-3: native-format Compatibility-mode warning on email writes.

  test('create_content_template warns when email HTML is not in AJO native format (P1-3)', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'c3', location: '/templates/c3', etag: '"v1"' });
    const result = await handleCreateContentTemplate({
      name: 'Plain', templateType: 'content', channels: ['email'],
      template: { subject: 'Hi', html: { body: '<html><body>plain</body></html>' } }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.[0]).toMatch(/Compatibility mode/);
  });

  test('create_content_template does not warn for native AJO email HTML (P1-3)', async () => {
    mockClient.createTemplate.mockResolvedValue({ id: 'c4', location: '/templates/c4', etag: '"v1"' });
    const nativeHtml = '<html><head><meta name="content-version" content="1"></head>' +
      '<body><div class="acr-structure"></div></body></html>';
    const result = await handleCreateContentTemplate({
      name: 'Native', templateType: 'content', channels: ['email'],
      template: { subject: 'Hi', html: { body: nativeHtml } }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  // P0-2: content-list filter validation.

  test('list_content_templates forwards a valid property filter to the API (P0-2)', async () => {
    mockClient.listTemplates.mockResolvedValue({ _page: { count: 0 }, items: [] });
    const result = await handleListContentTemplates({ property: ['name~^Welcome'] }) as { success: boolean };
    expect(result.success).toBe(true);
    expect(mockClient.listTemplates).toHaveBeenCalledWith({ property: ['name~^Welcome'] });
  });

  test('list_content_templates rejects a filter with no FIQL operator (P0-2)', async () => {
    const result = await handleListContentTemplates({ property: ['justAName'] }) as { success: boolean; error: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(mockClient.listTemplates).not.toHaveBeenCalled();
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

  // P1: status is filtered in-process (AJO rejects it as a property field).

  test('list_content_fragments filters by status client-side and strips it from the upstream query', async () => {
    mockClient.listFragments.mockResolvedValue({
      _page: { count: 3 },
      items: [
        { id: 'a', status: 'PUBLISHED' },
        { id: 'b', status: 'DRAFT' },
        { id: 'c', status: 'PUBLISHED' }
      ]
    });
    const result = await handleListContentFragments({ property: ['status==PUBLISHED'] }) as {
      success: boolean; data: { items: Array<{ id: string }> };
    };
    expect(result.success).toBe(true);
    expect(result.data.items.map(i => i.id)).toEqual(['a', 'c']);
    // status must NOT be sent upstream (AJO 400s on it); no property at all here.
    const sentProperty = mockClient.listFragments.mock.calls[0][0]?.property;
    expect(sentProperty).toBeUndefined();
  });

  test('list_content_fragments keeps non-status predicates upstream while filtering status locally', async () => {
    mockClient.listFragments.mockResolvedValue({
      _page: {}, items: [{ id: 'a', status: 'PUBLISHED' }, { id: 'b', status: 'ARCHIVED' }]
    });
    const result = await handleListContentFragments({ property: ['type==html', 'status!=ARCHIVED'] }) as {
      success: boolean; data: { items: Array<{ id: string }> };
    };
    expect(result.data.items.map(i => i.id)).toEqual(['a']);
    expect(mockClient.listFragments.mock.calls[0][0]?.property).toEqual(['type==html']);
  });

  test('list_content_fragments pages upstream to collect status matches up to limit', async () => {
    mockClient.listFragments
      .mockResolvedValueOnce({ _page: { next: 'cur1' }, items: [{ id: 'a', status: 'PUBLISHED' }, { id: 'b', status: 'DRAFT' }] })
      .mockResolvedValueOnce({ _page: {}, items: [{ id: 'c', status: 'PUBLISHED' }] });
    const result = await handleListContentFragments({ property: ['status==PUBLISHED'] }) as {
      success: boolean; data: { items: Array<{ id: string }>; _page: { next: unknown } };
    };
    expect(result.data.items.map(i => i.id)).toEqual(['a', 'c']);
    // status-filtered results are not cursor-paginated.
    expect(result.data._page.next).toBeNull();
    expect(mockClient.listFragments).toHaveBeenCalledTimes(2);
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

  test('create_content_fragment warns when email HTML is not in AJO native format (P1-3)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-9', location: '/fragments/f-9', etag: '"v1"' });
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'], fragment: { content: '<div>plain</div>' }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.[0]).toMatch(/Compatibility mode/);
  });

  test('create_content_fragment does NOT warn when the dual-field wysiwyg-content is compliant (even if content is a lightweight snippet)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-dual', location: '/fragments/f-dual', etag: '"v1"' });
    // content = lightweight embeddable snippet (no <head>/content-version, by design);
    // editorContext["wysiwyg-content"] = full Visual Designer doc (has content-version + acr-*).
    const snippet = '<div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:b6d70a45-a149-453b-85ba-809a5d40066d"><div class="acr-tmp-component"></div></div>';
    const wysiwyg = '<!DOCTYPE html><html><head><meta name="content-version" content="3.3"></head><body class id="acr-body" data-has-html-params><div class="acr-container"><div class="acr-structure"><div class="acr-fragment acr-component"></div></div></div></body></html>';
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'],
      fragment: { content: snippet, editorContext: { 'wysiwyg-content': wysiwyg } }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    // The compliance check must target wysiwyg-content, so no Compatibility-mode warning.
    expect(result.warnings?.some(w => /Compatibility mode/.test(w))).toBeFalsy();
  });

  test('create_content_fragment rewrites the data-fragment-id="ajo:SELF" sentinel to the assigned id via a follow-up PUT', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-self', location: '/fragments/f-self', etag: '"v1"' });
    mockClient.updateFragment.mockResolvedValue({ success: true, etag: '"v2"' });
    const result = await handleCreateContentFragment({
      name: 'Hero', type: 'html', channels: ['email'],
      fragment: { content: '<div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:SELF"></div>' }
    }) as { success: boolean; warnings?: string[]; etag?: string };
    expect(result.success).toBe(true);
    // The follow-up PUT carries the rewritten self-reference.
    expect(mockClient.updateFragment).toHaveBeenCalledTimes(1);
    const selfCall = mockClient.updateFragment.mock.calls[0];
    expect(selfCall[0]).toBe('f-self');
    const payload = selfCall[1] as { fragment: { content: string } };
    expect(payload.fragment.content).toContain('data-fragment-id="ajo:f-self"');
    expect(payload.fragment.content).not.toContain('ajo:SELF');
    // Sentinel correctly handled → no self-reference mismatch warning; new etag chained through.
    expect(result.warnings?.some(w => w.includes('id does not exist'))).toBeFalsy();
    expect(result.etag).toBe('"v2"');
  });

  test('create_content_fragment warns (and does NOT auto-rewrite) when data-fragment-id is a wrong literal, not the sentinel', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-bad', location: '/fragments/f-bad', etag: '"v1"' });
    const result = await handleCreateContentFragment({
      name: 'Hero', type: 'html', channels: ['email'],
      fragment: { content: '<div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:PLACEHOLDER_HERO"></div>' }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    // Only the explicit sentinel is auto-rewritten — a wrong literal is left alone and flagged.
    expect(mockClient.updateFragment).not.toHaveBeenCalled();
    expect(result.warnings?.some(w => w.includes('data-fragment-id="ajo:PLACEHOLDER_HERO"') && w.includes('"ajo:f-bad"'))).toBe(true);
  });

  test('create_content_fragment warns when fragment.content uses acr-component instead of acr-tmp-component (Issue 5)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-c', location: '/fragments/f-c', etag: '"v1"' });
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'],
      fragment: { content: '<div class="acr-fragment acr-component" data-component-id="text"></div>' }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => w.includes('must use "acr-tmp-component"'))).toBe(true);
  });

  test('create_content_fragment warns when fragment.content is a full document, not the lightweight snippet (Issue 5)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-d', location: '/fragments/f-d', etag: '"v1"' });
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'],
      fragment: { content: '<!DOCTYPE html><html><head></head><body><div class="acr-container"></div></body></html>' }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => w.includes('FULL Visual Designer document'))).toBe(true);
  });

  test('create_content_fragment warns when editorContext["wysiwyg-content"] uses acr-tmp-component (Issue 5)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-w', location: '/fragments/f-w', etag: '"v1"' });
    const wysiwyg = '<!DOCTYPE html><html><head><meta name="content-version" content="3"></head><body data-has-html-params><div class="acr-container"><div class="acr-structure"><div class="acr-fragment acr-tmp-component"></div></div></div></body></html>';
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'],
      fragment: { content: '<div class="acr-fragment is-locked has-html-params"><div class="acr-tmp-component"></div></div>', editorContext: { 'wysiwyg-content': wysiwyg } }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => w.includes('editorContext["wysiwyg-content"] uses "acr-tmp-component"'))).toBe(true);
  });

  test('create_content_fragment warns on a prefix-less {{ fragment }} helper id (#3)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-10', location: '/fragments/f-10', etag: '"v1"' });
    const bareUuid = '301c64ce-4085-4e86-8afc-254854d3c34c';
    const result = await handleCreateContentFragment({
      name: 'Banner', type: 'html', channels: ['email'],
      fragment: { content: `<th>{{ fragment id="${bareUuid}" name="F" mode="inline" }}</th>` }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => w.includes('missing a required ajo:/aem:/external: prefix'))).toBe(true);
  });

  // create — organization (Issue 1 two-step folder placement, Issue 3 tagIds/labels)

  const FOLDER_UUID = 'b45ee96b-a86d-481f-8554-dd3762aeaa8e';
  const TAG_UUID = 'b0749baa-78c5-4a5b-a9e0-2b65ef754cb7';

  test('create_content_fragment files into a folder via a follow-up add PATCH, not the create body (Issue 1)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-fold', location: '/fragments/f-fold', etag: '"v1"' });
    mockClient.patchFragment.mockResolvedValue({ success: true, etag: '"v2"' });
    const result = await handleCreateContentFragment({
      name: 'Filed', type: 'html', channels: ['email'],
      fragment: { content: '<div>x</div>' }, parentFolderId: FOLDER_UUID
    }) as { success: boolean; etag?: string };
    expect(result.success).toBe(true);
    // parentFolderId must NOT be in the create body (the runtime rejects it there)
    expect(mockClient.createFragment).toHaveBeenCalledWith(expect.not.objectContaining({ parentFolderId: expect.anything() }));
    // folder applied via a follow-up add PATCH using the post-create etag
    expect(mockClient.patchFragment).toHaveBeenCalledWith('f-fold', [{ op: 'add', path: '/parentFolderId', value: FOLDER_UUID }], '"v1"');
    // returned etag is refreshed from the PATCH so it stays chainable
    expect(result.etag).toBe('"v2"');
  });

  test('create_content_fragment still succeeds with a warning if folder placement fails (Issue 1)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-fold2', location: '/fragments/f-fold2', etag: '"v1"' });
    mockClient.patchFragment.mockRejectedValue(new Error('folder boom'));
    const result = await handleCreateContentFragment({
      name: 'Filed', type: 'html', channels: ['email'],
      fragment: { content: '<div>x</div>' }, parentFolderId: FOLDER_UUID
    }) as { success: boolean; id: string; warnings?: string[] };
    expect(result.success).toBe(true);
    expect(result.id).toBe('f-fold2');
    expect(result.warnings?.some(w => w.includes('filing it into folder') && w.includes('patch_content_fragment'))).toBe(true);
  });

  test('create_content_fragment passes tagIds and labels through in the create body (Issue 3)', async () => {
    mockClient.createFragment.mockResolvedValue({ id: 'f-tag', location: '/fragments/f-tag', etag: '"v1"' });
    await handleCreateContentFragment({
      name: 'Tagged', type: 'html', channels: ['email'], fragment: { content: '<div>x</div>' },
      tagIds: [TAG_UUID], labels: ['C1']
    });
    expect(mockClient.createFragment).toHaveBeenCalledWith(expect.objectContaining({ tagIds: [TAG_UUID], labels: ['C1'] }));
    expect(mockClient.patchFragment).not.toHaveBeenCalled(); // tagIds need no follow-up step
  });

  test('update_content_fragment strips parentFolderId from the PUT body but keeps tagIds (Issue 1/3)', async () => {
    mockClient.updateFragment.mockResolvedValue({ success: true });
    await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', name: 'F', type: 'html', channels: ['email'],
      fragment: { content: '<div>x</div>' }, parentFolderId: FOLDER_UUID, tagIds: [TAG_UUID]
    });
    const payload = mockClient.updateFragment.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('parentFolderId');
    expect(payload).toHaveProperty('tagIds', [TAG_UUID]);
  });

  test('update_content_fragment rewrites the ajo:SELF sentinel in-place (no follow-up write)', async () => {
    mockClient.updateFragment.mockResolvedValue({ success: true, etag: '"v2"' });
    const result = await handleUpdateContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"', name: 'Hero', type: 'html', channels: ['email'],
      fragment: { content: '<div class="acr-fragment is-locked has-html-params" data-fragment-id="ajo:SELF"></div>' }
    }) as { success: boolean; warnings?: string[] };
    expect(result.success).toBe(true);
    // It's already a PUT, so the sentinel is rewritten in the same call — no extra write.
    expect(mockClient.updateFragment).toHaveBeenCalledTimes(1);
    const payload = mockClient.updateFragment.mock.calls[0][1] as { fragment: { content: string } };
    expect(payload.fragment.content).toContain(`data-fragment-id="ajo:${VALID_UUID}"`);
    expect(payload.fragment.content).not.toContain('ajo:SELF');
    expect(result.warnings?.some(w => w.includes('id does not exist'))).toBeFalsy();
  });

  test('patch_content_fragment normalizes replace→add for /parentFolderId, leaves /name as replace (Issue 2)', async () => {
    mockClient.patchFragment.mockResolvedValue({ success: true });
    await handlePatchContentFragment({
      fragmentId: VALID_UUID, etag: '"v1"',
      patches: [
        { op: 'replace', path: '/parentFolderId', value: FOLDER_UUID },
        { op: 'replace', path: '/name', value: 'N' }
      ]
    });
    expect(mockClient.patchFragment).toHaveBeenCalledWith(
      VALID_UUID,
      [
        { op: 'add', path: '/parentFolderId', value: FOLDER_UUID },
        { op: 'replace', path: '/name', value: 'N' }
      ],
      '"v1"'
    );
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
