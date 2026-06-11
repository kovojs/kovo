import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyMutationResponseToDom,
  createQueryStore,
  DomMorphRoot,
  installJisoLoader,
  keyedDomMorph,
} from './index.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('runtime browser suite', () => {
  it('keeps the P2 L0+L1 demo interactive at first paint with zero JS before declared triggers', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section aria-label="P2 smoke demo">',
      '<nav fw-c="catalog-tabs" fw-state="{&quot;selected&quot;:&quot;featured&quot;}">',
      '<button type="button" aria-controls="featured" aria-selected="true" on:click="/demo/tabs.js#select" data-p-tab="featured">Featured</button>',
      '<button type="button" aria-controls="sale" aria-selected="false" on:click="/demo/tabs.js#select" data-p-tab="sale">Sale</button>',
      '</nav>',
      '<section id="featured">Featured products</section>',
      '<section id="sale" hidden>Sale products</section>',
      '<button commandfor="details-dialog" command="show-modal">Details</button>',
      '<dialog id="details-dialog"><form method="dialog"><button value="close">Close</button></form></dialog>',
      '<form fw-c="catalog-filter" fw-state="{&quot;query&quot;:&quot;&quot;}">',
      '<label for="filter-query">Filter</label>',
      '<input id="filter-query" name="query" on:input="/demo/filter.js#filter" value="">',
      '<output data-bind="filter.query"></output>',
      '</form>',
      '<aside fw-c="sales-chart" on:visible="/demo/chart.js#mount" data-chart-mounted="false">Chart</aside>',
      '</section>',
    ].join('');
    document.body.append(root);

    let visibleCallback: (entries: { isIntersecting: boolean; target: Element }[]) => void = (
      _entries,
    ) => {
      throw new Error('missing visible observer callback');
    };
    const imports: string[] = [];
    const chart = root.querySelector<HTMLElement>('[fw-c="sales-chart"]');
    const dialog = root.querySelector<HTMLDialogElement>('#details-dialog');
    const filterInput = root.querySelector<HTMLInputElement>('#filter-query');
    const filterOutput = root.querySelector<HTMLOutputElement>('output');
    const saleTab = root.querySelector<HTMLButtonElement>('[data-p-tab="sale"]');

    if (!chart || !dialog || !filterInput || !filterOutput || !saleTab) {
      throw new Error('missing P2 smoke fixture');
    }

    installJisoLoader({
      async importModule(url) {
        imports.push(url);

        if (url === '/demo/tabs.js') {
          return {
            select(event: Event, ctx: { params: { tab: string }; state: { selected: string } }) {
              ctx.state.selected = ctx.params.tab;
              for (const button of root.querySelectorAll<HTMLButtonElement>('[data-p-tab]')) {
                const selected = button.dataset.pTab === ctx.params.tab;
                button.setAttribute('aria-selected', String(selected));
                const panel = root.querySelector<HTMLElement>(`#${button.dataset.pTab}`);
                if (panel) panel.hidden = !selected;
              }
              event.preventDefault();
            },
          };
        }

        if (url === '/demo/filter.js') {
          return {
            filter(event: Event, ctx: { state: { query: string } }) {
              ctx.state.query = (event.target as HTMLInputElement).value;
              filterOutput.textContent = ctx.state.query;
            },
          };
        }

        if (url === '/demo/chart.js') {
          return {
            mount(_event: Event, ctx: { signal: AbortSignal }) {
              chart.dataset.chartMounted = String(!ctx.signal.aborted);
            },
          };
        }

        return {};
      },
      root,
      visibleObserver(callback) {
        visibleCallback = callback as typeof visibleCallback;
        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
        };
      },
    });

    expect(imports).toEqual([]);
    expect(dialog.open).toBe(false);

    root.querySelector<HTMLLabelElement>('label')?.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(filterInput));

    root.querySelector<HTMLButtonElement>('[commandfor="details-dialog"]')?.click();
    await vi.waitFor(() => expect(dialog.open).toBe(true));

    expect(imports).toEqual([]);

    filterInput.value = 'beans';
    filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(imports).toEqual(['/demo/filter.js']);
      expect(filterOutput.textContent).toBe('beans');
    });

    saleTab.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/demo/filter.js', '/demo/tabs.js']);
      expect(saleTab.getAttribute('aria-selected')).toBe('true');
      expect(root.querySelector<HTMLElement>('#sale')?.hidden).toBe(false);
      expect(root.querySelector<HTMLElement>('#featured')?.hidden).toBe(true);
    });

    visibleCallback([{ isIntersecting: true, target: chart }]);

    await vi.waitFor(() => {
      expect(imports).toEqual(['/demo/filter.js', '/demo/tabs.js', '/demo/chart.js']);
      expect(chart.dataset.chartMounted).toBe('true');
    });
  });

  it('keeps the loader idle until the first delegated interaction', async () => {
    const root = document.createElement('main');
    root.innerHTML =
      '<button fw-state="{&quot;count&quot;:0}" on:click="/handlers/cart.js#increment" data-p-product-id="p1">Add</button>';
    document.body.append(root);
    const button = root.querySelector('button');
    let imports = 0;

    installJisoLoader({
      async importModule(url) {
        imports += 1;
        expect(url).toBe('/handlers/cart.js');

        return {
          increment(_event: Event, ctx: { state: { count: number } }) {
            ctx.state.count += 1;
          },
        };
      },
      root,
    });

    expect(imports).toBe(0);

    button?.click();

    await vi.waitFor(() => {
      expect(imports).toBe(1);
      expect(button?.getAttribute('fw-state')).toBe('{"count":1}');
    });
  });

  it('refetches typed reads on document visible-return without a window focus duplicate', async () => {
    document.body.innerHTML =
      '<script fw-query="cart" type="application/json">{"count":1}</script>';
    const store = createQueryStore();
    let resolveText: ((body: string) => void) | undefined;
    const textDone = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const fetch = vi.fn(async () => ({
      status: 200,
      text: () => textDone,
    }));

    const loader = installJisoLoader({
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      root: document,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    resolveText?.('<fw-query name="cart">{"count":2}</fw-query>');
    await vi.waitFor(() => expect(store.get('cart')).toEqual({ count: 2 }));

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);

    loader.dispose();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves L0 light-DOM IDREF and form behavior without handler imports', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<cart-filter fw-c="cart-filter">',
      '<form id="filters">',
      '<label for="query">Search</label>',
      '<input id="query" name="query" value="coffee">',
      '<button type="submit">Apply</button>',
      '</form>',
      '</cart-filter>',
    ].join('');
    document.body.append(root);
    let imports = 0;

    installJisoLoader({
      async importModule() {
        imports += 1;
        return {};
      },
      root,
    });

    root.querySelector('label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(root.querySelector('#query'));
    });

    const form = root.querySelector('form');
    if (!form) throw new Error('missing form fixture');

    expect(new FormData(form).get('query')).toBe('coffee');
    expect(imports).toBe(0);
  });

  it('preserves L0 popover behavior without handler imports', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<button popovertarget="filters" popovertargetaction="toggle">Filters</button>',
      '<section id="filters" popover>Filter controls</section>',
    ].join('');
    document.body.append(root);
    let imports = 0;

    installJisoLoader({
      async importModule() {
        imports += 1;
        return {};
      },
      root,
    });

    const button = root.querySelector('button');
    const popover = root.querySelector<HTMLElement>('#filters');
    if (!button || !popover) throw new Error('missing popover fixture');

    expect(popover.matches(':popover-open')).toBe(false);

    button.click();

    await vi.waitFor(() => {
      expect(popover.matches(':popover-open')).toBe(true);
    });
    expect(imports).toBe(0);
  });

  it('preserves focus, selection, scroll, and keyed identity during a real DOM fragment morph', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form fw-c="cart-form">',
      '<label fw-key="label">Quantity</label>',
      '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea fw-key="quantity" name="quantity">12345</textarea>',
      '</form>',
    ].join('');
    document.body.append(root);
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[fw-key="panel"]');

    if (!textarea || !panel) throw new Error('missing browser fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const applied = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="cart-form">',
        '<form fw-c="cart-form">',
        '<textarea fw-key="quantity" name="quantity">67890</textarea>',
        '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
        '<label fw-key="label">Updated quantity</label>',
        '</form>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });
    const nextTextarea = root.querySelector('textarea');

    expect(applied.appliedFragments).toEqual(['cart-form']);
    expect(nextTextarea).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector<HTMLDivElement>('[fw-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
    expect(root.querySelector('label')?.textContent).toBe('Updated quantity');
  });

  it('appends real DOM fragments without replacing keyed list nodes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section fw-c="product-grid">',
      '<article fw-key="p1"><input value="keep"></article>',
      '<article fw-key="p2">Second</article>',
      '</section>',
    ].join('');
    document.body.append(root);
    const grid = root.querySelector('[fw-c="product-grid"]');
    const first = root.querySelector('[fw-key="p1"]');
    const second = root.querySelector('[fw-key="p2"]');
    const input = root.querySelector('input');

    if (!grid || !first || !second || !input) throw new Error('missing append fixture');

    input.focus();

    const appendResult = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid" mode="append">',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p4">Fourth</article>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(appendResult.appliedFragments).toEqual(['product-grid']);
    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect(document.activeElement).toBe(input);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);

    applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid">',
        '<section fw-c="product-grid">',
        '<article fw-key="p4">Fourth updated</article>',
        '<article fw-key="p1"><input value="keep"></article>',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p2">Second</article>',
        '</section>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p4',
      'p1',
      'p3',
      'p2',
    ]);
  });
});
