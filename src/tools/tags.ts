import { buildError, isClientConfigured } from '../adobe/client.js';
import {
  listTagCategories, getTagCategory,
  listTags, createTag, getTag, updateTag, deleteTag, validateTags,
  type TagPatchOp
} from '../adobe/unified-tags-client.js';
import {
  ListTagCategoriesSchema, GetTagCategorySchema,
  ListTagsSchema, CreateTagSchema, GetTagSchema, UpdateTagSchema, DeleteTagSchema, ValidateTagsSchema
} from '../validation/schemas.js';
import { notConfiguredError, validationError, withTelemetry, buildOutputSchema, DATA_OBJECT } from './utils.js';

// Shared note appended to every tag tool description.
const TAG_HINT =
  `Tags classify business objects for discovery; tag categories group related tags into meaningful sets. ` +
  `A tag belongs to exactly one category (the "Uncategorized" category if none is given at create time). ` +
  `Requires the Unified Tags/Folders API to be enabled on the credential's Developer Console project (else 403).`;

// NOTE: tag CATEGORY mutation (create/update/delete) is intentionally NOT exposed by
// this server — those operations require system/product administrator privileges that
// the typical MCP principal does not have, so they would only ever return 403. The
// read-only category tools (list_tag_categories / get_tag_category) remain. Tags
// themselves are fully managed; new tags land in "Uncategorized" by default.

// Map an upstream tag error to an actionable, tag-specific message. buildError appends
// content-tool stale-etag guidance to every 409 (naming get_content_template /
// get_content_fragment) — meaningless for a tag, so strip that bleed — then attach
// hints for the tag-specific failure modes the backend reports on delete/update.
function tagError(err: unknown) {
  const e = buildError(err);
  // Remove the "(Stale etag: … get_content_template / get_content_fragment …)" tail
  // the shared 409 handler adds; a tag is neither a template nor a fragment.
  e.message = e.message.replace(/\s*\(Stale etag:[\s\S]*?\)/, '').trimEnd();
  if (/associated tag count is not zero/i.test(e.message)) {
    e.message += ' This tag is still applied to content; remove it from every fragment/template that references it ' +
      '(patch_content_fragment / patch_content_template, resending /tagIds without this tag) before deleting it.';
  } else if (/not archived/i.test(e.message)) {
    e.message += ' AJO requires a tag to be archived before it can be deleted: call update_tag with archived: true first, ' +
      'then retry delete_tag (also make sure the tag is no longer applied to any content).';
  } else if (e.code === 'FORBIDDEN' && /privilege|category/i.test(e.message)) {
    e.message += ' Placing a tag in a custom category requires system/product administrator privileges; create the tag in ' +
      'the default "Uncategorized" category instead (omit tagCategoryId).';
  }
  return e;
}

// Shared list-query input properties (tags + tag categories share this grammar).
// `property` here is a filter attribute, NOT the FIQL grammar used by the content
// list tools — keep them distinct in the model's mind.
const TAG_LIST_PROPS = {
  start: { type: 'string' as const, description: 'Pagination start index/cursor from a previous page.' },
  limit: { type: 'number' as const, description: 'Max items per page (1-1000).' },
  property: { type: ['string', 'array'] as const, items: { type: 'string' as const }, description: 'Filter attribute(s), e.g. "tagCategoryId=<id>", "name", or "archived". A string or array of strings. NOT FIQL (that grammar is only for the content list tools).' },
  sortBy: { type: 'string' as const, description: 'Sort field: name | createdAt | modifiedAt.' },
  sortOrder: { type: 'string' as const, enum: ['asc', 'desc'], description: 'Sort direction. Optional — defaults to "asc" when sortBy is set, so you can pass sortBy on its own.' }
};

// ─── list_tag_categories ───────────────────────────────────────────────────────

