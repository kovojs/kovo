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

  it('does not suppress malformed-source rejection through parse-diagnostic Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedParseDiagnosticMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if (this.length > 0 && new Error().stack?.includes('parseDiagnosticsForSourceFile')) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'broken.tsx',
        source: `export const Broken = component({ render: () => <div><span></div> });`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV245')).toHaveLength(1);
    expect(result?.files).toEqual([]);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress fragment-target classification through component-option Array.find', () => {
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.find = function poisonedFragmentOptionFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        if (new Error().stack?.includes('componentHasInferredFragmentTarget')) {
          for (let index = 0; index < this.length; index += 1) {
            if ((this[index] as { key?: unknown } | undefined)?.key === 'queries') {
              poisonHits += 1;
              return undefined;
            }
          }
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-page.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});
export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => <section><p>{cart.total}</p><Stepper /></section>,
});
`,
      });
    } finally {
      Array.prototype.find = nativeFind;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV420')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress mutable-state classification through state-entry Array.some', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedStateEntrySome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        if (
          (this[0] as { key?: unknown } | undefined)?.key === 'count' &&
          new Error().stack?.includes('componentDeclaresMutableLocalState')
        ) {
          poisonHits += 1;
          return false;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-page.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});
export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => <section><p>{cart.total}</p><Stepper /></section>,
});
`,
      });
    } finally {
      Array.prototype.some = nativeSome;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV420')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress fragment-target validation through component Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedComponentTargetFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (
          typeof (this[0] as { localName?: unknown } | undefined)?.localName === 'string' &&
          new Error().stack?.includes('componentFragmentTargetNames')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: ({ priceList }) => <span>{priceList.total}</span>,
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV303')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress mutation-form provenance through named-import Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedNamedImportMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if (
          (this[0] as { name?: { text?: unknown } } | undefined)?.name?.text ===
            'mutationFormAttributes' &&
          new Error().stack?.includes('namedImportModels')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'product-grid.tsx',
        registryFacts: {
          mutationInputs: {
            'cart/add': [
              {
                coercion: 'string',
                defaulted: false,
                name: 'productId',
                optional: false,
                provenance: 'registry',
                required: true,
              },
            ],
          },
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
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toHaveLength(2);
    expect(poisonHits).toBe(0);
  });

  it('does not grant Kovo UI primitive authority through String.startsWith', () => {
    const nativeStartsWith = String.prototype.startsWith;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.startsWith = function poisonedUiSpecifierStartsWith(
        searchString: string,
        position?: number,
      ): boolean {
        if (`${this}` === './local-switch.js' && searchString === '@kovojs/ui/') {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeStartsWith, this, [searchString, position]);
      };
      result = compileComponentModule({
        fileName: 'local-switch-probe.tsx',
        source: `
import { Switch } from './local-switch.js';
export const LocalSwitchProbe = component({
  state: () => ({ checked: false }),
  render: (_queries, state) => <Switch checked={state.checked}>Local</Switch>,
});
`,
      });
    } finally {
      String.prototype.startsWith = nativeStartsWith;
    }

    const emitted = result?.files.map((file) => file.source).join('\n') ?? '';
    expect(emitted).not.toContain('LocalSwitchProbe$Switch_aria_checked_derive');
    expect(poisonHits).toBe(0);
  });

  it('cannot forge eager-trigger justification through String.matchAll', () => {
    const nativeMatchAll = String.prototype.matchAll;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.matchAll = function poisonedJustificationMatchAll(regexp: RegExp) {
        if (
          `${this}`.includes('ordinary comment') &&
          new Error().stack?.includes('parseJustifiedDiagnostics')
        ) {
          poisonHits += 1;
          const forged = Object.assign(['KV211'], {
            groups: undefined,
            index: 0,
            input: `${this}`,
          }) as RegExpMatchArray;
          return [forged][Symbol.iterator]();
        }
        return nativeApply(nativeMatchAll, this, [regexp]);
      };
      result = compileComponentModule({
        fileName: 'eager-trigger.tsx',
        source: `
export const EagerTrigger = component({
  render: () => (
    <section>
      {/* ordinary comment */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
      });
    } finally {
      String.prototype.matchAll = nativeMatchAll;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress eager-trigger validation through attribute Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedEventTriggerFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (
          (this[0] as { executionTriggerName?: unknown } | undefined)?.executionTriggerName ===
            'load' &&
          new Error().stack?.includes('eventTriggerAttributes')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'eager-trigger.tsx',
        source: `export const C = component({ render: () => <stock-ticker on:load="/c/ticker.client.js#Ticker$start" /> });`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('cannot forge eager-trigger justification through diagnostic Array.includes', () => {
    const nativeIncludes = Array.prototype.includes;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.includes = function poisonedJustificationIncludes(
        searchElement: unknown,
        fromIndex?: number,
      ): boolean {
        if (
          this[0] === 'KV212' &&
          searchElement === 'KV211' &&
          new Error().stack?.includes('hasKv211Justification')
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeIncludes, this, [searchElement, fromIndex]);
      };
      result = compileComponentModule({
        fileName: 'eager-trigger.tsx',
        source: `
export const C = component({
  render: () => <section>{/* KV212: unrelated */}<stock-ticker on:load="/c/ticker.client.js#Ticker$start" /></section>,
});
`,
      });
    } finally {
      Array.prototype.includes = nativeIncludes;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV211')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress defer JSX-child validation through element Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedDeferElementFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (
          Array.isArray(
            (this[0] as { childExpressionContainers?: unknown } | undefined)
              ?.childExpressionContainers,
          ) &&
          new Error().stack?.includes('validateDeferJsxChildren')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'defer-child.tsx',
        source: `
export const C = component({
  render: () => (
    <section>
      {defer({ target: 'panel', priority: 'after-paint', render: () => '<p>Ready</p>' })}
    </section>
  ),
});
`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV244')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress literal-navigation validation through element Array.flatMap', () => {
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.flatMap = function poisonedNavigationElementFlatMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U | readonly U[],
        thisArg?: unknown,
      ): U[] {
        if (
          Array.isArray((this[0] as { attributes?: unknown } | undefined)?.attributes) &&
          new Error().stack?.includes('literalNavigationTargets')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFlatMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'navigation.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `export const C = component({ render: () => <a href="/admin">Admin</a> });`,
      });
    } finally {
      Array.prototype.flatMap = nativeFlatMap;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV220')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not forge literal-navigation route matches through route Array.some', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.some = function poisonedNavigationRouteSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        if (this[0] === '/cart' && new Error().stack?.includes('validateLiteralHrefs')) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'navigation.tsx',
        registryFacts: { routes: ['/cart'] },
        source: `export const C = component({ render: () => <a href="/admin">Admin</a> });`,
      });
    } finally {
      Array.prototype.some = nativeSome;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV220')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress rendered clock validation through JSX-expression Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedTemporalExpressionFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        if (
          Array.isArray(
            (this[0] as { propertyAccesses?: unknown } | undefined)?.propertyAccesses,
          ) &&
          new Error().stack?.includes('renderedClockReads')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'clock.tsx',
        source: `
export const Clock = component({
  render: ({ now }) => <time>{formatRelative(now.ago)}</time>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV312')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not forge volatile-query refresh bindings through String.includes', () => {
    const nativeIncludes = String.prototype.includes;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.includes = function poisonedTemporalRefreshIncludes(
        search: string,
        position?: number,
      ): boolean {
        if (
          this.valueOf() === 'subscriptionQuery' &&
          search === '.refresh(' &&
          new Error().stack?.includes('refreshedComponentQueryNames')
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeIncludes, this, [search, position]);
      };
      result = compileComponentModule({
        fileName: 'subscription.tsx',
        queryShapes: { sub: { serverNow: { kind: 'volatile-time', shape: 'string' } } },
        source: `
export const Subscription = component({
  queries: { sub: subscriptionQuery },
  render: ({ sub }) => <time>{formatTime(sub.serverNow)}</time>,
});
`,
      });
    } finally {
      String.prototype.includes = nativeIncludes;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV312')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress package-prefix collisions through Map.get replacement', () => {
    const nativeGet = Map.prototype.get;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Map.prototype.get = function poisonedPackagePrefixGet<K, V>(key: K): V | undefined {
        if (key === 'acme-' && new Error().stack?.includes('validatePackageComponentPrefixes')) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeGet, this, [key]);
      };
      result = compileComponentModule({
        fileName: 'prefixes.tsx',
        packageComponentPrefixes: [
          { packageName: '@acme/one', prefix: 'acme-' },
          { packageName: '@other/two', prefix: 'acme-' },
        ],
        source: `export const C = component({ render: () => <p>Safe</p> });`,
      });
    } finally {
      Map.prototype.get = nativeGet;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV234')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress duplicate component identities through Map.get replacement', () => {
    const nativeGet = Map.prototype.get;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Map.prototype.get = function poisonedComponentNameGet<K, V>(key: K): V | undefined {
        if (
          key === 'components/cart/cart-badge' &&
          new Error().stack?.includes('validateDuplicateComponentNames')
        ) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeGet, this, [key]);
      };
      result = compileComponentModule({
        fileName: 'components/cart.tsx',
        source: `
export const CartBadge = component({ render: () => <cart-badge /> });
export const Cart_Badge = component({ render: () => <cart-badge /> });
`,
      });
    } finally {
      Map.prototype.get = nativeGet;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV237')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress duplicate transition identities through attribute Array.find', () => {
    const nativeFind = Array.prototype.find;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.find = function poisonedTransitionAttributeFind<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        if (
          (this[0] as { name?: unknown } | undefined)?.name === 'viewTransitionName' &&
          new Error().stack?.includes('viewTransitionRegistrations')
        ) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeFind, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'product-card.tsx',
        source: `
export const ProductCard = component({
  render: () => <section>
    <img viewTransitionName="product-image" src="/p1.png" />
    <a viewTransitionName="product-image" href="/products/p1">View</a>
  </section>,
});
`,
      });
    } finally {
      Array.prototype.find = nativeFind;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV239')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress missing IDREF validation through value Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedIdrefFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        if (
          (this[0] as { value?: unknown } | undefined)?.value === 'cart-search' &&
          new Error().stack?.includes('validateIdrefsInElementScope')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-shell.tsx',
        source: `
export const CartShell = component({
  render: () => <section><label for="cart-search">Search</label><input id="cart-query" /></section>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV221')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress duplicate static ids through Set.has replacement', () => {
    const nativeHas = Set.prototype.has;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Set.prototype.has = function poisonedStaticIdHas<T>(value: T): boolean {
        if (value === 'cart-title' && new Error().stack?.includes('validateStaticIds')) {
          poisonHits += 1;
          return false;
        }
        return nativeApply(nativeHas, this, [value]);
      };
      result = compileComponentModule({
        fileName: 'cart-shell.tsx',
        source: `
export const CartShell = component({
  render: () => <section><h2 id="cart-title">Cart</h2><output id="cart-title">2</output></section>,
});
`,
      });
    } finally {
      Set.prototype.has = nativeHas;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV224')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not accept unknown residual component stamps through Set.has replacement', () => {
    const nativeHas = Set.prototype.has;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Set.prototype.has = function poisonedResidualComponentHas<T>(value: T): boolean {
        if (
          value === 'unknown-component' &&
          new Error().stack?.includes('validateResidualStamps')
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeHas, this, [value]);
      };
      result = compileComponentModule({
        fileName: 'recommendations.tsx',
        source: `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: () => <section kovo-c="unknown-component" kovo-deps="missingQuery:p1" />,
});
`,
      });
    } finally {
      Set.prototype.has = nativeHas;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV226')).toHaveLength(2);
    expect(poisonHits).toBe(0);
  });

  it('cannot forge an isomorphic justification through diagnostic Array.includes', () => {
    const nativeIncludes = Array.prototype.includes;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.includes = function poisonedIsomorphicJustificationIncludes(
        searchElement: unknown,
        fromIndex?: number,
      ): boolean {
        if (
          this[0] === 'KV317' &&
          searchElement === 'KV318' &&
          new Error().stack?.includes('validateIsomorphicJustifications')
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeIncludes, this, [searchElement, fromIndex]);
      };
      result = compileComponentModule({
        fileName: 'isomorphic.tsx',
        source: `
export const Counter = component({
  /* KV317: unrelated */
  isomorphic: true,
  render: () => <button>Count</button>,
});
`,
      });
    } finally {
      Array.prototype.includes = nativeIncludes;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV318')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress fragment input validation through render-input Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedFragmentInputFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        if (
          (this[0] as { name?: unknown } | undefined)?.name === 'priceList' &&
          new Error().stack?.includes('validateFragmentTargetInputs')
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
export const CartBadge = component({
  queries: { cart: {} },
  render: ({ priceList }) => <span>{priceList.total}</span>,
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV303')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress nested stateful islands through Map.get replacement', () => {
    const nativeGet = Map.prototype.get;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Map.prototype.get = function poisonedStatefulIslandGet<K, V>(key: K): V | undefined {
        if (key === 'Stepper' && new Error().stack?.includes('validateNestedStatefulIsland')) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeGet, this, [key]);
      };
      result = compileComponentModule({
        fileName: 'cart-page.tsx',
        source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});
export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => <section><p>{cart.total}</p><Stepper /></section>,
});
`,
      });
    } finally {
      Map.prototype.get = nativeGet;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV420')).toHaveLength(1);
    expect(poisonHits).toBe(0);
  });

  it('does not suppress reactive-alias coverage through Map.get replacement', () => {
    const nativeGet = Map.prototype.get;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Map.prototype.get = function poisonedReactiveAliasGet<K, V>(key: K): V | undefined {
        if (key === 'label' && new Error().stack?.includes('aliasesReachableFromReferences')) {
          poisonHits += 1;
          return undefined;
        }
        return nativeApply(nativeGet, this, [key]);
      };
      result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => {
    const label = cart.count + 1;
    return <cart-badge><p>{label}</p></cart-badge>;
  },
});
`,
      });
    } finally {
      Map.prototype.get = nativeGet;
    }
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.code === 'KV311')).toHaveLength(1);
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

  it('does not retain extracted client-only imports through dead-import Array.filter', () => {
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.filter = function poisonedDeadImportFilter<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        if (
          (this[0] as { name?: { text?: unknown } } | undefined)?.name?.text === 'meterValueState'
        ) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeFilter, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'meter-probe.tsx',
        source: `
