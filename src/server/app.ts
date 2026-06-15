import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { tokenManager, AdobeCredentials } from '../auth/token-manager.js';
import axios from 'axios';
import { configureAdobeClient, resetAdobeClient, listTemplates } from '../adobe/client.js';

import { CredentialsFileSchema } from '../validation/schemas.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server.js';
import { getConnectedClients, addSession, touchSession, openSessionStream, closeSessionStream, removeSession } from '../mcp/connected-clients.js';
import { getWritesAllowed, setWritesAllowed, onWriteAccessChanged } from '../mcp/access-policy.js';
import { logger, metricsRegistry } from '../telemetry/index.js';
import { landingPageHtml } from '../ui/landing.js';

// ─── Shared configuration helpers ──────────────────────────────────────────

type ExtractedCredentials =
  | { ok: true; creds: AdobeCredentials }
  | { ok: false; status: number; error: string };

type ParsedConfigRequest =
  | { ok: true; creds: AdobeCredentials; sandboxName: string; orgName?: string }
  | { ok: false; status: number; error: string };

/**
 * Validate an uploaded credentials file and map its `values` array into a
 * normalized AdobeCredentials object. Shared by every endpoint that needs to
 * act on uploaded credentials so they all apply identical validation rules.
 */
function extractCredentials(credentials: unknown): ExtractedCredentials {
  if (!credentials) {
    return { ok: false, status: 400, error: 'credentials are required' };
  }

  const parsed = CredentialsFileSchema.safeParse(credentials);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid credentials file format: ' + parsed.error.errors.map(e => e.message).join(', ')
    };
  }

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

  const required: (keyof AdobeCredentials)[] = ['API_KEY', 'IMS_ORG'];
  const missing = required.filter(k => !creds[k]);
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `Missing required credential fields: ${missing.join(', ')}` };
  }

  return { ok: true, creds: creds as AdobeCredentials };
}

/**
 * Validate an /api/configure or /api/detect-tenant request body and extract a
 * normalized set of Adobe credentials plus the target sandbox. Shared so both
 * endpoints apply identical validation rules.
 */
function parseConfigRequest(body: Record<string, unknown>): ParsedConfigRequest {
  const { credentials, sandboxName, orgName } = body as {
    credentials?: unknown;
    sandboxName?: string;
    orgName?: unknown;
  };

  if (!sandboxName) {
    return { ok: false, status: 400, error: 'credentials and sandboxName are required' };
  }

  if (!sandboxName.match(/^[a-zA-Z0-9_-]{1,50}$/)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid sandbox name. Use alphanumeric characters, hyphens, and underscores only.'
    };
  }

  const extracted = extractCredentials(credentials);
  if (!extracted.ok) return extracted;

  return {
    ok: true,
    creds: extracted.creds,
    sandboxName,
    orgName: typeof orgName === 'string' && orgName.trim() ? orgName.trim() : undefined
  };
}

// Self-declared author email. We require a syntactically valid address but make
// no attempt to verify ownership — it's an honor-system attribution field.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAuthorEmail(value: unknown): { ok: true; email: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Your email is required so content changes can be attributed to you.' };
  }
  const email = value.trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  return { ok: true, email };
}

interface SandboxSummary {
  name: string;
  title?: string;
  type?: string;
  isDefault?: boolean;
}

/**
 * List the AEP sandboxes the authenticated credentials can access via the
 * Sandbox Management API. The returned list reflects the effective permissions
 * of the service account at runtime — it is the authoritative source of
 * accessible sandboxes, never inferred from the IMS org or API key alone.
 */
async function fetchSandboxes(
  accessToken: string,
  apiKey: string,
  imsOrg: string
): Promise<SandboxSummary[]> {
  const resp = await axios.get(
    'https://platform.adobe.io/data/foundation/sandbox-management/',
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': apiKey,
        'x-gw-ims-org-id': imsOrg,
        'Accept': 'application/json'
      },
      timeout: 8000
    }
  );

  const list = resp.data?.sandboxes;
  if (!Array.isArray(list)) return [];
  return list
    .filter((sb): sb is Record<string, unknown> => !!sb && typeof sb === 'object' && typeof sb.name === 'string')
    .map(sb => ({
      name: String(sb.name),
      title: typeof sb.title === 'string' && sb.title.trim() ? sb.title : undefined,
      type: typeof sb.type === 'string' ? sb.type : undefined,
      isDefault: sb.isDefault === true
    }));
}

