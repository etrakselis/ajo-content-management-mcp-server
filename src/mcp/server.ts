import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName, getConfiguredTenantId, getConfiguredAuthorEmail, listFragments } from '../adobe/client.js';
import { recordClient, removeClient, TransportKind } from './connected-clients.js';
import { getWritesAllowed, onWriteAccessChanged } from './access-policy.js';
import { ALL_PROMPTS, getPromptMessages } from './prompts.js';
import { logger } from '../telemetry/index.js';
import { recordAudit } from '../telemetry/audit.js';

// Template tools
import {
  listContentTemplatesDefinition, handleListContentTemplates,
  createContentTemplateDefinition, handleCreateContentTemplate,
  getContentTemplateDefinition, handleGetContentTemplate,
  updateContentTemplateDefinition, handleUpdateContentTemplate,
  patchContentTemplateDefinition, handlePatchContentTemplate,
  deleteContentTemplateDefinition, handleDeleteContentTemplate
} from '../tools/templates.js';

// Fragment tools
import {
  listContentFragmentsDefinition, handleListContentFragments,
  createContentFragmentDefinition, handleCreateContentFragment,
  getContentFragmentDefinition, handleGetContentFragment,
  updateContentFragmentDefinition, handleUpdateContentFragment,
  patchContentFragmentDefinition, handlePatchContentFragment,
  publishContentFragmentDefinition, handlePublishContentFragment,
  getLiveFragmentDefinition, handleGetLiveFragment,
  getFragmentPublicationStatusDefinition, handleGetFragmentPublicationStatus,
  archiveContentFragmentDefinition, handleArchiveContentFragment
} from '../tools/fragments.js';

// Schema Registry (XDM) tools — read-only; for discovering real personalization attribute paths
import {
  listXdmSchemasDefinition, handleListXdmSchemas,
  getXdmSchemaDefinition, handleGetXdmSchema,
  listXdmFieldGroupsDefinition, handleListXdmFieldGroups,
  getXdmFieldGroupDefinition, handleGetXdmFieldGroup,
  listXdmUnionSchemasDefinition, handleListXdmUnionSchemas,
  getXdmUnionSchemaDefinition, handleGetXdmUnionSchema
} from '../tools/schema-registry.js';

// Server context — read-only; reports who/what this server is operating as
import { getServerContextDefinition, handleGetServerContext } from '../tools/context.js';

const ALL_TOOLS = [
  listContentTemplatesDefinition,
  createContentTemplateDefinition,
  getContentTemplateDefinition,
  updateContentTemplateDefinition,
  patchContentTemplateDefinition,
  deleteContentTemplateDefinition,
  listContentFragmentsDefinition,
  createContentFragmentDefinition,
  getContentFragmentDefinition,
  updateContentFragmentDefinition,
  patchContentFragmentDefinition,
  publishContentFragmentDefinition,
  getLiveFragmentDefinition,
  getFragmentPublicationStatusDefinition,
  archiveContentFragmentDefinition,
  // Schema Registry (XDM) — read-only
  listXdmSchemasDefinition,
  getXdmSchemaDefinition,
  listXdmFieldGroupsDefinition,
  getXdmFieldGroupDefinition,
  listXdmUnionSchemasDefinition,
  getXdmUnionSchemaDefinition,
  // Server context — read-only
  getServerContextDefinition
];

// Tools that modify content. When the server is in read-only mode these are
// hidden from tool discovery and rejected if called anyway.
const WRITE_TOOLS = new Set<string>([
  'create_content_template', 'update_content_template', 'patch_content_template', 'delete_content_template',
  'create_content_fragment', 'update_content_fragment', 'patch_content_fragment',
  'publish_content_fragment', 'archive_content_fragment'
]);

const isWriteTool = (name: string): boolean => WRITE_TOOLS.has(name);

// Appended to write-tool descriptions so the client/LLM knows the call is gated by
// the server's runtime write-access setting (rather than always available).
const WRITE_TOOL_NOTE =
  '\n\n[Write operation] Requires write access. If the server is in read-only mode this call is ' +
  'rejected with a READ_ONLY_MODE error; the user can enable write access at http://localhost:3000.';

