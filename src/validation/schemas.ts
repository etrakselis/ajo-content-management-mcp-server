import { z } from 'zod';

// ─── Common ───────────────────────────────────────────────────────────────────

export const UuidSchema = z.string().uuid('Must be a valid UUID');
export const EtagSchema = z.string().min(1, 'ETag is required');

// Supported FIQL operators for the content-list `property` filter, longest-first
// so "~^" is recognized before "~". A filter expression that uses none of these
// is silently ignored by the AJO API (it returns an unfiltered list), so we
// reject it here loudly instead of letting the model reason over the wrong rows.
const FIQL_OPERATORS = ['=ge=', '=le=', '=gt=', '=lt=', '==', '!=', '~^', '~'];

const FiqlExpressionSchema = z.string().refine(
  (s) => FIQL_OPERATORS.some((op) => {
    const i = s.indexOf(op);
    return i > 0 && i + op.length < s.length; // non-empty field and value around the operator
  }),
  (s) => ({
    message: `Filter "${s}" is not a valid FIQL expression. Use field<operator>value with one of: ` +
      `== (equals), != (not equals), ~^ (starts with), ~ (contains). E.g. "name~^Welcome" or "status==PUBLISHED".`
  })
);

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  start: z.string().optional(),
  orderBy: z.string().optional(),
  property: z.array(FiqlExpressionSchema).optional()
});

export const PatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.string().min(1),
  value: z.unknown().optional(),
  from: z.string().optional()
});

export const PatchRequestSchema = z.array(PatchOpSchema).min(1);

// ─── Templates ───────────────────────────────────────────────────────────────

const TemplateChannelEnum = z.enum(['email', 'push', 'inapp', 'sms', 'code', 'directMail', 'landingpage', 'shared']);
const TemplateTypeEnum = z.enum(['html', 'html_primary_page', 'html_sub_page', 'content']);
const TemplateSubTypeEnum = z.enum(['HTML', 'JSON']);

// AJO mandates a subType for code-channel templates (HTML vs JSON tells it how to
// interpret the raw content). Enforce it here so the model gets a clear, early
// error instead of an opaque API rejection.
function checkTemplateSubType(
  data: { channels: string[]; subType?: 'HTML' | 'JSON' },
  ctx: z.RefinementCtx
): void {
  if (data.channels?.includes('code') && !data.subType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subType'], message: 'code channel templates require subType (HTML | JSON)' });
  }
}

// Enforce the per-(channel, templateType) `template` content shape server-side,
// pre-write, with a field-level message naming the expected type — so the common
// mistakes (e.g. email "content" with template.html as a STRING instead of
// { body }) are caught here instead of bouncing off AJO with an opaque
// "template body is not valid" 400. Only `shared` stays free-form (provider-
// defined); `code` is validated against the keys AJO actually accepts.
function checkTemplateContentShape(
  data: { channels: string[]; templateType: string; template?: Record<string, unknown> },
  ctx: z.RefinementCtx
): void {
  const channel = data.channels?.[0];
  const tt = data.templateType;
  const t = data.template;
  if (!channel || channel === 'shared') return;

  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

  if (t === undefined || t === null) {
    issue(['template'], `template content is required for the "${channel}" channel.`);
    return;
  }

  switch (channel) {
    case 'email':
      if (tt === 'content') {
        if (typeof t.subject !== 'string' || !t.subject) {
          issue(['template', 'subject'], 'email "content" templates require template.subject (a string).');
        }
        if (!isObj(t.html) || typeof t.html.body !== 'string') {
          issue(['template', 'html'], 'email "content" templates require template.html to be an object { body: string }, not a string. (The bare-string form is templateType "html".)');
        }
      } else if (tt === 'html') {
        if (typeof t.html !== 'string') {
          issue(['template', 'html'], 'email "html" templates require template.html to be a string. (The { body } object form is templateType "content".)');
        }
      }
      break;
    case 'landingpage':
      if (typeof t.html !== 'string') {
        issue(['template', 'html'], 'landingpage templates require template.html to be a string.');
      }
      break;
    case 'sms':
      if (typeof t.text !== 'string' || !t.text) {
        issue(['template', 'text'], 'sms templates require template.text (a string). Note the body field is "text", not "body".');
      }
      break;
    case 'inapp':
      if (!isObj(t.body) || typeof t.body.html !== 'string') {
        issue(['template', 'body'], 'inapp templates require template.body to be an object { html: string }.');
      }
      break;
    case 'directMail':
      if (typeof t.fileName !== 'string' || !t.fileName) {
        issue(['template', 'fileName'], 'directMail templates require template.fileName (a string).');
      }
      break;
    case 'push':
      if (typeof t.title !== 'string' && typeof t.message !== 'string') {
        issue(['template'], 'push templates require at least template.title or template.message (a string).');
      }
      break;
    case 'code':
      // AJO's code-channel body accepts one of html / expression / condition
      // (NOT "content"). Mirror that so the caller gets a precise client-side
      // message instead of an opaque JOMAL-1000 / CJMMAS-1079 after the round trip.
      if (!['html', 'expression', 'condition'].some(k => t[k] !== undefined)) {
        const hint = t.content !== undefined
          ? ' "content" is not a valid key for code templates.'
          : '';
        issue(['template'], `code templates require one of template.html, template.expression, or template.condition (per subType).${hint}`);
      }
      break;
  }
}

