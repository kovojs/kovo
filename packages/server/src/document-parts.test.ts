import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_PARTS_CONTENT_TYPE,
  DOCUMENT_PARTS_PROTOCOL,
  encodeEnhancedNavigationDocumentParts,
} from './document-parts.js';

// SPEC §8 (spec/07-navigation.md): the kovo-document-parts/v1 encoding is the enhanced-navigation
// wire representation of the full canonical document. These tests pin the encoder half of the
// codec; the browser builder half is pinned by packages/browser navigation tests, and end-to-end
// parity by tests/integration/specs/enhanced-navigation-no-reload.spec.ts.

const BUILD = 'build-token-1';

function doc(head: string, body: string, htmlAttrs = ' lang="en"', bodyAttrs = ''): string {
  return `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8">${head}</head><body${bodyAttrs}>${body}</body></html>`;
}

function decode(html: string): Record<string, unknown> {
  const encoded = encodeEnhancedNavigationDocumentParts(html, BUILD);
  expect(encoded).toBeTypeOf('string');
  return JSON.parse(encoded!) as Record<string, unknown>;
}

describe('encodeEnhancedNavigationDocumentParts', () => {
  it('exports the exact media type the client validates', () => {
    expect(DOCUMENT_PARTS_CONTENT_TYPE).toBe(
      'application/vnd.kovo.document-parts+json; charset=utf-8',
    );
  });

  it('encodes a canonical inert document as structured parts', () => {
    const envelope = decode(
      doc(
        '<meta name="kovo-build" content="build-token-1"><title>Home &amp; Start</title>' +
          '<link rel="stylesheet" href="/assets/styles.css">',
        '<main id="root"><h1>Navigation</h1><a href="/products/sku-1?ref=home">View</a></main>',
      ),
    );
    expect(envelope.protocol).toBe(DOCUMENT_PARTS_PROTOCOL);
    expect(envelope.build).toBe(BUILD);
    expect(envelope.htmlAttrs).toEqual([['lang', 'en']]);
    expect(envelope.bodyAttrs).toEqual([]);
    expect(envelope.head).toEqual([
      ['meta', [['charset', 'utf-8']], []],
      [
        'meta',
        [
          ['name', 'kovo-build'],
          ['content', 'build-token-1'],
        ],
        [],
      ],
      ['title', [], ['Home & Start']],
      [
        'link',
        [
          ['rel', 'stylesheet'],
          ['href', '/assets/styles.css'],
        ],
        [],
      ],
    ]);
    expect(envelope.body).toEqual([
      [
        'main',
        [['id', 'root']],
        [
          ['h1', [], ['Navigation']],
          ['a', [['href', '/products/sku-1?ref=home']], ['View']],
        ],
      ],
    ]);
  });

  it('keeps JSON query data scripts as inert element parts', () => {
    const envelope = decode(
      doc(
        '<script type="application/json" kovo-query="cart" data-kovo-csp-hash="sha256-x">' +
          '{"count":3,"note":"a \\u003c b"}</script>',
        '<main></main>',
      ),
    );
    const head = envelope.head as unknown[];
    expect(head[1]).toEqual([
      'script',
      [
        ['type', 'application/json'],
        ['kovo-query', 'cart'],
        ['data-kovo-csp-hash', 'sha256-x'],
      ],
      ['{"count":3,"note":"a \\u003c b"}'],
    ]);
  });

  it('inserts the implied tbody the browser parser would create', () => {
    const envelope = decode(doc('', '<table><tr><td>1</td></tr></table>'));
    expect(envelope.body).toEqual([
      ['table', [], [['tbody', [], [['tr', [], [['td', [], ['1']]]]]]]],
    ]);
  });

  it('closes an open <p> exactly where the parser implies its end tag', () => {
    const envelope = decode(doc('', '<p>one<div>two</div>'));
    expect(envelope.body).toEqual([
      ['p', [], ['one']],
      ['div', [], ['two']],
    ]);
  });

  it('marks SVG subtrees with the foreign namespace and adjusted case', () => {
    const envelope = decode(
      doc('', '<svg viewBox="0 0 8 8"><linearGradient id="g"></linearGradient></svg>'),
    );
    expect(envelope.body).toEqual([
      ['svg', [['viewBox', '0 0 8 8']], [['linearGradient', [['id', 'g']], [], 1]], 1],
    ]);
  });

  it('keeps comments so segment snapshots stay parser-identical', () => {
    const envelope = decode(doc('', '<main><!-- boundary --></main>'));
    expect(envelope.body).toEqual([['main', [], [['!', ' boundary ']]]]);
  });

  it('decodes numeric and known named references and refuses unknown ones', () => {
    const envelope = decode(doc('', '<main title="A &amp; B &#x41;">&copy; 2026</main>'));
    expect(envelope.body).toEqual([['main', [['title', 'A & B A']], ['© 2026']]]);
    expect(
      encodeEnhancedNavigationDocumentParts(doc('', '<main>&unknownentity;</main>'), BUILD),
    ).toBeUndefined();
  });

  it('treats a bare non-reference ampersand as literal text', () => {
    const envelope = decode(doc('', '<main>AT&amp;T, a & b</main>'));
    expect(envelope.body).toEqual([['main', [], ['AT&T, a & b']]]);
  });

  const refusals: readonly [label: string, html: string][] = [
    ['an executable inline script', doc('', '<main><script>alert(1)</script></main>')],
    ['an external script', doc('<script src="/x.js"></script>', '<main></main>')],
    ['a typeless data script', doc('', '<main><script kovo-query="q">{}</script></main>')],
    ['a native event handler attribute', doc('', '<main onclick="x()"></main>')],
    ['an iframe srcdoc', doc('', '<iframe srcdoc="<b>x</b>"></iframe>')],
    ['a customized built-in', doc('', '<main is="custom-main"></main>')],
    ['a base element', doc('<base href="/x/">', '<main></main>')],
    ['misnested table text', doc('', '<table>loose</table>')],
    ['a deep open p ambiguity', doc('', '<p><span>a<div>b</div></span></p>')],
    ['an unquoted attribute value', doc('', '<main id=root></main>')],
    ['a self-closed non-void element', doc('', '<main><div/></main>')],
    ['a mismatched end tag', doc('', '<main><section></main></section>')],
    ['a non-head element in head', doc('<div>x</div>', '<main></main>')],
    ['a nested anchor', doc('', '<a href="/a"><a href="/b">x</a></a>')],
    ['a legacy entity without semicolon', doc('', '<main>fish &amp chips</main>')],
    ['carriage returns', '<!doctype html><html><head></head><body>\r\n</body></html>'],
  ];
  for (const [label, html] of refusals) {
    it(`refuses ${label}`, () => {
      expect(encodeEnhancedNavigationDocumentParts(html, BUILD)).toBeUndefined();
    });
  }

  it('refuses an empty build token', () => {
    expect(encodeEnhancedNavigationDocumentParts(doc('', '<main></main>'), '')).toBeUndefined();
  });

  it('encodes raw-text style content verbatim', () => {
    const envelope = decode(doc('<style>a>b{color:red}</style>', '<main></main>'));
    const head = envelope.head as unknown[];
    expect(head[1]).toEqual(['style', [], ['a>b{color:red}']]);
  });

  it('drops the single literal leading newline in pre', () => {
    const envelope = decode(doc('', '<pre>\nline</pre>'));
    expect(envelope.body).toEqual([['pre', [], ['line']]]);
  });
});
