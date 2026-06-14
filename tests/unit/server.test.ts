import request from 'supertest';
import { createExpressApp } from '../../src/server/app';
import { tokenManager } from '../../src/auth/token-manager';
import axios from 'axios';
import { listTemplates } from '../../src/adobe/client';

// Bypass rate limiting so repeated calls to auth endpoints don't get 429 in tests.
jest.mock('express-rate-limit', () => () => (_req: unknown, _res: unknown, next: () => void) => next());

// Prevent real HTTP calls from detectTenantNamespace — it's non-fatal so
// test paths that reach it still succeed when these reject.
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    get: jest.fn().mockRejectedValue(new Error('network unavailable in tests')),
    post: jest.fn(),
  };
});

// Mock dependencies
jest.mock('../../src/mcp/server', () => ({
  createMcpServer: () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    setRequestHandler: jest.fn()
  }),
  createHttpTransport: () => ({
    handleRequest: jest.fn().mockImplementation((_req, res) => {
      res.json({ ok: true });
    }),
    onclose: null,
    sessionId: 'test-session-id'
  })
}));

jest.mock('../../src/telemetry/index', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => ({ info: jest.fn(), error: jest.fn() }) },
  metricsRegistry: { contentType: 'text/plain', metrics: jest.fn().mockResolvedValue('# metrics\n') },
  authRefreshCounter: { inc: jest.fn() },
  toolCallCounter: { inc: jest.fn() },
  toolCallDuration: { startTimer: jest.fn(() => jest.fn()) },
  adobeApiErrorCounter: { inc: jest.fn() },
  createRequestLogger: () => ({ info: jest.fn(), error: jest.fn() })
}));

jest.mock('../../src/auth/token-manager', () => ({
  tokenManager: {
    isConfigured: jest.fn().mockReturnValue(false),
    setCredentials: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ configured: false, tokenCached: false }),
    getToken: jest.fn().mockResolvedValue('mock-token'),
    reset: jest.fn()
  }
}));

jest.mock('../../src/adobe/client', () => ({
  configureAdobeClient: jest.fn(),
  resetAdobeClient: jest.fn(),
  isClientConfigured: jest.fn().mockReturnValue(false),
  listTemplates: jest.fn().mockResolvedValue({ items: [] })
}));

const app = createExpressApp();

