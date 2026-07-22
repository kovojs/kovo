import { spawnSync } from 'node:child_process';

import { type Options as AcornOptions, Parser, version as acornVersion } from 'acorn';
import { describe, expect, it } from 'vitest';

import { MAX_JAVASCRIPT_MODULE_REFERENCES } from './javascript-ast.js';
import { type KovoEmittedTranslationInput, verifyEmittedTranslation } from './translation.js';

const ConstructableParser = Parser as unknown as new (
  options: AcornOptions,
  input: string,
  startPos?: number,
) => Parser;

// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies C13 independently-reparsed-emitted-translation
describe('emitted translation validation (Plan 3 §2.2)', () => {
  it('accepts exact reviewed imports, secret-free client surfaces, covered kinds, and operation records', () => {
    expect(verifyEmittedTranslation(validTranslation())).toEqual({ findings: [], ok: true });

    const wrapped = validTranslation();
    const server = artifact(wrapped, 'server');
    server.source = `export function renderSource() { return \`${server.source.trim()}\`; }\n`;
    expect(verifyEmittedTranslation(wrapped)).toEqual({ findings: [], ok: true });
  });

  it('rejects an emitted binding absent from the KV437-reviewed import set', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('does not admit an unreviewed import or delete its finding through late intrinsics', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );
    const nativeHas = Set.prototype.has;
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    try {
      Set.prototype.has = function poisonedReviewedImportHas(value: unknown): boolean {
        if (typeof value === 'string' && value.includes('STRIPE_SECRET_KEY')) return true;
        return nativeApply(nativeHas, this, [value]);
      };
      Array.prototype.push = function poisonedTranslationFindingPush<T>(...values: T[]): number {
        if ((values[0] as { code?: unknown } | undefined)?.code === 'client-import-unreviewed') {
          return this.length;
        }
        return nativeApply(nativePush, this, values);
      };
      findings = verifyEmittedTranslation(input).findings;
    } finally {
      Set.prototype.has = nativeHas;
      Array.prototype.push = nativePush;
    }
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('does not let a late Array.push mutation delete an import from the parser AST', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    try {
      Array.prototype.push = function poisonedParserBodyPush<T>(...values: T[]): number {
        if ((values[0] as { type?: unknown } | undefined)?.type === 'ImportDeclaration') {
          return this.length;
        }
        return nativeApply(nativePush, this, values);
      };
      findings = verifyEmittedTranslation(input).findings;
    } finally {
      Array.prototype.push = nativePush;
    }
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('removes arbitrary inherited parser callbacks and restores the caller state', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    const probe = '__kovoParserInheritedGetterProbe__';
    let getterCalls = 0;
    function poisonParserPush<T>(this: T[], ...values: T[]): number {
      if ((values[0] as { type?: unknown } | undefined)?.type === 'ImportDeclaration') {
        return this.length;
      }
      return nativeApply(nativePush, this, values);
    }
    const getter = () => {
      getterCalls += 1;
      Array.prototype.push = poisonParserPush;
      return undefined;
    };
    const descriptor: PropertyDescriptor = {
      configurable: true,
      enumerable: true,
      get: getter,
      set() {},
    };
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    let parserPushLeftPoisoned = false;
    let restored: PropertyDescriptor | undefined;
    try {
      Object.defineProperty(Object.prototype, probe, descriptor);
      findings = verifyEmittedTranslation(input).findings;
      parserPushLeftPoisoned = Array.prototype.push === poisonParserPush;
      restored = Object.getOwnPropertyDescriptor(Object.prototype, probe);
    } finally {
      Array.prototype.push = nativePush;
      Reflect.deleteProperty(Object.prototype, probe);
    }

    expect(getterCalls).toBe(0);
    expect(parserPushLeftPoisoned).toBe(false);
    expect(restored).toEqual(descriptor);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('restores the source-reachable Acorn Parser graph around the parse', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );
    const original = Object.getOwnPropertyDescriptor(Parser.prototype, 'parse');
    expect(original).toBeDefined();
    const emptyParse = () => ({
      body: [],
      end: 0,
      sourceType: 'module',
      start: 0,
      type: 'Program',
    });
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    let callerMutationRestored = false;
    try {
      Object.defineProperty(Parser.prototype, 'parse', {
        ...original,
        value: emptyParse,
      });
      findings = verifyEmittedTranslation(input).findings;
      callerMutationRestored = Parser.prototype.parse === emptyParse;
    } finally {
      Object.defineProperty(Parser.prototype, 'parse', original!);
    }

    expect(callerMutationRestored).toBe(true);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('removes callbacks from the fixed-mode shared Acorn word cache', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );
    const seed = new ConstructableParser(
      { allowHashBang: true, ecmaVersion: 'latest', sourceType: 'module' },
      '',
    ) as Parser & { keywords: RegExp };
    const expression = seed.keywords;
    const original = Object.getOwnPropertyDescriptor(expression, 'test');
    const nativePush = Array.prototype.push;
    const nativeTest = RegExp.prototype.test;
    const nativeApply = Reflect.apply;
    let callbackCalls = 0;
    function poisonParserPush<T>(this: T[], ...values: T[]): number {
      if ((values[0] as { type?: unknown } | undefined)?.type === 'ImportDeclaration') {
        return this.length;
      }
      return nativeApply(nativePush, this, values);
    }
    function poisonedWordTest(this: RegExp, value: string): boolean {
      callbackCalls += 1;
      Array.prototype.push = poisonParserPush;
      return nativeApply(nativeTest, this, [value]);
    }
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    let callerMutationRestored = false;
    let parserPushRestored = false;
    try {
      Object.defineProperty(expression, 'test', {
        configurable: true,
        enumerable: false,
        value: poisonedWordTest,
        writable: true,
      });
      findings = verifyEmittedTranslation(input).findings;
      callerMutationRestored = expression.test === poisonedWordTest;
      parserPushRestored = Array.prototype.push === nativePush;
    } finally {
      Array.prototype.push = nativePush;
      if (original === undefined) Reflect.deleteProperty(expression, 'test');
      else Object.defineProperty(expression, 'test', original);
    }

    expect(callbackCalls).toBe(0);
    expect(callerMutationRestored).toBe(true);
    expect(parserPushRestored).toBe(true);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('removes callbacks from Acorn private RegExp state reached by the fixed warm parser', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = `const __kovoParserStateTrigger = /a/;\n${client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    )}`;
    const seed = new ConstructableParser(
      { allowHashBang: true, ecmaVersion: 'latest', sourceType: 'module' },
      'const seed = /a/;',
    ) as Parser & { regexpState: object | null };
    seed.parse();
    const state = seed.regexpState;
    expect(state).not.toBeNull();
    const statePrototype = Object.getPrototypeOf(state!) as { reset: (...args: unknown[]) => void };
    const original = Object.getOwnPropertyDescriptor(statePrototype, 'reset');
    expect(original).toBeDefined();
    const nativeReset = statePrototype.reset;
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let callbackCalls = 0;
    function poisonParserPush<T>(this: T[], ...values: T[]): number {
      if ((values[0] as { type?: unknown } | undefined)?.type === 'ImportDeclaration') {
        return this.length;
      }
      return nativeApply(nativePush, this, values);
    }
    function poisonedReset(this: object, ...args: unknown[]): void {
      callbackCalls += 1;
      Array.prototype.push = poisonParserPush;
      nativeApply(nativeReset, this, args);
    }
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    let callerMutationRestored = false;
    let parserPushRestored = false;
    try {
      Object.defineProperty(statePrototype, 'reset', { ...original, value: poisonedReset });
      findings = verifyEmittedTranslation(input).findings;
      callerMutationRestored = statePrototype.reset === poisonedReset;
      parserPushRestored = Array.prototype.push === nativePush;
    } finally {
      Array.prototype.push = nativePush;
      Object.defineProperty(statePrototype, 'reset', original!);
    }

    expect(callbackCalls).toBe(0);
    expect(callerMutationRestored).toBe(true);
    expect(parserPushRestored).toBe(true);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('removes callbacks from Acorn private DestructuringErrors reached by a warm subclass', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = `const __kovoDestructuringErrorsTrigger = { reviewed: true };\n${client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    )}`;
    const checkExpressionErrorsDescriptor = Object.getOwnPropertyDescriptor(
      Parser.prototype,
      'checkExpressionErrors',
    );
    const originalCheckExpressionErrors = checkExpressionErrorsDescriptor?.value;
    expect(originalCheckExpressionErrors).toBeTypeOf('function');
    let errors: object | undefined;
    function captureDestructuringErrors(
      this: Parser,
      reference: unknown,
      andThrow: unknown,
    ): unknown {
      if (typeof reference === 'object' && reference !== null) errors ??= reference;
      return Reflect.apply(originalCheckExpressionErrors as Function, this, [reference, andThrow]);
    }
    try {
      Object.defineProperty(Parser.prototype, 'checkExpressionErrors', {
        ...checkExpressionErrorsDescriptor,
        value: captureDestructuringErrors,
      });
      new ConstructableParser(
        { allowHashBang: true, ecmaVersion: 'latest', sourceType: 'module' },
        'const __kovoDestructuringErrorsSeed = { reviewed: true };',
      ).parse();
    } finally {
      Object.defineProperty(
        Parser.prototype,
        'checkExpressionErrors',
        checkExpressionErrorsDescriptor!,
      );
    }
    expect(errors).toBeDefined();

    const errorsPrototype = Object.getPrototypeOf(errors!) as object;
    const originalDoubleProto = Object.getOwnPropertyDescriptor(errorsPrototype, 'doubleProto');
    expect(originalDoubleProto).toBeUndefined();
    const nativePush = Array.prototype.push;
    const nativeApply = Reflect.apply;
    let callbackCalls = 0;
    function poisonParserPush<T>(this: T[], ...values: T[]): number {
      if ((values[0] as { type?: unknown } | undefined)?.type === 'ImportDeclaration') {
        return this.length;
      }
      return nativeApply(nativePush, this, values);
    }
    function poisonedDoubleProto(this: object, value: unknown): void {
      callbackCalls += 1;
      Array.prototype.push = poisonParserPush;
      Object.defineProperty(this, 'doubleProto', {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    let callerMutationRestored = false;
    let parserPushRestored = false;
    try {
      Object.defineProperty(errorsPrototype, 'doubleProto', {
        configurable: true,
        enumerable: false,
        set: poisonedDoubleProto,
      });
      findings = verifyEmittedTranslation(input).findings;
      callerMutationRestored =
        Object.getOwnPropertyDescriptor(errorsPrototype, 'doubleProto')?.set ===
        poisonedDoubleProto;
      parserPushRestored = Array.prototype.push === nativePush;
    } finally {
      Array.prototype.push = nativePush;
      if (originalDoubleProto === undefined) {
        Reflect.deleteProperty(errorsPrototype, 'doubleProto');
      } else {
        Object.defineProperty(errorsPrototype, 'doubleProto', originalDoubleProto);
      }
    }

    expect(callbackCalls).toBe(0);
    expect(callerMutationRestored).toBe(true);
    expect(parserPushRestored).toBe(true);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('pins the exact Acorn version and fixed-mode lazy control census', () => {
    expect(acornVersion).toBe('8.17.0');
    const options = { allowHashBang: true, ecmaVersion: 'latest', sourceType: 'module' } as const;
    const originalCheckExpressionErrors = Object.getOwnPropertyDescriptor(
      Parser.prototype,
      'checkExpressionErrors',
    )?.value;
    expect(originalCheckExpressionErrors).toBeTypeOf('function');
    let destructuringErrors: object | undefined;
    class WarmCensusParser extends ConstructableParser {
      checkExpressionErrors(reference: unknown, andThrow: unknown): unknown {
        if (typeof reference === 'object' && reference !== null) {
          destructuringErrors ??= reference;
        }
        return Reflect.apply(originalCheckExpressionErrors as Function, this, [
          reference,
          andThrow,
        ]);
      }
    }
    const warm = new WarmCensusParser(
      options,
      'const __kovoWarmDestructuringCensus = { reviewed: true }; const __kovoWarmRegExpCensus = /(/;',
    ) as Parser & {
      keywords: RegExp;
      regexpState: { branchID: object; parser: Parser } | null;
      reservedWords: RegExp;
      reservedWordsStrict: RegExp;
      reservedWordsStrictBind: RegExp;
      scopeStack: object[];
    };
    expect(() => warm.parse()).toThrow(/Unterminated group/u);
    expect(
      new Set([
        warm.keywords,
        warm.reservedWords,
        warm.reservedWordsStrict,
        warm.reservedWordsStrictBind,
      ]).size,
    ).toBe(4);
    expect(new Set(Reflect.ownKeys(destructuringErrors!))).toEqual(
      new Set([
        'shorthandAssign',
        'trailingComma',
        'parenthesizedAssign',
        'parenthesizedBind',
        'doubleProto',
      ]),
    );
    expect(Reflect.ownKeys(Object.getPrototypeOf(destructuringErrors!))).toEqual(['constructor']);
    expect(Reflect.ownKeys(warm.scopeStack[0]!)).toEqual(['flags', 'var', 'lexical', 'functions']);
    expect(Reflect.ownKeys(Object.getPrototypeOf(warm.scopeStack[0]!))).toEqual(['constructor']);
    expect(warm.regexpState?.parser).toBe(warm);
    expect(Reflect.ownKeys(Object.getPrototypeOf(warm.regexpState!))).toEqual([
      'constructor',
      'reset',
      'raise',
      'at',
      'nextIndex',
      'current',
      'lookahead',
      'advance',
      'eat',
      'eatChars',
    ]);
    expect(Reflect.ownKeys(Object.getPrototypeOf(warm.regexpState!.branchID))).toEqual([
      'constructor',
      'separatedFrom',
      'sibling',
    ]);
    const second = new ConstructableParser(options, '') as Parser & { keywords: RegExp };
    expect(second.keywords).toBe(warm.keywords);
  });

  it('fails closed on non-restorable parser drift and continues cleanup after a restore failure', () => {
    const moduleUrl = new URL('./translation-intrinsics.ts', import.meta.url).href;
    const entryDrift = spawnIsolatedParserControlProbe(`
        const { translationWithParserControls } = await import(${JSON.stringify(moduleUrl)});
        let callbackRan = false;
        let getterCalls = 0;
        Object.defineProperty(Object.prototype, '__kovoNonconfigurableEntryProbe__', {
          configurable: false,
          enumerable: true,
          get() { getterCalls += 1; return undefined; }
        });
        let threw = false;
        try {
          translationWithParserControls(() => { callbackRan = true; });
        } catch (error) {
          threw = error instanceof TypeError && /could not be installed/u.test(error.message);
        }
        if (!threw || callbackRan || getterCalls !== 0) {
          throw new Error(JSON.stringify({ callbackRan, getterCalls, threw }));
        }
      `);
    expect(entryDrift.status, entryDrift.stderr).toBe(0);

    const restoreFailure = spawnIsolatedParserControlProbe(`
        const { translationWithParserControls } = await import(${JSON.stringify(moduleUrl)});
        const nativePush = Array.prototype.push;
        const nativeSlice = String.prototype.slice;
        function poisonPush() { return 0; }
        function poisonSlice() { return ''; }
        let threw = false;
        try {
          translationWithParserControls(() => {
            Object.defineProperty(Array.prototype, 'push', {
              configurable: false,
              enumerable: false,
              value: poisonPush,
              writable: true
            });
            String.prototype.slice = poisonSlice;
          });
        } catch (error) {
          threw = error instanceof TypeError && /could not be fully restored/u.test(error.message);
        }
        if (!threw || Array.prototype.push !== nativePush || String.prototype.slice !== nativeSlice) {
          throw new Error(JSON.stringify({
            pushValueRestored: Array.prototype.push === nativePush,
            sliceRestored: String.prototype.slice === nativeSlice,
            threw
          }));
        }
      `);
    expect(restoreFailure.status, restoreFailure.stderr).toBe(0);

    const extensibilityDrift = spawnIsolatedParserControlProbe(`
        const { translationWithParserControls } = await import(${JSON.stringify(moduleUrl)});
        let callbackRan = false;
        Object.preventExtensions(Object.prototype);
        let threw = false;
        try {
          translationWithParserControls(() => { callbackRan = true; });
        } catch (error) {
          threw = error instanceof TypeError && /could not be installed/u.test(error.message);
        }
        if (!threw || callbackRan) throw new Error(JSON.stringify({ callbackRan, threw }));
      `);
    expect(extensibilityDrift.status, extensibilityDrift.stderr).toBe(0);

    const censusBound = spawnIsolatedParserControlProbe(`
        const { translationWithParserControls } = await import(${JSON.stringify(moduleUrl)});
        let callbackRan = false;
        for (let index = 0; index < 1_024; index += 1) {
          Object.defineProperty(Object.prototype, '__kovoParserBound' + index, {
            configurable: true,
            value: index
          });
        }
        let threw = false;
        try {
          translationWithParserControls(() => { callbackRan = true; });
        } catch (error) {
          threw = error instanceof TypeError && /census exceeds its bound/u.test(error.message);
        }
        if (!threw || callbackRan) throw new Error(JSON.stringify({ callbackRan, threw }));
      `);
    expect(censusBound.status, censusBound.stderr).toBe(0);
  });

  it('keeps the fixed-mode parser census inside its per-translation performance budget', () => {
    const input = validTranslation();
    for (let index = 0; index < 5; index += 1)
      expect(verifyEmittedTranslation(input).ok).toBe(true);
    const start = performance.now();
    for (let index = 0; index < 100; index += 1) {
      expect(verifyEmittedTranslation(input).ok).toBe(true);
    }
    expect(performance.now() - start).toBeLessThan(2_500);
  });

  it('does not hide an escaped exact secret token through late Array.some', () => {
    const input = validTranslation();
    input.decision = { ...input.decision, secretFieldNames: ['password-hash'] };
    artifact(input, 'registry').source += "\nconst leak = 'password\\x2dhash';\n";
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    try {
      Array.prototype.some = function poisonedSecretTokenSome<T>(
        callback: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        if (typeof (this[0] as { kind?: unknown } | undefined)?.kind === 'string') return false;
        return nativeApply(nativeSome, this, [callback, thisArg]);
      };
      findings = verifyEmittedTranslation(input).findings;
    } finally {
      Array.prototype.some = nativeSome;
    }
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'registry',
          code: 'secret-field-emitted',
          relation: 'secret-field-absence',
        }),
      ]),
    );
  });

  it('does not normalize an operation mismatch through inherited JSON hooks', () => {
    const input = validTranslation();
    artifact(input, 'server').source = artifact(input, 'server').source.replace(
      '"target":"users"',
      '"target":"admins"',
    );
    const nativeDefineProperty = Object.defineProperty;
    const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const original = nativeGetOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let findings: ReturnType<typeof verifyEmittedTranslation>['findings'] | undefined;
    try {
      nativeDefineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value(this: { door?: unknown; kind?: unknown }) {
          if (typeof this.door === 'string' && typeof this.kind === 'string') {
            return { door: this.door, kind: this.kind };
          }
          return this;
        },
        writable: true,
      });
      findings = verifyEmittedTranslation(input).findings;
    } finally {
      if (original === undefined) Reflect.deleteProperty(Object.prototype, 'toJSON');
      else nativeDefineProperty(Object.prototype, 'toJSON', original);
    }
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-decision-mismatch',
          relation: 'operation-serialization',
        }),
      ]),
    );
  });

  it('derives every client module acquisition from the complete AST and admits only named imports', () => {
    for (const acquisition of [
      'export { safeCall } from "./safe.client.js";',
      'export * from "./safe.client.js";',
      'import("./safe.client.js");',
      'import safeCall from "./safe.client.js";',
      'import "./safe.client.js";',
    ]) {
      const input = validTranslation();
      artifact(input, 'client').source += `\n${acquisition}\n`;
      expect(verifyEmittedTranslation(input).findings, acquisition).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'client-import-unreviewed',
            relation: 'client-import-subset',
          }),
        ]),
      );
    }

    const invalid = validTranslation();
    artifact(invalid, 'client').source += '\nimport { broken from "./safe.client.js";\n';
    expect(verifyEmittedTranslation(invalid).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-parse',
          relation: 'client-import-subset',
        }),
      ]),
    );

    const overBudget = validTranslation();
    artifact(overBudget, 'client').source = "import './safe.client.js';\n".repeat(
      MAX_JAVASCRIPT_MODULE_REFERENCES + 1,
    );
    expect(verifyEmittedTranslation(overBudget).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-budget',
          message: 'emitted client module exceeds the finite module-reference budget',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('rejects exact secret field tokens in client or registry output without substring false positives', () => {
    const safe = validTranslation();
    artifact(safe, 'registry').source += '\ninterface Safe { passwordHashDigest: string }\n';
    expect(verifyEmittedTranslation(safe)).toMatchObject({ ok: true });

    const commented = validTranslation();
    artifact(commented, 'registry').source += '\n// passwordHash\n';
    expect(verifyEmittedTranslation(commented).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'registry',
          code: 'secret-field-emitted',
          relation: 'secret-field-absence',
        }),
      ]),
    );

    const escaped = validTranslation();
    artifact(escaped, 'registry').source += '\ninterface Leak { password\\u0048ash: string }\n';
    expect(verifyEmittedTranslation(escaped).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'registry',
          code: 'secret-field-emitted',
          relation: 'secret-field-absence',
        }),
      ]),
    );

    const unicode = validTranslation();
    unicode.decision = { ...unicode.decision, secretFieldNames: ['密码'] };
    artifact(unicode, 'registry').source += '\ninterface Leak { 密码: string }\n';
    expect(verifyEmittedTranslation(unicode).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'registry',
          code: 'secret-field-emitted',
          relation: 'secret-field-absence',
        }),
      ]),
    );

    for (const kind of ['client', 'registry'] as const) {
      const input = validTranslation();
      artifact(input, kind).source += '\ninterface Leak { passwordHash: string }\n';
      expect(verifyEmittedTranslation(input).findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactKind: kind,
            code: 'secret-field-emitted',
            relation: 'secret-field-absence',
          }),
        ]),
      );
    }
  });

  it('fails a synthetic emitted kind until the coverage policy classifies it', () => {
    const input = validTranslation();
    input.artifacts.push({ fileName: 'generated/probe.map', kind: 'source-map', source: '{}' });

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact-kind-unreviewed',
          relation: 'artifact-coverage',
        }),
      ]),
    );

    const mislabeled = validTranslation();
    artifact(mislabeled, 'client').kind = 'css';
    expect(verifyEmittedTranslation(mislabeled).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact-kind-mismatch',
          relation: 'artifact-coverage',
        }),
      ]),
    );
  });

  it('requires server and per-handler operation JSON to use the frozen vocabularies and decision facts', () => {
    const unknown = validTranslation();
    artifact(unknown, 'client').source = artifact(unknown, 'client').source.replace(
      'browser.state.write',
      'browser.state.shell',
    );
    expect(verifyEmittedTranslation(unknown).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-kind-unreviewed',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const drifted = validTranslation();
    artifact(drifted, 'server').source = artifact(drifted, 'server').source.replace(
      '"target":"users"',
      '"target":"admins"',
    );
    expect(verifyEmittedTranslation(drifted).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-decision-mismatch',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const extendedClient = validTranslation();
    artifact(extendedClient, 'client').source = artifact(extendedClient, 'client').source.replace(
      '}], (_event',
      '}].concat([]), (_event',
    );
    expect(verifyEmittedTranslation(extendedClient).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-handler-shape',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const extendedServer = validTranslation();
    artifact(extendedServer, 'server').source = artifact(extendedServer, 'server').source.replace(
      '}]), schema:',
      '}].concat([])), schema:',
    );
    expect(verifyEmittedTranslation(extendedServer).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-manifest-shape',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const nestedDecoy = validTranslation();
    artifact(nestedDecoy, 'server').source = artifact(nestedDecoy, 'server')
      .source.replace('{ operations:', '{ decoy: { operations:')
      .replace(']), schema:', ']) }, schema:');
    expect(verifyEmittedTranslation(nestedDecoy).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-manifest-shape',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const duplicateOverride = validTranslation();
    artifact(duplicateOverride, 'server').source = artifact(
      duplicateOverride,
      'server',
    ).source.replace(']), schema:', ']), operations: [], schema:');
    expect(verifyEmittedTranslation(duplicateOverride).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-manifest-shape',
          relation: 'operation-serialization',
        }),
      ]),
    );
  });

  it('rejects JavaScript object syntax where the emission contract requires own-data JSON', () => {
    const input = validTranslation();
    artifact(input, 'client').source = artifact(input, 'client').source.replace(
      '[{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}]',
      "[{ door: 'compiler-state', kind: 'browser.state.write', target: 'state.count' }]",
    );

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-json',
          relation: 'operation-serialization',
        }),
      ]),
    );
  });
});