import { meterValueState } from '@kovojs/headless-ui/meter';
export const MeterProbe = component({
  state: () => ({ value: 72 }),
  render: (_queries, state) => (
    <button onClick={() => { state.value = meterValueState({ value: state.value }).value; }}>
      Optimize
    </button>
  ),
});
`,
      });
    } finally {
      Array.prototype.filter = nativeFilter;
    }

    const server = result?.files.find((file) => file.kind === 'server')?.source ?? '';
    expect(server).not.toContain('meterValueState');
    expect(poisonHits).toBe(0);
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

  it('does not forge KV201 element-param guidance through Array map/join', () => {
    const nativeMap = Array.prototype.map;
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedKv201ParamMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if ((this[0] as { attributeName?: unknown } | undefined)?.attributeName === 'data-p-id') {
          poisonHits += 1;
          return ['data-p-attacker'] as U[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      Array.prototype.join = function poisonedKv201HelpJoin(separator?: string): string {
        if (separator === '\n' && `${this[0] ?? ''}`.startsWith('Would lower to:')) {
          poisonHits += 1;
          return 'KOVO_KV201_GUIDANCE_INJECTION';
        }
        return nativeApply(nativeJoin, this, [separator]);
      };
      result = compileComponentModule({
        fileName: 'handler-guidance-probe.tsx',
        source: `
