import {
  isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName,
  getConfiguredTenantId, getConfiguredAuthorEmail, getConfiguredNamingConvention
} from '../adobe/client.js';
import { getWritesAllowed } from '../mcp/access-policy.js';
import type { ToolCatalogGroup } from '../mcp/tool-catalog.js';
import { RESOURCE_ACCESS_CATALOG } from '../mcp/resources.js';
import { notConfiguredError, withTelemetry, buildOutputSchema } from './utils.js';

// The full tool catalog, injected once at server startup (server.ts derives it
// from the live tool list and calls setToolCatalog). Surfacing it in this tool's
// output gives the model a reliable, high-salience index of every capability —
// so it can select tools by exact name instead of relying on fuzzy tool search.
let toolCatalog: ToolCatalogGroup[] = [];
export function setToolCatalog(catalog: ToolCatalogGroup[]): void {
  toolCatalog = catalog;
}

// ─── get_server_context ────────────────────────────────────────────────────
// A reliable, on-demand way for the LLM to report who/what this server is
// operating as. The server `instructions` aren't surfaced to the model by every
// client, but tools always are — so identity questions ("who is this running on
// behalf of?", "which sandbox am I on?") resolve to an explicit tool call here.

export const getServerContextDefinition = {
  name: 'get_server_context',
  title: 'Get Server Context (Identity & Config)',
  outputSchema: buildOutputSchema({
    data: {
      type: 'object',
      properties: {
        authorEmail: { type: ['string', 'null'], description: 'Self-declared author email (not verified); null if unset.' },
        sandbox: { type: ['string', 'null'], description: 'Configured AJO sandbox name.' },
        tenantNamespace: { type: ['string', 'null'], description: 'Tenant namespace (e.g. _acme); null if unknown.' },
        orgName: { type: 'string', description: 'Adobe org name (optional). Omitted entirely when not configured — absence means no org name was set, not an error.' },
        writeAccess: { type: 'boolean', description: 'Whether write operations are currently enabled.' },
        configured: { type: 'boolean', description: 'Whether credentials and sandbox are configured.' },
        tools: {
          type: 'array',
          description: 'Catalog of every tool this server exposes, grouped by domain. Call any tool by its exact "name". Use this to discover all capabilities in one call rather than searching.',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string', description: 'Domain grouping, e.g. "Content fragments".' },
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Exact tool name to call.' },
                    title: { type: 'string', description: 'Human-friendly title.' }
                  }
                }
              }
            }
          }
        },
        resources: {
          type: 'array',
          description: 'Catalog of every resource this server exposes, each with how to actually obtain it. Many clients (e.g. Claude Desktop) do not let the model read MCP resources directly, so use the "access" hint — it names the tool to call or says where the content already lives.',
          items: {
            type: 'object',
            properties: {
              uri: { type: 'string', description: 'Resource URI (e.g. ajo://error-codes).' },
              title: { type: 'string', description: 'Human-friendly title.' },
              description: { type: 'string', description: 'What the resource contains.' },
              access: { type: 'string', description: 'How the model can obtain this content (a tool to call, or where it already appears).' }
            }
          }
        }
      }
    }
  }),
  description: `Return the identity and configuration this MCP server is currently operating as: the author it is acting on behalf of (a self-declared email captured at setup — not verified), the AJO sandbox, the tenant namespace, the org name, and whether write access is enabled.

It also returns the full catalog of tools this server exposes (grouped by domain) — call this first to discover every available capability by exact name, instead of guessing at tool searches — and a catalog of every resource it exposes, each with an "access" hint telling you how to actually obtain that content (which tool to call, or where it already lives). The resource catalog matters because many clients do not let the model read MCP resources directly.

Use this to answer questions like "who is this server running on behalf of?", "which sandbox / tenant am I connected to?", "can I make changes (is write access on)?", "what can this server do?", or "what resources are available and how do I read them?".

Example usage: {}

Returns: { success: true, data: { authorEmail, sandbox, tenantNamespace, orgName, writeAccess, configured, tools: [{ group, tools: [{ name, title }] }], resources: [{ uri, title, description, access }] } }`,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {}
  }
};

export async function handleGetServerContext(_args?: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_server_context', async () => {
    const tenantId = getConfiguredTenantId();
    // orgName is an optional landing-page field that is usually left blank. When
    // it's unset (or empty) omit the key entirely rather than surfacing a null —
    // a missing key reads cleanly to the LLM, whereas a null invites it to mention
    // a non-existent org.
    const orgName = getConfiguredOrgName()?.trim();
    const namingConvention = getConfiguredNamingConvention();
    return {
      success: true,
      data: {
        authorEmail: getConfiguredAuthorEmail(),
        sandbox: getConfiguredSandboxName(),
        tenantNamespace: tenantId ? `_${tenantId}` : null,
        ...(orgName ? { orgName } : {}),
        writeAccess: getWritesAllowed(),
        configured: true,
        // Only surface the convention when enforcement is ON — never expose rules the
        // operator chose not to enforce (defense-in-depth; disabled configs aren't stored).
        ...(namingConvention?.enabled ? { namingConvention } : {}),
        tools: toolCatalog,
        resources: RESOURCE_ACCESS_CATALOG
      }
    };
  });
}
