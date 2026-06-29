// The source-changed detection that drives promotion idempotency hashes a
// stableStringify of the source content. If key order weren't normalized, an
// unchanged source could hash differently between runs and trigger spurious update
// PRs — so this property is load-bearing.

import { stableStringify } from '../../src/promotion/engine';

describe('stableStringify', () => {
  test('is independent of object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  test('normalizes nested object key order too', () => {
    const x = { outer: { z: 1, a: 2 }, list: [{ q: 1, p: 2 }] };
    const y = { list: [{ p: 2, q: 1 }], outer: { a: 2, z: 1 } };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });

  test('preserves array order (arrays are ordered, not sorted)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  test('distinguishes different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  test('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(42)).toBe('42');
  });
});
