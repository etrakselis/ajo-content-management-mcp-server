import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName, getConfiguredTenantId } from '../adobe/client.js';
import { recordClient, removeClient, TransportKind } from './connected-clients.js';
import { logger } from '../telemetry/index.js';

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
  publishFragmentDefinition,
  getLiveFragmentDefinition, handleGetLiveFragment,
  getFragmentPublicationStatusDefinition, handleGetFragmentPublicationStatus,
  archiveContentFragmentDefinition, handleArchiveContentFragment
} from '../tools/fragments.js';

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
  publishFragmentDefinition,
  getLiveFragmentDefinition,
  getFragmentPublicationStatusDefinition,
  archiveContentFragmentDefinition
];

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
  publish_fragment: handlePublishContentFragment,
  get_live_fragment: handleGetLiveFragment,
  get_fragment_publication_status: handleGetFragmentPublicationStatus,
  archive_content_fragment: handleArchiveContentFragment
};

export function createMcpServer(transport: TransportKind = 'http'): Server {
  const sandbox = getConfiguredSandboxName();
  const orgName = getConfiguredOrgName();
  const tenantId = getConfiguredTenantId();
  const tenantNamespace = tenantId ? `_${tenantId}` : null;

  let tenantDesc: string | null = null;
  if (sandbox) {
    const parts: string[] = [];
    if (orgName) parts.push(`org "${orgName}"`);
    if (tenantNamespace) parts.push(`tenant namespace "${tenantNamespace}"`);
    parts.push(`sandbox "${sandbox}"`);
    tenantDesc = parts.join(', ');
  }

  const instructions = tenantDesc
    ? `You are connected to Adobe Journey Optimizer for ${tenantDesc}. ` +
      `Always display the tenant namespace and sandbox name when discussing content operations. ` +
      `Before creating, updating, or deleting any content, confirm with the user that ` +
      `sandbox "${sandbox}"${tenantNamespace ? ` (tenant: ${tenantNamespace})` : ''} is the intended target.`
    : `You are connected to an AJO Content MCP server. ` +
      `No sandbox has been configured yet — ask the user to open http://localhost:3000 and complete setup before making any content changes.`;

  const server = new Server(
    {
      name: 'et-ajo-content-mgmt',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
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

  // ─── Tool Discovery ────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  // ─── Tool Execution ────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];

    if (!handler) {
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
      const parts: string[] = [];
      if (activeOrg) parts.push(`org: ${activeOrg}`);
      if (activeTenantId) parts.push(`tenant: _${activeTenantId}`);
      if (activeSandbox) parts.push(`sandbox: ${activeSandbox}`);
      const prefix = parts.length > 0 ? `[${parts.join(' | ')}]\n` : '';
      return {
        content: [{
          type: 'text',
          text: prefix + JSON.stringify(result, null, 2)
        }]
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Unhandled tool error', { tool: name, error: msg });
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
          uri: 'ajo://tools/overview',
          name: 'Available Tools Overview',
          description: 'Summary of all available tools and their purposes',
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
            availableTools: Object.keys(TOOL_HANDLERS).length
          }, null, 2)
        }]
      };
    }

    if (uri === 'ajo://tools/overview') {
      const overview = ALL_TOOLS.map(t => `• ${t.name}: ${t.description.split('\n')[0]}`).join('\n');
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `AJO Content MCP Server — Available Tools\n\nTemplates:\n${
            ALL_TOOLS.filter(t => t.name.includes('template')).map(t => `• ${t.name}`).join('\n')
          }\n\nFragments:\n${
            ALL_TOOLS.filter(t => t.name.includes('fragment') || t.name === 'publish_fragment').map(t => `• ${t.name}`).join('\n')
          }\n\n${overview}`
        }]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

// ─── STDIO Transport ──────────────────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer('stdio');
  const transport = new StdioServerTransport();

  transport.onclose = () => {
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
