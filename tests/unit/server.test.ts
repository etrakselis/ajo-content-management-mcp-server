import request from 'supertest';
import { createExpressApp } from '../../src/server/app';

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
    getToken: jest.fn().mockResolvedValue('mock-token')
  }
}));

jest.mock('../../src/adobe/client', () => ({
  configureAdobeClient: jest.fn(),
  isClientConfigured: jest.fn().mockReturnValue(false)
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
  });
});
