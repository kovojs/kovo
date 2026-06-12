import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';
import { navigationHrefLowering, navigationLinkLowering } from './lower/navigation.js';
import { parseComponentModule } from './scan/parse.js';

describe('navigation lowering', () => {
  it('exposes static Link lowering as explicit source patches', () => {
    const source = `
export const ProductLinks = component('product-links', {
  render: () => <Link to="/products/:id" params={{ id: 'p 1' }}>Product</Link>,
});
`;
    const lowering = navigationLinkLowering(
      source,
      parseComponentModule('product-links.tsx', source),
    );

    expect(lowering.replacements).toEqual([
      {
        end: source.indexOf('</Link>') + '</Link>'.length,
        replacement: '<a href="/products/p%201">Product</a>',
        start: source.indexOf('<Link'),
      },
    ]);
  });

  it('exposes static href lowering as explicit source patches', () => {
    const source = `
export const ProductLinks = component('product-links', {
  render: () => <a href={href('/products/:id', { params: { id: 'p1' } })}>Product</a>,
});
`;
    const hrefStart = source.indexOf('href={href(');
    const hrefEnd = source.indexOf(')}>Product') + ')}'.length;
    const lowering = navigationHrefLowering(parseComponentModule('product-links.tsx', source));

    expect(lowering.replacements).toEqual([
      {
        end: hrefEnd,
        replacement: 'href="/products/p1"',
        start: hrefStart,
      },
    ]);
  });

  it('accepts literal navigation targets that match declared routes', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/products/p1?max=500">Product</a>
      <form method="get" action="/cart"></form>
      <a href="https://example.com/products/p1">External</a>
      <a href="#details">Skip link</a>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('lowers static Link navigation sugar to plain anchors', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <Link className="product-link" to="/products/:id" params={{ id: 'p 1' }} search={{ max: 500, sort: 'price' }}>
        Product
      </Link>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain(
      '<a className="product-link" href="/products/p%201?max=500&amp;sort=price">',
    );
    expect(result.files[0]?.source).not.toContain('<Link');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('ignores Link navigation sugar text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = '<Link to="/missing">Missing</Link>';
    // <Link to="/also-missing">Missing</Link>
    return <Link to="/products/:id" params={{ id: 'p 1' }}>Product</Link>;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toContain('const sample = \'<Link to="/missing">Missing</Link>\'');
    // SPEC.md section 4.2: the lowered native <a> host also receives the derived fw-c stamp.
    expect(serverSource).toContain('<a href="/products/p%201" fw-c="product-links">Product</a>');
    expect(serverSource).not.toContain('<Link to="/products/:id"');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers static href calls to literal anchor hrefs before FW220 validation', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href={href('/products/:id', { params: { id: 'p1' }, search: { max: 500, sort: 'price' } })}>
        Product
      </a>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain('href="/products/p1?max=500&amp;sort=price"');
    expect(result.files[0]?.source).not.toContain("href('/products/:id'");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('ignores static href call text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = "href('/products/:id', { params: { id: 'p1' } })";
    // href('/products/:id', { params: { id: 'p2' } })
    return <a href={href('/products/:id', { params: { id: 'p3' } })}>Product</a>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain(
      "const sample = \"href('/products/:id', { params: { id: 'p1' } })\"",
    );
    expect(result.files[0]?.source).toContain('href="/products/p3"');
    expect(result.files[0]?.source).not.toContain(
      "href('/products/:id', { params: { id: 'p3' } })",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports FW220 for literal navigation targets outside the route table', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/product/p1">Product</a>
      <form method="get" action="/checkout"></form>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW220',
        fileName: 'product-links.tsx',
        message: 'Literal href or form action matches no declared route. /product/p1',
        severity: 'error',
        start: { column: 10, line: 5 },
        length: 18,
      },
      {
        code: 'FW220',
        fileName: 'product-links.tsx',
        message: 'Literal href or form action matches no declared route. /checkout',
        severity: 'error',
        start: { column: 26, line: 6 },
        length: 18,
      },
    ]);
  });

  it('ignores literal navigation target text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = '<a href="/missing">Missing</a><form action="/checkout"></form>';
    // <a href="/also-missing">Missing</a>
    return <a href="/products/p1">Product</a>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores expression href attribute text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = 'href={"/missing"}';
    // href={"/also-missing"}
    return <a href={"/products/p1"}>Product</a>;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toContain('const sample = \'href={"/missing"}\'');
    expect(serverSource).toContain('href="/products/p1"');
    expect(serverSource).not.toContain('href={"/products/p1"}');
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});