/**
 * Attempt to auto-detect the AEP tenant namespace via the Schema Registry.
 * Non-fatal: returns undefined if detection isn't possible. Logs the HTTP
 * status/body of each attempt to make 403s (missing permission) distinguishable
 * from an empty sandbox.
 */
async function detectTenantNamespace(
  accessToken: string,
  apiKey: string,
  imsOrg: string,
  sandboxName: string
): Promise<string | undefined> {
  const schemaRegistryHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'x-api-key': apiKey,
    'x-gw-ims-org-id': imsOrg,
    'x-sandbox-name': sandboxName,
    'Accept': 'application/json'
  };

  let detectedTenantId: string | undefined;

  // Primary: /stats endpoint (requires Schema Registry permission)
  try {
    const statsResp = await axios.get(
      'https://platform.adobe.io/data/foundation/schemaregistry/stats',
      { headers: schemaRegistryHeaders, timeout: 8000 }
    );
    if (statsResp.data?.tenantId) {
      detectedTenantId = String(statsResp.data.tenantId);
      logger.info('Auto-detected tenant namespace via /stats', { tenantId: detectedTenantId });
    }
  } catch (statsErr) {
    const statsStatus = axios.isAxiosError(statsErr) ? statsErr.response?.status : null;
    const statsBody = axios.isAxiosError(statsErr) ? statsErr.response?.data : null;
    logger.warn('Schema Registry /stats failed', { status: statsStatus, body: statsBody });

    // Fallback: parse tenant from first custom schema's $id or meta:altId
    try {
      const schemasResp = await axios.get(
        'https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas',
        {
          headers: { ...schemaRegistryHeaders, 'Accept': 'application/vnd.adobe.xed-id+json' },
          params: { limit: 1 },
          timeout: 8000
        }
      );
      const results = schemasResp.data?.results ?? schemasResp.data;
      const first = Array.isArray(results) ? results[0] : null;
      if (first) {
        // meta:altId: "_acme.schemas.xxx" → "acme"
        const altId: string = first['meta:altId'] ?? '';
        const altMatch = altId.match(/^_([^.]+)\./);
        if (altMatch) {
          detectedTenantId = altMatch[1];
        } else {
          // $id: "https://ns.adobe.com/acme/schemas/xxx" → "acme"
          const id: string = first['$id'] ?? '';
          const idMatch = id.match(/ns\.adobe\.com\/([^/]+)\/schemas\//);
          if (idMatch) detectedTenantId = idMatch[1];
        }
        if (detectedTenantId) {
          logger.info('Auto-detected tenant namespace via /tenant/schemas', { tenantId: detectedTenantId });
        } else {
          logger.warn('Schema Registry /tenant/schemas returned data but could not extract tenantId', { first });
        }
      } else {
        logger.warn('Schema Registry /tenant/schemas returned no schemas', { data: schemasResp.data });
      }
    } catch (fallbackErr) {
      const fallbackStatus = axios.isAxiosError(fallbackErr) ? fallbackErr.response?.status : null;
      const fallbackBody = axios.isAxiosError(fallbackErr) ? fallbackErr.response?.data : null;
      logger.warn('Schema Registry /tenant/schemas also failed', { status: fallbackStatus, body: fallbackBody });
    }
  }

  return detectedTenantId;
}

/**
 * If `body` is an MCP `initialize` request, returns the client's name/version
 * (either may be undefined); otherwise returns null. Handles batched bodies.
 */
function getInitClientInfo(body: unknown): { name?: string; version?: string } | null {
  const msgs = Array.isArray(body) ? body : [body];
  for (const m of msgs) {
    if (m && typeof m === 'object' && (m as { method?: string }).method === 'initialize') {
      const ci = (m as { params?: { clientInfo?: { name?: string; version?: string } } }).params?.clientInfo;
      return {
        name: ci?.name ? String(ci.name) : undefined,
        version: ci?.version ? String(ci.version) : undefined
      };
    }
  }
  return null;
}

