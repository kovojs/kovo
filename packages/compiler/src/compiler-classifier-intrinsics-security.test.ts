import { describe, expect, it } from 'vitest';

import {
  assertRenderPlanTokenMonotonicity,
  compileComponentModule,
  CompilerDiagnosticError,
} from './compile.js';
import { emitServerModule, semanticRenderEquivalenceCheck } from './emit/server.js';
import { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
import { parseComponentModule } from './scan/parse.js';

describe('compiler classifier intrinsic security', () => {
  it('does not suppress request-derived trustedHtml diagnostics through template-span Array.map', () => {
    const source = `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: input }) => <div>{trustedHtml(\`<p>\${input.body}</p>\`)}</div>,
});
`;
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedTemplateSpanMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if (
          this.length === 1 &&
          typeof (this[0] as { expression?: unknown } | undefined)?.expression === 'object' &&
          typeof (this[0] as { literal?: unknown } | undefined)?.literal === 'object'
        ) {
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({ fileName: 'probe.tsx', source });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV426')).toHaveLength(1);
  });

  it('does not suppress trustedHtml identity through render-parameter Array.find', () => {
    const source = `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: input }) => <div>{trustedHtml(input.body)}</div>,
});
`;
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.find = function poisonedRenderParameterFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        if (
          this.length === 3 &&
          typeof (this[0] as { name?: unknown } | undefined)?.name === 'object' &&
          typeof (this[2] as { name?: unknown } | undefined)?.name === 'object'
        ) {
          poisonHits += 1;
          return this[0];
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      result = compileComponentModule({ fileName: 'identity-probe.tsx', source });
    } finally {
      Array.prototype.find = nativeFind;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV426')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress secret query-wire diagnostics through query-name Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedSecretQueryFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (this.length === 1 && this[0] === 'user') return [];
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'user-card.tsx',
        queryShapes: { user: { passwordHash: { kind: 'secret', shape: 'string' } } },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => <user-card><span data-bind="user.passwordHash">x</span></user-card>,
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toHaveLength(1);
  });

  it('does not suppress query-shape binding diagnostics through binding Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedBindingFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        const first = this[0] as { name?: unknown; path?: unknown } | undefined;
        if (first?.name === 'data-bind' && first.path === 'cart.total') {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-total.tsx',
        queryShapes: { cart: { count: 'number' } },
        source: `
export const CartTotal = component({
  render: () => <span data-bind="cart.total">0</span>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV302')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not skip the complete validator pipeline through Array.flatMap replacement', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedValidatorFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (this.length > 30 && typeof this[0] === 'function') return [];
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'raw-html.tsx',
        source:
          "export const C = component({ render: () => <div dangerouslySetInnerHTML={'<img src=x onerror=alert(1)>'} /> });",
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toHaveLength(1);
  });

  it('does not suppress direct-db write diagnostics through handler Array.flatMap replacement', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedHandlerSinkFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { handlerWriteSinks?: unknown } | undefined;
        if (Array.isArray(first?.handlerWriteSinks)) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart.mutation.ts',
        source: `
export const addToCart = mutation({
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress direct-db write facts through late Set.has replacement', () => {
    const nativeHas = Set.prototype.has;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Set.prototype.has = function poisonedWriteOperationHas(value: unknown): boolean {
        if (value === 'insert' && new Error().stack?.includes('isHandlerWriteSinkOperation')) {
          poisonHits += 1;
          return false;
        }
        return nativeApply(nativeHas, this, [value]);
      };
      result = compileComponentModule({
        fileName: 'cart.mutation.ts',
        source: `
export const addToCart = mutation({
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
      });
    } finally {
      Set.prototype.has = nativeHas;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress direct-db paths through late Array.push replacement', () => {
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.push = function poisonedWritePathPush<T>(...values: T[]): number {
        const first = values[0] as { path?: unknown; terminalName?: unknown } | undefined;
        if (first?.path === 'request.db.insert' && first.terminalName === 'insert') {
          poisonHits += 1;
          return this.length;
        }
        return nativeApply(nativePush, this, values);
      };
      result = compileComponentModule({
        fileName: 'cart.mutation.ts',
        source: `
export const addToCart = mutation({
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
      });
    } finally {
      Array.prototype.push = nativePush;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress direct-db facts through late Map.set replacement', () => {
    const nativeSet = Map.prototype.set;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Map.prototype.set = function poisonedWriteFactSet<Key, Value>(
        key: Key,
        value: Value,
      ): Map<Key, Value> {
        const fact = value as { operationKind?: unknown; surface?: unknown } | undefined;
        if (fact?.operationKind === 'insert' && fact.surface === 'mutation') {
          poisonHits += 1;
          return this;
        }
        return nativeApply(nativeSet, this, [key, value]);
      };
      result = compileComponentModule({
        fileName: 'cart.mutation.ts',
        source: `
export const addToCart = mutation({
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
      });
    } finally {
      Map.prototype.set = nativeSet;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV330')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress non-literal regex diagnostics through late Array.push replacement', () => {
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.push = function poisonedRegexDiagnosticPush<T>(...values: T[]): number {
        if ((values[0] as { code?: unknown } | undefined)?.code === 'KV434') {
          poisonHits += 1;
          return this.length;
        }
        return nativeApply(nativePush, this, values);
      };
      result = compileComponentModule({
        fileName: 'schema.ts',
        source: `
const buildPattern = () => /safe/;
export const input = s.string().pattern(buildPattern());
`,
      });
    } finally {
      Array.prototype.push = nativePush;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV434')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not accept non-ASCII case-folding through late String.includes replacement', () => {
    const nativeIncludes = String.prototype.includes;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.includes = function poisonedRegexFlagIncludes(
        search: string,
        position?: number,
      ): boolean {
        if (this.valueOf() === 'i' && search === 'i') {
          poisonHits += 1;
          return false;
        }
        return nativeApply(nativeIncludes, this, [search, position]);
      };
      result = compileComponentModule({
        fileName: 'schema.ts',
        source: 'export const input = s.string().pattern(/é/i);',
      });
    } finally {
      String.prototype.includes = nativeIncludes;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV434')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not accept invalid regex syntax through late global RegExp replacement', () => {
    const nativeRegExp = globalThis.RegExp;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      globalThis.RegExp = function permissiveRegExp(): RegExp {
        return /safe/;
      } as unknown as RegExpConstructor;
      result = compileComponentModule({
        fileName: 'schema.ts',
        source: 'export const input = s.string().pattern("(");',
      });
    } finally {
      globalThis.RegExp = nativeRegExp;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV434')).toHaveLength(1);
  });

  it('does not suppress query-derived event payload diagnostics through late Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedEmitCallFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        const first = this[0] as { argumentPropertyAccesses?: unknown; name?: unknown } | undefined;
        if (
          first?.name === 'emit' &&
          Array.isArray(first.argumentPropertyAccesses) &&
          new Error().stack?.includes('eventPayloads')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart.events.tsx',
        queryShapes: { product: { id: 'string', unitPrice: 'number' } },
        source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV320')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress server-fact local-state diagnostics through late Array.find', () => {
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.find = function poisonedStateEntryFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        const first = this[0] as { valuePropertyAccesses?: unknown } | undefined;
        if (Array.isArray(first?.valuePropertyAccesses)) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <button disabled={cart.count === 0}>{state.saved}</button>,
});
`,
      });
    } finally {
      Array.prototype.find = nativeFind;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV301')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress event property facts through upstream argument Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedEmitArgumentMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if (
          (this[0] as { text?: unknown } | undefined)?.text === 'cart:added' &&
          new Error().stack?.includes('callExpressionModel')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart.events.tsx',
        queryShapes: { product: { id: 'string', unitPrice: 'number' } },
        source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV320')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress local-state property facts through upstream object Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedStatePropertyFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: { text?: unknown } } | undefined;
        if (first?.name?.text === 'saved' && new Error().stack?.includes('objectLiteralEntries')) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <button disabled={cart.count === 0}>{state.saved}</button>,
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV301')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress secret query declarations through component-option Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedQueryOptionFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: { text?: unknown } } | undefined;
        if (first?.name?.text === 'queries' && new Error().stack?.includes('componentOptions')) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'user-card.tsx',
        queryShapes: { user: { passwordHash: { kind: 'secret', shape: 'string' } } },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => <user-card><span data-bind="user.passwordHash">x</span></user-card>,
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress unsafe JSX attributes through upstream attribute Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedJsxAttributeFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: { escapedText?: unknown } } | undefined;
        if (
          first?.name?.escapedText === 'dangerouslySetInnerHTML' &&
          new Error().stack?.includes('jsxElementModel')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'raw-html.tsx',
        source:
          "export const C = component({ render: () => <div dangerouslySetInnerHTML={'<img src=x onerror=alert(1)>'} /> });",
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not publish a captured server secret through stateful Array.filter replacement', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let skippedUnsafeClassification = false;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedClientCaptureFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        const first = this[0] as
          | { binding?: unknown; callee?: unknown; published?: unknown }
          | undefined;
        if (
          !skippedUnsafeClassification &&
          first?.binding !== undefined &&
          typeof first.callee === 'boolean' &&
          typeof first.published === 'boolean'
        ) {
          skippedUnsafeClassification = true;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'pay-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from '../../config/secrets';
export const PayButton = component({
  render: () => <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    const clientSource = result?.files.find((file) => file.kind === 'client')?.source ?? '';
    expect(result?.diagnostics.some((diagnostic) => diagnostic.code === 'KV437')).toBe(true);
    expect(clientSource).not.toContain('../../config/secrets');
  });

  it('does not suppress client-capture diagnostics through Array.map replacement', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedClientCaptureMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | { binding?: unknown; callee?: unknown; published?: unknown }
          | undefined;
        if (
          first?.binding !== undefined &&
          typeof first.callee === 'boolean' &&
          typeof first.published === 'boolean'
        ) {
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'pay-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from '../../config/secrets';
export const PayButton = component({
  render: () => <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV437',
          message: expect.stringContaining('import="STRIPE_SECRET_KEY"'),
        }),
      ]),
    );
  });

  it('does not suppress dynamic script RAWTEXT diagnostics through Array.find replacement', () => {
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.find = function poisonedJsxExpressionFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        const first = this[0] as { containerEnd?: unknown; containerStart?: unknown } | undefined;
        if (typeof first?.containerStart === 'number' && typeof first.containerEnd === 'number') {
          return undefined;
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'script-text.tsx',
        source: `
export const ScriptText = component({
  queries: { cfg: () => ({ inline: "" }) },
  render: ({ cfg }) => <div><script>{cfg.inline}</script></div>,
});
`,
      });
    } finally {
      Array.prototype.find = nativeFind;
    }
    expect(result?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message:
            'Unsafe output context requires an explicit trusted Kovo escape hatch. dynamic <script> element text',
        }),
      ]),
    );
  });

  it('does not suppress trustedHtml provenance through Array iterator replacement', () => {
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    const empty: unknown[] = [];
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype[Symbol.iterator] = function poisonedProvenanceIterator<
        T,
      >(): ArrayIterator<T> {
        if (this[0] === 'request' || this[0] === 'query' || this[0] === 'unprovable') {
          return nativeApply(nativeIterator, empty, []);
        }
        return nativeApply(nativeIterator, this, []);
      };
      result = compileComponentModule({
        fileName: 'trusted-template.tsx',
        source: `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: input }) => <div>{trustedHtml(\`<p>\${input.body}</p>\`)}</div>,
});
`,
      });
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV426')).toHaveLength(1);
  });

  it('does not suppress assembled KV236 diagnostics through Array iterator replacement', () => {
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    const empty: unknown[] = [];
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype[Symbol.iterator] = function poisonedKv236Iterator<T>(): ArrayIterator<T> {
        if ((this[0] as { code?: unknown } | undefined)?.code === 'KV236') {
          return nativeApply(nativeIterator, empty, []);
        }
        return nativeApply(nativeIterator, this, []);
      };
      result = compileComponentModule({
        fileName: 'raw-html.tsx',
        source:
          "export const C = component({ render: () => <div dangerouslySetInnerHTML={'<img src=x onerror=alert(1)>'} /> });",
      });
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toHaveLength(1);
  });

  it('does not suppress secret query-wire diagnostics through upstream option-entry Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedQueryOptionMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if ((this[0] as { key?: unknown } | undefined)?.key === 'user') return [];
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'user-card.tsx',
        queryShapes: { user: { passwordHash: { kind: 'secret', shape: 'string' } } },
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => <user-card><span data-bind="user.passwordHash">x</span></user-card>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toHaveLength(1);
  });

  it('does not re-emit a captured secret through named-import Array.filter replacement', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedNamedImportFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        const first = this[0] as { localName?: unknown; moduleSpecifier?: unknown } | undefined;
        if (typeof first?.localName === 'string' && typeof first.moduleSpecifier === 'string') {
          return this as T[];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'pay-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from '../../config/secrets';
export const PayButton = component({
  render: () => <button onClick={() => sendPayment(STRIPE_SECRET_KEY)}>Pay</button>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    const clientSource = result?.files.find((file) => file.kind === 'client')?.source ?? '';
    expect(result?.diagnostics.some((diagnostic) => diagnostic.code === 'KV437')).toBe(true);
    expect(clientSource).not.toContain('../../config/secrets');
  });

  it('does not hide an unknown carrier escape through Array.some replacement', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedCarrierSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        for (let index = 0; index < this.length; index += 1) {
          if ((this[index] as { text?: unknown } | undefined)?.text === 'carrier') return false;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'carrier.tsx',
        source: `
import { trustedHtml } from '@kovojs/browser';
import { mutate } from './mutate';
export const C = component({
  render: ({}, _state, { request }) => {
    const carrier = { body: 'safe' };
    mutate(carrier, request.body);
    return <div>{trustedHtml(carrier.body)}</div>;
  },
});
`,
      });
    } finally {
      Array.prototype.some = nativeSome;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV426')).toHaveLength(1);
  });

  it('does not suppress secret query facts through Array iterator replacement', () => {
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeApply = Reflect.apply;
    const empty: unknown[] = [];
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype[Symbol.iterator] = function poisonedQueryFactIterator<T>(): ArrayIterator<T> {
        if ((this[0] as { query?: unknown } | undefined)?.query === 'user') {
          return nativeApply(nativeIterator, empty, []);
        }
        return nativeApply(nativeIterator, this, []);
      };
      result = compileComponentModule({
        fileName: 'user-card.tsx',
        queryShapeFacts: [
          {
            query: 'user',
            shape: { passwordHash: { kind: 'secret', shape: 'string' } },
            source: 'queries/user.ts:1',
          },
        ],
        source: `
export const UserCard = component({
  queries: { user: {} },
  render: () => <span data-bind="user.passwordHash">x</span>,
});
`,
      });
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toHaveLength(1);
  });

  it('does not suppress handler capture diagnostics through Array.some replacement', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedHandlerCaptureSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        for (let index = 0; index < this.length; index += 1) {
          if (this[index] === 'window') return false;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'browser-capture.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      });
    } finally {
      Array.prototype.some = nativeSome;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV201')).toHaveLength(1);
  });

  it('does not accept an empty publishToClient reason through String.trim replacement', () => {
    const nativeTrim = String.prototype.trim;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.trim = function poisonedPublishReasonTrim(): string {
        if (String(this) === '') return 'forged-audit-reason';
        return nativeTrim.call(this);
      };
      result = compileComponentModule({
        fileName: 'publish-button.tsx',
        source: `
import { component, publishToClient } from '@kovojs/core';
import { sendPayment } from './payments';
import { STRIPE_SECRET_KEY } from '../../config/secrets';
export const PayButton = component({
  render: () => <button onClick={() => sendPayment(publishToClient(STRIPE_SECRET_KEY, { reason: '' }))}>Pay</button>,
});
`,
      });
    } finally {
      String.prototype.trim = nativeTrim;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV437')).toHaveLength(1);
  });

  it('keeps KV416 monotonicity closed when late JSON.stringify reports every shape as equal', () => {
    const nativeStringify = JSON.stringify;
    let thrown: unknown;
    try {
      JSON.stringify = (() => '[]') as typeof JSON.stringify;
      try {
        assertRenderPlanTokenMonotonicity({
          after: { cart: 'field:id,total' },
          before: { cart: 'field:id,count' },
          tokenFn: () => 'frozen-token',
        });
      } catch (error) {
        thrown = error;
      }
    } finally {
      JSON.stringify = nativeStringify;
    }
    expect(thrown).toBeInstanceOf(CompilerDiagnosticError);
    expect((thrown as CompilerDiagnosticError).diagnostic.code).toBe('KV416');
  });

  it('cannot delete handler reject diagnostics through selective Array.map replacements', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedHandlerRejectMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { code?: unknown; exportName?: unknown } | undefined;
        if (
          first?.code === 'KV210' ||
          first?.code === 'KV201' ||
          typeof first?.exportName === 'string'
        ) {
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'browser-capture.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
  });

  it('cannot erase compiler snapshots through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          const code = (value as { code?: unknown } | null)?.code;
          if (code === 'KV210' || code === 'KV201') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      result = compileComponentModule({
        fileName: 'browser-capture.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      });
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }

    expect(result?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
    expect(poisonHits).toBe(0);
  });

  it('cannot erase fail-closed authoring diagnostics through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if ((value as { code?: unknown } | null)?.code === 'KV235') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      result = compileComponentModule({
        fileName: 'internal-import.tsx',
        source: `import { secret } from '@kovojs/core/internal/runtime';\nexport const value = secret;`,
      });
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }

    expect(result?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV235' })]),
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot suppress required static text escaping through attribute Array.some', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeStringIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedStaticTextAttributeSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        const first = this[0] as { name?: unknown } | undefined;
        const callbackSource = nativeApply<string>(nativeFunctionToString, callback, []);
        if (
          this.length === 1 &&
          first?.name === 'class' &&
          nativeApply<boolean>(nativeStringIncludes, callbackSource, ['data-derive-attr']) &&
          nativeApply<boolean>(nativeStringIncludes, callbackSource, ['data-bind'])
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'product-card.tsx',
        source: `
export const ProductCard = component({
  render: ({ product }) => <h2 class="title">{product.name}</h2>,
});
`,
      });
    } finally {
      Array.prototype.some = nativeSome;
    }

    expect(result?.files[0]?.source).toContain('{escapeText(product.name)}');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject executable source through structural helper import Array.join', () => {
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    const injection = `escapeText } from '@kovojs/server/internal/escape';\nglobalThis.KOVO_COMPILER_INJECTION = true;\nimport { escapeText`;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.join = function poisonedStructuralHelperJoin(separator?: string): string {
        if (this.length === 1 && this[0] === 'escapeText' && separator === ', ') {
          poisonHits += 1;
          return injection;
        }
        return nativeApply(nativeJoin, this, [separator]);
      };
      result = compileComponentModule({
        fileName: 'product-card.tsx',
        source: `
export const ProductCard = component({
  render: ({ product }) => <h2>{product.name}</h2>,
});
`,
      });
    } finally {
      Array.prototype.join = nativeJoin;
    }

    expect(result?.files[0]?.source).not.toContain('KOVO_COMPILER_INJECTION');
    expect(result?.files[0]?.source).toContain(
      "import { escapeText } from '@kovojs/server/internal/escape';",
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject executable source through inline derive parameter Array.join', () => {
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    const injection = 'now, cart) => 0);\nglobalThis.KOVO_DERIVE_INJECTION = true;\n//';
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.join = function poisonedInlineDeriveJoin(separator?: string): string {
        if (this.length === 2 && this[0] === 'now' && this[1] === 'cart' && separator === ', ') {
          poisonHits += 1;
          return injection;
        }
        return nativeApply(nativeJoin, this, [separator]);
      };
      result = compileComponentModule({
        fileName: 'clock-label.tsx',
        source: `
export const ClockLabel = component({
  queries: { cart: cartQuery },
  clocks: { ago: { every: '1s' } },
  render: ({ cart, now }) => (
    <time title={formatRelative(now.ago, cart.updatedAt)}>Updated</time>
  ),
});
`,
      });
    } finally {
      Array.prototype.join = nativeJoin;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_DERIVE_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot replace generated client handler exports through Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedClientHandlerMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { attributeName?: unknown; exportName?: unknown } | undefined;
        if (
          typeof first?.attributeName === 'string' &&
          typeof first.exportName === 'string' &&
          callback.name === 'emitHandlerExport'
        ) {
          poisonHits += 1;
          return ['globalThis.KOVO_HANDLER_INJECTION = true;'] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'track-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { track } from './analytics';
export const TrackButton = component({
  render: () => <button onClick={() => track('click')}>Track</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_HANDLER_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject client handler source through element-param projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeStringIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedElementParamMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { attributeName?: unknown; expression?: unknown } | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.attributeName === 'data-p-id' &&
          first.expression === 'item.id' &&
          nativeApply(nativeStringIncludes, callbackSource, ['sourceExpression'])
        ) {
          poisonHits += 1;
          return [
            {
              param: {
                attributeName: 'data-p-id); globalThis.KOVO_HANDLER_BODY_INJECTION = true; //',
                expression: 'item.id',
                type: 'string',
                value: '{item.id}',
              },
              sourceExpression: 'item.id',
            },
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'item-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { track } from './analytics';
export const ItemButton = component({
  render: ({ item }) => <button onClick={() => track(item.id)}>Track</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_HANDLER_BODY_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject server markup through handler-param attribute projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeStringIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedHandlerParamAttributeMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { attributeName?: unknown; expression?: unknown } | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.attributeName === 'data-p-quantity' &&
          first.expression === 'item.quantity' &&
          nativeApply(nativeStringIncludes, callbackSource, ['escapeAttribute'])
        ) {
          poisonHits += 1;
          return [
            'data-p-quantity="x"><img src=x data-injected=KOVO_PARAM_ATTRIBUTE_INJECTION><button data-p-rest="',
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'quantity-button.tsx',
        source: `
import { component } from '@kovojs/core';
export const QuantityButton = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => state.count += item.quantity}>Add</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_PARAM_ATTRIBUTE_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject server source through query-dependency projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedQueryDependencyMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { kind?: unknown; value?: unknown } | undefined;
        if (
          first?.kind === 'expression' &&
          typeof first.value === 'string' &&
          callback.name === 'renderQueryDependencyExpressionElement'
        ) {
          poisonHits += 1;
          return ['(globalThis.KOVO_DEP_INJECTION = true)'] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'question-detail.tsx',
        source: `
export const QuestionDetail = component({
  props: { questionId: String },
  queries: {
    answers: questionAnswers.args((props) => ({ questionId: props.questionId })),
    question: questionDetail.args((props) => ({ id: props.questionId })),
  },
  render: ({ answers, question }) => <section>{question.title}{answers.length}</section>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain('KOVO_DEP_INJECTION');
    expect(poisonHits).toBe(0);
  });

  it('cannot replace a reviewed server handler attribute patch', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedHandlerPatchMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | { attributeEnd?: unknown; attributeStart?: unknown; exportName?: unknown }
          | undefined;
        if (
          callback.name === 'handlerSourceReplacement' &&
          typeof first?.attributeStart === 'number' &&
          typeof first.attributeEnd === 'number' &&
          typeof first.exportName === 'string'
        ) {
          poisonHits += 1;
          return [
            {
              end: first.attributeEnd,
              replacement:
                'on:click="safe"><img src=x data-injected=KOVO_HANDLER_PATCH_INJECTION><button data-rest="',
              start: first.attributeStart,
            },
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'host-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { track } from './analytics';
export const HostButton = component({
  render: () => <button onClick={() => track('click')}>Track</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_HANDLER_PATCH_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot erase reviewed emitter patches through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          const replacement = (value as { replacement?: unknown } | null)?.replacement;
          if (typeof replacement === 'string' && replacement.includes('on:click=')) {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      result = compileComponentModule({
        fileName: 'setter-host-button.tsx',
        source: `
import { component } from '@kovojs/core';
import { track } from './analytics';
export const HostButton = component({
  render: () => <button onClick={() => track('click')}>Track</button>,
});
`,
      });
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }

    const emitted = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(emitted).toContain('on:click=');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject executable source through server template-literal escaping', () => {
    const nativeReplaceAll = String.prototype.replaceAll;
    const nativeApply = Reflect.apply;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.replaceAll = function poisonedServerTemplateReplaceAll(
        searchValue: string | RegExp,
        replaceValue: string,
      ): string {
        if (
          searchValue === '${' &&
          nativeApply(nativeIncludes, this, ['export const TemplateProbe'])
        ) {
          poisonHits += 1;
          return `${this}\`; globalThis.KOVO_TEMPLATE_LITERAL_INJECTION = true; return \``;
        }
        return nativeApply(nativeReplaceAll, this, [searchValue, replaceValue]);
      };
      result = compileComponentModule({
        fileName: 'template-probe.tsx',
        source: `
import { component } from '@kovojs/core';
export const TemplateProbe = component({ render: () => <p>Safe</p> });
`,
      });
    } finally {
      String.prototype.replaceAll = nativeReplaceAll;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_TEMPLATE_LITERAL_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot suppress repeatable mutation-form identity diagnostics', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedRepeatableFormSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        let hasEnhance = false;
        let hasMutation = false;
        let hasKey = false;
        for (let index = 0; index < this.length; index += 1) {
          const name = (this[index] as { name?: unknown } | undefined)?.name;
          if (name === 'enhance') hasEnhance = true;
          if (name === 'mutation') hasMutation = true;
          if (name === 'key') hasKey = true;
        }
        if (
          hasEnhance &&
          hasMutation &&
          !hasKey &&
          nativeApply(nativeIncludes, callbackSource, ["attribute.name === 'key'"])
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'product-list.tsx',
        source: `
export const addToCart = mutation({ handler() { return null; } });
export const ProductList = component({
  render: ({ products }) => (
    <section>{products.items.map((item) => (
      <form enhance mutation={addToCart}>
        <input type="hidden" name="productId" value={item.id} />
      </form>
    ))}</section>
  ),
});
`,
      });
    } finally {
      Array.prototype.some = nativeSome;
    }

    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV238')).toHaveLength(1);
    expect(result?.loweredSource).not.toContain('action="/_m/');
    expect(poisonHits).toBe(0);
  });

  it('cannot normalize visible server-render drift into equivalence', () => {
    const nativeReplace = String.prototype.replace;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let check: ReturnType<typeof semanticRenderEquivalenceCheck> | undefined;
    const expectedSource = `
export const Card = component({ render: () => <section><span>reviewed</span></section> });
`;
    const actualSource = `
export const Card = component({ render: () => <section><span>attacker</span></section> });
`;
    try {
      String.prototype.replace = function poisonedSemanticNormalization(
        searchValue: string | RegExp,
        replaceValue: string | ((...values: string[]) => string),
      ): string {
        if (this === '<section><span>attacker</span></section>') {
          poisonHits += 1;
          return '<section><span>reviewed</span></section>';
        }
        return nativeApply(nativeReplace, this, [searchValue, replaceValue]);
      };
      check = semanticRenderEquivalenceCheck(
        'card.server.js',
        parseComponentModule('card.tsx', expectedSource),
        emitServerModule(actualSource).executableSource,
      );
    } finally {
      String.prototype.replace = nativeReplace;
    }

    expect(check?.ok).toBe(false);
    expect(check?.actual).toContain('attacker');
    expect(poisonHits).toBe(0);
  });

  it('cannot replace generated live-target renderer exports', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedLiveTargetExportMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | { component?: unknown; queryBindings?: unknown; target?: unknown }
          | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          typeof first?.component === 'string' &&
          Array.isArray(first.queryBindings) &&
          typeof first.target === 'string' &&
          nativeApply(nativeIncludes, callbackSource, ['liveTargetRendererExport'])
        ) {
          poisonHits += 1;
          return ['globalThis.KOVO_LIVE_TARGET_EMIT_INJECTION = true;'] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'live-card.tsx',
        source: `
export const LiveCard = component({
  queries: { product: productQuery },
  render: ({ product }) => <section>{product.name}</section>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_LIVE_TARGET_EMIT_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject executable client bootstrap imports through input traversal', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let source = '';
    try {
      Array.prototype.map = function poisonedBootstrapImportMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { exportName?: unknown; importPath?: unknown } | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          typeof first?.exportName === 'string' &&
          typeof first.importPath === 'string' &&
          nativeApply(nativeIncludes, callbackSource, ['specifiers'])
        ) {
          poisonHits += 1;
          return ['globalThis.KOVO_BOOTSTRAP_INJECTION = true;'] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      source = emitQueryPlanBootstrapModule([
        {
          exportName: 'Card$queryUpdatePlans',
          importPath: './card.client.js',
        },
      ]).source;
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(source).not.toContain('KOVO_BOOTSTRAP_INJECTION');
    expect(source).toContain('Card$queryUpdatePlans as kovoQueryPlans_0_');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject server markup through typed mutation-form assembly', () => {
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.join = function poisonedTypedMutationFormJoin(separator?: string): string {
        let hasAction = false;
        let hasMutation = false;
        for (let index = 0; index < this.length; index += 1) {
          const value = this[index];
          if (typeof value === 'string' && value.startsWith('action="/_m/')) hasAction = true;
          if (typeof value === 'string' && value.startsWith('data-mutation=')) hasMutation = true;
        }
        if (separator === ' ' && hasAction && hasMutation) {
          poisonHits += 1;
          return 'method="post"><img src=x data-injected=KOVO_TYPED_FORM_INJECTION><form data-rest="';
        }
        return nativeApply(nativeJoin, this, [separator]);
      };
      result = compileComponentModule({
        fileName: 'save-form.tsx',
        source: `
export const save = mutation({ handler() { return null; } });
export const SaveForm = component({
  render: () => <form enhance mutation={save}><button type="submit">Save</button></form>,
});
`,
      });
    } finally {
      Array.prototype.join = nativeJoin;
    }

    expect(result?.files.map((file) => file.source).join('\n')).not.toContain(
      'KOVO_TYPED_FORM_INJECTION',
    );
    expect(poisonHits).toBe(0);
  });

  it('cannot inject JSX through platform-behavior attribute traversal', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedPlatformAttributeMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: unknown; value?: unknown } | undefined;
        const second = this[1] as { name?: unknown; value?: unknown } | undefined;
        if (
          first?.name === 'commandfor' &&
          typeof first.value === 'string' &&
          second?.name === 'command' &&
          typeof second.value === 'string'
        ) {
          poisonHits += 1;
          return nativeApply(
            nativeMap,
            [
              {
                name: 'commandfor="cart-drawer" /><img src="x" data-kovo-platform-injection="true" /><button data-rest',
                value: 'safe',
              },
            ],
            [callback, thisArg],
          );
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-button.tsx',
        source: `
export const CartButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('data-kovo-platform-injection');
    expect(lowered).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject JSX through final structural attribute projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedFinalJsxAttributeMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | { name?: unknown; ownership?: unknown; value?: unknown }
          | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.name === 'commandfor' &&
          first.ownership === 'generated' &&
          typeof first.value === 'object' &&
          nativeApply(nativeIncludes, callbackSource, ['printJsxIrAttribute'])
        ) {
          poisonHits += 1;
          return [
            'id="safe" /><img src="x" data-kovo-structural-injection="true" /><div data-rest="safe"',
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-button.tsx',
        source: `
export const CartButton = component({
  render: () => (
    <section>
      <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('data-kovo-structural-injection');
    expect(lowered).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(poisonHits).toBe(0);
  });

  it('cannot replace inline-attribute derive source through structural Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedInlineAttributeDeriveMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: unknown; source?: { expression?: unknown } } | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        const mapped = nativeApply<U[]>(nativeMap, this, [callback, thisArg]);
        if (
          first?.name === 'title' &&
          first.source?.expression === 'state.label' &&
          nativeApply(nativeIncludes, callbackSource, ['inlineAttributeDerive'])
        ) {
          const candidate = mapped[0] as { expression?: string } | null | undefined;
          if (candidate) {
            poisonHits += 1;
            candidate.expression =
              '(() => { globalThis.KOVO_INLINE_DERIVE_INJECTION = true; return "safe"; })()';
          }
        }
        return mapped;
      };
      result = compileComponentModule({
        fileName: 'safe-button.tsx',
        source: `
export const SafeButton = component({
  state: () => ({ label: 'safe' }),
  render: (_queries, state) => <button title={state.label}>Safe</button>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('KOVO_INLINE_DERIVE_INJECTION');
    expect(lowered).toContain('state.label');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject JSX through primitive-composition attribute projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedPrimitiveCompositionMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as { name?: unknown; origin?: unknown; value?: unknown } | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.name === 'id' &&
          first.origin === 'primitive' &&
          typeof first.value === 'object' &&
          nativeApply(nativeIncludes, callbackSource, ['mergeableToIrAttribute'])
        ) {
          poisonHits += 1;
          return [
            {
              name: 'id="safe" /><img src="x" data-kovo-primitive-injection="true" /><button data-rest',
              ownership: 'generated',
              provenance: {
                description: 'forged primitive attribute',
                ownership: 'generated',
                writer: 'attacker',
              },
              value: { kind: 'string', value: 'safe' },
            },
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'primitive-button.tsx',
        source: `
export const PrimitiveButton = component({
  render: () => (
    <Primitive.Trigger asChild attrs={{ id: 'safe', type: 'button' }}>
      <button>Safe</button>
    </Primitive.Trigger>
  ),
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('data-kovo-primitive-injection');
    expect(lowered).toContain('<button id="safe" type="button"');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject JSX through static-navigation replacement projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedNavigationReplacementMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | {
              call?: { end?: unknown; name?: unknown; start?: unknown };
              lowered?: unknown;
            }
          | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.call?.name === 'href' &&
          typeof first.call.start === 'number' &&
          typeof first.call.end === 'number' &&
          typeof first.lowered === 'string' &&
          nativeApply(nativeIncludes, callbackSource, ['replacement'])
        ) {
          poisonHits += 1;
          return [
            {
              end: first.call.end,
              replacement: '(globalThis.KOVO_NAVIGATION_SOURCE_INJECTION = true, "/products/p1")',
              start: first.call.start,
            },
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'product-link.tsx',
        source: `
const reviewedTarget = href('/products/:id', { params: { id: 'p1' } });
export const ProductLink = component({
  render: () => (
    <a href={reviewedTarget}>Product</a>
  ),
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('KOVO_NAVIGATION_SOURCE_INJECTION');
    expect(lowered).toContain('const reviewedTarget = "/products/p1"');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject JSX through static spread projection', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    const nativeFunctionToString = Function.prototype.toString;
    const nativeIncludes = String.prototype.includes;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedStaticSpreadMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const first = this[0] as
          | { name?: unknown; ownership?: unknown; value?: unknown }
          | undefined;
        const callbackSource = nativeApply(nativeFunctionToString, callback, []);
        if (
          first?.name === 'id' &&
          first.ownership === 'generated' &&
          typeof first.value === 'object' &&
          nativeApply(nativeIncludes, callbackSource, ['source'])
        ) {
          poisonHits += 1;
          return [
            {
              name: 'id="safe" /><img src="x" data-kovo-spread-injection="true" /><div data-rest',
              ownership: 'generated',
              provenance: first,
              value: { kind: 'string', value: 'safe' },
            },
          ] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'spread-card.tsx',
        source: `
export const SpreadCard = component({
  render: () => <div {...{ id: 'safe', title: 'reviewed' }}>Safe</div>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('data-kovo-spread-injection');
    expect(lowered).toContain('id="safe" title="reviewed"');
    expect(poisonHits).toBe(0);
  });

  it('cannot inject client source through template-stamp segment assembly', () => {
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.join = function poisonedTemplateStampJoin(separator?: string): string {
        let hasEscapedRead = false;
        for (let index = 0; index < this.length; index += 1) {
          const value = this[index];
          if (typeof value === 'string' && value.includes('kovoEscapeHtml(read(')) {
            hasEscapedRead = true;
          }
        }
        if (separator === ', ' && hasEscapedRead) {
          poisonHits += 1;
          return '(() => { globalThis.KOVO_TEMPLATE_STAMP_INJECTION = true; return ""; })()';
        }
        return nativeApply(nativeJoin, this, [separator]);
      };
      result = compileComponentModule({
        fileName: 'cart-list.tsx',
        source: `
export const CartList = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="id">
      <template kovo-stamp>
        <li kovo-key=""><span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
      });
    } finally {
      Array.prototype.join = nativeJoin;
    }

    const lowered = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(lowered).not.toContain('KOVO_TEMPLATE_STAMP_INJECTION');
    expect(lowered).toContain('kovoEscapeHtml(read(["name"]))');
    expect(poisonHits).toBe(0);
  });
});
