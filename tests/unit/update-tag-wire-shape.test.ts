/**
 * Wire-shape regression guard for update_tag (feedback Issue 6).
 *
 * This bug regressed twice in the same spot — first the patch op was sent as a
 * bare/over-broad body, then it was double-wrapped as
 * { patchRequestList: { patchRequestList: [op] } }. This test exercises the REAL
 * handler → REAL client → captured axios payload (only axios + config are mocked)
 * and asserts the exact wire body the backend (com.adobe.tagmanagementservicev2)
 * requires: a single top-level `patchRequestList` whose value is a FLAT array of
 * { op, path, value } ops — never a nested patchRequestList.
 */

const request = jest.fn().mockResolvedValue({ data: { id: 't1' } });
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: (...a: unknown[]) => request(...a) },
  request: (...a: unknown[]) => request(...a)
}));

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

import { handleUpdateTag } from '../../src/tools/tags';

const TAG_ID = 'b0749baa-78c5-4a5b-a9e0-2b65ef754cb7';
const sentBody = () => (request.mock.calls[request.mock.calls.length - 1][0] as { data: unknown }).data;

beforeEach(() => { request.mockClear(); request.mockResolvedValue({ data: { id: 't1' } }); });

test('archive-only update sends a bare JSON-Patch array (gateway adds the envelope) — never pre-wrapped', async () => {
  const res = await handleUpdateTag({ tagId: TAG_ID, archived: true }) as { success: boolean };
  expect(res.success).toBe(true);
  const data = sentBody();
  // bare array on the wire — NOT { patchRequestList: [...] } (the gateway wraps it)
  expect(Array.isArray(data)).toBe(true);
  expect(data).toEqual([{ op: 'replace', path: 'archived', value: 'true' }]);
  // belt-and-suspenders: we never emit any patchRequestList envelope ourselves
  expect(data).not.toHaveProperty('patchRequestList');
});

test('multi-field update sends a flat array of ops (one PATCH)', async () => {
  await handleUpdateTag({ tagId: TAG_ID, name: 'new-name', archived: false });
  expect(request).toHaveBeenCalledTimes(1);
  expect(sentBody()).toEqual([
    { op: 'replace', path: 'name', value: 'new-name' },
    { op: 'replace', path: 'archived', value: 'false' }
  ]);
});
