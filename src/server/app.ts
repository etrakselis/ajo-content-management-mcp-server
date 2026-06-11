import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { tokenManager, AdobeCredentials } from '../auth/token-manager.js';
import { configureAdobeClient } from '../adobe/client.js';
import { CredentialsFileSchema } from '../validation/schemas.js';
import { createMcpServer, createHttpTransport } from '../mcp/server.js';
import { logger, metricsRegistry } from '../telemetry/index.js';
import { landingPageHtml } from '../ui/landing.js';

export function createExpressApp(): express.Application {
  const app = express();

  // ─── Security Middleware ─────────────────────────────────────────────────

  app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts in UI
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:*'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id']
  }));

  app.use(express.json({ limit: '2mb' }));

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    (req as Request & { requestId: string }).requestId = uuidv4();
    res.setHeader('X-Request-Id', (req as Request & { requestId: string }).requestId);
    next();
  });

  // Rate limiting
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests', details: {} } }
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many auth attempts', details: {} } }
  });

  app.use(globalLimiter);

  // ─── Health Endpoints ─────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get('/ready', (_req, res) => {
    const configured = tokenManager.isConfigured();
    res.status(configured ? 200 : 503).json({
      ready: configured,
      authentication: tokenManager.getStatus()
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  // ─── Landing Page ─────────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(landingPageHtml);
  });

  // ─── Configuration API ────────────────────────────────────────────────────

  app.post('/api/configure', authLimiter, (req: Request, res: Response) => {
    const { credentials, sandboxName } = req.body;

    if (!credentials || !sandboxName) {
      return res.status(400).json({
        success: false,
        error: 'credentials and sandboxName are required'
      });
    }

    if (!sandboxName.match(/^[a-zA-Z0-9_-]{1,50}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sandbox name. Use alphanumeric characters, hyphens, and underscores only.'
      });
    }

    // Validate credentials structure
    const parsed = CredentialsFileSchema.safeParse(credentials);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid credentials file format: ' + parsed.error.errors.map(e => e.message).join(', ')
      });
    }

    // Extract credential values
    const creds: Partial<AdobeCredentials> = {};
    for (const val of parsed.data.values) {
      if (!val.enabled && val.enabled !== undefined) continue;
      const key = val.key as keyof AdobeCredentials;
      if (key === 'SCOPES') {
        (creds as Record<string, unknown>)[key] = Array.isArray(val.value)
          ? val.value
          : String(val.value).split(',').map(s => s.trim());
      } else {
        (creds as Record<string, unknown>)[key] = Array.isArray(val.value)
          ? val.value.join(',')
          : String(val.value);
      }
    }

    // Validate required fields
    const required: (keyof AdobeCredentials)[] = ['API_KEY', 'IMS_ORG'];
    const missing = required.filter(k => !creds[k]);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required credential fields: ${missing.join(', ')}`
      });
    }

    // Configure token manager and Adobe client
    tokenManager.setCredentials(creds as AdobeCredentials);

    configureAdobeClient({
      sandboxName,
      imsOrg: creds.IMS_ORG!,
      apiKey: creds.API_KEY!
    });

    logger.info('Server configured', {
      sandboxName,
      imsOrg: creds.IMS_ORG,
      hasClientSecret: !!(creds.CLIENT_SECRET && creds.CLIENT_SECRET !== 'placeholder123')
    });

    return res.json({
      success: true,
      message: 'MCP server configured',
      sandboxName,
      mcpEndpoint: '/mcp'
    });
  });

  app.get('/api/status', (_req, res) => {
    res.json({
      configured: tokenManager.isConfigured(),
      auth: tokenManager.getStatus()
    });
  });

  // ─── MCP HTTP Endpoint ────────────────────────────────────────────────────

  const mcpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 500
  });

  const mcpServer = createMcpServer();
  const activeTransports: Map<string, ReturnType<typeof createHttpTransport>> = new Map();

  app.all('/mcp', mcpLimiter, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: ReturnType<typeof createHttpTransport>;

      if (sessionId && activeTransports.has(sessionId)) {
        transport = activeTransports.get(sessionId)!;
      } else {
        transport = createHttpTransport();
        const sid = (transport as unknown as { sessionId?: string }).sessionId;
        if (sid) activeTransports.set(sid, transport);

        await mcpServer.connect(transport);

        transport.onclose = () => {
          const tsid = (transport as unknown as { sessionId?: string }).sessionId;
          if (tsid) activeTransports.delete(tsid);
        };
      }

      await transport.handleRequest(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('MCP transport error', { error: msg });
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP transport error' });
      }
    }
  });

  // ─── Error Handler ────────────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled server error', { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal server error', details: {} }
    });
  });

  return app;
}
