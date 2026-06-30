import { buildError, isClientConfigured } from '../adobe/client.js';
import {
  listSchemas, getSchema,
  listFieldGroups, getFieldGroup,
  listUnionSchemas, getUnionSchema,
  type Container
} from '../adobe/schema-registry-client.js';
import {
  ListXdmSchemasSchema, GetXdmSchemaSchema,
  ListXdmFieldGroupsSchema, GetXdmFieldGroupSchema,
  ListXdmUnionSchemasSchema, GetXdmUnionSchemaSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, oversizeError, DATA_OBJECT, LIST_DATA } from './utils.js';

// A fully-resolved schema (full=true) can exceed the 1 MB tool-result transport
// cap, which would otherwise surface as a bare "Tool result is too large" the
// caller can't branch on. The shared oversizeError guard (utils.ts) short-circuits
// with a structured RESPONSE_TOO_LARGE BEFORE returning, measuring the ACTUAL
// MCP-encoded result size so the size it reports and the limit it cites agree.

const PERSONALIZATION_HINT =
  `Use these to find the REAL personalization attribute paths configured in this sandbox instead of ` +
  `guessing. Personalization path rooting rule: ` +
  `(1) Standard XDM profile attributes (person, homeAddress, etc.) → "profile.<field>.<subfield>", e.g. profile.person.name.firstName. ` +
  `(2) Tenant-custom field group attributes → "profile._tenantId.<customField>", e.g. profile._acssandboxustwo.loyaltyTier. ` +
  `Do NOT root standard XDM fields under the tenant namespace — only fields your org added in a custom field group belong there. ` +
  `Recommended discovery workflow: call list_xdm_union_schemas to find the Profile union, get_xdm_union_schema with full=false ` +
  `to get the list of field-group $refs, then get_xdm_field_group (full=true, the default) on each group you need — that returns ` +
  `the full attribute tree for just that group without hitting the 1 MB response cap. ` +
  `Requires the AEP Schema Registry API to be enabled on the credential's Developer Console project (else 403).`;

// ─── list_xdm_schemas ─────────────────────────────────────────────────────────

export const listXdmSchemasDefinition = {
  name: 'list_xdm_schemas',
  title: 'List XDM Schemas',
  outputSchema: buildOutputSchema({ data: LIST_DATA }),
  description: `List or browse XDM schemas in the Experience Platform Schema Registry for the configured sandbox.
Returns concise summaries (title, $id, meta:altId, version). ${PERSONALIZATION_HINT}

Example usage:
- Tenant (custom) schemas: {} or { "container": "tenant" }
- Standard schemas: { "container": "global" }
- Filter by title: { "property": "title~Profile" }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      container: { type: 'string', enum: ['tenant', 'global'], description: 'tenant = customer-defined (default); global = standard XDM' },
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      start: { type: ['string', 'number'], description: 'Pagination cursor from the previous _page.next (the Schema Registry returns a numeric/opaque cursor; pass it back as-is). Note: the content list tools use an opaque base64 string cursor instead.' },
      property: { type: ['string', 'array'], items: { type: 'string' }, description: 'Filter expression(s): a string or an array of strings (same shape as the content list tools), e.g. "title~Loyalty" or ["title~Loyalty"]. Uses the Schema Registry filter grammar.' },
      orderBy: { type: 'string', description: 'Sort field, e.g. "title" or "-meta:created"' }
    }
  }
};

export async function handleListXdmSchemas(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_xdm_schemas', async () => {
    const parsed = ListXdmSchemasSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { container, ...rest } = parsed.data;
      return { success: true, data: await listSchemas(container as Container, rest) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── get_xdm_schema ────────────────────────────────────────────────────────────

export const getXdmSchemaDefinition = {
  name: 'get_xdm_schema',
  title: 'Get XDM Schema',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single XDM schema by ID. By default returns the fully-resolved schema (full=true) with every referenced field group inlined, so you can see the complete property tree and the exact attribute paths to use for personalization. ${PERSONALIZATION_HINT}

Pass the schema's $id or meta:altId (from list_xdm_schemas) as schemaId.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['schemaId'],
    properties: {
      schemaId: { type: 'string', description: 'The $id or meta:altId of the schema' },
      container: { type: 'string', enum: ['tenant', 'global'], description: 'Defaults to tenant' },
      full: { type: 'boolean', description: 'true (default) = fully resolved with all field groups inlined; false = unresolved definition' }
    }
  }
};

export async function handleGetXdmSchema(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_xdm_schema', async () => {
    const parsed = GetXdmSchemaSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { container, schemaId, full } = parsed.data;
      const data = await getSchema(container as Container, schemaId, full);
      const tooBig = oversizeError({ success: true, data }, 'Re-run with full=false to get the field-group $refs, then call get_xdm_field_group (full=true) on each group you need.');
      if (tooBig) return tooBig;
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── list_xdm_field_groups ──────────────────────────────────────────────────────

export const listXdmFieldGroupsDefinition = {
  name: 'list_xdm_field_groups',
  title: 'List XDM Field Groups',
  outputSchema: buildOutputSchema({ data: LIST_DATA }),
  description: `List or browse XDM field groups (the building blocks that contribute attributes to schemas) in the Schema Registry. Most customers define custom field groups under their tenant namespace — those are where non-default personalization attributes come from. ${PERSONALIZATION_HINT}

Example usage:
- Custom field groups: {} or { "container": "tenant" }
- Standard field groups: { "container": "global" }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      container: { type: 'string', enum: ['tenant', 'global'], description: 'tenant = customer-defined (default); global = standard XDM' },
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      start: { type: ['string', 'number'], description: 'Pagination cursor from the previous _page.next (the Schema Registry returns a numeric/opaque cursor; pass it back as-is). Note: the content list tools use an opaque base64 string cursor instead.' },
      property: { type: ['string', 'array'], items: { type: 'string' }, description: 'Filter expression(s): a string or an array of strings (same shape as the content list tools), e.g. "title~Loyalty" or ["title~Loyalty"]. Uses the Schema Registry filter grammar.' },
      orderBy: { type: 'string', description: 'Sort field' }
    }
  }
};

