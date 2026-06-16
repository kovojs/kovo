import { describe, expect, it } from 'vitest';

import {
  attrs,
  create,
  createAtomicStyles,
  createTheme,
  defineVars,
  emitAtomicCss,
  getPriority,
  props,
  raw,
} from './index.js';

describe('@kovojs/style phase 1 runtime fork', () => {
  it('merges atoms with property-level last-wins semantics', () => {
    const base = create(
      {
        root: {
          backgroundColor: 'black',
          color: 'white',
        },
      },
      { namespace: 'button', source: 'button.tsx' },
    );
    const override = create(
      {
        root: {
          backgroundColor: 'tomato',
        },
      },
      { namespace: 'buttonOverride', source: 'button.override.tsx' },
    );

    const result = attrs(base.root, override.root);

    expect(result.class).toMatch(/^kv-button-fg-[a-z0-9]+ kv-button-override-bg-[a-z0-9]+$/);
    expect(result['data-style-src']).toBe('button.tsx#root; button.override.tsx#root');
  });

  it('flattens arrays and serializes the explicit raw inline escape hatch', () => {
    const styles = create(
      {
        root: { display: 'inline-flex', opacity: 1 },
        muted: { opacity: 0.7 },
      },
      { namespace: 'badge' },
    );

    const result = attrs([styles.root, false, [styles.muted, raw({ '--progress': '60%' })]]);

    expect(result.class).toMatch(/^kv-badge-d-[a-z0-9]+ kv-badge-opacity-[a-z0-9]+$/);
    expect(result.style).toBe('--progress:60%');
  });

  it('emits readable provenance-prefixed atomic classes and priority layers', () => {
    const compiled = createAtomicStyles(
      {
        root: {
          padding: 8,
          paddingInline: 12,
          width: 44,
          ':hover': { backgroundColor: 'black' },
          '@media (min-width: 40rem)': { width: 52 },
        },
      },
      { namespace: 'button', source: 'button.tsx' },
    );

    expect(compiled.styles.root.__rules).toHaveLength(5);
    expect(compiled.css).toContain('@layer kovo-style.1000');
    expect(compiled.css).toContain('@layer kovo-style.2000');
    expect(compiled.css).toContain('@layer kovo-style.4000');
    expect(compiled.css).toContain('.kv-button-pad-');
    expect(compiled.css).toContain('.kv-button-bg-');
    expect(compiled.css).toContain(':hover');
    expect(compiled.css).toContain('@media (min-width: 40rem)');
  });

  it('keeps priority buckets independent of file/link order', () => {
    const firstFile = createAtomicStyles({ root: { paddingInline: 12 } }, { namespace: 'a' });
    const secondFile = createAtomicStyles({ root: { padding: 8 } }, { namespace: 'b' });
    const css = emitAtomicCss([...(secondFile.styles.root.__rules ?? []), ...(firstFile.styles.root.__rules ?? [])]);

    expect(getPriority('padding')).toBeLessThan(getPriority('paddingInline'));
    expect(css.indexOf('@layer kovo-style.1000')).toBeLessThan(css.indexOf('@layer kovo-style.2000'));
  });

  it('uses the full upstream property-priority table', () => {
    expect(getPriority('@supports (display: grid)')).toBe(30);
    expect(getPriority('@media (min-width: 40rem)')).toBe(200);
    expect(getPriority('@container card (min-width: 20rem)')).toBe(300);
    expect(getPriority(':hover')).toBe(130);
    expect(getPriority('::before')).toBe(5000);
    expect(getPriority('gridTemplate')).toBe(1000);
    expect(getPriority('gridTemplateColumns')).toBe(3000);
    expect(getPriority('scrollPadding')).toBe(1000);
    expect(getPriority('scrollPaddingTop')).toBe(4000);
  });

  it('defines typed token vars and theme override classes', () => {
    const tokens = defineVars(
      {
        accent: '#2563eb',
        onAccent: 'white',
      },
      { namespace: 'ui', source: 'button.tokens.ts' },
    );
    const theme = createTheme(tokens, { accent: '#16a34a' }, { namespace: 'success' });
    const styles = create({ root: { backgroundColor: tokens.accent, color: tokens.onAccent } }, { namespace: 'button' });

    expect(tokens.accent).toBe('var(--kovo-ui-accent)');
    expect(theme.className).toMatch(/^kv-success-theme-[a-z0-9]+$/);
    expect(theme.__rules?.[0]?.rule).toContain('--kovo-ui-accent:#16a34a');
    expect(props(styles.root).className).toMatch(/^kv-button-bg-[a-z0-9]+ kv-button-fg-[a-z0-9]+$/);
  });
});