describe('Express App', () => {

  describe('GET /health', () => {
    test('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /ready', () => {
    test('returns 503 when not configured', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
    });
  });

  describe('GET /metrics', () => {
    test('returns prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });
  });

  describe('GET /', () => {
    test('serves landing page HTML', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('AJO Content MCP Server');
    });
  });

  describe('POST /api/configure', () => {
    test('returns 400 when body is missing', async () => {
      const res = await request(app).post('/api/configure').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 with invalid sandbox name', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: { values: [] },
        sandboxName: 'invalid sandbox name!'
      });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 with invalid credentials format', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: { bad: 'format' },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when required credential fields are missing', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: { values: [{ key: 'CLIENT_SECRET', value: 'secret', enabled: true }], name: 'Test' },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/API_KEY|IMS_ORG/);
    });

    test('returns success when credentials and sandbox are valid', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'my-api-key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test Credentials'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mcpEndpoint).toBe('/mcp');
    });
  });

  describe('GET /api/status', () => {
    test('returns configured status', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured');
      expect(res.body).toHaveProperty('auth');
    });
  });

  describe('GET /api/connected-clients', () => {
    test('returns clients array', async () => {
      const res = await request(app).get('/api/connected-clients');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('clients');
      expect(Array.isArray(res.body.clients)).toBe(true);
    });
  });

  describe('POST /api/detect-tenant', () => {
    test('returns 400 when body is missing', async () => {
      const res = await request(app).post('/api/detect-tenant').send({});
      expect(res.status).toBe(400);
    });

    test('returns tenant detection result with valid credentials', async () => {
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'my-api-key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // tenantId is omitted from JSON when undefined (axios.get is mocked to reject)
      expect(res.body.tenantId).toBeUndefined();
    });

    test('returns 401 when token acquisition fails', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValueOnce(new Error('invalid_client'));
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'bad-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('invalid_client');
    });

    test('returns tenantId when schema registry /stats succeeds', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({ data: { tenantId: 'mycompany' } });
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe('mycompany');
      expect(res.body.tenantNamespace).toBe('_mycompany');
    });

    test('falls back to /tenant/schemas when /stats fails', async () => {
      (axios.get as jest.Mock)
        .mockRejectedValueOnce(new Error('stats 403'))
        .mockResolvedValueOnce({ data: { results: [{ 'meta:altId': '_mycompany.schemas.abc' }] } });
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe('mycompany');
    });

    test('falls back to $id parsing when meta:altId is absent', async () => {
      (axios.get as jest.Mock)
        .mockRejectedValueOnce(new Error('stats failed'))
        .mockResolvedValueOnce({ data: { results: [{ '$id': 'https://ns.adobe.com/acmecorp/schemas/abc123' }] } });
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe('acmecorp');
    });

    test('handles non-array schema registry response gracefully', async () => {
      (axios.get as jest.Mock)
        .mockRejectedValueOnce(new Error('stats failed'))
        .mockResolvedValueOnce({ data: {} });
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBeUndefined();
    });

    test('handles empty schema results gracefully', async () => {
      (axios.get as jest.Mock)
        .mockRejectedValueOnce(new Error('stats failed'))
        .mockResolvedValueOnce({ data: { results: [] } });
      const res = await request(app).post('/api/detect-tenant').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBeUndefined();
    });
  });

  describe('POST /api/configure - error paths', () => {
    const VALID_CREDS = {
      credentials: {
        values: [
          { key: 'API_KEY', value: 'my-api-key', enabled: true },
          { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
          { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
        ],
        name: 'Test'
      },
      sandboxName: 'my-sandbox'
    };

    test('returns 401 when token acquisition fails', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValueOnce(new Error('invalid creds'));
      const res = await request(app).post('/api/configure').send(VALID_CREDS);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('invalid creds');
    });

    test('returns 400 when sandbox validation fails with 403', async () => {
      const err403 = Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403, data: {} } });
      (listTemplates as jest.Mock).mockRejectedValueOnce(err403);
      const res = await request(app).post('/api/configure').send(VALID_CREDS);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found');
    });

    test('returns 401 when sandbox validation fails with 401', async () => {
      const err401 = Object.assign(new Error('Unauthorized'), { isAxiosError: true, response: { status: 401, data: {} } });
      (listTemplates as jest.Mock).mockRejectedValueOnce(err401);
      const res = await request(app).post('/api/configure').send(VALID_CREDS);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('401');
    });

    test('returns 400 for other axios sandbox errors', async () => {
      const err500 = Object.assign(new Error('Server Error'), { isAxiosError: true, response: { status: 500, data: { title: 'Internal Error' } } });
      (listTemplates as jest.Mock).mockRejectedValueOnce(err500);
      const res = await request(app).post('/api/configure').send(VALID_CREDS);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('500');
    });

    test('returns 400 for non-axios sandbox errors', async () => {
      (listTemplates as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));
      const res = await request(app).post('/api/configure').send(VALID_CREDS);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('connection refused');
    });

    test('skips credentials with enabled:false', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: {
          values: [
            { key: 'IGNORED_KEY', value: 'secret', enabled: false },
            { key: 'API_KEY', value: 'my-api-key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('handles SCOPES as a comma-separated string', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'my-api-key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true },
            { key: 'SCOPES', value: 'openid,AdobeID', enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('handles SCOPES as an array', async () => {
      const res = await request(app).post('/api/configure').send({
        credentials: {
          values: [
            { key: 'API_KEY', value: 'my-api-key', enabled: true },
            { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
            { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true },
            { key: 'SCOPES', value: ['openid', 'AdobeID'], enabled: true }
          ],
          name: 'Test'
        },
        sandboxName: 'my-sandbox'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/list-sandboxes', () => {
    const CREDS = {
      credentials: {
        values: [
          { key: 'API_KEY', value: 'my-api-key', enabled: true },
          { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
          { key: 'ACCESS_TOKEN', value: 'pre-supplied-token', enabled: true }
        ],
        name: 'Test'
      }
    };

    test('returns 400 when credentials are missing', async () => {
      const res = await request(app).post('/api/list-sandboxes').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns the discovered sandboxes on success', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          sandboxes: [
            { name: 'prod', title: 'Production', type: 'production', isDefault: true },
            { name: 'dev', title: 'Development', type: 'development' },
            { name: 'no-name-object' }, // valid (string name)
            { title: 'invalid — no name' } // dropped (no string name)
          ]
        }
      });
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sandboxes).toHaveLength(3);
      expect(res.body.sandboxes[0]).toEqual({ name: 'prod', title: 'Production', type: 'production', isDefault: true });
    });

    test('includes the tenant namespace when detection succeeds', async () => {
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { sandboxes: [{ name: 'prod', isDefault: true }] } }) // fetchSandboxes
        .mockResolvedValueOnce({ data: { tenantId: 'acme' } }); // detectTenantNamespace /stats
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe('acme');
      expect(res.body.tenantNamespace).toBe('_acme');
    });

    test('returns success with an empty list when no sandboxes are accessible', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({ data: { sandboxes: [] } });
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sandboxes).toEqual([]);
    });

    test('returns 401 with AUTH_FAILED when token acquisition fails', async () => {
      (tokenManager.getToken as jest.Mock).mockRejectedValueOnce(new Error('invalid_client'));
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_FAILED');
    });

    test('returns 403 with FORBIDDEN when the API rejects with 403', async () => {
      const err403 = Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403, data: {} } });
      (axios.get as jest.Mock).mockRejectedValueOnce(err403);
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    test('returns 502 with UPSTREAM_ERROR on other failures', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('network down'));
      const res = await request(app).post('/api/list-sandboxes').send(CREDS);
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('UPSTREAM_ERROR');
    });
  });

  describe('POST /mcp', () => {
    test('handles an initialize message and routes through transport', async () => {
      const res = await request(app).post('/mcp').send({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'TestMcpClient', version: '2.0.0' },
          capabilities: {}
        }
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('handles non-initialize messages', async () => {
      const res = await request(app).post('/mcp').send({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2,
        params: {}
      });
      expect(res.status).toBe(200);
    });

    test('handles a batch array of messages', async () => {
      const res = await request(app).post('/mcp').send([
        { jsonrpc: '2.0', method: 'tools/list', id: 1, params: {} }
      ]);
      expect(res.status).toBe(200);
    });

    test('handles initialize with missing clientInfo gracefully', async () => {
      const res = await request(app).post('/mcp').send({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 3,
        params: { capabilities: {} }
      });
      expect(res.status).toBe(200);
    });

    test('GET /mcp tracks SSE stream when lastHttpInit is set from prior initialize', async () => {
      // lastHttpInit was set by 'handles an initialize message' test above (same app instance)
      const res = await request(app).get('/mcp');
      expect(res.status).toBe(200);
    });
  });
});