export const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  description: z.string().optional(),
  templateType: TemplateTypeEnum,
  channels: z.array(TemplateChannelEnum).min(1).max(1),
  source: z.object({
    origin: z.enum(['ajo', 'aem', 'external']),
    metadata: z.record(z.unknown()).optional()
  }).optional(),
  subType: TemplateSubTypeEnum.optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  template: z.record(z.unknown()).optional()
}).superRefine(checkTemplateSubType).superRefine(checkTemplateContentShape);

export const GetTemplateSchema = z.object({
  templateId: UuidSchema
});

export const UpdateTemplateSchema = z.object({
  templateId: UuidSchema,
  etag: EtagSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  templateType: TemplateTypeEnum,
  channels: z.array(TemplateChannelEnum).min(1).max(1),
  source: z.object({
    origin: z.enum(['ajo', 'aem', 'external']),
    metadata: z.record(z.unknown()).optional()
  }).optional(),
  subType: TemplateSubTypeEnum.optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  template: z.record(z.unknown()).optional()
}).superRefine(checkTemplateSubType).superRefine(checkTemplateContentShape);

export const PatchTemplateSchema = z.object({
  templateId: UuidSchema,
  etag: EtagSchema,
  patches: PatchRequestSchema
});

export const DeleteTemplateSchema = z.object({
  templateId: UuidSchema
});

export const ListTemplatesSchema = PaginationSchema;

// ─── Fragments ────────────────────────────────────────────────────────────────

const FragmentTypeEnum = z.enum(['html', 'expression']);
const FragmentChannelEnum = z.enum(['email', 'shared']);
const FragmentSubTypeEnum = z.enum(['TEXT', 'HTML', 'JSON']);

// Enforce the content shape that the tool inputSchema advertises as a oneOf:
// html fragments must carry fragment.content, expression fragments must carry
// fragment.expression. AJO also mandates a subType for expression fragments, so
// require it here too. Catches a wrong-shaped payload (with a clear path) instead
// of letting it through to a less helpful AJO API rejection.
function checkFragmentContentShape(
  data: { type: 'html' | 'expression'; fragment: Record<string, unknown>; subType?: 'TEXT' | 'HTML' | 'JSON' },
  ctx: z.RefinementCtx
): void {
  if (data.type === 'html' && typeof data.fragment?.content !== 'string') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fragment', 'content'], message: 'html fragments require fragment.content (a string)' });
  }
  if (data.type === 'expression') {
    if (typeof data.fragment?.expression !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fragment', 'expression'], message: 'expression fragments require fragment.expression (a string)' });
    }
    if (!data.subType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subType'], message: 'expression fragments require subType (TEXT | HTML | JSON)' });
    }
  }
}