export const HandlerGuidanceProbe = component({
  render: () => (
    <button data-p-id={item.id} onClick={() => window.alert(item.id)}>Unsafe</button>
  ),
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
      Array.prototype.join = nativeJoin;
    }

    const diagnostic = result?.diagnostics.find((candidate) => candidate.code === 'KV201');
    expect(diagnostic?.help).toContain('Element params: data-p-id');
    expect(diagnostic?.help).not.toContain('KOVO_KV201_GUIDANCE_INJECTION');
    expect(poisonHits).toBe(0);
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
import { tabsTriggerClick as track } from '@kovojs/headless-ui/tabs';
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
import { tabsTriggerClick as track } from '@kovojs/headless-ui/tabs';
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

  it('does not erase mutation invalidation registry authority through Array.map', () => {
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.map = function poisonedInvalidationQueryMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        if (this.length === 2 && this[0] === 'account' && this[1] === 'audit') {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      };
      result = compileComponentModule({
        fileName: 'registry-probe.tsx',
        registryFacts: {
          invalidations: { 'account/save': ['account', 'audit'] },
        },
        source: `
export const RegistryProbe = component({
  render: () => <registry-probe>Safe</registry-probe>,
});
`,
      });
    } finally {
      Array.prototype.map = nativeMap;
    }

    const registry = result?.files.find((file) => file.kind === 'registry')?.source ?? '';
    expect(registry).toContain(`  'account/save': 'account' | 'audit';`);
    expect(poisonHits).toBe(0);
  });

  it('quotes registry route facts instead of admitting declaration-source injection', () => {
    const route = `/safe';\ndeclare global { interface Window { KOVO_REGISTRY_INJECTION: true } }`;
    const result = compileComponentModule({
      fileName: 'registry-route-probe.tsx',
      registryFacts: { routes: [route] },
      source: `
export const RegistryRouteProbe = component({
  render: () => <registry-route-probe>Safe</registry-route-probe>,
});
`,
    });

    const registry = result.files.find((file) => file.kind === 'registry')?.source ?? '';
    expect(registry).toContain(JSON.stringify(route));
    expect(registry).not.toContain(
      `\ndeclare global { interface Window { KOVO_REGISTRY_INJECTION: true } }`,
    );
  });

  it('does not suppress unsafe static-spread URL diagnostics through String.trim', () => {
    const source = `
export const SpreadUrl = component({
  render: () => <a {...{ href: "javascript:alert(1)" }}>x</a>,
});
`;
    const nativeTrim = String.prototype.trim;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      String.prototype.trim = function poisonedLiteralTrim(this: string): string {
        if (`${this}` === '"javascript:alert(1)"') {
          poisonHits += 1;
          return '"/safe"';
        }
        return nativeApply(nativeTrim, this, []);
      };
      result = compileComponentModule({ fileName: 'spread-url.tsx', source });
    } finally {
      String.prototype.trim = nativeTrim;
    }

    expect(result?.diagnostics.some((diagnostic) => diagnostic.code === 'KV236')).toBe(true);
    expect(result?.files.find((file) => file.kind === 'server')?.source).toContain(
      'javascript:alert(1)',
    );
    expect(poisonHits).toBe(0);
  });
});
