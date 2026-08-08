/** @jsxImportSource @kovojs/server */
import { trustedUrl } from '@kovojs/browser';
import { defineKovo, stylesheet } from '@kovojs/server';
import { rootedFiles } from '@kovojs/server/files';

// Authoring notes for this benchmark entrant (SPEC §4.8, §5.2 rule 10, §6.6, §9.1):
//
//  * The catalog is authored as a module-scope literal instead of `import ... from
//    '../../shared/catalog.json'`. The Kovo build snapshots the source closure rooted at the entry
//    module's directory, so a `../../` edge is refused outright, and a JSON module edge is reported
//    as `<opaque-module-initializer:...>` (KV424). Imported array bindings also stay opaque to the
//    data-plane scanner, so `catalog.map(...)` only proves out when the array literal is local.
//    Rows are byte-equivalent to `benchmarks/shared/catalog.json` plus a precomputed `priceLabel`.
//  * `priceLabel` replaces a `price.toFixed(2)` call: `Number.prototype.toFixed` is an
//    app-authored opaque call on a request-reachable path. The rendered text is unchanged.
//  * Row property reads are destructured at the parameter, because reading `product.name` off a
//    non-destructured binding is `<property-getter:product>` (KV424). `href`/`viewLabel` are
//    precomputed for the same reason: interpolating a destructured binding into a template literal
//    is an app-authored `@@toPrimitive` protocol hook. The emitted attributes are unchanged.
//  * The image route uses the framework-owned `rootedFiles(...)` capability with a static literal
//    root instead of `node:fs` + `node:path` + `process.cwd()`, which are refused as raw
//    filesystem/process authority from untrusted-data-reachable code (KV448).
//  * `img[src]` is a computed attribute, so KV236 requires the exact
//    `trustedUrl(value, { reason })` escape from `@kovojs/browser`. The catalog paths are
//    same-origin literals served by the `/images/:name` route below.
//  * `defineKovo({ appId })` is mandatory: without the canonical UUIDv4 the compiler cannot prove
//    the app receiver and every `app.route(...)` call fails with D1A007.