export const CreateFragmentSchema = z.object({
  name: z.string().min(1, 'Fragment name is required').max(255),
  description: z.string().optional(),
  type: FragmentTypeEnum,
  channels: z.array(FragmentChannelEnum).min(1).max(1),
  source: z.object({
    origin: z.enum(['ajo', 'external']),
    metadata: z.record(z.unknown()).optional()
  }).optional(),
  subType: FragmentSubTypeEnum.optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  fragment: z.record(z.unknown())
}).superRefine(checkFragmentContentShape);

export const GetFragmentSchema = z.object({
  fragmentId: UuidSchema
});

export const UpdateFragmentSchema = z.object({
  fragmentId: UuidSchema,
  etag: EtagSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: FragmentTypeEnum,
  channels: z.array(FragmentChannelEnum).min(1).max(1),
  source: z.object({
    origin: z.enum(['ajo', 'external']),
    metadata: z.record(z.unknown()).optional()
  }).optional(),
  subType: FragmentSubTypeEnum.optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  fragment: z.record(z.unknown())
}).superRefine(checkFragmentContentShape);

export const PatchFragmentSchema = z.object({
  fragmentId: UuidSchema,
  etag: EtagSchema,
  patches: PatchRequestSchema
});

export const PublishFragmentSchema = z.object({
  fragmentId: UuidSchema
});

export const GetLiveFragmentSchema = z.object({
  fragmentId: UuidSchema
});

export const GetPublicationStatusSchema = z.object({
  fragmentId: UuidSchema
});

export const ArchiveFragmentSchema = z.object({
  fragmentId: UuidSchema
});

export const ListFragmentsSchema = PaginationSchema;

// ─── Credentials File Schema ──────────────────────────────────────────────────

export const CredentialValueSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  enabled: z.boolean().optional()
});

export const CredentialsFileSchema = z.object({
  values: z.array(CredentialValueSchema),
  name: z.string().optional()
});

// ─── Schema Registry (XDM) ──────────────────────────────────────────────────

const SrContainerSchema = z.enum(['tenant', 'global']).optional().default('tenant');
const SrListBase = {
  limit: z.number().int().min(1).max(1000).optional(),
  // Accept the same array-of-strings shape the content list tools use, so a model
  // that learned `property` there can reuse it here without a type error; a bare
  // string is still accepted. (The Schema Registry uses its own filter grammar,
  // not AJO FIQL, so the content FIQL-operator check is not applied here.)
  property: z.union([z.string(), z.array(z.string())]).optional(),
  orderBy: z.string().optional(),
  start: z.union([z.string(), z.number()]).optional()
};

export const ListXdmSchemasSchema = z.object({ container: SrContainerSchema, ...SrListBase });
export const ListXdmFieldGroupsSchema = z.object({ container: SrContainerSchema, ...SrListBase });
export const ListXdmUnionSchemasSchema = z.object({ ...SrListBase }); // unions are tenant-only

export const GetXdmSchemaSchema = z.object({
  container: SrContainerSchema,
  schemaId: z.string().min(1, 'schemaId is required'),
  full: z.boolean().optional().default(true)
});
export const GetXdmFieldGroupSchema = z.object({
  container: SrContainerSchema,
  fieldGroupId: z.string().min(1, 'fieldGroupId is required'),
  full: z.boolean().optional().default(true)
});
export const GetXdmUnionSchemaSchema = z.object({
  unionId: z.string().min(1, 'unionId is required'),
  // Default false: the fully-resolved Profile union routinely exceeds the 1 MB
  // tool-result cap on real sandboxes, returning a hard error instead of data.
  // Start with full=false to get the field-group $ref list, then resolve each
  // group you need via get_xdm_field_group.
  full: z.boolean().optional().default(false)
});
