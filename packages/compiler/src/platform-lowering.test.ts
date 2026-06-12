import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

function expectHandlerRef(source: string, path: string, exportName: string): void {
  expect(source).toMatch(
    new RegExp(`${escapeRegExp(path)}\\?v=[0-9a-f]{8}#${escapeRegExp(exportName)}`),
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
export const CartButton = component('cart-button', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>
      Open cart
    </button>
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
      "'CartButton:button:click:cart-drawer': 'dialog:show-modal';",
    );
  });

  it('lowers requestClose dialog behavior to a valid invoker command', () => {
    const result = compileComponentModule({
      fileName: 'cart-close-button.tsx',
      source: `
export const CartCloseButton = component('cart-close-button', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.requestClose()}>
      Close cart
    </button>
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
      "'CartCloseButton:button:click:cart-drawer': 'dialog:request-close';",
    );
  });

  it('lowers typed document element actions through the parser model', () => {
    const result = compileComponentModule({
      fileName: 'cart-close-button.tsx',
      source: `
export const CartCloseButton = component('cart-close-button', {
  render: () => (
    <button onClick={() => (document.getElementById('cart-drawer') as HTMLDialogElement).requestClose()}>
      Close cart
    </button>
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
export const FilterButton = component('filter-button', {
  render: () => <button onClick={() => document.getElementById('filters')!.togglePopover()}>Filters</button>,
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
export const CartButton = component('cart-button', {
  render: () => {
    const sample = "<button onClick={() => document.getElementById('missing')!.showModal()} />";
    // <button onClick={() => document.getElementById('also-missing')!.showModal()} />
    return <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>;
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
export const ShippingDetails = component('shipping-details', {
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
      "'ShippingDetails:summary:click:shipping': 'details:toggle';",
    );
  });

  it('keeps unsupported details JavaScript as a handler instead of inventing platform attributes', () => {
    const result = compileComponentModule({
      fileName: 'accordion-toggle.tsx',
      source: `
export const AccordionToggle = component('accordion-toggle', {
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
});
