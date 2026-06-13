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
});

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
});

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

export const CreateFragmentSchema = z.object({
  name: z.string().min(1, 'Fragment name is required').max(255),
  description: z.string().optional(),
  type: FragmentTypeEnum,
  channels: z.array(FragmentChannelEnum).min(1).max(1),
  source: z.object({
    origin: z.enum(['ajo', 'external']),
    metadata: z.record(z.unknown()).optional()
  }).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  fragment: z.record(z.unknown())
});

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
  parentFolderId: z.string().uuid().nullable().optional(),
  fragment: z.record(z.unknown())
});

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