const catalog = [
  {
    id: 'p01',
    slug: 'linen-field-jacket',
    href: '/product/linen-field-jacket',
    name: 'Linen Field Jacket',
    viewLabel: 'View Linen Field Jacket',
    price: 148,
    priceLabel: '$148.00',
    blurb:
      'A light utility layer with corozo buttons, roomy patch pockets, and a washed linen finish.',
    img: '/images/product-01.webp',
  },
  {
    id: 'p02',
    slug: 'canvas-weekender',
    href: '/product/canvas-weekender',
    name: 'Canvas Weekender',
    viewLabel: 'View Canvas Weekender',
    price: 186,
    priceLabel: '$186.00',
    blurb: 'A structured overnight bag with bridle leather handles and a wide-mouth zip opening.',
    img: '/images/product-02.webp',
  },
  {
    id: 'p03',
    slug: 'wool-trail-overshirt',
    href: '/product/wool-trail-overshirt',
    name: 'Wool Trail Overshirt',
    viewLabel: 'View Wool Trail Overshirt',
    price: 132,
    priceLabel: '$132.00',
    blurb: 'Soft merino blend overshirt cut for layering through cool morning commutes.',
    img: '/images/product-03.webp',
  },
  {
    id: 'p04',
    slug: 'alpine-ceramic-mug',
    href: '/product/alpine-ceramic-mug',
    name: 'Alpine Ceramic Mug',
    viewLabel: 'View Alpine Ceramic Mug',
    price: 32,
    priceLabel: '$32.00',
    blurb: 'Hand-glazed stoneware with a comfortable thumb rest and a satin exterior.',
    img: '/images/product-04.webp',
  },
  {
    id: 'p05',
    slug: 'waxed-cotton-cap',
    href: '/product/waxed-cotton-cap',
    name: 'Waxed Cotton Cap',
    viewLabel: 'View Waxed Cotton Cap',
    price: 44,
    priceLabel: '$44.00',
    blurb: 'Six-panel cap in water-shedding cotton with a low crown and brass adjuster.',
    img: '/images/product-05.webp',
  },
  {
    id: 'p06',
    slug: 'ribbed-camp-socks',
    href: '/product/ribbed-camp-socks',
    name: 'Ribbed Camp Socks',
    viewLabel: 'View Ribbed Camp Socks',
    price: 24,
    priceLabel: '$24.00',
    blurb: 'Dense cotton socks with reinforced heels and a cushioned ribbed footbed.',
    img: '/images/product-06.webp',
  },
  {
    id: 'p07',
    slug: 'market-tote',
    href: '/product/market-tote',
    name: 'Market Tote',
    viewLabel: 'View Market Tote',
    price: 58,
    priceLabel: '$58.00',
    blurb: 'A durable canvas tote with an interior pocket and vegetable-tanned leather straps.',
    img: '/images/product-07.webp',
  },
  {
    id: 'p08',
    slug: 'walnut-desk-tray',
    href: '/product/walnut-desk-tray',
    name: 'Walnut Desk Tray',
    viewLabel: 'View Walnut Desk Tray',
    price: 74,
    priceLabel: '$74.00',
    blurb: 'Solid walnut catch-all sized for keys, pens, and the daily pocket carry.',
    img: '/images/product-08.webp',
  },
  {
    id: 'p09',
    slug: 'selvedge-denim',
    href: '/product/selvedge-denim',
    name: 'Selvedge Denim',
    viewLabel: 'View Selvedge Denim',
    price: 168,
    priceLabel: '$168.00',
    blurb: 'Straight-leg denim with a comfortable rise, chain-stitched hems, and redline selvedge.',
    img: '/images/product-01.webp',
  },
  {
    id: 'p10',
    slug: 'brass-key-hook',
    href: '/product/brass-key-hook',
    name: 'Brass Key Hook',
    viewLabel: 'View Brass Key Hook',
    price: 38,
    priceLabel: '$38.00',
    blurb: 'Wall-mounted brass hook with a hand-brushed finish and hidden fasteners.',
    img: '/images/product-02.webp',
  },
  {
    id: 'p11',
    slug: 'paper-notebook-set',
    href: '/product/paper-notebook-set',
    name: 'Paper Notebook Set',
    viewLabel: 'View Paper Notebook Set',
    price: 28,
    priceLabel: '$28.00',
    blurb: 'Three lay-flat notebooks with dot-grid pages and recycled heavyweight covers.',
    img: '/images/product-03.webp',
  },
  {
    id: 'p12',
    slug: 'merino-watch-cap',
    href: '/product/merino-watch-cap',
    name: 'Merino Watch Cap',
    viewLabel: 'View Merino Watch Cap',
    price: 48,
    priceLabel: '$48.00',
    blurb: 'Rib-knit merino cap with a double cuff and a soft, itch-free hand.',
    img: '/images/product-04.webp',
  },
  {
    id: 'p13',
    slug: 'campfire-blanket',
    href: '/product/campfire-blanket',
    name: 'Campfire Blanket',
    viewLabel: 'View Campfire Blanket',
    price: 118,
    priceLabel: '$118.00',
    blurb: 'Dense recycled wool blanket sized for the sofa, porch, or weekend cabin.',
    img: '/images/product-05.webp',
  },
  {
    id: 'p14',
    slug: 'stainless-bottle',
    href: '/product/stainless-bottle',
    name: 'Stainless Bottle',
    viewLabel: 'View Stainless Bottle',
    price: 42,
    priceLabel: '$42.00',
    blurb: 'Double-wall bottle with a leakproof cap and a powder-coated exterior.',
    img: '/images/product-06.webp',
  },
  {
    id: 'p15',
    slug: 'cotton-rugby-shirt',
    href: '/product/cotton-rugby-shirt',
    name: 'Cotton Rugby Shirt',
    viewLabel: 'View Cotton Rugby Shirt',
    price: 96,
    priceLabel: '$96.00',
    blurb: 'Heavy jersey rugby shirt with a twill collar and reinforced placket.',
    img: '/images/product-07.webp',
  },
  {
    id: 'p16',
    slug: 'leather-card-case',
    href: '/product/leather-card-case',
    name: 'Leather Card Case',
    viewLabel: 'View Leather Card Case',
    price: 68,
    priceLabel: '$68.00',
    blurb: 'Compact card case in full-grain leather with four slots and a center pocket.',
    img: '/images/product-08.webp',
  },
  {
    id: 'p17',
    slug: 'hemp-apron',
    href: '/product/hemp-apron',
    name: 'Hemp Apron',
    viewLabel: 'View Hemp Apron',
    price: 84,
    priceLabel: '$84.00',
    blurb: 'Cross-back shop apron with oversized waist pockets and bar-tacked stress points.',
    img: '/images/product-01.webp',
  },
  {
    id: 'p18',
    slug: 'cedar-shoe-blocks',
    href: '/product/cedar-shoe-blocks',
    name: 'Cedar Shoe Blocks',
    viewLabel: 'View Cedar Shoe Blocks',
    price: 54,
    priceLabel: '$54.00',
    blurb: 'Aromatic cedar shoe blocks with brass knobs and adjustable split toes.',
    img: '/images/product-02.webp',
  },
  {
    id: 'p19',
    slug: 'canvas-chore-coat',
    href: '/product/canvas-chore-coat',
    name: 'Canvas Chore Coat',
    viewLabel: 'View Canvas Chore Coat',
    price: 154,
    priceLabel: '$154.00',
    blurb: 'Midweight cotton canvas chore coat with triple-needle seams and roomy pockets.',
    img: '/images/product-03.webp',
  },
  {
    id: 'p20',
    slug: 'enamel-pin-set',
    href: '/product/enamel-pin-set',
    name: 'Enamel Pin Set',
    viewLabel: 'View Enamel Pin Set',
    price: 18,
    priceLabel: '$18.00',
    blurb: 'Three hard-enamel pins inspired by trail markers, workshop tools, and city maps.',
    img: '/images/product-04.webp',
  },
  {
    id: 'p21',
    slug: 'recycled-fleece',
    href: '/product/recycled-fleece',
    name: 'Recycled Fleece',
    viewLabel: 'View Recycled Fleece',
    price: 112,
    priceLabel: '$112.00',
    blurb: 'Deep-pile recycled fleece pullover with nylon trim and a generous kangaroo pocket.',
    img: '/images/product-05.webp',
  },
  {
    id: 'p22',
    slug: 'beech-coffee-scoop',
    href: '/product/beech-coffee-scoop',
    name: 'Beech Coffee Scoop',
    viewLabel: 'View Beech Coffee Scoop',
    price: 22,
    priceLabel: '$22.00',
    blurb: 'Turned beech scoop with a long handle and a natural oil finish.',
    img: '/images/product-06.webp',
  },
  {
    id: 'p23',
    slug: 'ripstop-packable-shell',
    href: '/product/ripstop-packable-shell',
    name: 'Ripstop Packable Shell',
    viewLabel: 'View Ripstop Packable Shell',
    price: 128,
    priceLabel: '$128.00',
    blurb: 'Wind shell that packs into its own pocket and handles surprise weather.',
    img: '/images/product-07.webp',
  },
  {
    id: 'p24',
    slug: 'maple-cutting-board',
    href: '/product/maple-cutting-board',
    name: 'Maple Cutting Board',
    viewLabel: 'View Maple Cutting Board',
    price: 92,
    priceLabel: '$92.00',
    blurb: 'End-grain maple board with juice grooves and rubber feet for steady prep.',
    img: '/images/product-08.webp',
  },
] as const;

