import axios from 'axios';
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

  test('getToken returns cached ACCESS_TOKEN without calling IMS', async () => {
    tm.setCredentials({
      CLIENT_SECRET: '',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg',
      ACCESS_TOKEN: 'pre-supplied-token'
    });
    const token = await tm.getToken();
    expect(token).toBe('pre-supplied-token');
    expect((axios as jest.Mocked<typeof axios>).post).not.toHaveBeenCalled();
  });

  test('getToken fetches a new token via OAuth client_credentials', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'oauth-token-abc', expires_in: 3600 }
    });

    tm.setCredentials({
      CLIENT_SECRET: 'real-secret',
      API_KEY: 'my-api-key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg'
    });

    const token = await tm.getToken();
    expect(token).toBe('oauth-token-abc');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://ims-na1.adobelogin.com/ims/token/v3',
      expect.stringContaining('grant_type=client_credentials'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    );
    expect(tm.getStatus().tokenCached).toBe(true);
  });

  test('getToken uses default IMS host when IMS field is empty', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'token-default-host', expires_in: 3600 }
    });

    tm.setCredentials({
      CLIENT_SECRET: 'real-secret',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: '',
      IMS_ORG: 'org@AdobeOrg'
    });

    await tm.getToken();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://ims-na1.adobelogin.com/ims/token/v3',
      expect.any(String),
      expect.any(Object)
    );
  });

  test('getToken wraps OAuth failure as AuthenticationError', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockRejectedValueOnce(new Error('connection refused'));

    tm.setCredentials({
      CLIENT_SECRET: 'real-secret',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg'
    });

    await expect(tm.getToken()).rejects.toThrow('Authentication failed');
  });

  test('getToken throws when placeholder secret and no cached token', async () => {
    tm.setCredentials({
      CLIENT_SECRET: 'placeholder123',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg'
    });
    await expect(tm.getToken()).rejects.toThrow('No client secret configured');
  });

  test('reset clears credentials, cache, and allows reconfiguration', () => {
    tm.setCredentials({
      CLIENT_SECRET: '',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg',
      ACCESS_TOKEN: 'token'
    });
    expect(tm.isConfigured()).toBe(true);
    expect(tm.getStatus().tokenCached).toBe(true);

    tm.reset();

    expect(tm.isConfigured()).toBe(false);
    expect(tm.getStatus().tokenCached).toBe(false);
    expect(tm.getStatus().expiresAt).toBeUndefined();
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
