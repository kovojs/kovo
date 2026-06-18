import { describe, expect, it } from 'vitest';

import {
  attrs,
  create,
  createAtomicStyles,
  defineConsts,
  defineTheme,
  createTheme,
  defineVars,
  emitAtomicCss,
  firstThatWorks,
  keyframes,
  props,
  raw,
  themeFromSeed,
  tokens,
} from './index.js';
import { getPriority } from './internal.js';

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
    expect(compiled.css).toContain('@layer kovo-style-1000');
    expect(compiled.css).toContain('@layer kovo-style-2000');
    expect(compiled.css).toContain('@layer kovo-style-4000');
    expect(compiled.css).toContain('.kv-button-pad-');
    expect(compiled.css).toContain('.kv-button-bg-');
    expect(compiled.css).toContain(':hover');
    expect(compiled.css).toContain('@media (min-width: 40rem)');
  });

  it('emits browser-valid lengths: bare-number lengths get px, unitless props and 0 do not', () => {
    const compiled = createAtomicStyles(
      {
        root: {
          maxWidth: 832,
          gap: 8,
          fontSize: 12,
          margin: 0,
          lineHeight: 1.5,
          zIndex: 10,
          opacity: 1,
          flexShrink: 0,
          height: '100vh',
          flex: '1 1 0%',
        },
      },
      { namespace: 'units', source: 'units.tsx' },
    );

    // Bare-number lengths gain `px` so the served declaration is valid CSS.
    expect(compiled.css).toContain('max-width:832px');
    expect(compiled.css).toContain('gap:8px');
    expect(compiled.css).toContain('font-size:12px');
    // `0` stays unitless and unitless properties are never px-suffixed.
    expect(compiled.css).toContain('margin:0}');
    expect(compiled.css).toContain('line-height:1.5}');
    expect(compiled.css).toContain('z-index:10}');
    expect(compiled.css).toContain('opacity:1}');
    expect(compiled.css).toContain('flex-shrink:0}');
    // Already-unit'd and multi-token values pass through untouched.
    expect(compiled.css).toContain('height:100vh');
    expect(compiled.css).toContain('flex:1 1 0%');
    // The unit lives only in the served text; the atomic class hashes the raw
    // value, so `attrs` class names stay in lockstep with the prior behavior.
    expect(compiled.css).not.toContain(':832px}px');
  });

  it('emits data-attribute selector suffixes for headless component state', () => {
    const compiled = createAtomicStyles(
      {
        root: {
          color: 'gray',
          '[data-state=active]': {
            color: 'black',
          },
        },
      },
      { namespace: 'tabs', source: 'tabs.tsx' },
    );

    expect(compiled.styles.root.__rules).toHaveLength(2);
    expect(compiled.css).toContain('.kv-tabs-fg-');
    expect(compiled.css).toContain('[data-state=active]{color:black}');
  });

  it('keeps priority buckets independent of file/link order', () => {
    const firstFile = createAtomicStyles({ root: { paddingInline: 12 } }, { namespace: 'a' });
    const secondFile = createAtomicStyles({ root: { padding: 8 } }, { namespace: 'b' });
    const css = emitAtomicCss([
      ...(secondFile.styles.root.__rules ?? []),
      ...(firstFile.styles.root.__rules ?? []),
    ]);

    expect(getPriority('padding')).toBeLessThan(getPriority('paddingInline'));
    expect(css.indexOf('@layer kovo-style-1000')).toBeLessThan(
      css.indexOf('@layer kovo-style-2000'),
    );
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
    const styles = create(
      { root: { backgroundColor: tokens.accent, color: tokens.onAccent } },
      { namespace: 'button' },
    );

    expect(tokens.accent).toBe('var(--kovo-ui-accent)');
    expect(theme.className).toMatch(/^kv-success-theme-[a-z0-9]+$/);
    expect(theme.__rules?.[0]?.rule).toContain('--kovo-ui-accent:#16a34a');
    expect(props(styles.root).className).toMatch(/^kv-button-bg-[a-z0-9]+ kv-button-fg-[a-z0-9]+$/);
  });

  it('defines typed constants that can feed static style objects', () => {
    const spacing = defineConsts({
      buttonHeight: 36,
      buttonPadding: '12px',
    });
    const styles = create(
      {
        root: {
          height: spacing.buttonHeight,
          paddingInline: spacing.buttonPadding,
        },
      },
      { namespace: 'button' },
    );

    expect(spacing.buttonHeight).toBe(36);
    expect(Object.isFrozen(spacing)).toBe(true);
    expect(attrs(styles.root).class).toMatch(/^kv-button-h-[a-z0-9]+ kv-button-pad-[a-z0-9]+$/);
  });

  it('generates a deterministic Material theme from one seed color', () => {
    const theme = themeFromSeed('#6750A4', {
      colors: { success: '#16a34a' },
      shape: { cornerMedium: '0.625rem' },
    });

    expect(theme.seed).toBe('#6750a4');
    expect(theme.variant).toBe('tonal-spot');
    expect(theme.sys.color.primary).toBe('#6750a4');
    expect(theme.sys.color.onPrimary).toBe('#ffffff');
    expect(theme.sys.color.surface).toBe('#fffbff');
    expect(theme.dark.sys.color.primary).toBe('#cfbcff');
    expect(theme.ref.primary[40]).toBe('#6750a4');
    expect(theme.sys.shape.cornerMedium).toBe('0.625rem');
    expect(theme.custom.success).toEqual({
      color: '#006c4b',
      colorContainer: '#7df9c2',
      onColor: '#ffffff',
      onColorContainer: '#002114',
    });
    expect(theme.css).toContain('--kovo-theme-ref-palette-primary-40:');
    expect(theme.css).toContain('--kovo-theme-sys-color-primary:');
    expect(theme.css).toContain('--kovo-theme-custom-success-color:');
    expect(theme.css).toContain(':root[data-theme="dark"]');
  });

  it('exports typed var references for theme tokens used in style.create', () => {
    const styles = create(
      {
        root: {
          backgroundColor: tokens.sys.color.primary,
          borderColor: tokens.sys.color.outlineVariant,
          borderRadius: tokens.sys.shape.cornerMedium,
          color: tokens.sys.color.onPrimary,
        },
      },
      { namespace: 'themed-button' },
    );

    expect(tokens.sys.color.primary).toBe('var(--kovo-theme-sys-color-primary)');
    expect(tokens.ref.palette.primary[40]).toBe('var(--kovo-theme-ref-palette-primary-40)');
    expect(tokens.customColor('success').onColor).toBe('var(--kovo-theme-custom-success-on-color)');
    expect(styles.root.__rules?.map((rule) => rule.value)).toContain(
      'var(--kovo-theme-sys-color-primary)',
    );
  });

  it('derives one final theme from a generated base without callbacks', () => {
    const base = defineTheme({ seed: '#6750A4' });
    const theme = defineTheme({
      base,
      component: { buttonBorder: base.sys.color.primary },
      sys: {
        color: { outline: base.sys.color.primary },
      },
      shape: { cornerSmall: '2px' },
    });

    expect(theme.sys.color.outline).toBe(base.sys.color.primary);
    expect(theme.sys.shape.cornerSmall).toBe('2px');
    expect(theme.css).toContain(`--kovo-theme-sys-color-outline: ${base.sys.color.primary};`);
    expect(theme.css).toContain(`--kovo-theme-component-button-border: ${base.sys.color.primary};`);
  });

  it('supports dynamic variants and contrast without leaking missing system roles', () => {
    const highContrast = themeFromSeed('#6750A4', { contrast: 0.5 });
    const vibrant = themeFromSeed('#6750A4', { variant: 'vibrant' });

    expect(highContrast.variant).toBe('tonal-spot');
    expect(highContrast.seed).toBe('#6750a4');
    expect(highContrast.sys.color.primary).not.toBe('#6750a4');
    expect(highContrast.css).toContain('--kovo-theme-sys-color-primary:');
    expect(highContrast.css).not.toContain('undefined');

    expect(vibrant.variant).toBe('vibrant');
    expect(vibrant.sys.color.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(vibrant.ref.primary[40]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vibrant.css).not.toContain('undefined');
  });

  it('keeps generated on-* role pairs at readable contrast for the canonical seed', () => {
    const theme = themeFromSeed('#6750A4');
    const pairs = [
      ['primary', 'onPrimary'],
      ['primaryContainer', 'onPrimaryContainer'],
      ['secondary', 'onSecondary'],
      ['secondaryContainer', 'onSecondaryContainer'],
      ['tertiary', 'onTertiary'],
      ['tertiaryContainer', 'onTertiaryContainer'],
      ['error', 'onError'],
      ['errorContainer', 'onErrorContainer'],
      ['surface', 'onSurface'],
      ['background', 'onBackground'],
    ] as const;

    for (const scheme of [theme.light, theme.dark]) {
      for (const [background, foreground] of pairs) {
        expect(
          contrastRatio(scheme.sys.color[background], scheme.sys.color[foreground]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function contrastRatio(background: string, foreground: string): number {
  const bg = relativeLuminance(background);
  const fg = relativeLuminance(foreground);
  const lighter = Math.max(bg, fg);
  const darker = Math.min(bg, fg);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  const red = channels?.[0] ?? 0;
  const green = channels?.[1] ?? 0;
  const blue = channels?.[2] ?? 0;
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

describe('ported upstream StyleX runtime fixtures', () => {
  it('snapshots supported upstream error handling for missing inputs', () => {
    // Ported from ../stylex/packages/@stylexjs/stylex/__tests__/stylex-test.js "error handling".
    type RuntimeApi = (...args: readonly unknown[]) => unknown;
    const calls = [
      ['create', create as RuntimeApi],
      ['createTheme', createTheme as RuntimeApi],
      ['defineConsts', defineConsts as RuntimeApi],
      ['defineVars', defineVars as RuntimeApi],
      ['firstThatWorks', firstThatWorks as RuntimeApi],
      ['keyframes', keyframes as RuntimeApi],
    ] as const;

    expect(
      calls.map(([api, call]) => {
        try {
          call();
          return { api, message: null, name: null };
        } catch (error) {
          return {
            api,
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
          };
        }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "api": "create",
          "message": "style.create requires styles to be an object.",
          "name": "TypeError",
        },
        {
          "api": "createTheme",
          "message": "style.createTheme requires baseTokens to be an object.",
          "name": "TypeError",
        },
        {
          "api": "defineConsts",
          "message": "style.defineConsts requires constants to be an object.",
          "name": "TypeError",
        },
        {
          "api": "defineVars",
          "message": "style.defineVars requires tokens to be an object.",
          "name": "TypeError",
        },
        {
          "api": "firstThatWorks",
          "message": "style.firstThatWorks requires at least one value.",
          "name": "TypeError",
        },
        {
          "api": "keyframes",
          "message": "style.keyframes requires frames to be an object.",
          "name": "TypeError",
        },
      ]
    `);
  });

  it('snapshots Kovo-only missing input guards for style helpers', () => {
    type RuntimeApi = (...args: readonly unknown[]) => unknown;
    const calls = [
      ['createAtomicStyles', createAtomicStyles as RuntimeApi],
      ['raw', raw as RuntimeApi],
    ] as const;

    expect(
      calls.map(([api, call]) => {
        try {
          call();
          return { api, message: null, name: null };
        } catch (error) {
          return {
            api,
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
          };
        }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "api": "createAtomicStyles",
          "message": "style.createAtomicStyles requires styles to be an object.",
          "name": "TypeError",
        },
        {
          "api": "raw",
          "message": "style.raw requires style to be an object.",
          "name": "TypeError",
        },
      ]
    `);
  });

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

  it('matches upstream props resolution with just pseudoclasses', () => {
    // Ported from StyleX "with just pseudoclasses".
    expect(
      props(
        { ':hover__backgroundColor': 'rse6dlih', $$css: true },
        { ':hover__color': 'gofk2cf1', $$css: true },
      ).className,
    ).toBe('rse6dlih gofk2cf1');
  });

  it('matches upstream props resolution for a complicated nested argument set', () => {
    // Ported from StyleX "with complicated set of arguments".
    const styles = [
      {
        backgroundColor: 'nu7423ey',
        borderColor: 'tpe1esc0',
        borderStyle: 'gewhe1h2',
        borderWidth: 'gcovof34',
        boxSizing: 'bdao358l',
        display: 'rse6dlih',
        listStyle: 's5oniofx',
        marginTop: 'm8h3af8h',
        marginEnd: 'l7ghb35v',
        marginBottom: 'kjdc1dyq',
        marginStart: 'kmwttqpk',
        paddingTop: 'srn514ro',
        paddingEnd: 'oxkhqvkx',
        paddingBottom: 'rl78xhln',
        paddingStart: 'nch0832m',
        WebkitTapHighlightColor: 'qi72231t',
        textAlign: 'cr00lzj9',
        textDecoration: 'rn8ck1ys',
        whiteSpace: 'n3t5jt4f',
        wordWrap: 'gh25dzvf',
        zIndex: 'g4tp4svg',
        $$css: true,
      },
      false,
      false,
      false,
      false,
      [
        {
          cursor: 'fsf7x5fv',
          touchAction: 's3jn8y49',
          $$css: true,
        },
        false,
        {
          outline: 'icdlwmnq',
          $$css: true,
        },
        [
          {
            WebkitTapHighlightColor: 'oajrlxb2',
            cursor: 'nhd2j8a9',
            touchAction: 'f1sip0of',
            $$css: true,
          },
          false,
          false,
          {
            textDecoration: 'esuyzwwr',
            ':hover__textDecoration': 'p8dawk7l',
            $$css: true,
          },
          false,
          [
            {
              backgroundColor: 'g5ia77u1',
              border: 'e4t7hp5w',
              color: 'gmql0nx0',
              cursor: 'nhd2j8a9',
              display: 'q9uorilb',
              fontFamily: 'ihxqhq3m',
              fontSize: 'l94mrbxd',
              lineHeight: 'aenfhxwr',
              marginTop: 'kvgmc6g5',
              marginEnd: 'cxmmr5t8',
              marginBottom: 'oygrvhab',
              marginStart: 'hcukyx3x',
              paddingTop: 'jb3vyjys',
              paddingEnd: 'rz4wbd8a',
              paddingBottom: 'qt6c0cv9',
              paddingStart: 'a8nywdso',
              textAlign: 'i1ao9s8h',
              textDecoration: 'myohyog2',
              ':hover__color': 'ksdfmwjs',
              ':hover__textDecoration': 'gofk2cf1',
              ':active__transform': 'lsqurvkf',
              ':active__transition': 'bj9fd4vl',
              $$css: true,
            },
            {
              display: 'a8c37x1j',
              width: 'k4urcfbm',
              $$css: true,
            },
            [
              {
                ':active__transform': 'tm8avpzi',
                $$css: true,
              },
            ],
          ],
        ],
      ],
    ] as const;

    const value = props(styles).className ?? '';
    const repeat = props(styles).className ?? '';

    expect(value).toBe(repeat);
    expect(value.split(' ').sort().join(' ')).toBe(
      'g5ia77u1 tpe1esc0 gewhe1h2 gcovof34 bdao358l a8c37x1j s5oniofx kvgmc6g5 cxmmr5t8 oygrvhab hcukyx3x jb3vyjys rz4wbd8a qt6c0cv9 a8nywdso oajrlxb2 i1ao9s8h myohyog2 n3t5jt4f gh25dzvf g4tp4svg nhd2j8a9 f1sip0of icdlwmnq e4t7hp5w gmql0nx0 ihxqhq3m l94mrbxd aenfhxwr k4urcfbm gofk2cf1 ksdfmwjs tm8avpzi bj9fd4vl'
        .split(' ')
        .sort()
        .join(' '),
    );
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

  it('matches upstream attrs basic resolution', () => {
    // Ported from StyleX attrs "basic resolve".
    expect(attrs({ a: 'aaa', b: 'bbb', $$css: true }).class).toBe('aaa bbb');
  });

  it('ports upstream dynamic props fixture through Kovo raw inline style', () => {
    // Upstream accepts a bare inline object; Kovo requires the explicit `raw(...)` escape hatch.
    expect(
      props([
        { backgroundColor: 'backgroundColor-red', $$css: 'components/Foo.react.js:1' },
        raw({ color: 'red' }),
      ]),
    ).toEqual({
      className: 'backgroundColor-red',
      'data-style-src': 'components/Foo.react.js:1',
      style: {
        color: 'red',
      },
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
