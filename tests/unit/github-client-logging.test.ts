/**
 * Unit tests for ghRequest's log-level handling (via the exported getFileSha /
 * ensureLabelExists wrappers): a status the caller expects and handles — getFileSha's
 * 404 ("file absent → create it"), ensureLabelExists's 422 ("label already exists") —
 * is logged at debug, not warn, so handled outcomes don't look like failures. Any
 * OTHER non-2xx still logs at warn. (global fetch is stubbed; no network.)
 */

const logger = { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: () => logger };
jest.mock('../../src/telemetry/index', () => ({ logger }));

import { getFileSha, ensureLabelExists } from '../../src/github/client';

// Minimal fetch Response stub.
function ghResponse(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    headers: { get: () => 'application/json' }
  };
}

const fetchMock = jest.fn();
beforeAll(() => { (global as unknown as { fetch: jest.Mock }).fetch = fetchMock; });
beforeEach(() => { jest.clearAllMocks(); });

describe('getFileSha — 404 is expected, not a warning', () => {
  test('a 404 returns null and is logged at debug (not warn)', async () => {
    fetchMock.mockResolvedValue(ghResponse(404, { message: 'Not Found' }));
    const sha = await getFileSha('tok', 'o', 'r', 'a/b.json', 'branch');
    expect(sha).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/expected/i),
      expect.objectContaining({ status: 404 })
    );
  });

  test('an unexpected status (500) PROPAGATES — not swallowed as "file absent"', async () => {
    fetchMock.mockResolvedValue(ghResponse(500, { message: 'Server Error' }));
    // A transient 5xx must NOT be reported as null ("file doesn't exist"); that would
    // make callers commit a tombstone without preserved content, PUT without a sha, or
    // skip a delete. Only a real 404 returns null.
    await expect(getFileSha('tok', 'o', 'r', 'a/b.json')).rejects.toThrow(/GitHub API 500/);
    expect(logger.warn).toHaveBeenCalledWith(
      'GitHub API error',
      expect.objectContaining({ status: 500 })
    );
  });

  test('a 200 returns the sha and logs no error at any level', async () => {
    fetchMock.mockResolvedValue(ghResponse(200, { sha: 'deadbeef' }));
    const sha = await getFileSha('tok', 'o', 'r', 'a/b.json');
    expect(sha).toBe('deadbeef');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('ensureLabelExists — 422 is expected, not a warning', () => {
  test('a 422 (label already exists) resolves and is logged at debug (not warn)', async () => {
    fetchMock.mockResolvedValue(ghResponse(422, { message: 'Validation Failed' }));
    await expect(ensureLabelExists('tok', 'o', 'r', 'ajo-promotion-deployed')).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/expected/i),
      expect.objectContaining({ status: 422 })
    );
  });

  test('a non-422 failure still throws and warns', async () => {
    fetchMock.mockResolvedValue(ghResponse(500, { message: 'Server Error' }));
    await expect(ensureLabelExists('tok', 'o', 'r', 'x')).rejects.toThrow(/GitHub API 500/);
    expect(logger.warn).toHaveBeenCalledWith(
      'GitHub API error',
      expect.objectContaining({ status: 500 })
    );
  });
});