const TOOL_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  list_content_templates: handleListContentTemplates,
  create_content_template: handleCreateContentTemplate,
  get_content_template: handleGetContentTemplate,
  update_content_template: handleUpdateContentTemplate,
  patch_content_template: handlePatchContentTemplate,
  delete_content_template: handleDeleteContentTemplate,
  list_content_fragments: handleListContentFragments,
  create_content_fragment: handleCreateContentFragment,
  get_content_fragment: handleGetContentFragment,
  update_content_fragment: handleUpdateContentFragment,
  patch_content_fragment: handlePatchContentFragment,
  publish_content_fragment: handlePublishContentFragment,
  get_live_fragment: handleGetLiveFragment,
  get_fragment_publication_status: handleGetFragmentPublicationStatus,
  archive_content_fragment: handleArchiveContentFragment,
  // Schema Registry (XDM) — read-only
  list_xdm_schemas: handleListXdmSchemas,
  get_xdm_schema: handleGetXdmSchema,
  list_xdm_field_groups: handleListXdmFieldGroups,
  get_xdm_field_group: handleGetXdmFieldGroup,
  list_xdm_union_schemas: handleListXdmUnionSchemas,
  get_xdm_union_schema: handleGetXdmUnionSchema,
  // Server context — read-only
  get_server_context: handleGetServerContext
};

