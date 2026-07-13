import { describe, expect, it } from 'vitest';

import {
  createRenderedFragmentHtml,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import {
  applyHtmlResponseFragments,
  applyResponseFragment,
  applyResponseFragments,
  p,
  type HtmlResponseFragmentApplyTarget,
} from './response-fragment-apply.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

interface TestFragmentTarget {
  html: string;
}

const fragmentHtml = (html: string): RenderedFragmentHtml => createRenderedFragmentHtml(html);

// SPEC §9.3/§13.2: a minimal DOM stand-in so the inline `p` prepend branch (insert
// keyed rows at the START, deduped by kovo-key, with the scroll-anchor guarantee) is
// exercisable in the node unit pool. Each fake row exposes the surface `g()`/`k()` read.
function fakeRow(key: string | null) {
  return {
    nodeType: 1,
    attributes: [] as { name: string; value: string }[],
    getAttribute(name: string): string | null {
      return name === 'kovo-key' ? key : null;
    },
    querySelectorAll(): unknown[] {
      return [];
    },
  };
}

type FakeRow = ReturnType<typeof fakeRow>;

function fakePrependTarget(existingKeys: readonly (string | null)[], rowHeight = 10) {
  const children = existingKeys.map((key) => fakeRow(key));
  return {
    children,
    scrollTop: 0,
    scrollHeight: existingKeys.length * rowHeight,
    prepend(...nodes: FakeRow[]): void {
      children.unshift(...nodes);
      // Simulate layout: each inserted row grows the scrollable height.
      this.scrollHeight += nodes.length * rowHeight;
    },
  };
}

function installFakeDocument(): () => void {
  const record = globalThis as unknown as { document?: unknown };
  const original = record.document;
  record.document = {
    createElement(name: string) {
      if (name !== 'template') throw new Error(`unexpected fake element: ${name}`);
      const content = { children: [] as FakeRow[], childNodes: [] as FakeRow[] };
      return {
        content,
        set innerHTML(value: string) {
          const rows: FakeRow[] = [];
          const re = /kovo-key="([^"]*)"/g;
          let match: RegExpExecArray | null;
          while ((match = re.exec(value)) !== null) rows.push(fakeRow(match[1] ?? null));
          content.children = rows;
          content.childNodes = rows;
        },
      };
    },
  };
  return () => {
    record.document = original;
  };
}

