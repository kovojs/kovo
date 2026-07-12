/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ComponentXmlError,
  parseComponentXml,
  renderRegistry,
  renderTree,
  type ComponentNode,
  type ComponentRegistry,
} from './render-tree.js';
import { s } from './schema.js';

// A component that emits its prop into an ATTRIBUTE (the JSX runtime escapes/URL-checks
// attributes; SPEC §4.8) and re-emits walker-escaped children verbatim.
const Callout = component({
  render: ({ title }: { title: string }, _state, { children }: { children?: unknown }) => (
    <section data-title={title}>{children}</section>
  ),
});

const Link = component({
  render: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
});

const Badge = component({
  render: ({ count }: { count: number }) => <span data-count={count} />,
});

const calloutProps = s.object({ title: s.string() });
const linkProps = s.object({ href: s.string(), label: s.string() });
const badgeProps = s.object({ count: s.number().default(0) });

const registry = renderRegistry({
  'kovo-callout': { component: Callout, props: calloutProps },
  'kovo-link': { component: Link, props: linkProps },
  'kovo-badge': { component: Badge, props: badgeProps },
  // bare component (no schema) — attributes pass through as strings, still attribute-escaped.
  'kovo-note': Callout,
});

const nativeArrayJoin = Array.prototype.join;
const nativeMapGet = Map.prototype.get;
const nativeStringSlice = String.prototype.slice;

afterEach(() => {
  Array.prototype.join = nativeArrayJoin;
  Map.prototype.get = nativeMapGet;
  String.prototype.slice = nativeStringSlice;
});

describe('parseComponentXml', () => {
  it('parses mixed text and nested elements with attributes', () => {
    const ast = parseComponentXml(
      'Hello <kovo-callout title="Q3 Results">see <kovo-badge count="4"/></kovo-callout>!',
    );
    expect(ast).toEqual<ComponentNode[]>([
      { type: 'text', value: 'Hello ' },
      {
        type: 'element',
        tag: 'kovo-callout',
        attributes: { title: 'Q3 Results' },
        children: [
          { type: 'text', value: 'see ' },
          { type: 'element', tag: 'kovo-badge', attributes: { count: '4' }, children: [] },
        ],
      },
      { type: 'text', value: '!' },
    ]);
  });

  it('decodes entities in text and attribute values', () => {
    const ast = parseComponentXml('<kovo-callout title="a &amp; b">x &lt; y &#65;</kovo-callout>');
    const node = ast[0];
    expect(node).toMatchObject({
      tag: 'kovo-callout',
      attributes: { title: 'a & b' },
      children: [{ type: 'text', value: 'x < y A' }],
    });
  });

  it('supports single-quoted, boolean attributes, comments, and CDATA', () => {
    const ast = parseComponentXml(
      "<!-- note --><kovo-callout title='hi' open><![CDATA[<raw> & ]]></kovo-callout>",
    );
    expect(ast[0]).toMatchObject({
      tag: 'kovo-callout',
      attributes: { title: 'hi', open: '' },
      children: [{ type: 'text', value: '<raw> & ' }],
    });
  });

  it('throws ComponentXmlError on mismatched and unclosed tags', () => {
    expect(() => parseComponentXml('<a>x</b>')).toThrow(ComponentXmlError);
    expect(() => parseComponentXml('<a>x')).toThrow(ComponentXmlError);
    expect(() => parseComponentXml('x</a>')).toThrow(ComponentXmlError);
  });
});

describe('renderTree', () => {
  it('renders a validated component tree from parsed XML', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml('<kovo-callout title="Q3">ok</kovo-callout>'),
    );
    expect(html).toBe('<section data-title="Q3">ok</section>');
  });

  it('escapes literal text nodes — the walker owns text-escaping (SPEC §4.10)', async () => {
    // CDATA carries the raw metacharacters verbatim into the text node; the walker must escape
    // them so LLM text can never inject markup.
    const html = await renderTree(registry, parseComponentXml('<![CDATA[a < b & c > d]]>'));
    expect(html).toBe('a &lt; b &amp; c &gt; d');
  });

  it('neutralizes XSS in attribute values', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml(
        '<kovo-callout title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">x</kovo-callout>',
      ),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralizes javascript: URLs in URL-bearing attributes', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml('<kovo-link href="javascript:alert(1)" label="x"/>'),
    );
    expect(html).toBe('<a href="#">x</a>');
  });

  it('passes only schema-declared props — no arbitrary attribute passthrough', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml(
        '<kovo-callout title="ok" onclick="evil()" data-extra="x">y</kovo-callout>',
      ),
    );
    expect(html).toBe('<section data-title="ok">y</section>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('data-extra');
  });

  it('fail-soft: drops an invalid attribute and falls back to its default', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml('<kovo-badge count="not-a-number"/>'),
    );
    expect(html).toBe('<span data-count="0"></span>');
  });

  it('renders an unknown tag as its children with the wrapper dropped (default)', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml(
        '<kovo-unknown>kept <kovo-callout title="t">inner</kovo-callout></kovo-unknown>',
      ),
    );
    expect(html).toBe('kept <section data-title="t">inner</section>');
  });

  it('drops an unknown tag entirely when unknownTag is "drop"', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml('before<kovo-unknown>gone</kovo-unknown>after'),
      { unknownTag: 'drop' },
    );
    expect(html).toBe('beforeafter');
  });

  it('passes attributes through (escaped) for a bare-component registry entry', async () => {
    const html = await renderTree(
      registry,
      parseComponentXml('<kovo-note title="x&quot;y">z</kovo-note>'),
    );
    expect(html).toBe('<section data-title="x&quot;y">z</section>');
  });
});

