import { TokenManager } from '../../src/auth/token-manager';

jest.mock('axios');
jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  metricsRegistry: { contentType: 'text/plain', metrics: jest.fn().mockResolvedValue('') }
}));

describe('TokenManager', () => {
  let tm: TokenManager;

  beforeEach(() => {
    tm = new TokenManager();
  });

  test('isConfigured returns false initially', () => {
    expect(tm.isConfigured()).toBe(false);
  });

  test('setCredentials marks as configured', () => {
    tm.setCredentials({
      CLIENT_SECRET: 'secret',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg'
    });
    expect(tm.isConfigured()).toBe(true);
  });

  test('getStatus returns correct shape', () => {
    const status = tm.getStatus();
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('tokenCached');
  });

  test('pre-supplied ACCESS_TOKEN is cached immediately', () => {
    tm.setCredentials({
      CLIENT_SECRET: '',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg',
      ACCESS_TOKEN: 'pre-supplied-token'
    });
    const status = tm.getStatus();
    expect(status.tokenCached).toBe(true);
  });

  test('getToken throws when not configured', async () => {
    await expect(tm.getToken()).rejects.toThrow('TokenManager not configured');
  });

  test('clearCache removes token', () => {
    tm.setCredentials({
      CLIENT_SECRET: '',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg',
      ACCESS_TOKEN: 'token'
    });
    expect(tm.getStatus().tokenCached).toBe(true);
    tm.clearCache();
    expect(tm.getStatus().tokenCached).toBe(false);
  });
});