export const listTagCategoriesDefinition = {
  name: 'list_tag_categories',
  title: 'List Tag Categories',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `List the tag categories in the organization. ${TAG_HINT}

Example usage:
- All categories: {}
- Sorted by name: { "sortBy": "name", "sortOrder": "asc" }

Returns: { success: true, data: { _page: { count, limit }, tags: [{ id, name, description, tagCount, ... }] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: { type: 'object' as const, additionalProperties: false, properties: TAG_LIST_PROPS }
};

export async function handleListTagCategories(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_tag_categories', async () => {
    const parsed = ListTagCategoriesSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      return { success: true, data: await listTagCategories(parsed.data) };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── get_tag_category ────────────────────────────────────────────────────────

export const getTagCategoryDefinition = {
  name: 'get_tag_category',
  title: 'Get Tag Category',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single tag category by ID. ${TAG_HINT}

Example usage: { "tagCategoryId": "e2b7c656-067b-4413-a366-adde0401df50" }

Returns: { success: true, data: { id, name, description, tagCount, ... } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['tagCategoryId'],
    properties: { tagCategoryId: { type: 'string', description: 'The tag category ID.' } }
  }
};

export async function handleGetTagCategory(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_tag_category', async () => {
    const parsed = GetTagCategorySchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getTagCategory(parsed.data.tagCategoryId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── list_tags ─────────────────────────────────────────────────────────────────

export const listTagsDefinition = {
  name: 'list_tags',
  title: 'List Tags',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `List or filter tags in the organization. ${TAG_HINT}

Example usage:
- All tags: {}
- Tags in one category: { "property": "tagCategoryId=e2b7c656-067b-4413-a366-adde0401df50" }
- Non-archived, sorted: { "property": "archived=false", "sortBy": "name", "sortOrder": "asc" }

Returns: { success: true, data: { _page: { count, limit, next }, tags: [{ id, name, tagCategoryId, archived, ... }] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: { type: 'object' as const, additionalProperties: false, properties: TAG_LIST_PROPS }
};

export async function handleListTags(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('list_tags', async () => {
    const parsed = ListTagsSchema.safeParse(args ?? {});
    if (!parsed.success) return validationError(parsed.error);
    try {
      return { success: true, data: await listTags(parsed.data) };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── create_tag ────────────────────────────────────────────────────────────────

export const createTagDefinition = {
  name: 'create_tag',
  title: 'Create Tag',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Create a tag. Pass tagCategoryId to place it in a specific category; omit it to create the tag under the "Uncategorized" category. ${TAG_HINT}

Omitting tagCategoryId (→ "Uncategorized") is the path that does NOT require administrator privileges — prefer it unless the user specifically needs a custom category. Placing a tag in a custom category requires system/product admin rights (otherwise 403). Tag categories themselves are admin-managed and this server does not expose creating/updating/deleting them — only list_tag_categories / get_tag_category for discovery.

Example usage:
- Uncategorized (no admin rights needed): { "name": "summer-sale" }
- Categorized: { "name": "summer-sale", "tagCategoryId": "e2b7c656-..." }

Returns: { success: true, data: { id, name, tagCategoryId, archived, ... } }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'The name of the tag.' },
      tagCategoryId: { type: 'string', description: 'Optional category to place the tag in. Omit for "Uncategorized".' }
    }
  }
};

export async function handleCreateTag(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('create_tag', async () => {
    const parsed = CreateTagSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { name, tagCategoryId } = parsed.data;
      const data = await createTag({ name, ...(tagCategoryId ? { tagCategoryId } : {}) });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── get_tag ─────────────────────────────────────────────────────────────────

export const getTagDefinition = {
  name: 'get_tag',
  title: 'Get Tag',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Retrieve a single tag by ID. ${TAG_HINT}

Example usage: { "tagId": "8af14b1e-f267-44ad-b94c-9ac70274e3d5" }

Returns: { success: true, data: { id, name, tagCategoryId, tagCategoryName, archived, ... } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['tagId'],
    properties: { tagId: { type: 'string', description: 'The tag ID.' } }
  }
};

export async function handleGetTag(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('get_tag', async () => {
    const parsed = GetTagSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await getTag(parsed.data.tagId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── update_tag ────────────────────────────────────────────────────────────────

export const updateTagDefinition = {
  name: 'update_tag',
  title: 'Update Tag',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Update a tag: rename it (name), archive/unarchive it (archived), and/or move it to another category (tagCategoryId). Provide at least one field to change; omitted fields are left untouched. ${TAG_HINT}

All provided fields are sent together in one PATCH as a list of JSON-Patch replace operations. archive/unarchive uses the boolean archived (the server sends it in the string form the API expects). Moving a tag into a CUSTOM category requires system/product administrator privileges (otherwise 403); archiving and renaming do not.

Example usage:
- Rename: { "tagId": "8af14b1e-...", "name": "summer-sale-2026" }
- Archive: { "tagId": "8af14b1e-...", "archived": true }  ← archive a tag before deleting it (see delete_tag)
- Move: { "tagId": "8af14b1e-...", "tagCategoryId": "e2b7c656-..." }  (admin only)

Returns: { success: true, data: { id, name, archived, tagCategoryId, ... } }`,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['tagId'],
    properties: {
      tagId: { type: 'string', description: 'The tag ID.' },
      name: { type: 'string', description: 'New name (optional).' },
      archived: { type: 'boolean', description: 'Set true to archive the tag, false to unarchive (optional).' },
      tagCategoryId: { type: 'string', description: 'Move the tag to this category (optional).' }
    }
  }
};

export async function handleUpdateTag(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('update_tag', async () => {
    const parsed = UpdateTagSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { tagId, name, archived, tagCategoryId } = parsed.data;
      // Build a JSON-Patch op per supplied field: op "replace", `value` is a STRING,
      // and the allowed paths are "name" / "archived" / "tagCategoryId" with NO leading
      // slash (matching the backend's accepted literals and its "only name, archived and
      // tagCategoryId update is allowed" message). The client sends these as a bare
      // array; the experience.adobe.io gateway adds the { patchRequestList: [...] }
      // envelope the backend expects (see updateTag in unified-tags-client).
      const ops: TagPatchOp[] = [];
      if (name !== undefined) ops.push({ op: 'replace', path: 'name', value: name });
      if (archived !== undefined) ops.push({ op: 'replace', path: 'archived', value: String(archived) });
      if (tagCategoryId !== undefined) ops.push({ op: 'replace', path: 'tagCategoryId', value: tagCategoryId });
      const data = await updateTag(tagId, ops);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── delete_tag ────────────────────────────────────────────────────────────────

export const deleteTagDefinition = {
  name: 'delete_tag',
  title: 'Delete Tag',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Delete a tag. ⚠ Irreversible — confirm with the user first. (To keep a tag but hide it from active use, archive it via update_tag with archived: true instead.) ${TAG_HINT}

PRECONDITIONS (AJO enforces these, returning errors otherwise):
1. The tag must NOT be applied to any content — otherwise 403 "Associated Tag Count is not Zero". Remove it from the tagIds of every referencing fragment/template first (patch_content_fragment / patch_content_template, resending /tagIds without this tag).
2. The tag must be ARCHIVED first — otherwise 409 "Tag is not archived". Call update_tag with archived: true, then delete.
So the full teardown order is: clear associations → update_tag { archived: true } → delete_tag.

Example usage: { "tagId": "8af14b1e-..." }

Returns: { success: true, data: {} }`,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['tagId'],
    properties: { tagId: { type: 'string', description: 'The tag ID to delete.' } }
  }
};

export async function handleDeleteTag(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('delete_tag', async () => {
    const parsed = DeleteTagSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const data = await deleteTag(parsed.data.tagId);
      // A successful DELETE returns 200 with an empty body, which axios surfaces as an
      // empty STRING. Returning that as `data` violates the declared object-typed
      // outputSchema and strict clients reject the (otherwise successful) result as a
      // generic "Tool execution failed". Coerce any non-object body to {}.
      return { success: true, data: data && typeof data === 'object' ? data : {} };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}

// ─── validate_tags ─────────────────────────────────────────────────────────────

export const validateTagsDefinition = {
  name: 'validate_tags',
  title: 'Validate Tags',
  outputSchema: buildOutputSchema({ data: DATA_OBJECT }),
  description: `Validate a set of tag IDs, returning which are valid and which are invalid. Read-only — performs no change. Useful before applying tag references to content. ${TAG_HINT}

Example usage: { "ids": ["2bd5ddd9-7284-4767-81d9-c75b122f2a6a", "invalid-tag"] }

Returns: { success: true, data: { validTags: [{ id }], invalidTags: [{ id }] } }`,
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['ids'],
    properties: {
      ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The tag IDs to validate.' },
      entity: { type: 'string', description: 'Optional identifier of the entity requesting validation (e.g. an API key).' }
    }
  }
};

export async function handleValidateTags(args: unknown) {
  if (!isClientConfigured()) return notConfiguredError();
  return withTelemetry('validate_tags', async () => {
    const parsed = ValidateTagsSchema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const { ids, entity } = parsed.data;
      const data = await validateTags({ ids, ...(entity !== undefined ? { entity } : {}) });
      return { success: true, data };
    } catch (err) {
      return { success: false, error: tagError(err) };
    }
  });
}