export function createMcpServer(transport: TransportKind = 'http'): Server {
  const sandbox = getConfiguredSandboxName();
  const orgName = getConfiguredOrgName();
  const tenantId = getConfiguredTenantId();
  const tenantNamespace = tenantId ? `_${tenantId}` : null;
  const authorEmail = getConfiguredAuthorEmail();

  let tenantDesc: string | null = null;
  if (sandbox) {
    const parts: string[] = [];
    if (orgName) parts.push(`org "${orgName}"`);
    if (tenantNamespace) parts.push(`tenant namespace "${tenantNamespace}"`);
    parts.push(`sandbox "${sandbox}"`);
    tenantDesc = parts.join(', ');
  }

  // All tools are always advertised; write access is gated at execution time.
  // Instructions intentionally omit the current write-access state because that
  // value is captured once at session-init and goes stale when the toggle flips.
  // The per-call WRITE_TOOL_NOTE in ListTools and the dynamic enforcement in
  // CallTool are the authoritative signals — instructions only carry the pattern.
  const dynamicNote = ` Write access is toggled at runtime; always attempt the operation the user ` +
    `asks for; if a write is rejected with READ_ONLY_MODE, tell the user they can enable write access ` +
    `at http://localhost:3000 and then retry — do not abandon the request.`;

  const personalizationNote = ` When inserting personalization fields into a template or fragment, do NOT assume ` +
    `default XDM paths like {{profile.person.firstName}}. Most customers define custom field groups under their ` +
    `tenant namespace, so first look up the real attribute paths with the XDM schema tools ` +
    `(list_xdm_field_groups / get_xdm_field_group, or get_xdm_union_schema for the full merged Profile view), ` +
    `then build personalization expressions from the actual attribute locations you find.`;

  const resourceNote = ` Before constructing any create or update payload, read the ` +
    `ajo://sandbox/channel-reference resource to confirm the correct templateType, channel, and content shape ` +
    `for the target channel. If you encounter an error, read ajo://error-codes for the cause and recovery action. ` +
    `Read ajo://server/status to diagnose NOT_CONFIGURED or UNAUTHORIZED errors.`;

  const promptNote = ` Use the 'discover-personalization-paths' prompt before inserting personalization ` +
    `expressions into any template or fragment. Use the 'publish-fragment' prompt for the full async publication ` +
    `workflow. Use 'audit-content-library' to survey all content in the sandbox.`;

  // Surface the self-declared author identity to the LLM. Captured at setup like
  // the tenant/sandbox above, so it shares their lifecycle (present once the user
  // has completed setup; omitted entirely if no email is configured).
  const authorNote = authorEmail
    ? ` You are acting on behalf of ${authorEmail}; this identity is recorded with every content change ` +
      `(create, update, delete, publish, archive) made through this server.`
    : '';

  const instructions = (tenantDesc
    ? `You are connected to Adobe Journey Optimizer for ${tenantDesc}. ` +
      `Always display the tenant namespace and sandbox name when discussing content operations. ` +
      `Before creating, updating, or deleting any content, confirm with the user that ` +
      `sandbox "${sandbox}"${tenantNamespace ? ` (tenant: ${tenantNamespace})` : ''} is the intended target.`
    : `You are connected to an AJO Content MCP server. ` +
      `No sandbox has been configured yet — ask the user to open http://localhost:3000 and complete setup before making any content changes.`)
    + authorNote + dynamicNote + personalizationNote + resourceNote + promptNote;

  const server = new Server(
    {
      name: 'et-ajo-content-mgmt',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {}
      },
      instructions
    }
  );

  // Capture the connecting client's identity from the initialize handshake so
  // the landing page can show which client this server is serving. HTTP clients
  // are tracked per-session in app.ts (the stateful /mcp handler); here we only
  // handle STDIO, where one persistent server maps 1:1 to one client.
  if (transport === 'stdio') {
    server.oninitialized = () => {
      const info = server.getClientVersion();
      if (info?.name) {
        recordClient(info.name, info.version);
        logger.info('MCP client connected', { client: info.name, version: info.version, transport });
      }
    };
  }

  // ─── Logging ──────────────────────────────────────────────────────────────
  // sendLoggingMessage handles per-session level filtering (via the SDK's
  // built-in SetLevelRequestSchema handler registered when logging: {} is declared).

  const emitLog = (level: LoggingLevel, data: string, sessionId?: string) => {
    server.sendLoggingMessage({ level, data }, sessionId).catch(() => {});
  };

  // ─── Tool Discovery ────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Always advertise the full tool set — many clients cache this list at connect
    // and ignore tools/list_changed, so hiding write tools would strand them in
    // read-only even after the toggle is flipped on. Write enforcement happens in
    // CallTool instead. A note on each write tool flags the runtime gate.
    const tools = ALL_TOOLS.map(t =>
      isWriteTool(t.name)
        ? { ...t, description: t.description + WRITE_TOOL_NOTE }
        : t
    );
    return { tools };
  });

  // ─── Tool Execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];
    const sessionId = extra.sessionId;

    emitLog('debug', `→ ${name}`, sessionId);

    // Enforce read-only mode at execution time (defense in depth — independent of
    // whether the tool was advertised). Read live so it applies to existing sessions.
    if (!getWritesAllowed() && isWriteTool(name)) {
      emitLog('warning', `✗ ${name}: READ_ONLY_MODE`, sessionId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'READ_ONLY_MODE',
              message: `Write operations are disabled. The server is in read-only mode, so "${name}" is not permitted. Ask the user to enable write access on the setup page (http://localhost:3000) if this is intended.`,
              details: {}
            }
          })
        }],
        isError: true
      };
    }

    if (!handler) {
      emitLog('warning', `✗ ${name}: TOOL_NOT_FOUND`, sessionId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'TOOL_NOT_FOUND',
              message: `Unknown tool: ${name}. Available tools: ${Object.keys(TOOL_HANDLERS).join(', ')}`,
              details: {}
            }
          })
        }],
        isError: true
      };
    }

    try {
      const result = await handler(args);
      const activeSandbox = getConfiguredSandboxName();
      const activeOrg = getConfiguredOrgName();
      const activeTenantId = getConfiguredTenantId();
      const activeAuthor = getConfiguredAuthorEmail();
      const parts: string[] = [];
      if (activeOrg) parts.push(`org: ${activeOrg}`);
      if (activeTenantId) parts.push(`tenant: _${activeTenantId}`);
      if (activeSandbox) parts.push(`sandbox: ${activeSandbox}`);
      if (activeAuthor) parts.push(`author: ${activeAuthor}`);
      const prefix = parts.length > 0 ? `[${parts.join(' | ')}]\n` : '';
      const resultObj = result as { success?: boolean; error?: { code?: string }; id?: string };
      if (resultObj?.success === false) {
        emitLog('warning', `✗ ${name}: ${resultObj.error?.code ?? 'error'}`, sessionId);
      } else {
        emitLog('info', `✓ ${name}`, sessionId);
      }

      // Audit trail: attribute every content write to the self-declared author.
      // Only writes reach here in non-read-only mode (read-only writes are
      // rejected above). Captures both successful and handler-rejected attempts.
      if (isWriteTool(name)) {
        const callArgs = (args ?? {}) as Record<string, unknown>;
        const argId = typeof callArgs.fragmentId === 'string'
          ? callArgs.fragmentId
          : (typeof callArgs.templateId === 'string' ? callArgs.templateId : undefined);
        recordAudit({
          action: name,
          authorEmail: getConfiguredAuthorEmail() ?? 'unknown',
          resourceType: name.includes('fragment') ? 'fragment' : name.includes('template') ? 'template' : 'unknown',
          resourceId: argId ?? resultObj?.id,
          resourceName: typeof callArgs.name === 'string' ? callArgs.name : undefined,
          sandbox: activeSandbox,
          tenantNamespace: activeTenantId ? `_${activeTenantId}` : null,
          success: resultObj?.success !== false
        });
      }
      return {
        content: [{
          type: 'text',
          text: prefix + JSON.stringify(result, null, 2)
        }]
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Unhandled tool error', { tool: name, error: msg });
      emitLog('error', `✗ ${name}: ${msg}`, sessionId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: msg, details: {} }
          })
        }],
        isError: true
      };
    }
  });

  // ─── Resources ────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'ajo://server/status',
          name: 'Server Status',
          description: 'Current configuration and authentication status',
          mimeType: 'application/json'
        },
        {
          uri: 'ajo://sandbox/channel-reference',
          name: 'Channel & Content-Type Reference',
          description: 'Maps AJO channels to valid templateType values, required template/fragment content shapes, and subType options. Read this before constructing create or update payloads.',
          mimeType: 'text/plain'
        },
        {
          uri: 'ajo://error-codes',
          name: 'Error Code Reference',
          description: 'All error codes this server can return, with their cause and the correct recovery action for each.',
          mimeType: 'text/plain'
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'ajo://server/status') {
      const authStatus = tokenManager.getStatus();
      const configured = isClientConfigured();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            serverName: 'et-ajo-content-mgmt',
            version: '1.0.0',
            configured,
            authentication: authStatus,
            writeAccess: getWritesAllowed(),
            availableTools: Object.keys(TOOL_HANDLERS).length
          }, null, 2)
        }]
      };
    }

    if (uri === 'ajo://sandbox/channel-reference') {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `AJO Content Type & Channel Reference
======================================
Read this before constructing create or update payloads to avoid validation errors.

━━━ TEMPLATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

templateType "html" — Full HTML email
  channels:  ["email"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "html_primary_page" — Landing page (main page)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "html_sub_page" — Landing page (sub-page / confirmation)
  channels:  ["landingpage"]
  template:  { "html": "<html>...</html>" }
  subType:   n/a

templateType "content" — Structured content (all non-HTML channels)
  Push notification:
    channels:  ["push"]
    template:  { "title": "...", "message": "...", "deeplink": "..." }
  SMS:
    channels:  ["sms"]
    template:  { "body": "..." }
  In-app message:
    channels:  ["inapp"]
    template:  { "header": "...", "body": "...", "buttonText": "...", "buttonLink": "..." }
  Code-based experience:
    channels:  ["code"]
    template:  { ... }  (shape is app-defined)
    subType:   "HTML" | "JSON"
  Direct mail:
    channels:  ["directMail"]
    template:  { ... }  (shape is provider-defined)
  Shared (multi-channel):
    channels:  ["shared"]
    template:  { ... }

━━━ FRAGMENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type "html" — Reusable HTML block embedded in email templates
  channels:  ["email"]
  fragment:  { "content": "<div>...</div>" }
  subType:   n/a

type "expression" — Reusable expression / helper text
  channels:  ["shared"]
  fragment:  { "expression": "..." }
  subType:   "TEXT" | "HTML" | "JSON"

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• channels must be an array with exactly 1 value.
• subType is only valid on templateType "content" + channel "code", and on fragment type "expression".
• Personalization expressions go inside the template/fragment content strings.
  Do NOT use guessed XDM paths. Use list_xdm_field_groups / get_xdm_union_schema to find
  real attribute paths for this sandbox before inserting {{ }} expressions.`
        }]
      };
    }

    if (uri === 'ajo://error-codes') {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `AJO Content MCP — Error Code Reference
========================================

NOT_CONFIGURED
  Cause:    Server has no credentials or sandbox configured yet.
  Recovery: Ask the user to open http://localhost:3000, upload their credentials JSON,
            and enter the sandbox name. Do not retry the tool until they confirm setup is done.

READ_ONLY_MODE
  Cause:    A write operation was attempted while the server is in read-only mode.
  Recovery: Tell the user they can enable write access at http://localhost:3000, then
            retry the exact same operation once they confirm it is enabled. Do not abandon
            the request — just wait for the user to flip the toggle.

VALIDATION_ERROR
  Cause:    Either (a) the tool was called with invalid/missing input parameters (Zod
            validation), or (b) the AJO API rejected the request body (HTTP 400).
  Recovery: For (a): check the "details" array — each entry has a "path" and "message"
            identifying which field is wrong. Fix the input and retry.
            For (b): check the "message" and "details" from the API response for specifics.

UNAUTHORIZED  (HTTP 401)
  Cause:    The IMS access token is missing, expired, or was rejected by the API.
  Recovery: The server auto-refreshes tokens; if this error persists, the stored
            credentials may be invalid. Ask the user to reconfigure at http://localhost:3000.

FORBIDDEN  (HTTP 403)
  Cause:    The API key or service account does not have permission for this operation
            on this sandbox, OR the AEP Schema Registry API is not added to the
            Developer Console project (common cause of 403 on XDM schema tools).
  Recovery: For content tools: ask the user to verify their API key has the correct
            product profiles in Adobe Developer Console.
            For XDM schema tools: ask the user to add the "Experience Platform API"
            to their Developer Console project and regenerate credentials.

NOT_FOUND  (HTTP 404)
  Cause:    The requested resource (template, fragment, schema) does not exist, or the
            ID is wrong, or it belongs to a different sandbox.
  Recovery: Verify the ID is correct. If listing first, check the current sandbox
            (shown in the [org | tenant | sandbox] prefix of every tool response).
            The user may need to switch sandboxes.

CONFLICT  (HTTP 409)
  Cause:    The ETag supplied to an update or patch operation is stale — another process
            modified the resource after you fetched it.
  Recovery: Re-fetch the resource with get_content_template or get_content_fragment to
            get the current data and a fresh ETag, then reapply the intended changes and
            retry the update. Do not reuse the old ETag.

API_ERROR  (any other HTTP error)
  Cause:    An unexpected HTTP status code was returned by the AJO API (e.g. 429, 500,
            503). The "message" field contains the API's own error description.
  Recovery: For 429 (rate limit): wait a moment and retry.
            For 5xx: the AJO service may be temporarily unavailable; retry once, then
            tell the user if it persists.

INTERNAL_ERROR
  Cause:    An unexpected exception occurred inside the MCP server itself (not an API
            error). The "message" field has the raw exception message.
  Recovery: This is likely a bug. Tell the user what happened and suggest they check
            the server logs (docker logs <container>) for more detail.

TOOL_NOT_FOUND
  Cause:    The tool name in the request does not match any registered handler.
  Recovery: This should not occur in normal use. If it does, the client may be using a
            stale tool list — reconnect the MCP client to refresh.`
        }]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // ─── Completions ──────────────────────────────────────────────────────────
  // Provides argument completions for prompt arguments so clients (e.g. Claude
  // Desktop) can surface dropdowns or autocomplete as the user types.

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { ref, argument } = request.params;

    if (ref.type !== 'ref/prompt') {
      return { completion: { values: [] } };
    }

    // audit-content-library → content_type: static enum
    if (ref.name === 'audit-content-library' && argument.name === 'content_type') {
      const options = ['both', 'templates', 'fragments'];
      const values = options.filter(o => o.startsWith(argument.value));
      return { completion: { values, hasMore: false } };
    }

    // publish-fragment → fragment_id: live lookup from the sandbox
    if (ref.name === 'publish-fragment' && argument.name === 'fragment_id') {
      if (!isClientConfigured()) return { completion: { values: [] } };
      try {
        const data = await listFragments({ limit: 50 }) as { items?: Array<{ id: string; name: string }> };
        const items = data.items ?? [];
        const values = items
          .map(f => f.id)
          .filter(id => id.startsWith(argument.value));
        return { completion: { values, hasMore: false } };
      } catch {
        return { completion: { values: [] } };
      }
    }

    return { completion: { values: [] } };
  });

  // ─── Prompts ──────────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: ALL_PROMPTS };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = ALL_PROMPTS.find(p => p.name === name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}. Available: ${ALL_PROMPTS.map(p => p.name).join(', ')}`);
    }
    // Read live — tenant may have been configured after this session initialized.
    const liveTenantId = getConfiguredTenantId();
    const liveTenantNamespace = liveTenantId ? `_${liveTenantId}` : null;
    let messages;
    try {
      messages = getPromptMessages(name, args as Record<string, string> | undefined, liveTenantNamespace);
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, err instanceof Error ? err.message : String(err));
    }
    return { description: prompt.description, messages };
  });

  return server;
}

// ─── STDIO Transport ──────────────────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer('stdio');
  const transport = new StdioServerTransport();

  const unsubWriteAccess = onWriteAccessChanged(() => {
    server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
    server.notification({ method: 'notifications/resources/list_changed' }).catch(() => {});
  });

  transport.onclose = () => {
    unsubWriteAccess();
    // A stdio server is 1:1 with a client; drop it from the connected list on close
    const info = server.getClientVersion();
    if (info?.name) removeClient(info.name);
    logger.info('STDIO transport closed (no client connected or client disconnected)');
  };

  await server.connect(transport);
  logger.info('MCP STDIO transport active');
}

// The HTTP (Streamable) transport is created per-session in the /mcp handler
// (src/server/app.ts), which owns the stateful session lifecycle.