/**
 * Is `origin` a loopback origin (the bundled setup page)? Port-agnostic so it
 * accepts the page whether the user browsed to localhost or 127.0.0.1 on any port.
 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * CSRF guard for state-changing endpoints. This server has no caller auth, so a
 * malicious page the operator visits in the same browser could otherwise POST to
 * these endpoints (e.g. flip on write access). We reject any request a browser
 * marks as cross-site, or that carries a non-loopback Origin.
 *
 * Non-browser MCP clients (stdio bridges, curl) send neither Sec-Fetch-Site nor
 * Origin; they can't be a CSRF vector and are allowed through untouched.
 */
function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    logger.warn('Blocked cross-site request', { path: req.path, secFetchSite: site });
    res.status(403).json({ success: false, error: 'Cross-site request blocked.' });
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && !isLoopbackOrigin(origin)) {
    logger.warn('Blocked request from disallowed origin', { path: req.path, origin });
    res.status(403).json({ success: false, error: 'Request origin not allowed.' });
    return;
  }
  next();
}

export function createExpressApp(): express.Application {
  const app = express();

  // ─── Security Middleware ─────────────────────────────────────────────────

  app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts in UI
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:*'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
    exposedHeaders: ['Mcp-Session-Id']
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

  // Discovery is triggered automatically when the user uploads credentials and
  // can be retried, so it needs more headroom than the strict auth limiter.
  const discoverLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many sandbox discovery attempts. Please wait a moment and retry.' }
  });

  // Discover which AEP sandboxes the uploaded credentials can access, so the
  // landing page can populate the sandbox dropdown instead of asking the user to
  // type a name. Validation/activation still happen at /api/configure; this is a
  // best-effort convenience probe and never mutates server state.
  app.post('/api/list-sandboxes', csrfGuard, discoverLimiter, async (req: Request, res: Response) => {
    const extracted = extractCredentials((req.body as { credentials?: unknown })?.credentials);
    if (!extracted.ok) {
      return res.status(extracted.status).json({ success: false, error: extracted.error });
    }
    const { creds } = extracted;

    // Acquire an IMS token to call the Sandbox Management API. We reset the token
    // manager afterwards so this probe doesn't leave the server looking
    // "configured" before the user has picked a sandbox and clicked Start.
    tokenManager.setCredentials(creds);

    let accessToken: string;
    try {
      accessToken = await tokenManager.getToken();
    } catch (err) {
      tokenManager.reset();
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('Credential validation failed during list-sandboxes', { error: detail });
      return res.status(401).json({
        success: false,
        code: 'AUTH_FAILED',
        error: `Unable to authenticate with Adobe Experience Platform: ${detail}`
      });
    }

    try {
      const sandboxes = await fetchSandboxes(accessToken, creds.API_KEY!, creds.IMS_ORG!);

      // The tenant namespace is org-wide (identical across sandboxes) but the
      // Schema Registry must be queried within a sandbox context, so probe the
      // default (or first) discovered sandbox. Non-fatal — surfaced purely so the
      // landing page can show the tenant identity as soon as credentials load.
      let tenantId: string | undefined;
      if (sandboxes.length > 0) {
        const probeSandbox = sandboxes.find(s => s.isDefault)?.name ?? sandboxes[0].name;
        tenantId = await detectTenantNamespace(accessToken, creds.API_KEY!, creds.IMS_ORG!, probeSandbox);
      }

      tokenManager.reset();
      logger.info('Listed accessible sandboxes', { count: sandboxes.length, tenantId });
      return res.json({
        success: true,
        sandboxes,
        tenantId,
        tenantNamespace: tenantId ? `_${tenantId}` : undefined
      });
    } catch (err) {
      tokenManager.reset();
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      const body = axios.isAxiosError(err) ? err.response?.data : null;
      logger.warn('Sandbox Management API call failed', { status, body });
      if (status === 401) {
        return res.status(401).json({
          success: false,
          code: 'AUTH_FAILED',
          error: 'Unable to authenticate with Adobe Experience Platform. Please verify the access token and API credentials.'
        });
      }
      if (status === 403) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN',
          error: 'The supplied credentials do not have permission to list Adobe Experience Platform sandboxes.'
        });
      }
      return res.status(502).json({
        success: false,
        code: 'UPSTREAM_ERROR',
        error: 'Unable to retrieve sandbox information. Please try again later.'
      });
    }
  });

  // Lightweight probe: validate credentials and attempt tenant-namespace
  // detection WITHOUT activating the server. The landing page calls this before
  // configuring so it can reveal the org-name input up front when the namespace
  // can't be auto-detected.
  app.post('/api/detect-tenant', csrfGuard, authLimiter, async (req: Request, res: Response) => {
    const parsedReq = parseConfigRequest(req.body);
    if (!parsedReq.ok) {
      return res.status(parsedReq.status).json({ success: false, error: parsedReq.error });
    }
    const { creds, sandboxName } = parsedReq;

    // Apply credentials so the token manager can acquire an IMS token
    tokenManager.setCredentials(creds);

    let accessToken: string;
    try {
      accessToken = await tokenManager.getToken();
    } catch (err) {
      tokenManager.reset();
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('Credential validation failed during detect-tenant', { error: detail });
      return res.status(401).json({
        success: false,
        error: `Invalid credentials: ${detail}. Check your CLIENT_SECRET, API_KEY, and TECHNICAL_ACCOUNT_ID.`
      });
    }

    const detectedTenantId = await detectTenantNamespace(
      accessToken, creds.API_KEY!, creds.IMS_ORG!, sandboxName
    );

    return res.json({
      success: true,
      tenantId: detectedTenantId,
      tenantNamespace: detectedTenantId ? `_${detectedTenantId}` : undefined
    });
  });

  app.post('/api/configure', csrfGuard, authLimiter, async (req: Request, res: Response) => {
    const parsedReq = parseConfigRequest(req.body);
    if (!parsedReq.ok) {
      return res.status(parsedReq.status).json({ success: false, error: parsedReq.error });
    }
    const { creds, sandboxName, orgName } = parsedReq;

    // Self-declared author email — mandatory; recorded with every content change.
    const emailResult = parseAuthorEmail((req.body as { authorEmail?: unknown })?.authorEmail);
    if (!emailResult.ok) {
      return res.status(400).json({ success: false, error: emailResult.error });
    }
    const authorEmail = emailResult.email;

    // Access mode — read-only by default; writes only when explicitly enabled.
    setWritesAllowed(req.body?.allowWrites === true);

    // Apply credentials so the token manager can acquire an IMS token
    tokenManager.setCredentials(creds);

    // ── Step 1: validate credentials by acquiring an IMS token ────────────────
    let accessToken: string;
    try {
      accessToken = await tokenManager.getToken();
    } catch (err) {
      tokenManager.reset();
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('Credential validation failed during configure', { error: detail });
      return res.status(401).json({
        success: false,
        error: `Invalid credentials: ${detail}. Check your CLIENT_SECRET, API_KEY, and TECHNICAL_ACCOUNT_ID.`
      });
    }

    // ── Step 2: auto-detect tenant namespace via Schema Registry (non-fatal) ──
    const detectedTenantId = await detectTenantNamespace(
      accessToken, creds.API_KEY!, creds.IMS_ORG!, sandboxName
    );

    // Configure client with all info (including auto-detected tenant ID)
    configureAdobeClient({
      sandboxName,
      imsOrg: creds.IMS_ORG!,
      apiKey: creds.API_KEY!,
      orgName,
      tenantId: detectedTenantId,
      authorEmail
    });

    // ── Step 3: validate sandbox via lightweight read call ────────────────────
    try {
      await listTemplates({ limit: 1 });
    } catch (err) {
      tokenManager.reset();
      resetAdobeClient();
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const title = err.response?.data?.title || err.response?.data?.message || err.message;
        if (status === 403) {
          return res.status(400).json({
            success: false,
            error: `Sandbox "${sandboxName}" not found or your API key does not have AJO Content permissions for it. Verify the sandbox name in Adobe Experience Platform.`
          });
        }
        if (status === 401) {
          return res.status(401).json({
            success: false,
            error: `Access token was rejected by the API (401). Check that your API key and IMS org are correct.`
          });
        }
        return res.status(400).json({
          success: false,
          error: `Sandbox validation failed (${status}): ${title}`
        });
      }
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(400).json({
        success: false,
        error: `Sandbox validation failed: ${detail}`
      });
    }

    logger.info('Server configured and validated', {
      sandboxName,
      imsOrg: creds.IMS_ORG,
      tenantId: detectedTenantId,
      authorEmail,
      hasClientSecret: !!(creds.CLIENT_SECRET && creds.CLIENT_SECRET !== 'placeholder123')
    });

    return res.json({
      success: true,
      message: 'MCP server configured',
      sandboxName,
      tenantId: detectedTenantId,
      tenantNamespace: detectedTenantId ? `_${detectedTenantId}` : undefined,
      authorEmail,
      writesAllowed: getWritesAllowed(),
      mcpEndpoint: '/mcp'
    });
  });

  // Flip the read/write access mode live (after activation), without a full
  // reconfigure. Enforcement (CallTool) is immediate; already-connected clients
  // keep their previously-advertised tool list until they reconnect.
  app.post('/api/access-mode', csrfGuard, (req: Request, res: Response) => {
    if (!tokenManager.isConfigured()) {
      return res.status(409).json({ success: false, error: 'Server is not configured yet.' });
    }
    setWritesAllowed(req.body?.allowWrites === true);
    logger.info('Access mode changed', { writesAllowed: getWritesAllowed() });
    return res.json({ success: true, writesAllowed: getWritesAllowed() });
  });

  app.get('/api/status', (_req, res) => {
    res.json({
      configured: tokenManager.isConfigured(),
      auth: tokenManager.getStatus()
    });
  });

  // Which MCP clients are currently connected (captured from the initialize
  // handshake). Polled by the landing page after activation. `configured` lets
  // the page detect a container restart (server state lost) and reset itself.
  app.get('/api/connected-clients', (_req, res) => {
    res.json({ configured: tokenManager.isConfigured(), writesAllowed: getWritesAllowed(), clients: getConnectedClients() });
  });

  // ─── MCP HTTP Endpoint ────────────────────────────────────────────────────

  const mcpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 500
  });

  // Active Streamable HTTP sessions (stateful), keyed by MCP session ID. Each
  // client holds one session for its lifetime, so every request — including
  // tool calls that carry no clientInfo — is attributable to the right client.
  const httpSessions = new Map<string, StreamableHTTPServerTransport>();

  app.all('/mcp', mcpLimiter, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Existing session → mark activity and route to its transport.
      if (sessionId && httpSessions.has(sessionId)) {
        const transport = httpSessions.get(sessionId)!;
        touchSession(sessionId);
        if (req.method === 'GET') {
          // The standalone SSE stream stays open for the session; track it so an
          // idle-but-connected client keeps showing, and refresh when it closes.
          openSessionStream(sessionId);
          res.on('close', () => closeSessionStream(sessionId));
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // A new session must begin with an `initialize` request.
      const initInfo = getInitClientInfo(req.body);
      if (!sessionId && initInfo) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => uuidv4(),
          onsessioninitialized: (sid: string) => {
            httpSessions.set(sid, transport);
            if (initInfo.name) addSession(sid, initInfo.name, initInfo.version);
            logger.info('MCP session initialized', { sessionId: sid, client: initInfo.name, transport: 'http' });
          }
        });
        const mcpServer = createMcpServer('http');
        const unsubWriteAccess = onWriteAccessChanged(() => {
          mcpServer.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
          mcpServer.notification({ method: 'notifications/resources/list_changed' }).catch(() => {});
        });
        transport.onclose = () => {
          unsubWriteAccess();
          const sid = transport.sessionId;
          if (sid) {
            httpSessions.delete(sid);
            removeSession(sid);
            logger.info('MCP session closed', { sessionId: sid, transport: 'http' });
          }
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // A session ID was provided but we don't know it (e.g. server restarted, or
      // the session expired) → 404 tells the client to reinitialize.
      if (sessionId) {
        res.status(404).json({
          jsonrpc: '2.0', id: null,
          error: { code: -32001, message: 'Session not found — reinitialize.' }
        });
        return;
      }

      // No session ID and not an initialize request.
      res.status(400).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32000, message: 'Bad Request: send an initialize request to start a session.' }
      });
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
