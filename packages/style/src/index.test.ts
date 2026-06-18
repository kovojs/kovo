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
    expect(compiled.css).toContain('@layer kovo-style.1000');
    expect(compiled.css).toContain('@layer kovo-style.2000');
    expect(compiled.css).toContain('@layer kovo-style.4000');
    expect(compiled.css).toContain('.kv-button-pad-');
    expect(compiled.css).toContain('.kv-button-bg-');
    expect(compiled.css).toContain(':hover');
    expect(compiled.css).toContain('@media (min-width: 40rem)');
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
    expect(css.indexOf('@layer kovo-style.1000')).toBeLessThan(
      css.indexOf('@layer kovo-style.2000'),
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
    expect(tokens.customColor('success').onColor).toBe(
      'var(--kovo-theme-custom-success-on-color)',
    );
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

  it('fails loudly for unsupported contrast generation instead of ignoring it', () => {
    expect(() => themeFromSeed('#6750A4', { contrast: 0.5 })).toThrow(
      'theme.themeFromSeed supports only contrast: 0 in this release.',
    );
  });
});

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
