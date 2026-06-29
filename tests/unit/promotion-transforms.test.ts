// Unit tests for the cross-sandbox promotion content transforms (the pure,
// correctness-critical pieces of the promotion engine). The engine's orchestration
// itself drives live AJO/GitHub APIs and is covered by integration testing.

import {
  scanFragmentEmbedsWithNames,
  rewriteFragmentEmbedIds,
  resetSelfFragmentId,
  stripAcrContentStatus
} from '../../src/tools/utils';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('scanFragmentEmbedsWithNames', () => {
  test('captures id, source, and name from an ajo embed helper', () => {
    const body = { html: { body: `<th>{{ fragment id="ajo:${A}" name="Hero" mode="inline" }}</th>` } };
    const refs = scanFragmentEmbedsWithNames(body);
    expect(refs).toEqual([{ reference: `ajo:${A}`, source: 'ajo', id: A, name: 'Hero' }]);
  });

  test('captures aem/external sources and de-duplicates by reference', () => {
    const body = `{{ fragment id="aem:${A}" name="Img" }} and again {{ fragment id="aem:${A}" name="Img" }} and {{ fragment id="external:${B}" name="X" }}`;
    const refs = scanFragmentEmbedsWithNames(body);
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.source).sort()).toEqual(['aem', 'external']);
  });

  test('ignores malformed (prefix-less) helper ids', () => {
    const body = `{{ fragment id="${A}" name="bad" }}`;
    expect(scanFragmentEmbedsWithNames(body)).toEqual([]);
  });

  test('tolerates a missing name attribute', () => {
    const refs = scanFragmentEmbedsWithNames(`{{ fragment id="ajo:${A}" mode="inline" }}`);
    expect(refs).toEqual([{ reference: `ajo:${A}`, source: 'ajo', id: A }]);
  });

  test('ignores a fragment helper with no id attribute', () => {
    expect(scanFragmentEmbedsWithNames(`{{ fragment mode="inline" }}`)).toEqual([]);
  });

  test('de-duplicates repeated ajo references and skips a second malformed', () => {
    const body = `{{ fragment id="ajo:${A}" name="x" }}{{ fragment id="ajo:${A}" name="x" }}{{ fragment id="nope" }}{{ fragment id="nope2" }}`;
    expect(scanFragmentEmbedsWithNames(body)).toEqual([{ reference: `ajo:${A}`, source: 'ajo', id: A, name: 'x' }]);
  });
});

describe('rewriteFragmentEmbedIds', () => {
  test('rewrites only mapped ajo ids and preserves the name attribute', () => {
    const body = { html: { body: `{{ fragment id="ajo:${A}" name="Hero" mode="inline" }}` } };
    const out = rewriteFragmentEmbedIds(body, new Map([[A, C]])) as typeof body;
    expect(out.html.body).toBe(`{{ fragment id="ajo:${C}" name="Hero" mode="inline" }}`);
  });

  test('leaves unmapped ids and non-ajo sources untouched', () => {
    const body = `{{ fragment id="ajo:${A}" name="a" }}{{ fragment id="aem:${B}" name="b" }}`;
    const out = rewriteFragmentEmbedIds(body, new Map([[B, C]])) as string; // B is aem, not ajo
    expect(out).toBe(body); // nothing changes: A unmapped, B is aem
  });

  test('rewrites multiple distinct embeds across nested string leaves', () => {
    const body = { a: `{{ fragment id="ajo:${A}" name="x" }}`, b: { c: `{{ fragment id="ajo:${B}" name="y" }}` } };
    const out = rewriteFragmentEmbedIds(body, new Map([[A, C], [B, A]])) as typeof body;
    expect(out.a).toContain(`ajo:${C}`);
    expect(out.b.c).toContain(`ajo:${A}`);
  });

  test('returns input unchanged for an empty map', () => {
    const body = { x: `{{ fragment id="ajo:${A}" name="x" }}` };
    expect(rewriteFragmentEmbedIds(body, new Map())).toBe(body);
  });

  test('does not mutate the input object', () => {
    const body = { html: `{{ fragment id="ajo:${A}" name="x" }}` };
    rewriteFragmentEmbedIds(body, new Map([[A, C]]));
    expect(body.html).toContain(`ajo:${A}`); // original intact
  });

  test('walks array elements and preserves non-string leaves', () => {
    const body = {
      rows: [
        `{{ fragment id="ajo:${A}" name="x" }}`,
        { count: 3, enabled: true, missing: null }
      ]
    };
    const out = rewriteFragmentEmbedIds(body, new Map([[A, C]])) as typeof body;
    expect(out.rows[0]).toContain(`ajo:${C}`);
    expect(out.rows[1]).toEqual({ count: 3, enabled: true, missing: null });
  });

  test('leaves a string with no helper untouched (fast path)', () => {
    const out = rewriteFragmentEmbedIds({ s: 'plain text, no embeds' }, new Map([[A, C]])) as { s: string };
    expect(out.s).toBe('plain text, no embeds');
  });
});

describe('resetSelfFragmentId', () => {
  test('rewrites a concrete self-reference to the ajo:SELF sentinel', () => {
    const frag = { content: `<div class="acr-fragment" data-fragment-id="ajo:${A}">x</div>` };
    const out = resetSelfFragmentId(frag) as typeof frag;
    expect(out.content).toBe('<div class="acr-fragment" data-fragment-id="ajo:SELF">x</div>');
  });

  test('leaves an existing ajo:SELF untouched and ignores non-self markup', () => {
    const frag = { content: `data-fragment-id="ajo:SELF"`, other: 'no ids here' };
    const out = resetSelfFragmentId(frag) as typeof frag;
    expect(out.content).toBe('data-fragment-id="ajo:SELF"');
    expect(out.other).toBe('no ids here');
  });

  test('rewrites the self-reference inside editorContext wysiwyg too', () => {
    const frag = { editorContext: { 'wysiwyg-content': `<body data-fragment-id="ajo:${B}">` } };
    const out = resetSelfFragmentId(frag) as typeof frag;
    expect(out.editorContext['wysiwyg-content']).toContain('ajo:SELF');
  });
});

describe('stripAcrContentStatus', () => {
  test('removes the acr-content-status meta tag', () => {
    const frag = { content: `<head><meta name="acr-content-status" content="exported"><title>x</title></head>` };
    const out = stripAcrContentStatus(frag) as typeof frag;
    expect(out.content).not.toContain('acr-content-status');
    expect(out.content).toContain('<title>x</title>');
  });

  test('is a no-op when the meta tag is absent', () => {
    const frag = { content: '<head><title>x</title></head>' };
    expect((stripAcrContentStatus(frag) as typeof frag).content).toBe('<head><title>x</title></head>');
  });
});
