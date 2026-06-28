import { describe, expect, it } from 'vitest';

import { create, createKeyframes, createTheme, defineVars, emitAtomicCss } from './engine.js';

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

    const vars = defineVars({ accent: '#0f766e' });
    const css = emitAtomicCss(vars.__rules as never);
    expect(css).not.toContain('--kovo-tokens--a-t&-t-accent');
    expect(css).not.toContain('--kovo-tokens--r&-d_gap2');
  });

  it('rejects createTheme overrides that would emit CSS-invalid custom properties', () => {
    const forgedTokens = {
      'R&D_gap2': 'var(--kovo-tokens--r&-d_gap2)',
    } as never;

    expect(() => createTheme(forgedTokens, { 'R&D_gap2': '#7c3aed' } as never)).toThrowError(
      /style\.createTheme rejected CSS-invalid token "R&D_gap2"/,
    );

    const forgedValidTokenName = {
      accent: 'var(--kovo-tokens-a&-accent)',
    } as never;

    expect(() => createTheme(forgedValidTokenName, { accent: '#0f766e' } as never)).toThrowError(
      /style\.createTheme rejected token "accent": base token reference .*valid unescaped CSS custom-property name/s,
    );
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
