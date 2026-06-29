/**
 * Unit tests for the recursive secret-redaction used by the structured logger.
 * The prior scrub only masked top-level keys; these lock in that credentials are
 * redacted at any nesting depth and inside arrays, that benign keys survive, and
 * that the walk is cycle-safe.
 */

import { redactSecrets } from '../../src/telemetry/index';

describe('redactSecrets', () => {
  test('redacts sensitive keys at the top level', () => {
    const out = redactSecrets({
      token: 'abc', client_secret: 's', authorization: 'Bearer x', password: 'p', pat: 'ghp_x',
      sandbox: 'sb'
    });
    expect(out).toEqual({
      token: '[REDACTED]', client_secret: '[REDACTED]', authorization: '[REDACTED]',
      password: '[REDACTED]', pat: '[REDACTED]', sandbox: 'sb'
    });
  });

  test('redacts sensitive keys nested inside objects and arrays', () => {
    const out = redactSecrets({
      config: { github: { token: 'ghp_secret', owner: 'me' } },
      creds: [{ clientSecret: 'x' }, { accessToken: 'y', name: 'ok' }]
    }) as Record<string, any>;
    expect(out.config.github).toEqual({ token: '[REDACTED]', owner: 'me' });
    expect(out.creds[0]).toEqual({ clientSecret: '[REDACTED]' });
    expect(out.creds[1]).toEqual({ accessToken: '[REDACTED]', name: 'ok' });
  });

  test('matches case-insensitively and on common variants (CLIENT_SECRET, refreshToken)', () => {
    const out = redactSecrets({ CLIENT_SECRET: 's', refreshToken: 'r', X_API_TOKEN: 't' }) as Record<string, string>;
    expect(out).toEqual({ CLIENT_SECRET: '[REDACTED]', refreshToken: '[REDACTED]', X_API_TOKEN: '[REDACTED]' });
  });

  test('does NOT over-redact benign keys (tokenCached, apiVersion, description)', () => {
    const out = redactSecrets({ tokenCached: true, apiVersion: '1.0', description: 'a secret recipe' }) as Record<string, unknown>;
    // tokenCached ends with "cached", not "token"; apiVersion/description aren't sensitive
    // (a string VALUE mentioning "secret" is never redacted — only KEY names are).
    expect(out).toEqual({ tokenCached: true, apiVersion: '1.0', description: 'a secret recipe' });
  });

  test('leaves primitives and Error objects intact', () => {
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    const err = new Error('boom');
    expect(redactSecrets(err)).toBe(err);
  });

  test('is cycle-safe (no infinite recursion)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redactSecrets(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });

  test('does not mutate the input', () => {
    const input = { token: 'abc', nested: { secret: 's' } };
    redactSecrets(input);
    expect(input.token).toBe('abc');
    expect(input.nested.secret).toBe('s');
  });
});
