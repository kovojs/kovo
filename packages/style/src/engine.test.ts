import { describe, expect, it } from 'vitest';

import { createTheme, defineVars, emitAtomicCss } from './engine.js';

// Regression coverage for bugz-3 L10 (SPEC.md §13.1): `defineVars`/`createTheme`
// used to interpolate `String(value)` verbatim into a CSS rule string, so a
// runtime value containing `}`, `;`, or `</style>` broke out of the
// declaration/rule (or, when the emitted CSS is inlined, out of a `<style>`
// element). Kovo fails closed, so these public runtime entry points now reject
// such values instead of emitting an unescaped, breakout-capable rule.
describe('bugz-3 L10: createTheme/defineVars CSS-value breakout (SPEC.md §13.1)', () => {
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

  it('rejects a createTheme override that breaks out of an inline <style> element', () => {
    const tokens = defineVars({ primary: '#2563eb' });
    // OLD behavior: __rules[0].rule kept `red</style><script>alert(1)</script>`
    // verbatim, so an inlined stylesheet shipped an executable <script>.
    expect(() =>
      createTheme(tokens, { primary: 'red</style><script>alert(1)</script>' }),
    ).toThrowError(/style\.createTheme rejected an unsafe CSS value for token "primary".*"<"/s);
  });

  it('rejects a createTheme override containing a control character (newline)', () => {
    const tokens = defineVars({ primary: '#2563eb' });
    expect(() => createTheme(tokens, { primary: 'red\n}html{}' })).toThrowError(
      /style\.createTheme rejected an unsafe CSS value/,
    );
  });

  it('still emits ordinary CSS values verbatim (no over-blocking, no escaping)', () => {
    // A legitimate value with spaces, parens, commas, `#`, `%`, and `-` must pass
    // unchanged so the fail-closed validator does not corrupt real stylesheets.
    const vars = defineVars({
      primary: '#16a34a',
      shadow: 'color-mix(in srgb, #fff 50%, #000)',
      border: '1px solid var(--kovo-tokens-primary)',
    });
    const rules = vars.__rules as ReadonlyArray<{ rule: string }>;
    const css = emitAtomicCss(rules as never);

    expect(rules.map((rule) => rule.rule)).toEqual([
      ':root{--kovo-tokens-primary:#16a34a}',
      ':root{--kovo-tokens-shadow:color-mix(in srgb, #fff 50%, #000)}',
      ':root{--kovo-tokens-border:1px solid var(--kovo-tokens-primary)}',
    ]);
    // The breakout-capable substrings never appear because nothing closed a block.
    expect(css).toContain('--kovo-tokens-primary:#16a34a');
    expect(css).not.toContain('}html{');

    const theme = createTheme(vars, { primary: '#15803d' });
    const themeRules = theme.__rules as ReadonlyArray<{ rule: string }>;
    expect(themeRules[0]?.rule).toBe(`.${theme.className}{--kovo-tokens-primary:#15803d}`);
  });
});
