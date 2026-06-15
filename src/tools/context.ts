import {
  isClientConfigured, getConfiguredSandboxName, getConfiguredOrgName,
  getConfiguredTenantId, getConfiguredAuthorEmail
} from '../adobe/client.js';
import { getWritesAllowed } from '../mcp/access-policy.js';
import type { ToolCatalogGroup } from '../mcp/tool-catalog.js';
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
        orgName: { type: ['string', 'null'], description: 'Adobe org name.' },
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
        }
      }
    }
  }),
  description: `Return the identity and configuration this MCP server is currently operating as: the author it is acting on behalf of (a self-declared email captured at setup — not verified), the AJO sandbox, the tenant namespace, the org name, and whether write access is enabled.

It also returns the full catalog of tools this server exposes (grouped by domain) — call this first to discover every available capability by exact name, instead of guessing at tool searches.

Use this to answer questions like "who is this server running on behalf of?", "which sandbox / tenant am I connected to?", "can I make changes (is write access on)?", or "what can this server do?".

Example usage: {}

Returns: { success: true, data: { authorEmail, sandbox, tenantNamespace, orgName, writeAccess, configured, tools: [{ group, tools: [{ name, title }] }] } }`,
  annotations: { title: 'Get Server Context (Identity & Config)', readOnlyHint: true, openWorldHint: false },
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
    return {
      success: true,
      data: {
        authorEmail: getConfiguredAuthorEmail(),
        sandbox: getConfiguredSandboxName(),
        tenantNamespace: tenantId ? `_${tenantId}` : null,
        orgName: getConfiguredOrgName(),
        writeAccess: getWritesAllowed(),
        configured: true,
        tools: toolCatalog
      }
    };
  });
}
