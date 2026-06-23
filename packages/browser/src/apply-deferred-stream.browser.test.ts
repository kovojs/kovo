import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './client.js';
import { applyDeferredStreamResponseToRuntime } from './generated.js';
import { DomMorphRoot, keyedDomMorph } from './morph.js';

const visibleApplyScriptBody =
  'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}var b=e.join("\\n"),a=()=>globalThis.__kovo_a?.(b),o=globalThis.IntersectionObserver&&new IntersectionObserver((r)=>{for(const x of r)if(x.isIntersecting){o.disconnect();a();break}},{rootMargin:"600px 0px"}),c=0;if(o){for(var v of ["rail:p1"]){var d=[...document.getElementsByTagName("kovo-defer")].find((x)=>x.getAttribute("target")===v);if(d){o.observe(d);c++}}}if(!c)a();s.remove()';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('browser deferred stream response apply', () => {
  it('applies CRLF deferred stream query truth before browser fragment morphs', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-c="cart-badge"><output data-bind="cart.count">0</output></section>',
      '<p data-bind="cart.count">0</p>',
    ].join('');
    document.body.append(root);
    const store = createQueryStore();
    const badge = root.querySelector('[kovo-c="cart-badge"]');
    const observed: string[] = [];
    if (!badge) throw new Error('missing cart badge fixture');

    // SPEC.md §4.4/§9.1: deferred stream chunks reuse mutation query/fragment
    // apply, so browser morphs observe the query-store truth from the same part.
    const applied = applyDeferredStreamResponseToRuntime({
      body: [
        '--kovo-boundary\r\n',
        'Content-Type: text/vnd.kovo.fragment+html\r\n',
        '\r\n',
        '<kovo-query name="cart">{"count":4}</kovo-query>\r\n',
        '<kovo-fragment target="cart-badge">',
        '<section kovo-c="cart-badge"><output data-bind="cart.count">server</output></section>',
        '</kovo-fragment>\r\n',
        '--kovo-boundary--\r\n',
      ].join(''),
      morph(target, html) {
        observed.push(root.querySelector('p')?.textContent ?? '');
        keyedDomMorph(target, html);
      },
      queryPlans: { cart: { bindings: true } },
      queryRoot: document,
      root: new DomMorphRoot(root),
      store,
    });

    expect(applied.queries).toEqual(['cart']);
    expect(applied.appliedFragments).toEqual(['cart-badge']);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(observed).toEqual(['4']);
    expect(root.querySelector('[kovo-c="cart-badge"]')).toBe(badge);
    expect(root.querySelector('[kovo-c="cart-badge"] output')?.textContent).toBe('server');
    expect(root.querySelector('p')?.textContent).toBe('4');
  });

  it('waits to apply visible stream chunks until the placeholder intersects', () => {
    let callback:
      | ((entries: readonly Pick<IntersectionObserverEntry, 'isIntersecting' | 'target'>[]) => void)
      | undefined;
    const observed: Element[] = [];
    const disconnected = vi.fn();
    const applied: string[] = [];

    vi.stubGlobal(
      'IntersectionObserver',
      class TestIntersectionObserver {
        constructor(
          observerCallback: (
            entries: readonly Pick<IntersectionObserverEntry, 'isIntersecting' | 'target'>[],
          ) => void,
          public readonly options?: IntersectionObserverInit,
        ) {
          callback = observerCallback;
        }

        observe(target: Element): void {
          observed.push(target);
        }

        disconnect = disconnected;
      },
    );
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a = (body) => {
      applied.push(body);
    };

    document.body.innerHTML =
      '<kovo-defer target="rail:p1" state="pending" data-kovo-region-priority="visible">Loading rail</kovo-defer>';
    const placeholder = document.querySelector('kovo-defer');
    if (!placeholder) throw new Error('missing visible placeholder fixture');
    const fragment = document.createElement('kovo-fragment');
    fragment.setAttribute('target', 'rail:p1');
    fragment.setAttribute('priority', 'visible');
    fragment.innerHTML = '<aside>Rail ready</aside>';
    const script = document.createElement('script');
    script.text = visibleApplyScriptBody;

    document.body.append('\n--kovo-boundary\n', fragment, script);

    expect(observed).toEqual([placeholder]);
    expect(applied).toEqual([]);
    expect(document.querySelector('kovo-fragment')).toBeNull();

    callback?.([{ isIntersecting: false, target: placeholder }]);
    expect(applied).toEqual([]);

    callback?.([{ isIntersecting: true, target: placeholder }]);
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([
      '<kovo-fragment target="rail:p1" priority="visible"><aside>Rail ready</aside></kovo-fragment>',
    ]);
  });

  it('applies visible stream chunks immediately when IntersectionObserver is unavailable', () => {
    const applied: string[] = [];
    vi.stubGlobal('IntersectionObserver', undefined);
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a = (body) => {
      applied.push(body);
    };

    document.body.innerHTML =
      '<kovo-defer target="rail:p1" state="pending" data-kovo-region-priority="visible">Loading rail</kovo-defer>';
    const fragment = document.createElement('kovo-fragment');
    fragment.setAttribute('target', 'rail:p1');
    fragment.setAttribute('priority', 'visible');
    fragment.innerHTML = '<aside>Rail ready</aside>';
    const script = document.createElement('script');
    script.text = visibleApplyScriptBody;

    document.body.append('\n--kovo-boundary\n', fragment, script);

    expect(applied).toEqual([
      '<kovo-fragment target="rail:p1" priority="visible"><aside>Rail ready</aside></kovo-fragment>',
    ]);
  });
});