function spawnIsolatedParserControlProbe(source: string) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', source],
    { encoding: 'utf8' },
  );
}

function validTranslation(): KovoEmittedTranslationInput & {
  artifacts: { fileName: string; kind: string; source: string }[];
} {
  return {
    artifacts: [
      {
        fileName: 'generated/card.client.js',
        kind: 'client',
        source: [
          'import { securityHandler } from "@kovojs/browser/generated";',
          'import { safeCall as call } from "./safe.client.js";',
          'export const Card$button_click = securityHandler([{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}], (_event, _ctx) => { return call(); });',
          '',
        ].join('\n'),
      },
      {
        fileName: 'generated/card.server.js',
        kind: 'server',
        source:
          'export const __kovoSecurityOperationManifest_v1 = Object.freeze({ operations: Object.freeze([{"door":"managed-db","kind":"server.database.read","target":"users"}]), schema: "kovo-security-operation-ir/v1", semanticGraph: undefined });\n',
      },
      {
        fileName: 'generated/registries.d.ts',
        kind: 'registry',
        source: 'export interface QueryRegistry { user: { id: string } }\n',
      },
      {
        fileName: 'generated/card.css',
        kind: 'css',
        source: '.card { color: green; }\n',
      },
    ],
    decision: {
      clientHandlers: [
        {
          exportName: 'Card$button_click',
          operations: [
            {
              door: 'compiler-state',
              kind: 'browser.state.write',
              target: 'state.count',
            },
          ],
        },
      ],
      clientImports: [
        {
          imports: [{ importedName: 'securityHandler', localName: 'securityHandler' }],
          moduleSpecifier: '@kovojs/browser/generated',
        },
        {
          imports: [{ importedName: 'safeCall', localName: 'call' }],
          moduleSpecifier: './safe.client.js',
        },
      ],
      secretFieldNames: ['passwordHash'],
      serverOperations: [{ door: 'managed-db', kind: 'server.database.read', target: 'users' }],
    },
  };
}

function artifact(
  input: ReturnType<typeof validTranslation>,
  kind: 'client' | 'registry' | 'server',
): { fileName: string; kind: string; source: string } {
  return input.artifacts.find((entry) => entry.kind === kind)!;
}
