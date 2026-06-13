import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';
import { viewTransitionLowering } from './lower/view-transitions.js';
import { parseComponentModule } from './scan/parse.js';

describe('view transition lowering', () => {
  it('exposes view transition lowering as parsed source patches', () => {
    const source = `
export const ProductCard = component('product-card', {
  render: () => <img alt="Product" style='opacity: .8;' viewTransitionName="product-p1-image" src="/p1.png" />,
});
`;
    const lowering = viewTransitionLowering(parseComponentModule('product-card.tsx', source));
    const viewTransitionStart = source.indexOf(' viewTransitionName=');
    const viewTransitionEnd = source.indexOf(' src="/p1.png"', viewTransitionStart);
    const styleStart = source.indexOf("style='opacity: .8;'");

    expect(lowering.stamps).toEqual([{ name: 'product-p1-image' }]);
    expect(lowering.replacements).toEqual([
      {
        end: viewTransitionEnd,
        replacement: '',
        start: viewTransitionStart,
      },
      {
        end: styleStart + "style='opacity: .8;'".length,
        replacement: 'style="opacity: .8; view-transition-name: product-p1-image"',
        start: styleStart,
      },
    ]);
  });

  it('stamps cross-document view transition names as real CSS', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(result.files[0]?.source).toContain(
      '<img src="/p1.png" style="view-transition-name: product-p1-image" fw-c="product-card" />',
    );
    expect(result.files[2]?.source).toContain("'product-p1-image': unknown;");
  });

  it('merges cross-document view transition stamps into existing static styles', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img style="opacity: .8" viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(serverSource).toContain(
      '<img style="opacity: .8; view-transition-name: product-p1-image" src="/p1.png" fw-c="product-card" />',
    );
    expect(serverSource.match(/\sstyle=/g)).toHaveLength(1);
    expect(serverSource).not.toContain('viewTransitionName=');
  });

  it('merges view transition styles from parsed style attribute spans', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img alt="Product" style='opacity: .8;' viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain(
      '<img alt="Product" style="opacity: .8; view-transition-name: product-p1-image" src="/p1.png" fw-c="product-card" />',
    );
    expect(serverSource).not.toContain('viewTransitionName=');
  });

  it('ignores view transition attribute text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => {
    const sample = '<img viewTransitionName="not-real" />';
    // <img viewTransitionName="also-not-real" />
    return <img viewTransitionName="product-p1-image" src="/p1.png" />;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    expect(serverSource).toContain('const sample = \'<img viewTransitionName="not-real" />\'');
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(serverSource).toContain(
      '<img src="/p1.png" style="view-transition-name: product-p1-image" fw-c="product-card" />',
    );
    expect(serverSource).not.toContain('viewTransitionName="product-p1-image"');
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});