describe('response fragment apply primitive', () => {
  it('types decoded fragment HTML as a browser-side capability', () => {
    expect(() =>
      applyResponseFragment(
        {
          // @ts-expect-error SPEC.md §9.1 decoded fragment apply requires RenderedFragmentHtml.
          html: '<p>raw</p>',
          target: 'target',
        },
        {
          appendFragment() {},
          findFragmentTarget: () => ({}),
          replaceFragment() {},
        },
      ),
    ).toBeTypeOf('function');
  });

  it('applies replace and append fragment modes through supplied target operations', () => {
    // SPEC.md §9.1: kovo-fragment patches share one decoded apply primitive
    // across modular morph and the generated inline loader closure.
    const targets = new Map([
      ['cart-badge', { html: '' }],
      ['cart-list', { html: '<li>existing</li>' }],
    ] satisfies [string, TestFragmentTarget][]);
    const options = {
      appendFragment(target: TestFragmentTarget, html: RenderedFragmentHtml) {
        target.html += html.toString();
      },
      findFragmentTarget(target: string) {
        return targets.get(target) ?? null;
      },
      replaceFragment(target: TestFragmentTarget, html: RenderedFragmentHtml) {
        target.html = html.toString();
      },
    };

    expect(
      applyResponseFragment(
        { html: fragmentHtml('<cart-badge>1</cart-badge>'), target: 'cart-badge' },
        options,
      ),
    ).toBe(true);
    expect(
      applyResponseFragment(
        { html: fragmentHtml('<li>new</li>'), mode: 'append', target: 'cart-list' },
        options,
      ),
    ).toBe(true);
    expect(
      applyResponseFragment(
        { html: fragmentHtml('<aside>ignored</aside>'), target: 'missing' },
        options,
      ),
    ).toBe(false);

    expect(targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(targets.get('cart-list')?.html).toBe('<li>existing</li><li>new</li>');
  });

  it('reports applied targets from one fragment batch helper', () => {
    // SPEC.md §9.1: modular DOM apply and inline apply share fragment target
    // filtering and applied-target reporting after response bodies are decoded.
    const targets = new Map([
      ['replace-target', { html: '<p>old</p>' }],
      ['append-target', { html: '<li>old</li>' }],
    ] satisfies [string, TestFragmentTarget][]);

    const applied = applyResponseFragments<TestFragmentTarget>(
      [
        { html: fragmentHtml('<p>new</p>'), target: 'replace-target' },
        { html: fragmentHtml('<li>new</li>'), mode: 'append', target: 'append-target' },
        { html: fragmentHtml('<aside>ignored</aside>'), target: 'missing-target' },
      ],
      {
        appendFragment(target, html) {
          target.html += html.toString();
        },
        findFragmentTarget(target) {
          return targets.get(target) ?? null;
        },
        replaceFragment(target, html) {
          target.html = html.toString();
        },
      },
    );

    expect(applied).toEqual(['replace-target', 'append-target']);
    expect(targets.get('replace-target')?.html).toBe('<p>new</p>');
    expect(targets.get('append-target')?.html).toBe('<li>old</li><li>new</li>');
  });

  it('dispatches mode="prepend" to the prepend sink, falling back to append when absent', () => {
    // SPEC §9.3: prepend is its own ordered-insert vocabulary. A caller with a prepend
    // sink routes to it; one without degrades to append (still an ordered insert).
    const withPrepend = {
      log: [] as string[],
      appendFragment(_t: TestFragmentTarget, html: RenderedFragmentHtml) {
        this.log.push(`append:${html}`);
      },
      prependFragment(_t: TestFragmentTarget, html: RenderedFragmentHtml) {
        this.log.push(`prepend:${html}`);
      },
      findFragmentTarget() {
        return {} as TestFragmentTarget;
      },
      replaceFragment(_t: TestFragmentTarget, html: RenderedFragmentHtml) {
        this.log.push(`replace:${html}`);
      },
    };
    applyResponseFragment(
      { html: fragmentHtml('<li>older</li>'), mode: 'prepend', target: 't' },
      withPrepend,
    );
    expect(withPrepend.log).toEqual(['prepend:<li>older</li>']);

    const noPrepend = {
      log: [] as string[],
      appendFragment(_t: TestFragmentTarget, html: RenderedFragmentHtml) {
        this.log.push(`append:${html}`);
      },
      findFragmentTarget() {
        return {} as TestFragmentTarget;
      },
      replaceFragment() {},
    };
    applyResponseFragment(
      { html: fragmentHtml('<li>older</li>'), mode: 'prepend', target: 't' },
      noPrepend,
    );
    expect(noPrepend.log).toEqual(['append:<li>older</li>']);
  });

  it('prepends keyed rows at the START, dedupes by kovo-key, and preserves the scroll anchor', () => {
    // SPEC §9.3/§13.2: the inline DOM adapter inserts the page at the front, skips a row
    // whose kovo-key is already present (m4), and shifts scrollTop by the inserted height
    // so existing ("load older") content stays visually fixed.
    const restore = installFakeDocument();
    try {
      const target = fakePrependTarget(['m3', 'm4'], 10);
      const applied = applyHtmlResponseFragments(
        [
          {
            html: fragmentHtml(
              '<article kovo-key="m4"></article><article kovo-key="m1"></article><article kovo-key="m2"></article>',
            ),
            mode: 'prepend',
            target: 'chat-log',
          },
        ],
        () => target as unknown as HtmlResponseFragmentApplyTarget,
      );

      expect(applied).toEqual(['chat-log']);
      // m4 deduped; m1,m2 inserted at the FRONT in wire order, before m3,m4.
      expect(target.children.map((row) => row.getAttribute('kovo-key'))).toEqual([
        'm1',
        'm2',
        'm3',
        'm4',
      ]);
      // Two rows inserted (10px each) → scrollTop shifts by 20 to keep the anchor.
      expect(target.scrollTop).toBe(20);
    } finally {
      restore();
    }
  });

  it('keeps prepend output decisions stable after late Set prototype poisoning', () => {
    // SPEC §6.6/§9.3: a mutable Set prototype cannot forge every incoming key
    // as already present and silently discard a server-authorized output page.
    const restore = installFakeDocument();
    const originalHas = Set.prototype.has;
    try {
      const security = createBrowserNavigationSecurityControls();
      const target = fakePrependTarget(['m3', 'm4'], 10);
      Set.prototype.has = (() => true) as typeof Set.prototype.has;
      p(
        [
          {
            html: fragmentHtml(
              '<article kovo-key="m1"></article><article kovo-key="m2"></article>',
            ),
            mode: 'prepend',
            target: 'chat-log',
          },
        ],
        () => target as unknown as HtmlResponseFragmentApplyTarget,
        security,
        (html) => html,
      );

      expect(target.children.map((row) => row.getAttribute('kovo-key'))).toEqual([
        'm1',
        'm2',
        'm3',
        'm4',
      ]);
    } finally {
      Set.prototype.has = originalHas;
      restore();
    }
  });

  it('exports one shared decoded fragment primitive and HTML adapter', async () => {
    const fragmentApplyModule = await import('./response-fragment-apply.js');

    // SPEC.md §4.4/§9.1: the generated inline loader embeds this canonical
    // helper closure, so there is no second private HTML fragment adapter.
    expect(fragmentApplyModule.applyHtmlResponseFragments).toBe(applyHtmlResponseFragments);
    expect(fragmentApplyModule.applyResponseFragments).toBe(applyResponseFragments);
  });
});
