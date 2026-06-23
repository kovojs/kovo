/** @jsxImportSource @kovojs/server */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createApp, respond, route, stylesheet } from '@kovojs/server';

import catalogJson from '../../shared/catalog.json' assert { type: 'json' };

type Product = (typeof catalogJson)[number];

const catalog = catalogJson as Product[];
const imageDir = path.join(process.cwd(), '../shared/images');

const benchmarkStylesheets = [stylesheet('../../shared/styles.css')] as const;

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function productForSlug(slug: string | undefined): Product {
  return catalog.find((product) => product.slug === slug) ?? catalog[0]!;
}

function CartControls({ product }: { product?: Product } = {}): string {
  return (
    <span data-cart-root="kovo">
      <button
        class="cart-button"
        type="button"
        aria-label="Open cart with 0 items"
        popovertarget="cart-dialog"
      >
        Cart (0)
      </button>
      {product ? (
        <button class="primary-button" type="button" popovertarget="cart-dialog">
          Add to cart
        </button>
      ) : (
        ''
      )}
    </span>
  );
}

function CartDialog(): string {
  return (
    <div id="cart-dialog" class="cart-dialog" role="dialog" aria-labelledby="cart-title" popover="">
      <header>
        <div>
          <h2 id="cart-title">Review cart</h2>
          <p>Client-only cart state is represented by the benchmark dialog probe.</p>
        </div>
        <button
          class="secondary-button"
          type="button"
          popovertarget="cart-dialog"
          popovertargetaction="hide"
        >
          Close
        </button>
      </header>
      <div class="cart-lines">Selected item ready for checkout.</div>
      <div class="cart-total">
        <span>Total</span>
        <strong>$0.00</strong>
      </div>
      <form class="checkout">
        <label>
          Name
          <input name="name" autocomplete="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" />
        </label>
        <button class="primary-button" type="button">
          Place order
        </button>
      </form>
      <p class="confirmation" role="status">
        Order placed. Confirmation sent to the checkout email.
      </p>
    </div>
  );
}

function Nav(): string {
  return (
    <nav class="nav">
      <a class="brand" href="/">
        Kovo Supply
      </a>
      <CartControls />
    </nav>
  );
}

function ProductCard({ product }: { product: Product }): string {
  return (
    <article class="card">
      <a href={`/product/${product.slug}`} aria-label={`View ${product.name}`}>
        <img src={product.img} width="640" height="480" loading="lazy" alt="" />
      </a>
      <h2>{product.name}</h2>
      <p>{product.blurb}</p>
      <span class="price">{formatPrice(product.price)}</span>
      <div class="card-actions">
        <a class="secondary-button" href={`/product/${product.slug}`}>
          Details
        </a>
        <CartControls product={product} />
      </div>
    </article>
  );
}

function ListingPage(): string {
  return (
    <main>
      <section class="hero">
        <h1>Field goods for everyday carry</h1>
        <p>
          A 24-product commerce benchmark rendered with Kovo server documents and lazy client
          handlers.
        </p>
      </section>
      <section class="grid" aria-label="Products">
        {catalog.map((product) => (
          <ProductCard product={product} key={product.id} />
        ))}
      </section>
    </main>
  );
}

function ProductPage({ product }: { product: Product }): string {
  return (
    <main class="detail">
      <div class="detail-media">
        <img src={product.img} width="640" height="480" loading="eager" alt="" />
      </div>
      <section class="detail-copy">
        <a href="/">Back to listing</a>
        <h1>{product.name}</h1>
        <p>{product.blurb}</p>
        <span class="price">{formatPrice(product.price)}</span>
        <label class="qty-row">
          Qty
          <input type="number" min="1" value="1" />
        </label>
        <div class="detail-actions">
          <CartControls product={product} />
          <CartControls />
        </div>
      </section>
    </main>
  );
}

function Shell({ children }: { children: unknown }): string {
  return (
    <div class="shell">
      <Nav />
      {children}
      <CartDialog />
    </div>
  );
}

const homeRoute = route('/', {
  meta: { title: 'Kovo Supply Benchmark' },
  page: () => <Shell>{<ListingPage />}</Shell>,
  stylesheets: benchmarkStylesheets,
});

const productRoute = route('/product/:slug', {
  meta: { title: 'Kovo Supply Product' },
  page: (context) => <Shell>{<ProductPage product={productForSlug(context.params.slug)} />}</Shell>,
  stylesheets: benchmarkStylesheets,
});

const imageRoute = route('/images/:name', {
  page: (context) => {
    const name = String(context.params.name ?? '');
    if (!/^product-\d\d\.webp$/.test(name)) {
      return respond.file('not found', { contentType: 'text/plain; charset=utf-8' });
    }
    return respond.file(readFileSync(path.join(imageDir, name)), {
      contentType: 'image/webp',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  },
});

export default createApp({
  document: { lang: 'en-US' },
  renderRoute(value) {
    return typeof value === 'string' ? value : String(value ?? '');
  },
  routes: [homeRoute, productRoute, imageRoute],
});
