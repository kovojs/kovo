import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

function expectHandlerRef(source: string, path: string, exportName: string): void {
  const relativePath = escapeRegExp(path.replace(/^\/c\//, ''));
  expect(source).toMatch(
    new RegExp(`/c/__v/[0-9a-f]{16}-[0-9a-f]{8}/${relativePath}#${escapeRegExp(exportName)}`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('platform lowering', () => {
  it('lowers provable dialog behavior to platform attributes instead of client handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>
        Open cart
      </button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'cart-button/cart-button:button:click:cart-drawer': 'dialog:show-modal';",
    );
  });

  it('reports author conflicts with structural platform behavior writers', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component({
  render: () => (
    <section>
      <button commandfor="manual-drawer" onClick={() => document.getElementById('cart-drawer')!.showModal()}>
        Open cart
      </button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV231'))
      .toMatchInlineSnapshot(`
      [
        {
          "code": "KV231",
          "fileName": "cart-button.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 26,
          "message": "Unmergeable attribute conflict in primitive composition. commandfor (writers: author JSX, platform behavior lowering)",
          "severity": "error",
          "start": {
            "column": 15,
            "line": 5,
          },
        },
        {
          "code": "KV231",
          "fileName": "cart-button.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 26,
          "message": "Unmergeable attribute conflict in primitive composition. commandfor",
          "severity": "error",
          "start": {
            "column": 15,
            "line": 5,
          },
        },
      ]
    `);
  });

  it('lowers requestClose dialog behavior to a valid invoker command', () => {
    const result = compileComponentModule({
      fileName: 'cart-close-button.tsx',
      source: `
export const CartCloseButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('cart-drawer')!.requestClose()}>
        Close cart
      </button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'request-close',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="request-close"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'cart-close-button/cart-close-button:button:click:cart-drawer': 'dialog:request-close';",
    );
  });

  it('lowers typed document element actions through the parser model', () => {
    const result = compileComponentModule({
      fileName: 'cart-close-button.tsx',
      source: `
export const CartCloseButton = component({
  render: () => (
    <section>
      <button onClick={() => (document.getElementById('cart-drawer') as HTMLDialogElement).requestClose()}>
        Close cart
      </button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'request-close',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="request-close"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });

  it('lowers provable popover behavior to popover target attributes', () => {
    const result = compileComponentModule({
      fileName: 'filter-button.tsx',
      source: `
export const FilterButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('filters')!.togglePopover()}>Filters</button>
      <div id="filters" popover>Filters</div>
    </section>
  ),
});
`,
    });

    expect(result.platformSubstitutions).toEqual([
      {
        action: 'toggle',
        event: 'click',
        kind: 'popover',
        tag: 'button',
        target: 'filters',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      'popovertarget="filters" popovertargetaction="toggle"',
    );
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });

  it('ignores platform behavior text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component({
  render: () => {
    const sample = "<button onClick={() => document.getElementById('missing')!.showModal()} />";
    // <button onClick={() => document.getElementById('also-missing')!.showModal()} />
    return (
      <section>
        <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>
        <dialog id="cart-drawer">Cart</dialog>
      </section>
    );
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(serverSource).toContain("document.getElementById('missing')!.showModal()");
    expect(serverSource).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(serverSource).not.toContain("document.getElementById('cart-drawer')!.showModal()");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers provable details summary toggles by dropping redundant JavaScript', () => {
    const result = compileComponentModule({
      fileName: 'shipping-details.tsx',
      source: `
export const ShippingDetails = component({
  render: () => (
    <details id="shipping">
      <summary onClick={() => document.getElementById('shipping')!.open = !document.getElementById('shipping')!.open}>
        Shipping
      </summary>
      <p>Usually ships tomorrow.</p>
    </details>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'toggle',
        event: 'click',
        kind: 'details',
        tag: 'summary',
        target: 'shipping',
      },
    ]);
    expect(result.files[0]?.source).toContain('<summary>');
    expect(result.files[0]?.source).not.toContain('on:click=');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'shipping-details/shipping-details:summary:click:shipping': 'details:toggle';",
    );
  });

  it('keeps unsupported details JavaScript as a handler instead of inventing platform attributes', () => {
    const result = compileComponentModule({
      fileName: 'accordion-toggle.tsx',
      source: `
export const AccordionToggle = component({
  render: () => (
    <button onClick={() => document.getElementById('shipping')!.open = true}>
      Shipping
    </button>
  ),
});
`,
    });

    // SPEC §5.2.4 names <details> as an L0 target, but this JS assignment has no
    // dialog-style commandfor equivalent in the current compiler model.
    expect(result.platformSubstitutions).toEqual([]);
    expectHandlerRef(
      result.files[0]?.source ?? '',
      '/c/accordion-toggle.client.js',
      'AccordionToggle$button_click',
    );
    expect(result.files[1]?.source).toContain('export const AccordionToggle$button_click');
  });

  it('keeps dialog JavaScript when the host is not a platform invoker button', () => {
    const result = compileComponentModule({
      fileName: 'cart-link.tsx',
      source: `
export const CartLink = component({
  render: () => (
    <section>
      <a href="/cart" onClick={() => document.getElementById('cart-drawer')!.showModal()}>
        Open cart
      </a>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.platformSubstitutions).toEqual([]);
    expect(result.files[0]?.source).not.toContain('commandfor="cart-drawer"');
    expectHandlerRef(result.files[0]?.source ?? '', '/c/cart-link.client.js', 'CartLink$a_click');
  });

  it('keeps dialog JavaScript when the target is not a dialog', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>
        Open cart
      </button>
      <div id="cart-drawer">Cart</div>
    </section>
  ),
});
`,
    });

    expect(result.platformSubstitutions).toEqual([]);
    expect(result.files[0]?.source).not.toContain('commandfor="cart-drawer"');
    expectHandlerRef(
      result.files[0]?.source ?? '',
      '/c/cart-button.client.js',
      'CartButton$button_click',
    );
  });

  it('keeps popover JavaScript when the target is not popover-bearing', () => {
    const result = compileComponentModule({
      fileName: 'filter-button.tsx',
      source: `
export const FilterButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('filters')!.togglePopover()}>Filters</button>
      <div id="filters">Filters</div>
    </section>
  ),
});
`,
    });

    expect(result.platformSubstitutions).toEqual([]);
    expect(result.files[0]?.source).not.toContain('popovertarget="filters"');
    expectHandlerRef(
      result.files[0]?.source ?? '',
      '/c/filter-button.client.js',
      'FilterButton$button_click',
    );
  });
});
