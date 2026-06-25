import { afterEach, describe, expect, it, vi } from 'vitest';

import { installKovoLoader } from './client.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser loader behavior', () => {
  it('keeps the P2 L0+L1 demo interactive at first paint with zero JS before declared triggers', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section aria-label="P2 smoke demo">',
      '<nav kovo-c="catalog-tabs" kovo-state="{&quot;selected&quot;:&quot;featured&quot;}">',
      '<button type="button" aria-controls="featured" aria-selected="true" on:click="/c/demo/tabs.js#select" data-p-tab="featured">Featured</button>',
      '<button type="button" aria-controls="sale" aria-selected="false" on:click="/c/demo/tabs.js#select" data-p-tab="sale">Sale</button>',
      '</nav>',
      '<section id="featured">Featured products</section>',
      '<section id="sale" hidden>Sale products</section>',
      '<button commandfor="details-dialog" command="show-modal">Details</button>',
      '<dialog id="details-dialog"><form method="dialog"><button value="close">Close</button></form></dialog>',
      '<form kovo-c="catalog-filter" kovo-state="{&quot;query&quot;:&quot;&quot;}">',
      '<label for="filter-query">Filter</label>',
      '<input id="filter-query" name="query" on:input="/c/demo/filter.js#filter" value="">',
      '<output data-bind="filter.query"></output>',
      '</form>',
      '<aside kovo-c="sales-chart" on:visible="/c/demo/chart.js#mount" data-chart-mounted="false">Chart</aside>',
      '</section>',
    ].join('');
    document.body.append(root);

    let visibleCallback: (entries: { isIntersecting: boolean; target: Element }[]) => void = (
      _entries,
    ) => {
      throw new Error('missing visible observer callback');
    };
    const imports: string[] = [];
    const chart = root.querySelector<HTMLElement>('[kovo-c="sales-chart"]');
    const dialog = root.querySelector<HTMLDialogElement>('#details-dialog');
    const filterInput = root.querySelector<HTMLInputElement>('#filter-query');
    const filterOutput = root.querySelector<HTMLOutputElement>('output');
    const saleTab = root.querySelector<HTMLButtonElement>('[data-p-tab="sale"]');

    if (!chart || !dialog || !filterInput || !filterOutput || !saleTab) {
      throw new Error('missing P2 smoke fixture');
    }

    installKovoLoader({
      async importModule(url) {
        imports.push(url);

        if (url === '/c/demo/tabs.js') {
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

        if (url === '/c/demo/filter.js') {
          return {
            filter(event: Event, ctx: { state: { query: string } }) {
              ctx.state.query = (event.target as HTMLInputElement).value;
              filterOutput.textContent = ctx.state.query;
            },
          };
        }

        if (url === '/c/demo/chart.js') {
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
      expect(imports).toEqual(['/c/demo/filter.js']);
      expect(filterOutput.textContent).toBe('beans');
    });

    saleTab.click();

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/demo/filter.js', '/c/demo/tabs.js']);
      expect(saleTab.getAttribute('aria-selected')).toBe('true');
      expect(root.querySelector<HTMLElement>('#sale')?.hidden).toBe(false);
      expect(root.querySelector<HTMLElement>('#featured')?.hidden).toBe(true);
    });

    visibleCallback([{ isIntersecting: true, target: chart }]);

    await vi.waitFor(() => {
      expect(imports).toEqual(['/c/demo/filter.js', '/c/demo/tabs.js', '/c/demo/chart.js']);
      expect(chart.dataset.chartMounted).toBe('true');
    });
  });

  it('keeps the loader idle until the first delegated interaction', async () => {
    const root = document.createElement('main');
    root.innerHTML =
      '<button kovo-state="{&quot;count&quot;:0}" on:click="/c/handlers/cart.js#increment" data-p-product-id="p1">Add</button>';
    document.body.append(root);
    const button = root.querySelector('button');
    let imports = 0;

    installKovoLoader({
      async importModule(url) {
        imports += 1;
        expect(url).toBe('/c/handlers/cart.js');

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
      expect(button?.getAttribute('kovo-state')).toBe('{"count":1}');
    });
  });

  it('preserves L0 light-DOM IDREF and form behavior without handler imports', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<cart-filter kovo-c="cart-filter">',
      '<form id="filters">',
      '<label for="query">Search</label>',
      '<input id="query" name="query" value="coffee">',
      '<button type="submit">Apply</button>',
      '</form>',
      '</cart-filter>',
    ].join('');
    document.body.append(root);
    let imports = 0;

    installKovoLoader({
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

    installKovoLoader({
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
});
