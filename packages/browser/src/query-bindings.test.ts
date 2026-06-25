import { describe, expect, it } from 'vitest';

import {
  setRuntimeSinkSecurityEventHandler,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  applyStateBindings,
  createQueryBindingIndex,
  supportsQueryBindings,
} from './query-bindings.js';
import {
  FakeMorphRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
  FakeStatefulBindingElement,
  FakeTemplateStampHost,
} from './runtime-test-fakes.js';

describe('query binding helpers', () => {
  it('applies DOM-shaped data-bind text, value, and attribute updates', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const total = new FakeQueryBindingElement('cart.total', { value: '0' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'old',
      'data-bind:aria-label': 'cart.label',
    });
    root.bindings.push(count, total);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'cart', { count: 3, label: null, total: 1499 })).toEqual([
      'cart.count',
      'cart.total',
      'cart.label',
    ]);
    expect(count.textContent).toBe('3');
    expect(total.value).toBe('1499');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'cart', { count: 4, label: 'Cart ready', total: 1999 });
    expect(label.getAttribute('aria-label')).toBe('Cart ready');
  });

  it('fails closed for unsafe query-bound URL, srcset, event, srcdoc, raw HTML, and CSS sinks', () => {
    const root = new FakeMorphRoot();
    const link = new FakeQueryPlanElement({
      'data-bind:href': 'cart.href',
      'data-bind:innerHTML': 'cart.html',
      'data-bind:onclick': 'cart.handler',
      'data-bind:srcdoc': 'cart.srcdoc',
      'data-bind:srcset': 'cart.srcset',
      'data-bind:style': 'cart.style',
      href: '/old',
      innerHTML: '<p>old</p>',
      onclick: 'old()',
      srcdoc: '<p>old</p>',
      srcset: '/old.png 1x',
      style: 'color: green',
    });
    root.planElements.push(link);
    const events: RuntimeSinkSecurityEvent[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));

    // SPEC.md §4.8: query refreshes share the same output-context floor as SSR.
    try {
      expect(
        applyQueryBindings(root, 'cart', {
          handler: 'alert(document.cookie)',
          href: 'java\nscript:alert(1)',
          html: '<img src=x onerror=alert(1)>',
          srcdoc: '<script>alert(1)</script>',
          srcset: '/safe.png 1x, javascript:alert(1) 2x',
          style: 'background:url(javascript:alert(1))',
        }),
      ).toEqual([
        'cart.href',
        'cart.html',
        'cart.handler',
        'cart.srcdoc',
        'cart.srcset',
        'cart.style',
      ]);
    } finally {
      restore();
    }
    expect(link.getAttribute('href')).toBe('#');
    expect(link.getAttribute('innerHTML')).toBeNull();
    expect(link.getAttribute('onclick')).toBeNull();
    expect(link.getAttribute('srcdoc')).toBeNull();
    expect(link.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(link.getAttribute('style')).toBeNull();
    expect(events).toHaveLength(6);
    expect(events.map((event) => [event.code, event.family, event.action])).toEqual([
      ['KV236', 'url', 'neutralize'],
      ['KV236', 'raw-html', 'remove'],
      ['KV236', 'event-handler', 'remove'],
      ['KV236', 'srcdoc', 'remove'],
      ['KV236', 'srcset', 'neutralize'],
      ['KV236', 'css-text', 'remove'],
    ]);
    expect(JSON.stringify(events)).not.toContain('document.cookie');
    expect(JSON.stringify(events)).not.toContain('alert');
  });

  it('applies optional binding path segments and removes empty attribute bindings', () => {
    const root = new FakeMorphRoot();
    const name = new FakeQueryBindingElement('deal.contact?.name', { textContent: 'Ada' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'Ada',
      'data-bind:aria-label': 'deal.contact?.name',
    });
    root.bindings.push(name);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'deal', { contact: null })).toEqual([
      'deal.contact?.name',
      'deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'deal', { contact: { name: 'Grace' } });
    expect(name.textContent).toBe('Grace');
    expect(label.getAttribute('aria-label')).toBe('Grace');
  });

  it('reuses indexed attribute binding candidates across compiled query plans', () => {
    const root = new FakeMorphRoot();
    const cartLabel = new FakeQueryPlanElement({
      'aria-label': 'old cart',
      'data-bind:aria-label': 'cart.label',
    });
    const productLabel = new FakeQueryPlanElement({
      'aria-label': 'old product',
      'data-bind:aria-label': 'product.label',
    });
    root.planElements.push(cartLabel, productLabel);

    const bindingIndex = createQueryBindingIndex(root);

    // SPEC.md §4.8: compiled query plans update every matching data-bind slot.
    // The response apply path reuses this index for all query chunks in one body
    // instead of full-document '*' scanning once per query chunk.
    expect(
      applyCompiledQueryUpdatePlan(root, 'cart', { label: 'Cart ready' }, {}, { bindingIndex }),
    ).toEqual({
      bindings: ['cart.label'],
      derives: [],
      stamps: [],
      templateStamps: [],
    });
    expect(
      applyCompiledQueryUpdatePlan(
        root,
        'product',
        { label: 'Product ready' },
        {},
        { bindingIndex },
      ),
    ).toEqual({
      bindings: ['product.label'],
      derives: [],
      stamps: [],
      templateStamps: [],
    });

    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
  });

  it('runs compiled query update plans in bindings, derives, stamps, then template-stamps order', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement(
      { 'data-derive': 'cart.summary' },
      { textContent: '1 item' },
    );
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const list = new FakeTemplateStampHost({
      'data-bind-list': 'cart.items',
      'kovo-key': 'productId',
    });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host, list);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      {
        count: 2,
        items: [
          { name: 'Mug', productId: 'p1', qty: 2 },
          { name: 'Beans', productId: 'p2', qty: 1 },
        ],
      },
      {
        derives: [
          {
            name: 'summary',
            select(value) {
              observed.push(`derive sees binding:${count.textContent}`);
              return `${(value as { count: number }).count} items`;
            },
          },
        ],
        stamps: [
          {
            attr: 'data-cart-summary',
            selector: '[data-plan="cart-host"]',
            select() {
              observed.push(`stamp sees derive:${summary.textContent}`);
              return summary.textContent;
            },
          },
        ],
        templateStamps: [
          {
            key: 'productId',
            list: 'items',
            render(item) {
              const product = item as { name: string; qty: number };
              return `<li><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: ['cart.count'],
      derives: ['summary'],
      stamps: ['data-cart-summary'],
      templateStamps: ['[data-bind-list="cart.items"]'],
    });
    expect(observed).toEqual(['derive sees binding:2', 'stamp sees derive:2 items']);
    expect(summary.textContent).toBe('2 items');
    expect(host.getAttribute('data-cart-summary')).toBe('2 items');
    expect(list.items.map((item) => item.key)).toEqual(['p1', 'p2']);
    expect(list.items.map((item) => item.index)).toEqual([0, 1]);
    expect(list.textContent).toBe(
      '<li><span data-bind=".qty">2</span> x <span data-bind=".name">Mug</span></li><li><span data-bind=".qty">1</span> x <span data-bind=".name">Beans</span></li>',
    );
  });

  it('removes compiled attribute stamps when the selected value is empty', () => {
    const root = new FakeMorphRoot();
    const host = new FakeQueryPlanElement({ 'aria-label': 'Ada', 'data-plan': 'deal-host' });
    root.planElements.push(host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'deal',
      { contact: null },
      {
        bindings: false,
        stamps: [
          {
            attr: 'aria-label',
            selector: '[data-plan="deal-host"]',
            select(value) {
              return (value as { contact: { name: string } | null }).contact?.name;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: ['aria-label'],
      templateStamps: [],
    });
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('applies same-island state bindings without query dependencies', async () => {
    const host = new FakeStatefulBindingElement({
      'data-bind:data-state': 'state.status',
      'kovo-state': '{"status":"idle"}',
    });
    const count = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: host, textContent: '0' },
    );
    const label = new FakeStatefulBindingElement(
      {
        'aria-label': 'Old',
        'data-bind:aria-label': 'state.label',
      },
      { parent: host },
    );

    await expect(
      applyStateBindings(host, { count: 2, label: 'Ready', status: 'open' }),
    ).resolves.toEqual(['state.count', 'state.status', 'state.label']);
    expect(count.textContent).toBe('2');
    expect(host.getAttribute('data-state')).toBe('open');
    expect(label.getAttribute('aria-label')).toBe('Ready');
  });

  it('keeps state binding walks scoped to the nearest state host', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"count":0}' });
    const count = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: host, textContent: '0' },
    );
    const nestedHost = new FakeStatefulBindingElement(
      { 'kovo-state': '{"count":100}' },
      { parent: host },
    );
    const nestedCount = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: nestedHost, textContent: '100' },
    );

    await expect(applyStateBindings(host, { count: 1 })).resolves.toEqual(['state.count']);
    expect(count.textContent).toBe('1');
    expect(nestedCount.textContent).toBe('100');
  });

  it('applies optional state path empty semantics to text and attributes', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"deal":{}}' });
    const name = new FakeStatefulBindingElement(
      { 'data-bind': 'state.deal.contact?.name' },
      { parent: host, textContent: 'Ada' },
    );
    const label = new FakeStatefulBindingElement(
      {
        'aria-label': 'Ada',
        'data-bind:aria-label': 'state.deal.contact?.name',
      },
      { parent: host },
    );

    await expect(applyStateBindings(host, { deal: { contact: null } })).resolves.toEqual([
      'state.deal.contact?.name',
      'state.deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();
  });

  it('lazy-imports state derive attribute bindings and removes empty results', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"open":false}' });
    const panel = new FakeStatefulBindingElement(
      {
        'data-bind:hidden': '/c/disclosure.client.js#Disclosure$panel_hidden_derive',
        hidden: '',
      },
      { parent: host },
    );
    const importModule = async () => ({
      Disclosure$panel_hidden_derive: {
        run(value: unknown) {
          return (value as { open: boolean }).open ? null : '';
        },
      },
    });

    await expect(applyStateBindings(host, { open: true }, { importModule })).resolves.toEqual([
      '/c/disclosure.client.js#Disclosure$panel_hidden_derive',
    ]);
    expect(panel.getAttribute('hidden')).toBeNull();

    await applyStateBindings(host, { open: false }, { importModule });
    expect(panel.getAttribute('hidden')).toBe('');
  });

  it('reflects state-derived checked bindings to the live input property', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"checked":false}' });
    const directInput = new FakeStatefulBindingElement(
      {
        checked: '',
        'data-bind:checked': 'state.checked',
      },
      { checked: true, parent: host },
    );
    const input = new FakeStatefulBindingElement(
      {
        'data-bind:checked': '/c/switch.client.js#Switch$input_checked_derive',
      },
      { checked: false, parent: host },
    );
    const importModule = async () => ({
      Switch$input_checked_derive: {
        run(value: unknown) {
          return (value as { checked: boolean }).checked ? '' : null;
        },
      },
    });

    await expect(applyStateBindings(host, { checked: true }, { importModule })).resolves.toEqual([
      'state.checked',
      '/c/switch.client.js#Switch$input_checked_derive',
    ]);
    // J3: checked is a boolean-presence attribute; direct state binding true → '' (present), not 'true'.
    expect(directInput.getAttribute('checked')).toBe('');
    expect(directInput.checked).toBe(true);
    expect(input.getAttribute('checked')).toBe('');
    expect(input.checked).toBe(true);

    await applyStateBindings(host, { checked: false }, { importModule });
    expect(directInput.getAttribute('checked')).toBeNull();
    expect(directInput.checked).toBe(false);
    expect(input.getAttribute('checked')).toBeNull();
    expect(input.checked).toBe(false);
  });

  it('reflects state-derived value attribute bindings to the live input property', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"value":2}' });
    const input = new FakeStatefulBindingElement(
      {
        'data-bind:value': '/c/number-field.client.js#NumberField$input_value_derive',
        value: '2',
      },
      { parent: host, value: '2' },
    );
    const importModule = async () => ({
      NumberField$input_value_derive: {
        run(value: unknown) {
          return (value as { value: number | undefined }).value;
        },
      },
    });

    await expect(applyStateBindings(host, { value: 5 }, { importModule })).resolves.toEqual([
      '/c/number-field.client.js#NumberField$input_value_derive',
    ]);
    expect(input.getAttribute('value')).toBe('5');
    expect(input.value).toBe('5');

    await applyStateBindings(host, { value: undefined }, { importModule });
    expect(input.getAttribute('value')).toBeNull();
    expect(input.value).toBe('');
  });

  it('assigns data-bind-prop:checked/indeterminate live properties across re-renders (SPEC §4.8)', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"checked":"indeterminate"}' });
    // The companion SSR attribute (checked) is attribute-only; data-bind-prop owns
    // the dirty .checked / .indeterminate properties after interaction.
    const input = new FakeStatefulBindingElement(
      {
        checked: '',
        'data-bind:checked': '/c/checkbox.client.js#Checkbox$input_checked_derive',
        'data-bind-prop:checked': '/c/checkbox.client.js#Checkbox$input_checked_derive',
        'data-bind-prop:indeterminate': '/c/checkbox.client.js#Checkbox$input_indeterminate_derive',
      },
      { checked: false, indeterminate: false, parent: host },
    );
    const importModule = async () => ({
      Checkbox$input_checked_derive: {
        run(value: unknown) {
          return (value as { checked: unknown }).checked === true ? '' : null;
        },
      },
      Checkbox$input_indeterminate_derive: {
        run(value: unknown) {
          return (value as { checked: unknown }).checked === 'indeterminate' ? '' : null;
        },
      },
    });

    // Indeterminate state: not .checked, but .indeterminate true.
    await applyStateBindings(host, { checked: 'indeterminate' }, { importModule });
    expect(input.checked).toBe(false);
    expect(input.indeterminate).toBe(true);

    // Checked state: .checked true, .indeterminate false.
    await applyStateBindings(host, { checked: true }, { importModule });
    expect(input.checked).toBe(true);
    expect(input.indeterminate).toBe(false);

    // Unchecked state: both false.
    await applyStateBindings(host, { checked: false }, { importModule });
    expect(input.checked).toBe(false);
    expect(input.indeterminate).toBe(false);
  });

  it('assigns data-bind-prop:scrollTop from a state path (SPEC §4.8)', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"scrollTop":0}' });
    // scrollTop is not an HTML attribute, so only the property write applies.
    const viewport = new FakeStatefulBindingElement(
      { 'data-bind-prop:scrolltop': 'state.scrollTop' },
      { parent: host, scrollTop: 0 },
    );

    await applyStateBindings(host, { scrollTop: 240 });
    expect(viewport.scrollTop).toBe(240);

    await applyStateBindings(host, { scrollTop: 0 });
    expect(viewport.scrollTop).toBe(0);
  });

  it('ignores a non-allowlisted data-bind-prop suffix (KV236 wall)', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"x":"<b>"}' });
    const el = new FakeStatefulBindingElement(
      { 'data-bind-prop:innerhtml': 'state.x' },
      { parent: host },
    );
    (el as unknown as Record<string, unknown>).innerHTML = 'safe';

    await applyStateBindings(host, { x: '<script>alert(1)</script>' });
    expect((el as unknown as Record<string, unknown>).innerHTML).toBe('safe');
  });

  it('removes native progress value bindings without restoring determinate state', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"value":40}' });
    const progress = new FakeStatefulBindingElement(
      {
        'data-bind:value': '/c/progress.client.js#Progress$value_derive',
        value: '40',
      },
      { parent: host },
    );
    let liveValue = '40';
    Object.defineProperty(progress, 'tagName', { value: 'PROGRESS' });
    Object.defineProperty(progress, 'value', {
      configurable: true,
      get: () => liveValue,
      set: (value: string) => {
        liveValue = value;
        progress.setAttribute('value', value);
      },
    });
    const importModule = async () => ({
      Progress$value_derive: {
        run(value: unknown) {
          return (value as { value: number | null }).value;
        },
      },
    });

    await expect(applyStateBindings(host, { value: 100 }, { importModule })).resolves.toEqual([
      '/c/progress.client.js#Progress$value_derive',
    ]);
    expect(progress.getAttribute('value')).toBe('100');
    expect(progress.value).toBe('100');

    await applyStateBindings(host, { value: null }, { importModule });
    expect(progress.getAttribute('value')).toBeNull();
  });

  it('reflects state-derived scroll attribute bindings to live scroll properties', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"scrollTop":0}' });
    const viewport = new FakeStatefulBindingElement(
      {
        'data-bind:scrollleft': 'state.scrollLeft',
        'data-bind:scrolltop': 'state.scrollTop',
      },
      { parent: host, scrollLeft: 0, scrollTop: 0 },
    );

    await expect(applyStateBindings(host, { scrollLeft: 12, scrollTop: 160 })).resolves.toEqual([
      'state.scrollLeft',
      'state.scrollTop',
    ]);
    expect(viewport.getAttribute('scrollleft')).toBe('12');
    expect(viewport.scrollLeft).toBe(12);
    expect(viewport.getAttribute('scrolltop')).toBe('160');
    expect(viewport.scrollTop).toBe(160);

    await applyStateBindings(host, { scrollLeft: undefined, scrollTop: undefined });
    expect(viewport.getAttribute('scrollleft')).toBeNull();
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.getAttribute('scrolltop')).toBeNull();
    expect(viewport.scrollTop).toBe(0);
  });

  it('reflects state-derived indeterminate bindings to the live input property', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"checked":"indeterminate"}' });
    const input = new FakeStatefulBindingElement(
      {
        'data-bind:indeterminate': '/c/checkbox.client.js#Checkbox$input_indeterminate_derive',
      },
      { indeterminate: false, parent: host },
    );
    const importModule = async () => ({
      Checkbox$input_indeterminate_derive: {
        run(value: unknown) {
          return (value as { checked: boolean | 'indeterminate' }).checked === 'indeterminate'
            ? ''
            : null;
        },
      },
    });

    await expect(
      applyStateBindings(host, { checked: 'indeterminate' }, { importModule }),
    ).resolves.toEqual(['/c/checkbox.client.js#Checkbox$input_indeterminate_derive']);
    expect(input.getAttribute('indeterminate')).toBe('');
    expect(input.indeterminate).toBe(true);

    await applyStateBindings(host, { checked: true }, { importModule });
    expect(input.getAttribute('indeterminate')).toBeNull();
    expect(input.indeterminate).toBe(false);
  });

  it('lazy-imports state derive text bindings', async () => {
    const host = new FakeStatefulBindingElement({ 'kovo-state': '{"value":""}' });
    const output = new FakeStatefulBindingElement(
      { 'data-bind': '/c/accordion.client.js#Accordion$output_text_derive' },
      { parent: host, textContent: 'old' },
    );
    const importModule = async () => ({
      Accordion$output_text_derive: {
        run(value: unknown) {
          return (value as { value: string }).value || 'none';
        },
      },
    });

    await expect(applyStateBindings(host, { value: '' }, { importModule })).resolves.toEqual([
      '/c/accordion.client.js#Accordion$output_text_derive',
    ]);
    expect(output.textContent).toBe('none');
  });

  it('detects query binding roots by selector support', () => {
    expect(supportsQueryBindings(new FakeMorphRoot())).toBe(true);
    expect(supportsQueryBindings({})).toBe(false);
  });

  // J3: query-driven boolean-presence attributes must remove on falsy, set '' on truthy.
  // (SPEC §1.1/§4.6/§4.8 — raw booleans from query source must not write 'false'/'true'.)
  it('treats boolean-presence attributes uniformly: true → present, false → removed', () => {
    const root = new FakeMorphRoot();
    const button = new FakeQueryPlanElement({
      'data-bind:disabled': 'cart.isEmpty',
      disabled: '',
    });
    const details = new FakeQueryPlanElement({
      'data-bind:open': 'nav.expanded',
    });
    const option = new FakeQueryPlanElement({
      'data-bind:selected': 'option.active',
    });
    root.planElements.push(button, details, option);

    // true → setAttribute to '' (present)
    applyCompiledQueryUpdatePlan(root, 'cart', { isEmpty: true }, {});
    expect(button.getAttribute('disabled')).toBe('');

    // false → removeAttribute (not 'false')
    applyCompiledQueryUpdatePlan(root, 'cart', { isEmpty: false }, {});
    expect(button.getAttribute('disabled')).toBeNull();

    // truthy non-boolean → present
    applyCompiledQueryUpdatePlan(root, 'nav', { expanded: 1 }, {});
    expect(details.getAttribute('open')).toBe('');

    // null → removed (falsy via null check)
    applyCompiledQueryUpdatePlan(root, 'option', { active: null }, {});
    expect(option.getAttribute('selected')).toBeNull();
  });

  // J3: also covers disabled/hidden/readonly/required/multiple/selected/open.
  it('removes boolean-presence attribute data-bind:hidden when value is false', () => {
    const root = new FakeMorphRoot();
    const panel = new FakeQueryPlanElement({
      'data-bind:hidden': 'modal.closed',
      hidden: '',
    });
    root.planElements.push(panel);

    // Starts hidden (setAttribute '' expected on true).
    applyCompiledQueryUpdatePlan(root, 'modal', { closed: true }, {});
    expect(panel.getAttribute('hidden')).toBe('');

    // Now remove when false.
    applyCompiledQueryUpdatePlan(root, 'modal', { closed: false }, {});
    expect(panel.getAttribute('hidden')).toBeNull();
  });
});
