import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileComponentModule } from '@kovojs/compiler';
import { dispatchDelegatedEvent, type EventElementLike } from '@kovojs/runtime';
import { renderRoutePageResponse } from '@kovojs/server/internal/route';

import { productRoute } from './app.js';

// Tutorial step 02: the served page is self-describing (SPEC.md section 4.2)
// — platform behavior, handler wiring, and island state are all readable as
// attributes — and the handler module is loadable and runnable without a
// browser (SPEC.md section 4.3).

class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string>) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(_selector: string): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}

function bodyText(body: unknown): string {
  if (typeof body !== 'string') throw new Error('expected a string page body');
  return body;
}

function renderProductRoute(id: string) {
  return renderRoutePageResponse(productRoute, { params: { id } }, {});
}

function attributeFrom(html: string, name: string): string {
  const match = new RegExp(`${name}="([^"]+)"`).exec(html);
  if (!match?.[1]) throw new Error(`missing ${name} attribute in rendered page`);
  return match[1].replaceAll('&quot;', '"');
}

describe('tutorial step 02 — islands', () => {
  // snippet:page-test
  it('serves the island as self-describing attributes, zero eager JS', async () => {
    const response = await renderProductRoute('p1');
    const html = bodyText(response.body);

    // L0: the size-guide closure was proven equivalent to a platform invoker
    // and lowered to attributes — no JavaScript ships for it.
    expect(html).toContain('popovertarget="size-guide"');
    expect(html).toContain('popovertargetaction="toggle"');

    // L1: the save button names its handler module and export in markup; the
    // module loads on first interaction, not at page load.
    expect(html).toMatch(
      /on:click="\/c\/site\/tutorial\/steps\/02-islands\/src\/components\/product-actions\.client\.js\?v=[0-9a-f]{8}#ProductActions\$button_click"/,
    );

    // Island state is serialized in the markup, not hidden in a JS heap.
    expect(html).toContain('kovo-state="{&quot;saved&quot;:0}"');
  });
  // /snippet

  // snippet:dispatch-test
  it('runs the named handler export against island state without a browser', async () => {
    const response = await renderProductRoute('p1');
    const html = bodyText(response.body);
    const element = new FakeElement({
      'kovo-state': attributeFrom(html, 'kovo-state'),
      'on:click': attributeFrom(html, 'on:click'),
    });
    const importedUrls: string[] = [];
    const importModule = async (url: string) => {
      importedUrls.push(url);
      return import('./generated/product-actions.client.js');
    };

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importedUrls[0]).toContain('/c/site/tutorial/steps/02-islands/');
    expect(element.getAttribute('kovo-state')).toBe('{"saved":2}');
  });
  // /snippet

  // snippet:lint-test
  it('compiles the authored TSX with the KV210 naming nudge as the only lint', () => {
    const result = compileComponentModule({
      fileName: 'site/tutorial/steps/02-islands/src/components/product-actions.tsx',
      source: readFileSync(new URL('./components/product-actions.tsx', import.meta.url), 'utf8'),
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'KV210', severity: 'lint' }),
    ]);
    expect(result.platformSubstitutions).toEqual([
      { action: 'toggle', event: 'click', kind: 'popover', tag: 'button', target: 'size-guide' },
    ]);
  });
  // /snippet
});