type Product = (typeof catalog)[number];

const benchmarkStylesheets = [stylesheet('./styles.css')] as const;

// Rooted at the same directory the previous `path.join(process.cwd(), '../shared/images')` resolved
// to when the harness starts the server with cwd = benchmarks/kovo.
const imageFiles = await rootedFiles('../shared/images');

const app = defineKovo({
  appId: '38652956-30bb-4fbb-b8a7-585f4734b6b1',
  document: { lang: 'en-US' },
  renderRoute(value) {
    return typeof value === 'string' ? value : String(value ?? '');
  },
});

function productForSlug(slug: string | undefined): Product {
  for (const candidate of catalog) {
    if (candidate.slug === slug) return candidate;
  }
  return catalog[0];
}

function CartControls({ addToCart = false }: { addToCart?: boolean } = {}): string {
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
      {addToCart ? (
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

function ProductCard({
  blurb,
  href,
  img,
  name,
  priceLabel,
  viewLabel,
}: {
  blurb: string;
  href: string;
  img: string;
  name: string;
  priceLabel: string;
  viewLabel: string;
}): string {
  return (
    <article class="card">
      <a href={href} aria-label={viewLabel}>
        <img
          src={trustedUrl(img, { reason: 'same-origin benchmark catalog image path' })}
          width="640"
          height="480"
          loading="lazy"
          alt=""
        />
      </a>
      <h2>{name}</h2>
      <p>{blurb}</p>
      <span class="price">{priceLabel}</span>
      <div class="card-actions">
        <a class="secondary-button" href={href}>
          Details
        </a>
        <CartControls addToCart={true} />
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
        {catalog.map(({ blurb, href, img, name, priceLabel, viewLabel }) => (
          <ProductCard
            blurb={blurb}
            href={href}
            img={img}
            name={name}
            priceLabel={priceLabel}
            viewLabel={viewLabel}
          />
        ))}
      </section>
    </main>
  );
}

function ProductPage({
  blurb,
  img,
  name,
  priceLabel,
}: {
  blurb: string;
  img: string;
  name: string;
  priceLabel: string;
}): string {
  return (
    <main class="detail">
      <div class="detail-media">
        <img
          src={trustedUrl(img, { reason: 'same-origin benchmark catalog image path' })}
          width="640"
          height="480"
          loading="eager"
          alt=""
        />
      </div>
      <section class="detail-copy">
        <a href="/">Back to listing</a>
        <h1>{name}</h1>
        <p>{blurb}</p>
        <span class="price">{priceLabel}</span>
        <label class="qty-row">
          Qty
          <input type="number" min="1" value="1" />
        </label>
        <div class="detail-actions">
          <CartControls addToCart={true} />
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

const homeRoute = app.route('/', {
  access: app.publicAccess('public benchmark catalog'),
  meta: { title: 'Kovo Supply Benchmark' },
  page: () => <Shell>{<ListingPage />}</Shell>,
  stylesheets: benchmarkStylesheets,
});

const productRoute = app.route('/product/:slug', {
  access: app.publicAccess('public benchmark product details'),
  meta: { title: 'Kovo Supply Product' },
  page: (context) => {
    const { blurb, img, name, priceLabel } = productForSlug(context.params.slug);
    return (
      <Shell>{<ProductPage blurb={blurb} img={img} name={name} priceLabel={priceLabel} />}</Shell>
    );
  },
  stylesheets: benchmarkStylesheets,
});

const imageRoute = app.route('/images/:name', {
  access: app.publicAccess('public immutable benchmark images'),
  page: (context) =>
    imageFiles.serve(String(context.params.name ?? ''), {
      contentType: 'image/webp',
      disposition: 'inline',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    }),
});

export default app.assemble({
  routes: [homeRoute, productRoute, imageRoute],
});