describe('renderTree security boundaries (SPEC §4.10)', () => {
  const payload = '<img src=x onerror="globalThis.__kovoRenderTreePwned=1">';
  const Dangerous = component({
    render: () => trustedHtml(payload, 'render-tree security regression') as never,
  });

  it('does not compose escaped output through a late Array.join replacement', async () => {
    const closed = renderRegistry({});
    const nodes = parseComponentXml('safe-marker');
    Array.prototype.join = function (separator) {
      if (this.length === 1) return payload;
      return Reflect.apply(nativeArrayJoin, this, [separator]);
    } as typeof Array.prototype.join;

    const html = await renderTree(closed, nodes);
    Array.prototype.join = nativeArrayJoin;
    expect(html).toBe('safe-marker');
  });

  it('dispatches only through the private registry snapshot under late Map.get poison', async () => {
    const closed = renderRegistry({});
    Map.prototype.get = function (key) {
      if (this === closed.entries && key === 'evil') return { component: Dangerous };
      return Reflect.apply(nativeMapGet, this, [key]);
    } as typeof Map.prototype.get;

    const html = await renderTree(closed, parseComponentXml('<evil/>'));
    Map.prototype.get = nativeMapGet;
    expect(html).toBe('');
  });

  it('ignores mutations to the public registry view', async () => {
    const closed = renderRegistry({});
    (closed.entries as Map<string, unknown>).set('evil', { component: Dangerous });
    await expect(renderTree(closed, parseComponentXml('<evil/>'))).resolves.toBe('');
  });

  it('rejects a structurally forged registry', async () => {
    const forged = {
      __kovoComponentRegistry: true,
      entries: new Map([['evil', { component: Dangerous }]]),
    } as unknown as ComponentRegistry;

    await expect(renderTree(forged, parseComponentXml('<evil/>'))).rejects.toThrow(
      'minted by renderRegistry',
    );
  });

  it('pins XML name extraction against late String.slice retagging', async () => {
    const source = '<evil/>';
    const closed = renderRegistry({ approved: Dangerous });
    String.prototype.slice = function (start, end) {
      const value = Reflect.apply(String, undefined, [this]) as string;
      if (value === source && start === 1 && end === 5) return 'approved';
      return Reflect.apply(nativeStringSlice, value, [start, end]);
    } as typeof String.prototype.slice;

    const html = await renderTree(closed, parseComponentXml(source));
    String.prototype.slice = nativeStringSlice;
    expect(html).toBe('');
  });

  it('requires stable own-data registry entries with component provenance', () => {
    const accessorRegistry = {} as Record<string, unknown>;
    Object.defineProperty(accessorRegistry, 'evil', {
      enumerable: true,
      get: () => Dangerous,
    });
    expect(() => renderRegistry(accessorRegistry as never)).toThrow('own data property');
    expect(() => renderRegistry({ evil: (() => undefined) as never })).toThrow(
      'component() provenance',
    );
  });

  it('rejects isomorphic components from the server-only registry', () => {
    const Isomorphic = component({ isomorphic: true, render: () => <p>unsafe posture</p> });
    expect(() => renderRegistry({ isomorphic: Isomorphic })).toThrow('server-renderable');
  });

  it('rejects cyclic and over-deep ASTs before rendering', async () => {
    const closed = renderRegistry({});
    const cyclic: ComponentNode = {
      type: 'element',
      tag: 'unknown',
      attributes: {},
      children: [],
    };
    (cyclic as Extract<ComponentNode, { type: 'element' }>).children.push(cyclic);

    await expect(renderTree(closed, cyclic)).rejects.toThrow('cyclic ComponentNode');
    const deepSource = '<unknown>'.repeat(257) + 'x' + '</unknown>'.repeat(257);
    expect(() => parseComponentXml(deepSource)).toThrow('depth bound');
  });

  it('rejects duplicate and prototype-named XML attributes as plain data', () => {
    expect(() => parseComponentXml('<x a="1" a="2"/>')).toThrow('Duplicate attribute');
    const parsed = parseComponentXml('<x __proto__="plain"/>');
    expect((parsed[0] as Extract<ComponentNode, { type: 'element' }>).attributes.__proto__).toBe(
      'plain',
    );
  });

  it('bounds untrusted XML source and per-element attribute work', () => {
    expect(() => parseComponentXml('x'.repeat(1_000_001))).toThrow('code-unit bound');
    const attributes = Array.from({ length: 1_025 }, (_, index) => `a${index}=""`).join(' ');
    expect(() => parseComponentXml(`<x ${attributes}/>`)).toThrow('attribute bound');
  });
});
