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
    expect(result['data-style-src']).toBe('button.tsx#root button.override.tsx#root');
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
