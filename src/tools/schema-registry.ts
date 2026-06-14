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
import { notConfiguredError, validationError, withTelemetry } from './utils.js';

const PERSONALIZATION_HINT =
  `Use these to find the REAL personalization attribute paths configured in this sandbox instead of ` +
  `guessing default XDM fields. Custom attributes live under the tenant namespace key (e.g. "_yourtenant") ` +
  `in the schema's "properties" tree; that nesting path is what you reference in personalization expressions. ` +
  `Requires the AEP Schema Registry API to be enabled on the credential's Developer Console project (else 403).`;

// ─── list_xdm_schemas ─────────────────────────────────────────────────────────

export const listXdmSchemasDefinition = {
  name: 'list_xdm_schemas',
  description: `List XDM schemas in the Experience Platform Schema Registry for the configured sandbox.
Returns concise summaries (title, $id, meta:altId, version). ${PERSONALIZATION_HINT}

Example usage:
- Tenant (custom) schemas: {} or { "container": "tenant" }
- Standard schemas: { "container": "global" }
- Filter by title: { "property": "title~Profile" }`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      container: { type: 'string', enum: ['tenant', 'global'], description: 'tenant = customer-defined (default); global = standard XDM' },
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      property: { type: 'string', description: 'Filter expression, e.g. "title~Loyalty"' },
      orderby: { type: 'string', description: 'Sort field, e.g. "title" or "-meta:created"' }
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
  });
}

// ─── get_xdm_schema ────────────────────────────────────────────────────────────

export const getXdmSchemaDefinition = {
  name: 'get_xdm_schema',
  description: `Retrieve a single XDM schema by ID. By default returns the fully-resolved schema (full=true) with every referenced field group inlined, so you can see the complete property tree and the exact attribute paths to use for personalization. ${PERSONALIZATION_HINT}

Pass the schema's $id or meta:altId (from list_xdm_schemas) as schemaId.`,
  annotations: { readOnlyHint: true },
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
      return { success: true, data: await getSchema(container as Container, schemaId, full) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── list_xdm_field_groups ──────────────────────────────────────────────────────

export const listXdmFieldGroupsDefinition = {
  name: 'list_xdm_field_groups',
  description: `List XDM field groups (the building blocks that contribute attributes to schemas) in the Schema Registry. Most customers define custom field groups under their tenant namespace — those are where non-default personalization attributes come from. ${PERSONALIZATION_HINT}

Example usage:
- Custom field groups: {} or { "container": "tenant" }
- Standard field groups: { "container": "global" }`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      container: { type: 'string', enum: ['tenant', 'global'], description: 'tenant = customer-defined (default); global = standard XDM' },
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      property: { type: 'string', description: 'Filter expression, e.g. "title~Loyalty"' },
      orderby: { type: 'string', description: 'Sort field' }
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
  });
}

// ─── get_xdm_field_group ─────────────────────────────────────────────────────────

export const getXdmFieldGroupDefinition = {
  name: 'get_xdm_field_group',
  description: `Retrieve a single XDM field group by ID, fully resolved by default (full=true) so you can see every attribute it defines and the exact paths. ${PERSONALIZATION_HINT}

Pass the field group's $id or meta:altId (from list_xdm_field_groups) as fieldGroupId.`,
  annotations: { readOnlyHint: true },
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
      return { success: true, data: await getFieldGroup(container as Container, fieldGroupId, full) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}

// ─── list_xdm_union_schemas ──────────────────────────────────────────────────────

export const listXdmUnionSchemasDefinition = {
  name: 'list_xdm_union_schemas',
  description: `List XDM union schemas (tenant container). A union is the merged view of every schema that shares a class — e.g. the full Profile union combines all enabled Profile field groups into one schema. This is the single best source of the complete set of attributes available for personalization. ${PERSONALIZATION_HINT}`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      limit: { type: 'number', description: 'Max items to return (1-1000)' },
      property: { type: 'string', description: 'Filter expression' },
      orderby: { type: 'string', description: 'Sort field' }
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
  });
}

// ─── get_xdm_union_schema ─────────────────────────────────────────────────────────

export const getXdmUnionSchemaDefinition = {
  name: 'get_xdm_union_schema',
  description: `Retrieve a single XDM union schema by ID, fully resolved by default (full=true). The resolved Profile union is the complete attribute set available for personalization in this sandbox — read its "properties" tree to find real attribute paths (custom ones nested under the tenant namespace key). ${PERSONALIZATION_HINT}

Pass the union's $id or meta:altId (from list_xdm_union_schemas) as unionId.`,
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['unionId'],
    properties: {
      unionId: { type: 'string', description: 'The $id or meta:altId of the union schema' },
      full: { type: 'boolean', description: 'true (default) = fully resolved; false = unresolved definition' }
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
      return { success: true, data: await getUnionSchema(unionId, full) };
    } catch (err) {
      return { success: false, error: buildError(err) };
    }
  });
}
