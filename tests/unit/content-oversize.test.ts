/**
 * Unit tests for the RESPONSE_TOO_LARGE guard on the content get_* tools
 * (get_content_fragment / get_content_template / get_live_fragment). A full Visual
 * Designer html document can exceed the ~1 MB transport cap; the guard converts that
 * into a structured, catchable error instead of a bare transport-level truncation —
 * the same protection the XDM Schema Registry tools already had.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} }),
  getFragment: jest.fn(),
  getLiveFragment: jest.fn(),
  getTemplate: jest.fn(),
  listFragments: jest.fn(),
  listTemplates: jest.fn()
}));

import { handleGetContentFragment, handleGetLiveFragment, handleListContentFragments } from '../../src/tools/fragments';
import { handleGetContentTemplate, handleListContentTemplates } from '../../src/tools/templates';
import * as client from '../../src/adobe/client';

const mockClient = client as jest.Mocked<typeof client>;

beforeEach(() => jest.clearAllMocks());

type ErrResult = { success: boolean; error?: { code: string; message: string; details: { bytes: number } }; data?: unknown };

// ~700 KB compact → over 1 MB once serialized twice by toToolResult (compact
// structuredContent + pretty text block).
const hugeHtml = 'x'.repeat(700_000);

describe('content get_* RESPONSE_TOO_LARGE guard', () => {
  test('get_content_fragment returns a structured RESPONSE_TOO_LARGE pointing at get_live_fragment', async () => {
    mockClient.getFragment.mockResolvedValue({ data: { id: 'f1', type: 'html', fragment: { content: hugeHtml } }, etag: '"e"' } as never);
    const result = await handleGetContentFragment({ fragmentId: '11111111-1111-1111-1111-111111111111' }) as ErrResult;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.message).toMatch(/get_live_fragment/);
    expect(result.data).toBeUndefined();
    // Internal consistency: cited bytes must genuinely exceed the cited ~1 MB limit.
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
    const citedKb = Number(result.error?.message.match(/~(\d+) KB as an MCP/)?.[1]);
    expect(citedKb).toBeGreaterThan(1024);
  });

  test('get_content_fragment passes through when within the cap', async () => {
    const small = { data: { id: 'f1', type: 'html', fragment: { content: '<div>hi</div>' } }, etag: '"e"' };
    mockClient.getFragment.mockResolvedValue(small as never);
    const result = await handleGetContentFragment({ fragmentId: '11111111-1111-1111-1111-111111111111' }) as { success: boolean; data?: unknown; etag?: string };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(small.data);
    expect(result.etag).toBe('"e"');
  });

  test('get_content_template returns a structured RESPONSE_TOO_LARGE', async () => {
    mockClient.getTemplate.mockResolvedValue({ data: { id: 't1', template: { html: hugeHtml } }, etag: '"e"' } as never);
    const result = await handleGetContentTemplate({ templateId: '22222222-2222-2222-2222-222222222222' }) as ErrResult;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
  });

  test('get_content_template passes through (with embeddedFragments) when within the cap', async () => {
    mockClient.getTemplate.mockResolvedValue({ data: { id: 't1', template: { html: '<div>ok</div>' } }, etag: '"e"' } as never);
    const result = await handleGetContentTemplate({ templateId: '22222222-2222-2222-2222-222222222222' }) as { success: boolean; embeddedFragments?: unknown[] };
    expect(result.success).toBe(true);
    expect(result.embeddedFragments).toEqual([]);
  });

  test('get_live_fragment returns a structured RESPONSE_TOO_LARGE', async () => {
    mockClient.getLiveFragment.mockResolvedValue({ type: 'html', fragment: { content: hugeHtml } } as never);
    const result = await handleGetLiveFragment({ fragmentId: '33333333-3333-3333-3333-333333333333' }) as ErrResult;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
  });
});

describe('content list_* RESPONSE_TOO_LARGE guard', () => {
  test('list_content_fragments returns a structured RESPONSE_TOO_LARGE when the aggregate exceeds the cap', async () => {
    mockClient.listFragments.mockResolvedValue({
      items: [{ id: 'f1', name: 'Big', type: 'html', fragment: { content: hugeHtml } }],
      _page: { next: null }
    } as never);
    const result = await handleListContentFragments({}) as ErrResult;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
    expect(result.error?.message).toMatch(/get_content_fragment/);
  });

  test('list_content_fragments passes through when within the cap', async () => {
    mockClient.listFragments.mockResolvedValue({
      items: [{ id: 'f1', name: 'Small', type: 'html' }], _page: { next: null }
    } as never);
    const result = await handleListContentFragments({}) as { success: boolean; data?: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('list_content_templates returns a structured RESPONSE_TOO_LARGE when the aggregate exceeds the cap', async () => {
    mockClient.listTemplates.mockResolvedValue({
      items: [{ id: 't1', name: 'Big', template: { html: hugeHtml } }], _page: { next: null }
    } as never);
    const result = await handleListContentTemplates({}) as ErrResult;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
  });
});
