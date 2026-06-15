import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('compiler attribute merge diagnostics', () => {
  it('merges primitive attrs-function records into the author element on the wire', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      registryFacts: { queries: { cart: 'CartQuery', product: 'ProductQuery' } },
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <primitive-merge>
      <div id="author-panel"></div>
      <Tooltip.Trigger
        attrs={{
          class: 'primitive base',
          style: 'color: red;',
          'on:click': '/c/primitive#click',
          id: 'primitive-trigger',
          'aria-controls': 'primitive-panel',
          'aria-label': 'Primitive label',
          'data-state': 'closed',
          'data-p-id': 'primitive-id',
          'data-bind': 'cart.count',
          required: true,
          'fw-deps': 'cart',
          type: 'button',
        }}
      >
        {(attrs) => (
          <button
            {...attrs}
            class="author base"
            style="background: blue;"
            on:click="/c/author#click"
            id="author-trigger"
            aria-controls="author-panel"
            aria-label="Author label"
            data-state="author-open"
            data-p-id="author-id"
            data-bind="cart.total"
            disabled
            required={false}
            fw-deps="product"
            type="submit"
          >
            Toggle
          </button>
        )}
      </Tooltip.Trigger>
    </primitive-merge>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('class="primitive base author"');
    expect(serverSource).toContain('style="color: red; background: blue"');
    expect(serverSource).toContain('on:click="/c/author#click /c/primitive#click"');
    expect(serverSource).toContain('id="author-trigger"');
    expect(serverSource).toContain('aria-controls="author-panel"');
    expect(serverSource).toContain('aria-label="Author label"');
    expect(serverSource).toContain('data-state="closed"');
    expect(serverSource).toContain('data-p-id="author-id"');
    expect(serverSource).toContain('data-bind="cart.total"');
    expect(serverSource).toContain('required');
    expect(serverSource).toContain('disabled');
    expect(serverSource).toContain('fw-deps="cart product"');
    expect(serverSource).toContain('type="submit"');
    expect(serverSource).not.toContain('Tooltip.Trigger');
    expect(serverSource).not.toContain('{...attrs}');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'FW231',
      'FW232',
      'FW232',
      'FW231',
      'FW233',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Unmergeable attribute conflict in primitive composition. aria-controls',
      'Author overrides a primitive-owned ARIA or state attribute. aria-label',
      'Author overrides a primitive-owned ARIA or state attribute. data-state',
      'Unmergeable attribute conflict in primitive composition. data-p-id',
      'Two writers target the same binding slot. data-bind',
    ]);
  });

  it('reports FW231, FW232, and FW233 for residual attribute merge conflicts', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" fw-c="primitive-merge" fw-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 19,
        message: 'Unmergeable attribute conflict in primitive composition. commandfor',
        severity: 'error',
        start: { column: 15, line: 7 },
      },
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 15,
        message: 'Unmergeable attribute conflict in primitive composition. data-p-id',
        severity: 'error',
        start: { column: 56, line: 7 },
      },
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 22,
        message: 'Unmergeable attribute conflict in primitive composition. fw-c',
        severity: 'error',
        start: { column: 88, line: 7 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 20,
        message: 'Author overrides a primitive-owned ARIA or state attribute. aria-expanded',
        severity: 'lint',
        start: { column: 37, line: 8 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 11,
        message: 'Author overrides a primitive-owned ARIA or state attribute. role',
        severity: 'lint',
        start: { column: 72, line: 8 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 17,
        message: 'Author overrides a primitive-owned ARIA or state attribute. data-state',
        severity: 'lint',
        start: { column: 104, line: 8 },
      },
      {
        code: 'FW233',
        fileName: 'primitive-merge.tsx',
        length: 22,
        message: 'Two writers target the same binding slot. data-bind',
        severity: 'error',
        start: { column: 13, line: 9 },
      },
      {
        code: 'FW233',
        fileName: 'primitive-merge.tsx',
        length: 29,
        message: 'Two writers target the same binding slot. data-bind:hidden',
        severity: 'error',
        start: { column: 59, line: 9 },
      },
    ]);
  });

  it('ignores attribute merge text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => {
    const sample = '<button role="button" role="link"></button>';
    // <button data-state="closed" data-state="open"></button>
    return <button role="button">Open</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports merge diagnostics after static primitive attr spread lowering', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <button
      {...{
        role: 'button',
        'data-bind': 'cart.count',
      }}
      role="link"
      data-bind="cart.total"
    >
      Toggle
    </button>
  ),
});
`,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['FW232', 'FW233']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Author overrides a primitive-owned ARIA or state attribute. role',
      'Two writers target the same binding slot. data-bind',
    ]);
  });
});
