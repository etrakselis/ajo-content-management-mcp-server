import {
  CreateTemplateSchema,
  CreateFragmentSchema,
  PatchRequestSchema,
  CredentialsFileSchema,
  ArchiveFragmentSchema,
  UpdateFragmentSchema
} from '../../src/validation/schemas';

describe('Validation Schemas', () => {

  describe('CreateTemplateSchema', () => {
    test('accepts valid HTML email template', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Test Template',
        templateType: 'html',
        channels: ['email'],
        template: { html: '<html>Hi</html>' }
      });
      expect(result.success).toBe(true);
    });

    test('rejects empty name', () => {
      const result = CreateTemplateSchema.safeParse({
        name: '',
        templateType: 'html',
        channels: ['email']
      });
      expect(result.success).toBe(false);
    });

    test('rejects invalid templateType', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Test',
        templateType: 'invalid_type',
        channels: ['email']
      });
      expect(result.success).toBe(false);
    });

    test('rejects invalid channel', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Test',
        templateType: 'html',
        channels: ['fax']
      });
      expect(result.success).toBe(false);
    });

    test('rejects missing required fields', () => {
      const result = CreateTemplateSchema.safeParse({ name: 'Test' });
      expect(result.success).toBe(false);
    });

    test('accepts code template with subType and a valid body key (html/expression/condition)', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Code Block', templateType: 'content', channels: ['code'],
        subType: 'JSON', template: { expression: '{"k":"v"}' }
      });
      expect(result.success).toBe(true);
    });

    test('rejects code template whose body uses "content" instead of html/expression/condition', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Code Block', templateType: 'content', channels: ['code'],
        subType: 'HTML', template: { content: '<html/>' }
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.errors.find(e => e.path.join('.') === 'template')?.message ?? '';
        expect(msg).toMatch(/html.*expression.*condition/);
        expect(msg).toMatch(/"content" is not a valid key/);
      }
    });

    test('rejects code template missing subType (AJO mandates it)', () => {
      const result = CreateTemplateSchema.safeParse({
        name: 'Code Block', templateType: 'content', channels: ['code'],
        template: { html: '<html/>' }
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateFragmentSchema', () => {
    test('accepts valid HTML fragment', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Header Fragment',
        type: 'html',
        channels: ['email'],
        fragment: { content: '<div>Hello</div>' }
      });
      expect(result.success).toBe(true);
    });

    test('accepts expression fragment with subType', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Greeting',
        type: 'expression',
        channels: ['shared'],
        fragment: { expression: 'Hello {{profile.name}}' },
        subType: 'TEXT'
      });
      expect(result.success).toBe(true);
    });

    test('rejects expression fragment missing subType (AJO mandates it)', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Greeting',
        type: 'expression',
        channels: ['shared'],
        fragment: { expression: 'Hello {{profile.name}}' }
      });
      expect(result.success).toBe(false);
    });

    test('rejects invalid type', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Test',
        type: 'video',
        channels: ['email'],
        fragment: {}
      });
      expect(result.success).toBe(false);
    });

    test('rejects html fragment missing fragment.content', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Test', type: 'html', channels: ['email'], fragment: {}
      });
      expect(result.success).toBe(false);
    });

    test('rejects expression fragment missing fragment.expression', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Test', type: 'expression', channels: ['shared'], fragment: { content: 'wrong key' }
      });
      expect(result.success).toBe(false);
    });

    test('retains subType for expression fragments (no longer stripped)', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Greeting', type: 'expression', channels: ['shared'],
        fragment: { expression: 'Hi {{x}}' }, subType: 'TEXT'
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.subType).toBe('TEXT');
    });

    test('rejects an invalid subType value', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Greeting', type: 'expression', channels: ['shared'],
        fragment: { expression: 'Hi {{x}}' }, subType: 'YAML'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PatchRequestSchema', () => {
    test('accepts valid patch operations', () => {
      const result = PatchRequestSchema.safeParse([
        { op: 'replace', path: '/name', value: 'New Name' },
        { op: 'remove', path: '/description' }
      ]);
      expect(result.success).toBe(true);
    });

    test('rejects invalid op', () => {
      const result = PatchRequestSchema.safeParse([
        { op: 'move', path: '/name', value: 'Test' }
      ]);
      expect(result.success).toBe(false);
    });

    test('rejects empty array', () => {
      const result = PatchRequestSchema.safeParse([]);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateFragmentSchema — source field', () => {
    test('accepts payload without source (optional)', () => {
      const result = UpdateFragmentSchema.safeParse({
        fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d',
        etag: '"v1"',
        name: 'Updated Fragment',
        type: 'html',
        channels: ['email'],
        fragment: { content: '<div>Hi</div>' }
      });
      expect(result.success).toBe(true);
    });

    test('accepts payload with explicit source', () => {
      const result = UpdateFragmentSchema.safeParse({
        fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d',
        etag: '"v1"',
        name: 'Updated Fragment',
        type: 'html',
        channels: ['email'],
        fragment: { content: '<div>Hi</div>' },
        source: { origin: 'external' }
      });
      expect(result.success).toBe(true);
    });

    test('rejects unknown source origin', () => {
      const result = UpdateFragmentSchema.safeParse({
        fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d',
        etag: '"v1"',
        name: 'Updated Fragment',
        type: 'html',
        channels: ['email'],
        fragment: {},
        source: { origin: 'aem' }
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ArchiveFragmentSchema', () => {
    test('accepts valid UUID', () => {
      const result = ArchiveFragmentSchema.safeParse({
        fragmentId: 'b6d70a45-a149-453b-85ba-809a5d40066d'
      });
      expect(result.success).toBe(true);
    });

    test('rejects non-UUID fragmentId', () => {
      const result = ArchiveFragmentSchema.safeParse({ fragmentId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    test('rejects missing fragmentId', () => {
      const result = ArchiveFragmentSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('CredentialsFileSchema', () => {
    test('accepts valid credentials file', () => {
      const result = CredentialsFileSchema.safeParse({
        values: [
          { key: 'API_KEY', value: 'my-key', enabled: true },
          { key: 'IMS_ORG', value: 'org@AdobeOrg', enabled: true },
          { key: 'SCOPES', value: ['openid', 'AdobeID'], enabled: true }
        ],
        name: 'Test Credentials'
      });
      expect(result.success).toBe(true);
    });

    test('rejects missing values array', () => {
      const result = CredentialsFileSchema.safeParse({ name: 'Test' });
      expect(result.success).toBe(false);
    });

    test('accepts flat environment-variable export', () => {
      const result = CredentialsFileSchema.safeParse({
        ORG_ID: 'C735552962AB1A800A495FFD@AdobeOrg',
        CLIENT_SECRETS: ['p8e-secret'],
        CLIENT_ID: '546fc40eb1fa459f936381a4b9585e81',
        SCOPES: ['openid', 'AdobeID', 'read_organizations'],
        TECHNICAL_ACCOUNT_ID: '276381656A3DB8D60A495FC5@techacct.adobe.com',
        TECHNICAL_ACCOUNT_EMAIL: 'e7da6295@techacct.adobe.com'
      });
      expect(result.success).toBe(true);
    });

    test('rejects flat export missing CLIENT_ID', () => {
      const result = CredentialsFileSchema.safeParse({
        ORG_ID: 'org@AdobeOrg',
        CLIENT_SECRETS: ['secret']
      });
      expect(result.success).toBe(false);
    });
  });
});
