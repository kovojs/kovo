import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('compiler attribute merge diagnostics', () => {
  it('merges primitive attrs-function records into the author element on the wire', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      registryFacts: { queries: { cart: 'CartQuery', product: 'ProductQuery' } },
      source: `
export const PrimitiveMerge = component({
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
          'kovo-deps': 'cart',
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
            kovo-deps="product"
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
    expect(serverSource).toContain('kovo-deps="cart product"');
    expect(serverSource).toContain('type="submit"');
    expect(serverSource).not.toContain('Tooltip.Trigger');
    expect(serverSource).not.toContain('{...attrs}');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV231',
      'KV232',
      'KV232',
      'KV231',
      'KV233',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Unmergeable attribute conflict in primitive composition. aria-controls (writers: primitive attrs, author JSX)',
      'Author overrides a primitive-owned ARIA or state attribute. aria-label (writers: primitive attrs, author JSX)',
      'Author overrides a primitive-owned ARIA or state attribute. data-state (writers: primitive attrs, author JSX)',
      'Unmergeable attribute conflict in primitive composition. data-p-id (writers: primitive attrs, author JSX)',
      'Two writers target the same binding slot. data-bind (writers: primitive attrs, author JSX)',
    ]);
  });

  it('rewrites primitive IDREFs when an authored id wins in the composition group', () => {
    const result = compileComponentModule({
      fileName: 'primitive-id-rewrite.tsx',
      source: `
export const PrimitiveIdRewrite = component({
  render: () => (
    <primitive-id-rewrite>
      <Primitive.Trigger
        asChild
        attrs={{
          'aria-controls': 'primitive-dialog',
          command: 'show-modal',
          commandfor: 'primitive-dialog',
          type: 'button',
        }}
      >
        <button>Open</button>
      </Primitive.Trigger>
      <Primitive.Content
        asChild
        attrs={{
          id: 'primitive-dialog',
          'aria-labelledby': 'primitive-title',
        }}
      >
        <dialog id="author-dialog">
          <h1 id="primitive-title">Title</h1>
        </dialog>
      </Primitive.Content>
    </primitive-id-rewrite>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('aria-controls="author-dialog"');
    expect(serverSource).toContain('commandfor="author-dialog"');
    expect(serverSource).toContain('id="author-dialog"');
    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV231, KV232, and KV233 for residual attribute merge conflicts', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component({
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" kovo-c="primitive-merge" kovo-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV231',
        fileName: 'primitive-merge.tsx',
        length: 19,
        message: 'Unmergeable attribute conflict in primitive composition. commandfor',
        severity: 'error',
        start: { column: 15, line: 7 },
      },
      {
        code: 'KV231',
        fileName: 'primitive-merge.tsx',
        length: 15,
        message: 'Unmergeable attribute conflict in primitive composition. data-p-id',
        severity: 'error',
        start: { column: 56, line: 7 },
      },
      {
        code: 'KV231',
        fileName: 'primitive-merge.tsx',
        length: 24,
        message: 'Unmergeable attribute conflict in primitive composition. kovo-c',
        severity: 'error',
        start: { column: 88, line: 7 },
      },
      {
        code: 'KV232',
        fileName: 'primitive-merge.tsx',
        length: 20,
        message: 'Author overrides a primitive-owned ARIA or state attribute. aria-expanded',
        severity: 'lint',
        start: { column: 37, line: 8 },
      },
      {
        code: 'KV232',
        fileName: 'primitive-merge.tsx',
        length: 11,
        message: 'Author overrides a primitive-owned ARIA or state attribute. role',
        severity: 'lint',
        start: { column: 72, line: 8 },
      },
      {
        code: 'KV232',
        fileName: 'primitive-merge.tsx',
        length: 17,
        message: 'Author overrides a primitive-owned ARIA or state attribute. data-state',
        severity: 'lint',
        start: { column: 104, line: 8 },
      },
      {
        code: 'KV233',
        fileName: 'primitive-merge.tsx',
        length: 22,
        message: 'Two writers target the same binding slot. data-bind',
        severity: 'error',
        start: { column: 13, line: 9 },
      },
      {
        code: 'KV233',
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
export const PrimitiveMerge = component({
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
export const PrimitiveMerge = component({
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

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV232', 'KV233']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Author overrides a primitive-owned ARIA or state attribute. role',
      'Two writers target the same binding slot. data-bind',
    ]);
  });
});
