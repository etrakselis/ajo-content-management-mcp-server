import {
  CreateTemplateSchema,
  CreateFragmentSchema,
  PatchRequestSchema,
  CredentialsFileSchema
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

    test('accepts expression fragment', () => {
      const result = CreateFragmentSchema.safeParse({
        name: 'Greeting',
        type: 'expression',
        channels: ['shared'],
        fragment: { expression: 'Hello {{profile.name}}' }
      });
      expect(result.success).toBe(true);
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
  });
});
