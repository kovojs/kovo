import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { serverRenderLowering } from './emit/server.js';
import { parseComponentModule } from './scan/parse.js';

const cartAddMutationInputs = [
  {
    coercion: 'string',
    defaulted: false,
    name: 'productId',
    optional: false,
    provenance: 'registry',
    required: true,
  },
  {
    coercion: 'number',
    defaulted: true,
    name: 'quantity',
    optional: false,
    provenance: 'registry',
    required: false,
  },
] as const;

function requireLoweredSource(result: ReturnType<typeof compileComponentModule>): string {
  if (result.loweredSource === null) throw new TypeError('expected lowered source');
  return result.loweredSource;
}

describe('compiler stamps', () => {
  it('exposes server host stamps as parsed source patches', () => {
    const source = `
export const Recommendations = component({
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => (
    <section class="card" kovo-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`;
    const model = parseComponentModule('recommendations.tsx', source);
    const lowering = serverRenderLowering([], model, 'recommendations');
    const kovoDepsStart = source.indexOf("kovo-deps='product:p1'");
    const insertPosition = source.indexOf('>', kovoDepsStart);

    expect(lowering.replacements).toEqual([
      {
        end: kovoDepsStart + "kovo-deps='product:p1'".length,
        replacement: 'kovo-deps="product:p1 cart"',
        start: kovoDepsStart,
      },
      {
        end: insertPosition,
        replacement:
          ' kovo-c="recommendations" kovo-fragment-target="recommendations" kovo-live-component="recommendations" kovo-state="{&quot;open&quot;:true}"',
        start: insertPosition,
      },
    ]);
    expect(lowering.outputContexts).toMatchInlineSnapshot(`
      [
        {
          "context": "attribute",
          "expression": "recommendations",
          "sink": "kovo-c",
          "source": "server-render",
          "writer": "host identity stamp",
        },
        {
          "context": "attribute",
          "expression": "product:p1 cart",
          "sink": "kovo-deps",
          "source": "server-render",
          "writer": "host dependency stamp",
        },
        {
          "context": "attribute",
          "expression": "recommendations",
          "sink": "kovo-fragment-target",
          "source": "server-render",
          "writer": "host fragment target stamp",
        },
        {
          "context": "attribute",
          "expression": "recommendations",
          "sink": "kovo-live-component",
          "source": "server-render",
          "writer": "host live component stamp",
        },
        {
          "context": "attribute",
          "expression": "{"open":true}",
          "sink": "kovo-state",
          "source": "server-render",
          "writer": "host state stamp",
        },
      ]
    `);
    expect(lowering.stampWrites).toMatchInlineSnapshot(`
      [
        {
          "attr": "kovo-c",
          "mode": "insert",
          "value": "recommendations",
          "writer": "host identity stamp",
        },
        {
          "attr": "kovo-deps",
          "mode": "replace",
          "value": "product:p1 cart",
          "writer": "host dependency stamp",
        },
        {
          "attr": "kovo-fragment-target",
          "mode": "insert",
          "value": "recommendations",
          "writer": "host fragment target stamp",
        },
        {
          "attr": "kovo-live-component",
          "mode": "insert",
          "value": "recommendations",
          "writer": "host live component stamp",
        },
        {
          "attr": "kovo-state",
          "mode": "insert",
          "value": "{"open":true}",
          "writer": "host state stamp",
        },
      ]
    `);
    expect(lowering.diagnostics).toEqual([]);
  });

  it('reports author conflicts with terminal server and handler stamp writers', () => {
    const result = compileComponentModule({
      fileName: 'stamp-conflict.tsx',
      registryFacts: { components: ['other-widget'] },
      source: `
export const StampConflict = component({
  queries: { item: itemQuery },
  state: () => ({ open: true }),
  render: ({ item }) => (
    <section kovo-c="other-widget" kovo-state="{&quot;open&quot;:false}">
      <button data-p-id="author" onClick={() => save(item.id)}>Save</button>
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
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 18,
          "message": "Unmergeable attribute conflict in primitive composition. data-p-id (writers: author JSX, event handler param lowering)",
          "severity": "error",
          "start": {
            "column": 15,
            "line": 7,
          },
        },
        {
          "code": "KV231",
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 21,
          "message": "Unmergeable attribute conflict in primitive composition. kovo-c (writers: author JSX, host identity stamp)",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
        {
          "code": "KV231",
          "fileName": "stamp-conflict.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 37,
          "message": "Unmergeable attribute conflict in primitive composition. kovo-state (writers: author JSX, host state stamp)",
          "severity": "error",
          "start": {
            "column": 36,
            "line": 6,
          },
        },
      ]
    `);
  });

  it('lowers typed enhanced mutation forms to submitted target stamps', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: (_queries, _state, slots) => (
    <form enhance mutation={addToCart} key={slots.productId} class="add">
      <input type="hidden" name="productId" value={slots.productId} />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    const loweredSource = requireLoweredSource(result);
    expect(loweredSource).toContain(
      '<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${slots.productId}`} kovo-key={slots.productId} class="add"',
    );
    expect(loweredSource).toContain(
      "import { renderMutationCsrfField as __kovoRenderMutationCsrfField, renderMutationIdemField as __kovoRenderMutationIdemField } from '@kovojs/server/internal/csrf';",
    );
    expect(loweredSource.match(/__kovoRenderMutationCsrfField\(addToCart\)/g)).toHaveLength(1);
    // A2 (SPEC §10.3): a per-submit Kovo-Idem hidden field is emitted alongside the CSRF field.
    expect(loweredSource.match(/__kovoRenderMutationIdemField\(\)/g)).toHaveLength(1);
    expect(loweredSource).not.toContain('mutation={addToCart}');
    expect(loweredSource).not.toMatch(/\skey=\{slots\.productId\}/);
    expect(result.outputContextFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: '/_m/cart/add',
          sink: 'action',
          writer: 'typed mutation form lowering',
        }),
        expect.objectContaining({
          expression: 'cart/add',
          sink: 'data-mutation',
          writer: 'typed mutation form lowering',
        }),
        expect.objectContaining({
          expression: 'add-to-cart:${slots.productId}',
          sink: 'kovo-fragment-target',
          writer: 'typed mutation form lowering',
        }),
        expect.objectContaining({
          expression: 'slots.productId',
          sink: 'kovo-key',
          writer: 'typed mutation form lowering',
        }),
      ]),
    );
    expect(() => assertRenderEquivalence(result)).not.toThrow();
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers streaming enhanced mutation forms without changing non-stream forms', () => {
    const streaming = compileComponentModule({
      fileName: 'streaming-chat-form.tsx',
      source: `
export const sendMessage = mutation('chat/send', {
  handler() {
    return null;
  },
});

export const ChatComposer = component({
  render: (_queries, _state, slots) => (
    <form enhance stream mutation={sendMessage} key={slots.threadId} class="composer">
      <input name="message" />
    </form>
  ),
});
`,
    });
    const buffered = compileComponentModule({
      fileName: 'buffered-chat-form.tsx',
      source: `
export const sendMessage = mutation('chat/send', {
  handler() {
    return null;
  },
});

export const ChatComposer = component({
  render: (_queries, _state, slots) => (
    <form enhance mutation={sendMessage} key={slots.threadId} class="composer">
      <input name="message" />
    </form>
  ),
});
`,
    });

    expect(streaming.diagnostics).toEqual([]);
    expect(buffered.diagnostics).toEqual([]);
    const streamingSource = requireLoweredSource(streaming);
    const bufferedSource = requireLoweredSource(buffered);
    expect(streamingSource).toContain(
      '<form enhance method="post" action="/_m/chat/send" data-mutation="chat/send" data-mutation-stream="true" kovo-fragment-target={`send-message:${slots.threadId}`} kovo-key={slots.threadId} class="composer"',
    );
    expect(streamingSource).not.toMatch(/\sstream(?:\s|>)/);
    expect(bufferedSource).toContain(
      '<form enhance method="post" action="/_m/chat/send" data-mutation="chat/send" kovo-fragment-target={`send-message:${slots.threadId}`} kovo-key={slots.threadId} class="composer"',
    );
    expect(bufferedSource).not.toContain('data-mutation-stream');
    expect(streaming.outputContextFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: 'true',
          sink: 'data-mutation-stream',
          writer: 'streaming mutation form lowering',
        }),
      ]),
    );
    expect(() => assertRenderEquivalence(streaming)).not.toThrow();
    expect(() => assertFixpoint(streaming)).not.toThrow();
    expect(() => assertRenderEquivalence(buffered)).not.toThrow();
    expect(() => assertFixpoint(buffered)).not.toThrow();
  });

  it('lowers stream text source targets to runtime-visible data attributes', () => {
    const result = compileComponentModule({
      fileName: 'streaming-message.tsx',
      source: `
export const StreamingMessage = component({
  render: () => (
    <article>
      <p streamText="message:a1" aria-live="polite"></p>
    </article>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    const loweredSource = requireLoweredSource(result);
    expect(loweredSource).toContain('<p data-stream-text="message:a1" aria-live="polite">');
    expect(loweredSource).not.toContain('streamText=');
    expect(result.outputContextFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: 'message:a1',
          sink: 'data-stream-text',
          writer: 'stream text target lowering',
        }),
      ]),
    );
    expect(() => assertRenderEquivalence(result)).not.toThrow();
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports KV243 for ambiguous stream text source targets', () => {
    const result = compileComponentModule({
      fileName: 'bad-streaming-message.tsx',
      source: `
export const StreamingMessage = component({
  render: () => (
    <article>
      <p streamText="#assistant"></p>
      <p data-stream-text="assistant"></p>
    </article>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV243')).toEqual([
      expect.objectContaining({
        message:
          'Invalid stream text target. "#assistant" is not a stream source id; expected "source:id", not a selector or unscoped id.',
      }),
      expect.objectContaining({
        message:
          'Invalid stream text target. "assistant" is not a stream source id; expected "source:id", not a selector or unscoped id.',
      }),
    ]);
  });

  it('lowers imported typed enhanced mutation forms from registry facts', () => {
    const result = compileComponentModule({
      fileName: 'product-grid.tsx',
      registryFacts: {
        mutationInputs: { 'cart/add': cartAddMutationInputs },
        mutations: { 'cart/add': 'typeof addToCart' },
      },
      source: `
import { addToCart } from '../app.js';

export const ProductGrid = component({
  render: (_queries, _state, slots) => (
    <form enhance mutation={addToCart} key={slots.productId}>
      <input type="hidden" name="productId" value={slots.productId} />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    const loweredSource = requireLoweredSource(result);
    expect(loweredSource).toContain(
      '<form enhance method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${slots.productId}`} kovo-key={slots.productId}',
    );
    expect(loweredSource.match(/__kovoRenderMutationCsrfField\(addToCart\)/g)).toHaveLength(1);
    expect(() => assertRenderEquivalence(result)).not.toThrow();
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('does not emit duplicate CSRF helpers when runtime mutation props are preserved', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart} key="p1">
      <input type="hidden" name="productId" value="p1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.loweredSource).toContain('mutation={addToCart}');
    expect(result.loweredSource).not.toContain('__kovoRenderMutationCsrfField(addToCart)');
    expect(() => assertRenderEquivalence(result)).not.toThrow();
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports KV242 for imported enhanced mutation form fields from registry facts', () => {
    const result = compileComponentModule({
      fileName: 'product-grid.tsx',
      registryFacts: {
        mutationInputs: { 'cart/add': cartAddMutationInputs },
        mutations: { 'cart/add': 'typeof addToCart' },
      },
      source: `
import { addToCart } from '../app.js';

export const ProductGrid = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input type="hidden" name="product" value="p1" />
      <input name="quantity" value="1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. unknown field "product" for mutation "cart/add". Expected fields: productId, quantity',
      }),
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. missing required field "productId" for mutation "cart/add". Expected fields: productId, quantity',
      }),
    ]);
  });

  it('reports KV242 for mutationFormAttributes spread forms from registry facts', () => {
    const result = compileComponentModule({
      fileName: 'product-grid.tsx',
      registryFacts: {
        mutationInputs: { 'cart/add': cartAddMutationInputs },
        mutations: { 'cart/add': 'typeof addToCart' },
      },
      source: `
import { mutationFormAttributes } from '@kovojs/server';
import { addToCart } from '../app.js';

export const ProductGrid = component({
  render: () => (
    <form enhance {...mutationFormAttributes(addToCart)}>
      <input type="hidden" name="product" value="p1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. unknown field "product" for mutation "cart/add". Expected fields: productId, quantity',
      }),
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. missing required field "productId" for mutation "cart/add". Expected fields: productId, quantity',
      }),
    ]);
  });

  it('lowers field and form error helpers to the enclosing mutation failure slot', () => {
    const result = compileComponentModule({
      fileName: 'product-grid.tsx',
      registryFacts: {
        mutationInputs: { 'cart/add': cartAddMutationInputs },
        mutations: { 'cart/add': 'typeof addToCart' },
      },
      source: `
import { component, FieldError, form, FormError } from '@kovojs/core';

const addToCart = form('cart/add');

export const ProductGrid = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <form enhance mutation={addToCart} key="p1">
      <input type="hidden" name="productId" value="p1" />
      <input name="quantity" />
      <FieldError name="quantity" class="error" />
      <FormError code="OUT_OF_STOCK">Unable to add this item.</FormError>
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([]);
    expect(result.loweredSource).toContain(
      '<input name="quantity"  aria-describedby="add-to-cart-quantity-error-p1"/>',
    );
    expect(result.loweredSource).toContain(
      '{FieldError({ "failure": slots.forms.addToCart.failure, "name": "quantity", "class": "error", "id": "add-to-cart-quantity-error-p1" })}',
    );
    expect(result.loweredSource).toContain(
      '{FormError({ "failure": slots.forms.addToCart.failure, "code": "OUT_OF_STOCK", "children": "Unable to add this item." })}',
    );
  });

  it('reports KV242 for field error helpers outside a typed mutation form or outside the schema', () => {
    const result = compileComponentModule({
      fileName: 'product-grid.tsx',
      registryFacts: {
        mutationInputs: { 'cart/add': cartAddMutationInputs },
        mutations: { 'cart/add': 'typeof addToCart' },
      },
      source: `
import { component, FieldError, form } from '@kovojs/core';

const addToCart = form('cart/add');

export const ProductGrid = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <section>
      <FieldError name="quantity" />
      <form enhance mutation={addToCart}>
        <input name="productId" />
        <FieldError name="sku" />
      </form>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          '<FieldError> must be rendered inside an enhanced mutation form',
        ),
      }),
      expect.objectContaining({
        message: expect.stringContaining(
          'unknown field "sku" for mutation "cart/add". Expected fields: productId, quantity',
        ),
      }),
    ]);
  });

  it('rejects repeatable typed enhanced mutation forms without authored key identity', () => {
    const result = compileComponentModule({
      fileName: 'product-list.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  handler() {
    return null;
  },
});

export const ProductList = component({
  render: ({ products }) => (
    <section>
      {products.items.map((item) => (
        <form enhance mutation={addToCart}>
          <input type="hidden" name="productId" value={item.id} />
        </form>
      ))}
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV238')).toEqual([
      expect.objectContaining({
        message:
          'Duplicate fragment-target wire name. repeatable enhanced mutation form needs authored key identity',
      }),
    ]);
    expect(result.loweredSource).toContain('mutation={addToCart}');
    expect(result.loweredSource).not.toContain('action="/_m/cart/add"');
  });

  it('reports KV242 for enhanced mutation form names outside the local input schema', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input type="hidden" name="product" value="p1" />
      <input name="quantity" value="1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. unknown field "product" for mutation "cart/add". Expected fields: productId, quantity',
      }),
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. missing required field "productId" for mutation "cart/add". Expected fields: productId, quantity',
      }),
    ]);
  });

  it('reports KV242 for missing required local mutation input fields', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input name="quantity" value="1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. missing required field "productId" for mutation "cart/add". Expected fields: productId, quantity',
      }),
    ]);
  });

  it('accepts complete local enhanced mutation fields and defaulted missing fields', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input type="hidden" name="productId" value="p1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([]);
  });

  it('reports KV242 for dynamic and unsupported enhanced mutation controls', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
    action: s.string().optional(),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: ({ fieldName }) => (
    <form enhance mutation={addToCart}>
      <input type="hidden" name="productId" value="p1" />
      <input name={fieldName} value="dynamic" />
      <input type="hidden" name="productId" value="p2" />
      <input type="file" name="upload" />
      <input type="checkbox" name="agree" />
      <input type="radio" name="choice" />
      <select name="tags" multiple />
      <input name="metadata.slug" />
      <button name="action" value="save">Save</button>
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('dynamic field names are not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('repeated field "productId" is not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('file input field "upload" is not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('checkbox field "agree" is not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('radio field "choice" is not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('multiple select field "tags" is not supported'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('nested field path "metadata.slug" is not supported'),
        }),
      ]),
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'KV242',
        message: expect.stringContaining('unknown field "action"'),
      }),
    );
  });

  it('reports KV242 for external form-associated mutation controls', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <section>
      <form id="cart" enhance mutation={addToCart}></form>
      <input form="cart" name="productId" value="p1" />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('external form-associated controls are not supported'),
        }),
      ]),
    );
  });

  it('ignores disabled mutation controls when checking completeness', () => {
    const result = compileComponentModule({
      fileName: 'add-to-cart-form.tsx',
      source: `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
  }),
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  render: () => (
    <form enhance mutation={addToCart}>
      <input disabled name="productId" value="p1" />
    </form>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([
      expect.objectContaining({
        message:
          'Enhanced mutation form fields do not match mutation input schema. missing required field "productId" for mutation "cart/add". Expected fields: productId',
      }),
    ]);
  });

  it('stamps rendered component markup with declared query dependencies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery, productPage: productPageQuery },
  render: ({ cart, productPage }) => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <span>{productPage.title}</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<cart-badge kovo-deps="cart productPage" kovo-fragment-target="cart-badge" kovo-live-component="cart-badge/cart-badge">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lints hand-written fragment target hooks on inferred query roots', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <cart-badge kovo-fragment-target="cart-badge">
      {cart.count}
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV223',
        help: expect.stringContaining('kovo-fragment-target hook'),
        message:
          'Redundant hand-written fragment target stamp in sugar; the compiler derives it. kovo-fragment-target',
        severity: 'lint',
      }),
    );
    expect(result.files[0]?.source.match(/kovo-fragment-target=/g)).toHaveLength(1);
  });

  it('stamps kovo-c component identity on native render hosts', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }) => (
    <ol>
      <li kovo-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<ol kovo-c="order-history" kovo-deps="orderHistory" kovo-fragment-target="order-history" kovo-live-component="order-history/order-history">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('stamps native host identity from the parsed render host, not tag text', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  render: () => {
    const sample = '<order-history></order-history>';
    return <ol><li kovo-key="order-1">Order</li></ol>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol kovo-c="order-history">');
    expect(serverSource).toContain("'<order-history></order-history>'");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('stamps serializable props on inferred live target roots', () => {
    const result = compileComponentModule({
      fileName: 'product-detail.tsx',
      source: `
export const ProductDetail = component({
  props: { productId: String },
  queries: {
    product: productQuery.args((props) => ({ id: props.productId })),
  },
  render: ({ productId, product }) => (
    <section>
      <span>{productId}</span>
      <span>{product.name}</span>
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section kovo-c="product-detail" kovo-deps="product" kovo-fragment-target="product-detail" kovo-live-component="product-detail/product-detail" kovo-props={JSON.stringify({ productId })}>',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('keeps hand-written kovo-c stamps on native hosts unchanged in ejected IR', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  render: () => (
    <ol kovo-c="order-history">
      <li kovo-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol kovo-c="order-history">');
    expect(serverSource.match(/kovo-c=/g)).toHaveLength(1);
  });

  it('does not stamp query or state declarations from strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => {
    const sample = 'queries: { cart: cartQuery }, state: () => ({ open: true })';
    // queries: { product: productQuery }, state: () => ({ count: 1 })
    return <cart-badge>Static</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).not.toContain('kovo-deps=');
    expect(serverSource).not.toContain('kovo-state=');
    expect(result.diagnostics).toEqual([]);
  });

  it('stamps the returned host instead of tag text inside render bodies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => {
    const sample = '<not-the-host></not-the-host>';
    // <also-not-the-host></also-not-the-host>
    return <cart-badge>{renderOnce(cart.count)}</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain(
      '<cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge" kovo-live-component="cart-badge/cart-badge" kovo-state="{&quot;open&quot;:true}">',
    );
    expect(serverSource).toContain("'<not-the-host></not-the-host>'");
    expect(serverSource).not.toContain('<not-the-host kovo-deps=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('merges declared query dependencies into existing kovo-deps stamps', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="recommendations" kovo-deps="product:p1 cart">
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section kovo-c="recommendations" kovo-deps="product:p1 cart" kovo-fragment-target="recommendations" kovo-live-component="recommendations/recommendations">',
    );
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('updates existing kovo-deps from parsed attribute spans', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section class="card" kovo-deps='product:p1'>
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section class="card" kovo-deps="product:p1 cart" kovo-c="recommendations" kovo-fragment-target="recommendations" kovo-live-component="recommendations/recommendations">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('validates residual kovo-c and kovo-deps stamps against known component and query facts', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="recommendations" kovo-deps="product:p1 cart">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
    ]);
  });

  it('reports KV226 for residual stamps naming unknown components or query instances', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="unknown-component" kovo-deps="cart missingQuery:p1">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV231',
        fileName: 'recommendations.tsx',
        length: 26,
        message:
          'Unmergeable attribute conflict in primitive composition. kovo-c (writers: author JSX, host identity stamp)',
        severity: 'error',
        start: { column: 14, line: 5 },
      },
      {
        code: 'KV223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
      {
        code: 'KV226',
        fileName: 'recommendations.tsx',
        message:
          'kovo-deps or kovo-c names an unknown query instance or component. kovo-c="unknown-component"',
        severity: 'error',
        start: { column: 14, line: 5 },
        length: 26,
      },
      {
        code: 'KV226',
        fileName: 'recommendations.tsx',
        message:
          'kovo-deps or kovo-c names an unknown query instance or component. kovo-deps="missingQuery:p1"',
        severity: 'error',
        start: { column: 41, line: 5 },
        length: 32,
      },
    ]);
  });

  it('ignores residual stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<section kovo-c="unknown-component" kovo-deps="missingQuery:p1"></section>';
    // <section kovo-c="other-unknown" kovo-deps="otherMissing:p1"></section>
    return (
      <section kovo-c="recommendations" kovo-deps="cart">
        <span>{renderOnce(cart.count)}</span>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV222 and KV223 for hand-written stamps around typed expressions in sugar', () => {
    const redundant = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    });
    const drift = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    });

    expect(redundant.diagnostics).toMatchObject([
      {
        code: 'KV223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 31, line: 4 },
      },
    ]);
    expect(drift.diagnostics).toMatchObject([
      {
        code: 'KV222',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.count" wraps {cart.total}',
        severity: 'error',
        start: { column: 31, line: 4 },
      },
    ]);
  });

  it('ignores binding stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<span data-bind="cart.count">{cart.count}</span>';
    // <span data-bind="cart.total">{cart.count}</span>
    return <span>{renderOnce(cart.count)}</span>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not let self-closing same-name children hide list stamp diagnostics', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <ul />
      <template kovo-stamp>
        <li><span data-bind=".missing">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV302',
          fileName: 'cart-badge.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.items',
          severity: 'error',
          start: { column: 9, line: 4 },
          length: 27,
        }),
      ]),
    );
  });
});