describe('ported upstream StyleX runtime fixtures', () => {
  it('matches upstream basic props resolution', () => {
    // Ported from ../stylex/packages/@stylexjs/stylex/__tests__/stylex-test.js "basic resolve".
    expect(props({ a: 'aaa', b: 'bbb', $$css: true }).className).toBe('aaa bbb');
  });

  it('matches upstream array merge order', () => {
    // Ported from StyleX "merge order": classes keep first-seen property order unless replaced.
    expect(
      props([
        { a: 'a', ':hover__aa': 'aa', $$css: true },
        { b: 'b', $$css: true },
        { c: 'c', ':hover__cc': 'cc', $$css: true },
      ]).className,
    ).toBe('a aa b c cc');
  });

  it('matches upstream same-property override behavior', () => {
    // Ported from StyleX "top-level array of simple overridden classes".
    expect(
      props([
        { backgroundColor: 'nu7423ey', $$css: true },
        { backgroundColor: 'gh25dzvf', $$css: true },
      ]).className,
    ).toBe('gh25dzvf');
  });

  it('matches upstream nested arrays and pseudo-class override behavior', () => {
    // Ported from StyleX "nested arrays and pseudoClasses overriding things".
    expect(
      props([
        { backgroundColor: 'nu7423ey', $$css: true },
        [{ backgroundColor: 'abcdefg', ':hover__backgroundColor': 'ksdfmwjs', $$css: true }],
        { color: 'gofk2cf1', ':hover__backgroundColor': 'rse6dlih', $$css: true },
      ]).className,
    ).toBe('abcdefg gofk2cf1 rse6dlih');
  });

  it('matches upstream data-style-src collection with the Kovo attrs shape', () => {
    // Ported from StyleX "data prop for source map data"; Kovo keeps `class`, not `className`.
    expect(
      attrs([
        { backgroundColor: 'backgroundColor-red', $$css: 'components/Foo.react.js:1' },
        { color: 'color-blue', $$css: 'components/Bar.react.js:3' },
        [{ display: 'display-block', $$css: 'components/Baz.react.js:5' }],
      ]),
    ).toEqual({
      class: 'backgroundColor-red color-blue display-block',
      'data-style-src':
        'components/Foo.react.js:1; components/Bar.react.js:3; components/Baz.react.js:5',
    });
  });

  it('ports upstream dynamic attrs fixture through Kovo raw inline style', () => {
    // Upstream accepts a bare inline object; Kovo requires the explicit `raw(...)` escape hatch.
    expect(
      attrs([
        { backgroundColor: 'backgroundColor-red', $$css: 'components/Foo.react.js:1' },
        raw({
          color: 'red',
          marginTop: '10px',
          opacity: 0.5,
          '--foo': 2,
          MsTransition: 'none',
          WebkitTapHighlightColor: 'transparent',
        }),
      ]),
    ).toEqual({
      class: 'backgroundColor-red',
      'data-style-src': 'components/Foo.react.js:1',
      style:
        'color:red;margin-top:10px;opacity:0.5;--foo:2;-ms-transition:none;-webkit-tap-highlight-color:transparent',
    });
  });
});
