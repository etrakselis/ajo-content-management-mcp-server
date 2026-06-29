import axios from 'axios';
import { TokenManager, acquireProbeToken, clearProbeTokenCache } from '../../src/auth/token-manager';

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

  test('primeToken seeds the cache so getToken does not call IMS', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockClear();
    tm.setCredentials({
      CLIENT_SECRET: 'real-secret',
      API_KEY: 'key',
      TECHNICAL_ACCOUNT_ID: 'tech@acct',
      IMS: 'ims-na1.adobelogin.com',
      IMS_ORG: 'org@AdobeOrg'
    });
    tm.primeToken('primed-token', 3600);
    const token = await tm.getToken();
    expect(token).toBe('primed-token');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('primeToken is a no-op before credentials are set', () => {
    tm.primeToken('orphan-token', 3600);
    expect(tm.getStatus().tokenCached).toBe(false);
  });
});

describe('acquireProbeToken (scoped probe-token cache)', () => {
  const creds = {
    CLIENT_SECRET: 'real-secret',
    API_KEY: 'key',
    TECHNICAL_ACCOUNT_ID: 'tech@acct',
    IMS: 'ims-na1.adobelogin.com',
    IMS_ORG: 'org@AdobeOrg'
  };

  beforeEach(() => {
    clearProbeTokenCache();
    (axios as jest.Mocked<typeof axios>).post.mockReset();
  });

  test('fetches once then reuses the cached token for the same credentials', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'probe-token-1', expires_in: 3600 } });

    const a = await acquireProbeToken(creds);
    const b = await acquireProbeToken(creds);

    expect(a.accessToken).toBe('probe-token-1');
    expect(b.accessToken).toBe('probe-token-1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent calls onto a single IMS request', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'probe-token-2', expires_in: 3600 } });

    const [a, b, c] = await Promise.all([
      acquireProbeToken(creds), acquireProbeToken(creds), acquireProbeToken(creds)
    ]);

    expect(a.accessToken).toBe('probe-token-2');
    expect(b.accessToken).toBe('probe-token-2');
    expect(c.accessToken).toBe('probe-token-2');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  test('different credentials are cached separately', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'tok-A', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: 'tok-B', expires_in: 3600 } });

    const a = await acquireProbeToken(creds);
    const b = await acquireProbeToken({ ...creds, CLIENT_SECRET: 'different-secret' });

    expect(a.accessToken).toBe('tok-A');
    expect(b.accessToken).toBe('tok-B');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('clearProbeTokenCache forces a fresh fetch', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'probe-token-3', expires_in: 3600 } });

    await acquireProbeToken(creds);
    clearProbeTokenCache();
    await acquireProbeToken(creds);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('returns the remaining TTL so callers can prime another cache', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'probe-token-4', expires_in: 3600 } });

    const { expiresInSeconds } = await acquireProbeToken(creds);
    expect(expiresInSeconds).toBeGreaterThan(3500);
    expect(expiresInSeconds).toBeLessThanOrEqual(3600);
  });
});
