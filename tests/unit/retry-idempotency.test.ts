/**
 * Regression test for the axios-retry condition (src/adobe/client.ts).
 *
 * The condition must be idempotency-aware: a 5xx means the request DID reach AJO and
 * may have already committed, so replaying a non-idempotent write (POST create, PATCH)
 * can duplicate a fragment/template, double-publish, or apply a JSON-Patch op twice.
 * A prior `|| status >= 500` clause retried ALL methods on 5xx — this locks in that
 * only idempotent methods (and genuine network drops) are retried.
 *
 * axios-retry's default export is spied so we can capture the retryCondition
 * configureAdobeClient passes to it, while its real predicate helpers are preserved.
 */

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
  adobeApiErrorCounter: { inc: jest.fn() },
  authRefreshCounter: { inc: jest.fn() }
}));
jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: { getToken: jest.fn().mockResolvedValue('tok') }
}));

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } })),
      post: jest.fn(),
      isAxiosError: actual.isAxiosError,
      AxiosError: actual.AxiosError
    },
    isAxiosError: actual.isAxiosError,
    AxiosError: actual.AxiosError
  };
});

// Keep axios-retry's real predicate helpers, but make the default export a spy so the
// retryCondition passed to it can be captured and exercised directly.
jest.mock('axios-retry', () => {
  const real = jest.requireActual('axios-retry');
  const fn = Object.assign(jest.fn(), {
    isNetworkOrIdempotentRequestError: real.isNetworkOrIdempotentRequestError,
    exponentialDelay: real.exponentialDelay
  });
  return { __esModule: true, default: fn };
});

import axiosRetry from 'axios-retry';
import { configureAdobeClient } from '../../src/adobe/client';

const realAxios = jest.requireActual('axios');

// Build a synthetic AxiosError. A status implies a response (HTTP error); no status +
// a network code implies a transport-level failure with no response.
function makeError(method: string, status?: number, code?: string) {
  return new realAxios.AxiosError(
    'boom',
    code ?? (status ? 'ERR_BAD_RESPONSE' : 'ECONNRESET'),
    { method } as never,
    undefined,
    status ? ({ status, data: {}, statusText: '', headers: {}, config: { method } } as never) : undefined
  );
}

let retryCondition: (e: unknown) => boolean;

beforeAll(() => {
  configureAdobeClient({ sandboxName: 's', imsOrg: 'o', apiKey: 'k' });
  const opts = (axiosRetry as unknown as jest.Mock).mock.calls[0][1] as { retryCondition: (e: unknown) => boolean };
  retryCondition = opts.retryCondition;
});

describe('adobe client retry condition — idempotency-aware', () => {
  test('does NOT retry POST/PATCH on 5xx (avoids duplicate create / double-publish / replayed patch)', () => {
    expect(retryCondition(makeError('post', 503))).toBe(false);
    expect(retryCondition(makeError('post', 500))).toBe(false);
    expect(retryCondition(makeError('patch', 502))).toBe(false);
  });

  test('DOES retry idempotent methods (GET/PUT/DELETE/HEAD) on 5xx', () => {
    expect(retryCondition(makeError('get', 503))).toBe(true);
    expect(retryCondition(makeError('put', 500))).toBe(true);
    expect(retryCondition(makeError('delete', 502))).toBe(true);
    expect(retryCondition(makeError('head', 504))).toBe(true);
  });

  test('never retries 4xx', () => {
    expect(retryCondition(makeError('get', 404))).toBe(false);
    expect(retryCondition(makeError('post', 400))).toBe(false);
  });

  test('429 follows the same idempotency rule', () => {
    expect(retryCondition(makeError('post', 429))).toBe(false);
    expect(retryCondition(makeError('get', 429))).toBe(true);
  });

  test('retries genuine network drops (any method) but never a client-side timeout', () => {
    expect(retryCondition(makeError('post', undefined, 'ECONNRESET'))).toBe(true);
    expect(retryCondition(makeError('get', undefined, 'ECONNABORTED'))).toBe(false);
    expect(retryCondition(makeError('get', undefined, 'ETIMEDOUT'))).toBe(false);
  });
});
