/**
 * Unit tests for the XDM Schema Registry tools — specifically the RESPONSE_TOO_LARGE
 * guard (#4) that converts an oversized resolved schema into a structured, catchable
 * error instead of a bare transport-level truncation.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  buildError: (err: unknown) => ({ code: 'API_ERROR', message: String(err), details: {} })
}));

jest.mock('../../src/adobe/schema-registry-client', () => ({
  listSchemas: jest.fn(), getSchema: jest.fn(),
  listFieldGroups: jest.fn(), getFieldGroup: jest.fn(),
  listUnionSchemas: jest.fn(), getUnionSchema: jest.fn()
}));

import { handleGetXdmUnionSchema, handleGetXdmSchema, handleGetXdmFieldGroup } from '../../src/tools/schema-registry';
import * as sr from '../../src/adobe/schema-registry-client';

const mockSr = sr as jest.Mocked<typeof sr>;

beforeEach(() => jest.clearAllMocks());

describe('RESPONSE_TOO_LARGE guard (#4)', () => {
  // Serialized twice (compact + pretty) per toToolResult, so ~700 KB compact pushes
  // the transmitted result well over the 1 MB cap.
  const huge = { blob: 'x'.repeat(700_000) };
  const small = { meta: 'ok' };

  test('get_xdm_union_schema returns a structured RESPONSE_TOO_LARGE with recovery guidance', async () => {
    mockSr.getUnionSchema.mockResolvedValue(huge);
    const result = await handleGetXdmUnionSchema({ unionId: 'u1', full: true }) as {
      success: boolean; error?: { code: string; message: string; details: { bytes: number } }; data?: unknown;
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.message).toMatch(/full=false/);
    expect(result.data).toBeUndefined();
    // Internal consistency: the size cited (message + details.bytes) must genuinely
    // exceed the cited ~1 MB limit — no "367 KB exceeds 1 MB" contradiction.
    expect(result.error?.details.bytes).toBeGreaterThan(1_000_000);
    const citedKb = Number(result.error?.message.match(/~(\d+) KB as an MCP/)?.[1]);
    expect(citedKb).toBeGreaterThan(1024);
  });

  test('get_xdm_schema passes through when the payload is within the cap', async () => {
    mockSr.getSchema.mockResolvedValue(small);
    const result = await handleGetXdmSchema({ schemaId: 's1' }) as { success: boolean; data?: unknown };
    expect(result.success).toBe(true);
    expect(result.data).toEqual(small);
  });

  test('catches a payload under the old 450KB compact threshold that doubles past 1MB (boundary fix for #4)', async () => {
    // Deeply-indentable shape: small compact size, large pretty-printed size.
    const data = { properties: Array.from({ length: 12000 }, () => ({ a: [1, 2, 3, 4, 5] })) };
    const compact = Buffer.byteLength(JSON.stringify({ success: true, data }), 'utf8');
    // The previous fixed-compact threshold (450 KB) would have let this through...
    expect(compact).toBeLessThan(450_000);
    // ...but the transmitted result (compact structuredContent + pretty text block) is over 1 MB.
    mockSr.getUnionSchema.mockResolvedValue(data);
    const result = await handleGetXdmUnionSchema({ unionId: 'u1', full: true }) as { success: boolean; error?: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
  });

  test('get_xdm_field_group oversize guidance points to full=false', async () => {
    mockSr.getFieldGroup.mockResolvedValue(huge);
    const result = await handleGetXdmFieldGroup({ fieldGroupId: 'fg1' }) as {
      success: boolean; error?: { code: string; message: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESPONSE_TOO_LARGE');
    expect(result.error?.message).toMatch(/full=false/);
  });
});
