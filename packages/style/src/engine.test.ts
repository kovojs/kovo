import { describe, expect, it } from 'vitest';

import {
  attrs,
  create,
  createAtomicStyles,
  createKeyframes,
  defineVars,
  defineVarsWithCss,
  emitAtomicCss,
  raw,
} from './engine.js';

// Regression coverage for bugz-3 L10 (SPEC.md §13.1): `defineVars` used to
// interpolate `String(value)` verbatim into a CSS rule string, so a runtime
// value containing `}`, `;`, or `</style>` broke out of the
// declaration/rule (or, when the emitted CSS is inlined, out of a `<style>`
// element). Kovo fails closed, so these public runtime entry points now reject
// such values instead of emitting an unescaped, breakout-capable rule.
describe('bugz-3 L10: defineVars CSS-value breakout (SPEC.md §13.1)', () => {
  it('pins every CSS serialization stage against late authored intrinsic replacement', () => {
    const nativeArrayJoin = Array.prototype.join;
    const nativeArrayPush = Array.prototype.push;
    const nativeArraySort = Array.prototype.sort;
    const nativeJsonStringify = JSON.stringify;
    const nativeMapGet = Map.prototype.get;
    const nativeMapSet = Map.prototype.set;
    const nativeObjectEntries = Object.entries;
    const nativeObjectKeys = Object.keys;
    const nativeRegExpExec = RegExp.prototype.exec;
    const nativeStringReplace = String.prototype.replace;
    const nativeStringStartsWith = String.prototype.startsWith;
    const nativeWeakMapGet = WeakMap.prototype.get;
    const nativeWeakMapSet = WeakMap.prototype.set;
    let result: { css: string; merged: ReturnType<typeof attrs> } | undefined;
    try {
      Array.prototype.join = () => '0}html{display:none}';
      Array.prototype.push = () => 0;
      Array.prototype.sort = () => {
        throw new Error('poisoned sort');
      };
      JSON.stringify = () => '0}html{display:none}';
      Map.prototype.get = () => undefined;
      Map.prototype.set = function poisonedMapSet() {
        return this;
      };
      Object.entries = () => [['color', 'red}html{display:none}']];
      Object.keys = () => ['poisoned'];
      RegExp.prototype.exec = () => null;
      String.prototype.replace = () => '0}html{display:none}';
      String.prototype.startsWith = () => false;
      WeakMap.prototype.get = () => undefined;
      WeakMap.prototype.set = function poisonedWeakMapSet() {
        return this;
      };

      const compiled = createAtomicStyles({ root: { color: 'red', padding: 4 } });
      defineVarsWithCss({ accent: '#2563eb' });
      const pulse = createKeyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
      result = {
        css: emitAtomicCss(compiled.rules, { keyframes: [pulse] }),
        merged: attrs(compiled.styles.root, raw({ marginTop: 2 })),
      };
    } finally {
      Array.prototype.join = nativeArrayJoin;
      Array.prototype.push = nativeArrayPush;
      Array.prototype.sort = nativeArraySort;
      JSON.stringify = nativeJsonStringify;
      Map.prototype.get = nativeMapGet;
      Map.prototype.set = nativeMapSet;
      Object.entries = nativeObjectEntries;
      Object.keys = nativeObjectKeys;
      RegExp.prototype.exec = nativeRegExpExec;
      String.prototype.replace = nativeStringReplace;
      String.prototype.startsWith = nativeStringStartsWith;
      WeakMap.prototype.get = nativeWeakMapGet;
      WeakMap.prototype.set = nativeWeakMapSet;
    }
    expect(result?.css).toContain('@keyframes kv-keyframes-');
    expect(result?.css).toContain('{color:red}');
    expect(result?.css).not.toContain('html{display:none}');
    expect(result?.merged.style).toBe('margin-top:2');
  });

  it('rejects accessor, unstable proxy, and unbranded output carriers without invoking them', () => {
    let invoked = false;
    const accessorStyle = {
      root: {
        get color() {
          invoked = true;
          return 'red';
        },
      },
    };
    expect(() => create(accessorStyle)).toThrow(/stable own data property/u);
    expect(invoked).toBe(false);

    let flip = false;
    const unstable = new Proxy(
      { root: { color: 'red' } },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property === 'root' && descriptor && 'value' in descriptor) {
            flip = !flip;
            return { ...descriptor, value: flip ? descriptor.value : { color: 'blue' } };
          }
          return descriptor;
        },
      },
    );
    expect(() => create(unstable)).toThrow(/stable own data property/u);

    expect(() =>
      emitAtomicCss([
        {
          atRules: [],
          className: 'forged',
          cssProperty: 'color',
          property: 'color',
          priority: 1,
          rule: '.forged{color:red}html{display:none}',
          selectorSuffix: '',
          source: 'forged',
          value: 'red',
        },
      ]),
    ).toThrow(/framework-created atomic rule/u);
  });
  it('keeps delimiter validation authoritative after authored Set poisoning', () => {
    const nativeHas = Set.prototype.has;
    let emitted = '';
    let error: unknown;
    try {
      Set.prototype.has = () => false;
      try {
        emitted = String(defineVarsWithCss({ primary: 'red}html{display:none}' }).rules);
      } catch (caught) {
        error = caught;
      }
    } finally {
      Set.prototype.has = nativeHas;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(emitted).toBe('');
  });

  it('does not consult the mutable global String binding for numeric CSS values', () => {
    const nativeString = globalThis.String;
    let rule = '';
    try {
      globalThis.String = (() => '0}html{display:none}') as StringConstructor;
      const vars = defineVarsWithCss({ spacing: 1 });
      rule = vars.rules[0]?.rule ?? '';
    } finally {
      globalThis.String = nativeString;
    }
    expect(rule).toBe(':root{--kovo-tokens-spacing:1}');
  });
  it('rejects a defineVars value that closes the :root block and injects a rule', () => {
    // OLD behavior: __rules[0].rule === ':root{--kovo-tokens-primary:red}html{display:none}}'
    // (the `}` closes :root early and `html{display:none}` becomes a live rule).
    expect(() => defineVars({ primary: 'red}html{display:none}' })).toThrowError(
      /style\.defineVars rejected an unsafe CSS value for token "primary".*"\}"/s,
    );
  });

  it('rejects a defineVars value carrying a `;` declaration delimiter', () => {
    expect(() => defineVars({ primary: 'red;color:blue' })).toThrowError(
      /style\.defineVars rejected an unsafe CSS value/,
    );
  });

  it('still emits ordinary CSS values verbatim (no over-blocking, no escaping)', () => {
    // A legitimate value with spaces, parens, commas, `#`, `%`, and `-` must pass
    // unchanged so the fail-closed validator does not corrupt real stylesheets.
    const vars = defineVarsWithCss({
      primary: '#16a34a',
      shadow: 'color-mix(in srgb, #fff 50%, #000)',
      border: '1px solid var(--kovo-tokens-primary)',
    });
    const rules = vars.rules;
    const css = emitAtomicCss(rules);

    expect(rules.map((rule) => rule.rule)).toEqual([
      ':root{--kovo-tokens-primary:#16a34a}',
      ':root{--kovo-tokens-shadow:color-mix(in srgb, #fff 50%, #000)}',
      ':root{--kovo-tokens-border:1px solid var(--kovo-tokens-primary)}',
    ]);
    // The breakout-capable substrings never appear because nothing closed a block.
    expect(css).toContain('--kovo-tokens-primary:#16a34a');
    expect(css).not.toContain('}html{');
  });

  it('rejects style.create values that break out of an atomic declaration', () => {
    expect(() =>
      create({
        card: {
          color: 'red}html{display:none}',
        },
      }),
    ).toThrowError(/style\.create rejected an unsafe CSS value/);
  });

  it('rejects unsafe token names before they enter CSS custom-property names', () => {
    expect(() => defineVars({ 'primary}html{display:none': '#fff' })).toThrowError(
      /style\.defineVars rejected an unsafe CSS token/,
    );
  });

  it('rejects CSS-ident-invalid defineVars token names before emitting custom properties', () => {
    expect(() => defineVars({ 'AT&TAccent': '#0f766e' })).toThrowError(
      /style\.defineVars rejected CSS-invalid token "AT&TAccent".*"--kovo-tokens--a-t&-t-accent"/s,
    );
    expect(() => defineVars({ 'R&D_gap2': '#7c3aed' })).toThrowError(
      /style\.defineVars rejected CSS-invalid token "R&D_gap2".*"--kovo-tokens--r&-d_gap2"/s,
    );

    const vars = defineVarsWithCss({ accent: '#0f766e' });
    const css = emitAtomicCss(vars.rules);
    expect(css).not.toContain('--kovo-tokens--a-t&-t-accent');
    expect(css).not.toContain('--kovo-tokens--r&-d_gap2');
  });

  it('rejects keyframe step names and declaration values that break out of @keyframes', () => {
    expect(() =>
      createKeyframes({
        '0%}html{display:none': {
          opacity: 0,
        },
      }),
    ).toThrowError(/style\.keyframes rejected an unsafe CSS step/);

    expect(() =>
      createKeyframes({
        to: {
          transform: 'translateX(0)}html{display:none}',
        },
      }),
    ).toThrowError(/style\.keyframes rejected an unsafe CSS value/);
  });
});