export async function handleListXdmFieldGroups(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_xdm_field_groups', async () => {
    const parsed = ListXdmFieldGroupsSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { container, ...rest } = parsed.data;
      return { success: true, data: await listFieldGroups(container as Container, rest) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── get_xdm_field_group ─────────────────────────────────────────────────────────

export const getXdmFieldGroupDefinition = {
  name: 'get_xdm_field_group',
  title: 'Get XDM Field Group',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single XDM field group by ID, fully resolved by default (full=true) so you can see every attribute it defines and the exact paths. ${PERSONALIZATION_HINT}

Pass the field group's $id or meta:altId (from list_xdm_field_groups) as fieldGroupId.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['fieldGroupId'],
    properties: {
      fieldGroupId: { type: 'string', description: 'The $id or meta:altId of the field group' },
      container: { type: 'string', enum: ['tenant', 'global'], description: 'Defaults to tenant' },
      full: { type: 'boolean', description: 'true (default) = fully resolved; false = unresolved definition' }
    }
  }
};

export async function handleGetXdmFieldGroup(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_xdm_field_group', async () => {
    const parsed = GetXdmFieldGroupSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { container, fieldGroupId, full } = parsed.data;
      const data = await getFieldGroup(container as Container, fieldGroupId, full);
      const tooBig = oversizeError({ success: true, data }, 'Re-run with full=false to get the unresolved definition (the fully-resolved form is too large to return).');
      if (tooBig) return tooBig;
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── list_xdm_union_schemas ──────────────────────────────────────────────────────

export const listXdmUnionSchemasDefinition = {
  name: 'list_xdm_union_schemas',
  title: 'List XDM Union Schemas',
  outputSchema: buildOutputSchema({ data: LIST_DATA }),
  description: `List or browse XDM union schemas (tenant container). A union is the merged view of every schema that shares a class — e.g. the full Profile union combines all enabled Profile field groups into one schema. This is the single best source of the complete set of attributes available for personalization. ${PERSONALIZATION_HINT}`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      start: { type: ['string', 'number'], description: 'Pagination cursor from the previous _page.next (the Schema Registry returns a numeric/opaque cursor; pass it back as-is). Note: the content list tools use an opaque base64 string cursor instead.' },
      property: { type: ['string', 'array'], items: { type: 'string' }, description: 'Filter expression(s): a string or an array of strings (same shape as the content list tools). Uses the Schema Registry filter grammar.' },
      orderBy: { type: 'string', description: 'Sort field' }
    }
  }
};

export async function handleListXdmUnionSchemas(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_xdm_union_schemas', async () => {
    const parsed = ListXdmUnionSchemasSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      return { success: true, data: await listUnionSchemas(parsed.data) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}

// ─── get_xdm_union_schema ─────────────────────────────────────────────────────────

export const getXdmUnionSchemaDefinition = {
  name: 'get_xdm_union_schema',
  title: 'Get XDM Union Schema',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single XDM union schema by ID. Defaults to full=false (the unresolved form with field-group $refs) because fully-resolved Profile unions routinely exceed the 1 MB tool-result cap on real sandboxes and return a hard error instead of data. Use full=false first to get the list of field-group $refs, then call get_xdm_field_group (full=true) on each group you actually need — that returns the complete attribute tree for one group at a time, within the size limit. Only pass full=true if you know the specific union is small. ${PERSONALIZATION_HINT}

Pass the union's $id or meta:altId (from list_xdm_union_schemas) as unionId.`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['unionId'],
    properties: {
      unionId: { type: 'string', description: 'The $id or meta:altId of the union schema' },
      full: { type: 'boolean', description: 'false (default) = unresolved form with field-group $refs; true = fully resolved (may exceed the 1 MB result cap on real Profile unions)' }
    }
  }
};

export async function handleGetXdmUnionSchema(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_xdm_union_schema', async () => {
    const parsed = GetXdmUnionSchemaSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { unionId, full } = parsed.data;
      const data = await getUnionSchema(unionId, full);
      const tooBig = oversizeError({ success: true, data }, 'Re-run with full=false to get the field-group $refs, then call get_xdm_field_group (full=true) on each one you need.');
      if (tooBig) return tooBig;
      return { success: true, data };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  }, args);
}
