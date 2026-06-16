import { z } from 'zod';

// ─── Common ───────────────────────────────────────────────────────────────────

export const UuidSchema = z.string().uuid('Must be a valid UUID');
export const EtagSchema = z.string().min(1, 'ETag is required');

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  start: z.string().optional(),
  orderBy: z.string().optional(),
  property: z.array(z.string()).optional()
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
}).superRefine(checkTemplateSubType);

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
}).superRefine(checkTemplateSubType);

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
  property: z.string().optional(),
  orderby: z.string().optional()
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
  full: z.boolean().optional().default(true)
});
