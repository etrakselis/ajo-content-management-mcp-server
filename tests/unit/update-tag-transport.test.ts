/**
 * Transport-boundary proof for update_tag (feedback "non-literal double-wrap" theory).
 *
 * Unlike the other wire-shape test, this does NOT mock the axios module — it uses
 * REAL axios and installs a mock ADAPTER, so the entire axios pipeline runs
 * (request transformers, any interceptors, body serialization). The adapter captures
 * the exact serialized bytes that would go on the socket. Driven through the real
 * handler → real client → real utRequest → real axios. If a hidden interceptor or
 * computed-key envelope existed anywhere in-process, it would show up here.
 */

jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getToken: jest.fn().mockResolvedValue('tok') }
}));

jest.mock('../../src/adobe/client', () => ({
  isClientConfigured: () => true,
  buildError: (e: unknown) => ({ code: 'API_ERROR', message: String(e), details: {} }),
  getConfiguredApiKey: () => 'k',
  getConfiguredImsOrg: () => 'o',
  getConfiguredSandboxName: () => 's'
}));

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })
}));

import axios from 'axios';
import { handleUpdateTag } from '../../src/tools/tags';

const TAG_ID = 'b0749baa-78c5-4a5b-a9e0-2b65ef754cb7';
let capturedBody: string | undefined;
let capturedUrl: string | undefined;

beforeAll(() => {
  // Real axios pipeline; the adapter sees config.data already run through
  // transformRequest (i.e. the literal JSON string that hits the wire).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axios.defaults.adapter = (async (config: any) => {
    capturedUrl = config.url;
    capturedBody = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    return { data: { id: 't1' }, status: 200, statusText: 'OK', headers: {}, config };
  }) as never;
});

beforeEach(() => { capturedBody = undefined; capturedUrl = undefined; });

test('the literal serialized update_tag body is a bare JSON-Patch array through the real axios pipeline', async () => {
  const res = await handleUpdateTag({ tagId: TAG_ID, archived: true }) as { success: boolean };
  expect(res.success).toBe(true);
  expect(capturedUrl).toContain('/unifiedtags/tags/');
  expect(capturedBody).toBeDefined();
  const body = JSON.parse(capturedBody as string);
  // bare array — the experience.adobe.io gateway adds the { patchRequestList: [...] }
  // envelope itself, so we must NOT send it pre-wrapped.
  expect(Array.isArray(body)).toBe(true);
  expect(body).toEqual([{ op: 'replace', path: 'archived', value: 'true' }]);
  // the process must never emit a patchRequestList wrapper itself
  expect(capturedBody).not.toContain('patchRequestList');
});
