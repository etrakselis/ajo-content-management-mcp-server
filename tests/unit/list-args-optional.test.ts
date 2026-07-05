/**
 * Regression test: list_content_fragments / list_content_templates must accept an
 * OMITTED arguments object. The MCP `arguments` field is optional, so a no-filter
 * "list everything" call arrives as undefined on clients that omit it. Their Zod
 * schema (PaginationSchema, a z.object) rejects undefined, so the handlers must guard
 * with `args ?? {}` — otherwise the most basic list call returns a spurious
 * VALIDATION_ERROR. The sibling list handlers (list_tags, list_xdm_*) already do this.
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
  listFragments: jest.fn(),
  listTemplates: jest.fn()
}));

import { handleListContentFragments } from '../../src/tools/fragments';
import { handleListContentTemplates } from '../../src/tools/templates';
import * as client from '../../src/adobe/client';
import { ListFragmentsSchema, ListTemplatesSchema } from '../../src/validation/schemas';

const mockClient = client as jest.Mocked<typeof client>;

beforeEach(() => jest.clearAllMocks());

type ListResult = { success: boolean; error?: { code: string } };

describe('list handlers accept an omitted arguments object', () => {
  test('list_content_fragments(undefined) lists instead of returning VALIDATION_ERROR', async () => {
    mockClient.listFragments.mockResolvedValue({ items: [], _page: { next: null } } as never);
    const result = await handleListContentFragments(undefined) as ListResult;
    expect(result.error?.code).not.toBe('VALIDATION_ERROR');
    expect(result.success).toBe(true);
    expect(mockClient.listFragments).toHaveBeenCalledTimes(1);
  });

  test('list_content_templates(undefined) lists instead of returning VALIDATION_ERROR', async () => {
    mockClient.listTemplates.mockResolvedValue({ items: [], _page: { next: null } } as never);
    const result = await handleListContentTemplates(undefined) as ListResult;
    expect(result.error?.code).not.toBe('VALIDATION_ERROR');
    expect(result.success).toBe(true);
    expect(mockClient.listTemplates).toHaveBeenCalledTimes(1);
  });

  // Documents WHY the handler guard is required: the raw schema still rejects undefined.
  test('the underlying schemas reject undefined but accept {} (rationale for the `?? {}` guard)', () => {
    expect(ListFragmentsSchema.safeParse(undefined).success).toBe(false);
    expect(ListTemplatesSchema.safeParse(undefined).success).toBe(false);
    expect(ListFragmentsSchema.safeParse({}).success).toBe(true);
    expect(ListTemplatesSchema.safeParse({}).success).toBe(true);
  });
});
