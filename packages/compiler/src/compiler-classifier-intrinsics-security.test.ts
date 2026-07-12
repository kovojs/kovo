import { describe, expect, it } from 'vitest';

import {
  assertRenderPlanTokenMonotonicity,
  compileComponentModule,
  CompilerDiagnosticError,
} from './compile.js';

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
    const injection =
      'now, cart) => 0);\nglobalThis.KOVO_DERIVE_INJECTION = true;\n//';
    let poisonHits = 0;
    let result: ReturnType<typeof compileComponentModule> | undefined;
    try {
      Array.prototype.join = function poisonedInlineDeriveJoin(separator?: string): string {
        if (
          this.length === 2 &&
          this[0] === 'now' &&
          this[1] === 'cart' &&
          separator === ', '
        ) {
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
});
