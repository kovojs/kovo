/** @jsxImportSource @kovojs/server */
import type { ClientHrefs } from './chrome.js';

// Landing page (SPEC §7 L0): the "break it" pipeline is radio buttons + :has(),
// zero JavaScript. The page is authored as TSX route composition so the route
// compiler can derive enhanced-navigation page boundaries.

const BRAND = 'Kovo';
const BRAND_CAPS = BRAND.toUpperCase();
const BRAND_CLI = BRAND.toLowerCase();

const NAV = [
  { href: '/docs/installation/', label: 'Docs' },
  { href: '/tutorial/', label: 'Tutorial' },
  { href: '/guides/', label: 'Guides' },
  { href: '/api/', label: 'API' },
  { href: '/spec/', label: 'Spec' },
];

export interface LandingPageProps {
  clients: ClientHrefs;
  loaderGzipBytes: number;
}

export function LandingRoutePage({ clients, loaderGzipBytes }: LandingPageProps): string {
  return (
    <div class="landing">
      <LandingHeader clients={clients} />
      <div class="wrap">
        <Hero clients={clients} />
        <BreakIt />
        <Split />
        <LedgerStrip loaderGzipBytes={loaderGzipBytes} />
        <LandingFooter />
      </div>
    </div>
  );
}

function LandingHeader({ clients }: { clients: ClientHrefs }): string {
  return (
    <header>
      <div class="bar">
        <a href="/" class="logo">
          <span class="mark">&#9670;</span> {BRAND_CAPS}
        </a>
        <nav>
          {NAV.map((item) => (
            <a href={item.href}>{item.label}</a>
          ))}
        </nav>
        <span class="right">
          <button type="button" on:click={`${clients.search}#open`}>
            &#8984;K
          </button>
          <a href="https://github.com/kovojs/kovo" rel="external">
            GitHub
          </a>
        </span>
      </div>
    </header>
  );
}

function Hero({ clients }: { clients: ClientHrefs }): string {
  return (
    <section class="hero">
      <div>
        <h1 class="stencil">
          {BRAND_CAPS}
          <span class="cursor">&#9646;</span>
        </h1>
        <p class="tagline">
          The web framework that <em>hands your agent the fix</em>{' '}
          <span class="dd">-- database to DOM.</span>
        </p>
        <p class="sub">
          {BRAND} is built from the ground up so AI coding agents get a precise error and know{' '}
          <b>exactly what to fix</b>. And it's delightful for your users: pages are real HTML,{' '}
          <b>interactive at first paint</b>.
        </p>
        <span class="nojs">&#10003; No JS required on load</span>
        <div class="try">
          <div class="cmd">
            <span>
              <span class="dollar">$</span> <code>pnpm create {BRAND_CLI} my-app</code>
            </span>
            <button type="button" class="code-copy" on:click={`${clients.code}#copy`}>
              copy
            </button>
          </div>
          <a class="go" href="/tutorial/">
            Start the tutorial
          </a>
        </div>
      </div>
      <div class="term">
        <div class="term-head">
          <span>one rename, every layer caught</span>
          <span>{BRAND_CLI} check</span>
        </div>
        <pre>
          <span class="t-dim">$ git diff db/schema.ts</span>
          {'\n'}
          <span class="t-del">-  price: integer('price'),</span>
          {'\n'}
          <span class="t-add">+  priceCents: integer('price_cents'),</span>
          {'\n\n'}
          <span class="t-dim">$ {BRAND_CLI} check</span>
          {'\n\n'}
          <span class="t-err">&#10007;</span>{' '}
          <span class="t-loc">server/queries/product.ts:14</span>{' '}
          <span class="badge b-query">QUERY</span>
          {'\n  '}projection reads dropped column <b>price</b>
          {'\n  '}
          <span class="t-fix">-&gt; select priceCents, or alias: price: products.priceCents</span>
          {'\n\n'}
          <span class="t-err">&#10007;</span>{' '}
          <span class="t-loc">src/product-card.tsx:13</span>{' '}
          <span class="badge b-bind">BINDING</span>
          {'\n  '}data-bind <b>"product.price"</b> has no source in the query
          {'\n  '}
          <span class="t-fix">-&gt; bind product.priceCents -- format in a derive</span>
          {'\n\n'}
          <span class="t-err">&#10007;</span>{' '}
          <span class="t-loc">src/cart/checkout.tsx:31</span>{' '}
          <span class="badge b-form">FORM</span>
          {'\n  '}field <b>price</b> is not in the cart/add mutation schema
          {'\n\n'}
          <span class="t-err">&#10007;</span>{' '}
          <span class="t-loc">src/routes/sale.ts:8</span>{' '}
          <span class="badge b-route">ROUTE</span>
          {'\n  '}redirect builds <b>/sale?max=price</b> against a dropped param
          {'\n\n'}
          <div class="cascade-sum">
            <span>
              <b>4 errors</b> &middot; 4 files &middot; each with its fix
            </span>
            <span class="t-ok">0 guesses</span>
          </div>
        </pre>
      </div>
    </section>
  );
}

function BreakIt(): string {
  return (
    <section class="breakit">
      <p class="sec-label">How it works</p>
      <h2 class="pipe-title">Build-time checks from backend to frontend</h2>
      <p class="pipe-sub">
        Every layer below is checked against the next at build time. Don't take our word for it --
        break something:
      </p>

      <input type="radio" name="brk" id="brk-col" checked />
      <input type="radio" name="brk" id="brk-query" />
      <input type="radio" name="brk" id="brk-bind" />

      <div class="choices">
        <label for="brk-col">
          <b>01</b> rename the column
        </label>
        <label for="brk-query">
          <b>02</b> reshape the query
        </label>
        <label for="brk-bind">
          <b>03</b> typo the binding
        </label>
      </div>

      <div class="pipe">
        <div class="node node-1">
          <p class="nl">Database</p>
          <pre>
            products = <span class="fn">table</span>({'{'}
            {'\n  '}details: <span class="hl">nullable</span>(json),
            {'\n  '}price: <span class="fn">integer</span>()
            {'\n'}
            {'}'})
          </pre>
        </div>
        <div class="link link-1">
          <span class="chk chk-ok">&#10003; typed</span>
          <span class="chk chk-bad">&#10007; KV402</span>
          <span class="wire"></span>
        </div>
        <div class="node node-2">
          <p class="nl">Server query</p>
          <pre>
            <span class="fn">query</span>(<span class="st">'product'</span>, {'{'}
            {'\n  '}reads: [product],
            {'\n  '}load: ... <span class="hl">-&gt; shape</span>
            {'\n'}
            {'}'})
          </pre>
        </div>
        <div class="link link-2">
          <span class="chk chk-ok">&#10003; typed</span>
          <span class="chk chk-bad">&#10007; KV223</span>
          <span class="wire"></span>
        </div>
        <div class="node node-3">
          <p class="nl">Client data</p>
          <pre>
            &lt;script kovo-query=<span class="st">"product"</span>&gt;
            {'\n'}
            {'{"price": '}
            <span class="hl">1299</span>
            {'}'}
          </pre>
        </div>
        <div class="link link-3">
          <span class="chk chk-ok">&#10003; typed</span>
          <span class="chk chk-bad">&#10007; KV227</span>
          <span class="wire"></span>
        </div>
        <div class="node node-4">
          <p class="nl">Rendered UI</p>
          <pre>
            &lt;h2 data-bind=
            {'\n  '}
            <span class="st">"product.price"</span>&gt;
          </pre>
        </div>
      </div>

      <div class="caught">
        <CaughtCase
          className="case case-col term"
          head={`${BRAND_CLI} check -- caught at the database -> query junction`}
          code="KV402"
          title="query 'product' reads a column that no longer exists"
          location="server/queries/product.ts:14 -- select(products."
          field="price"
          fix="-> the column is now priceCents -- select it, or alias: price: products.priceCents"
          note="every query is compiled against the live schema, so a rename can't reach production"
        />
        <CaughtCase
          className="case case-query term"
          head={`${BRAND_CLI} check -- caught at the query -> client junction`}
          code="KV223"
          title="the page depends on data the query no longer ships"
          location='src/product-card.tsx:13 -- data-bind="product.'
          field="price"
          fix="-> the projection now ships priceCents -- update the binding, or restore the field"
          note="bindings are typed against the query's emitted shape, not against hope"
        />
        <CaughtCase
          className="case case-bind term"
          head={`${BRAND_CLI} check -- caught at the client -> UI junction`}
          code="KV227"
          title="binding path 'product.pricee' does not exist"
          location='src/product-card.tsx:13 -- data-bind="product.'
          field="pricee"
          fix="-> did you mean product.price?"
          note="the DOM is part of the type system: a typo in an attribute is a build error"
        />
      </div>
      <p class="breakit-foot">
        <span>
          this demo is plain HTML and CSS -- radio buttons and :has(). <b>that's the point.</b>
        </span>
        <span>L0 on the interaction ladder</span>
      </p>
    </section>
  );
}

function CaughtCase({
  className,
  code,
  field,
  fix,
  head,
  location,
  note,
  title,
}: {
  className: string;
  code: string;
  field: string;
  fix: string;
  head: string;
  location: string;
  note: string;
  title: string;
}): string {
  return (
    <div class={className}>
      <div class="term-head">
        <span>{head}</span>
      </div>
      <pre>
        <span class="t-err">&#10007; {code}</span> -- <b>{title}</b>
        {'\n\n  '}
        {location}
        <span class="sq">{field}</span>
        {field === 'price' ? ')' : '"'}
        {'\n  '}
        <span class="t-fix">{fix}</span>
        {'\n  '}
        <span class="t-dim">{note}</span>
      </pre>
    </div>
  );
}

function Split(): string {
  return (
    <section class="split">
      <div class="half agents">
        <p class="hl-label">For agents</p>
        <h3>Errors worth reading</h3>
        <p class="lead">
          Every diagnostic teaches: the line, the reason, the fixes -- so the loop is{' '}
          <b>edit -&gt; check -&gt; fixed</b>, not edit -&gt; deploy -&gt; bug report. The
          behavior graph is queryable too:{' '}
          <code>{BRAND_CLI} explain mutation cart/add</code> answers "what refreshes?" with diffable
          output for CI.
        </p>
        <div class="term">
          <div class="term-head">$ {BRAND_CLI} check</div>
          <pre>
            <span class="t-dim">13 &#9474;</span> render: () =&gt; &lt;h2&gt;{'{'}product.
            <span class="sq">details.name</span>
            {'}'}&lt;/h2&gt;
            {'\n\n'}
            <span class="t-err">&#10007; KV227</span> --{' '}
            <b>product.details can be null here</b>
            {'\n  '}
            <span class="t-fix">fix 1</span> {'{'}product.details
            <span class="t-ok">?.</span>name{'}'}
            {'\n  '}
            <span class="t-fix">fix 2</span> make the projection non-null in the query
            {'\n\n'}
            <span class="t-ok">&#10003; caught in 0.4s -- before anything ran</span>
          </pre>
        </div>
      </div>

      <div class="half users">
        <p class="hl-label">For users</p>
        <h3>No uncanny valley</h3>
        <p class="lead">
          No hydration means no window where the page <b>looks ready but isn't</b>. A button works
          the moment it paints.
        </p>
        <div class="timelines">
          <div class="tl">
            <p class="who">
              <span>Typical SPA</span>
              <span class="bad">interactive at 3.2s</span>
            </p>
            <div class="track track-spa">
              <span class="seg s1"></span>
              <span class="seg s2"></span>
              <span class="seg s3"></span>
            </div>
            <p class="marks">
              <span>0ms paint</span>
              <span class="warn">&#9888; looks ready, ignores clicks</span>
              <span>3.2s</span>
            </p>
          </div>
          <div class="tl">
            <p class="who">
              <span>{BRAND}</span>
              <span class="good">interactive at first paint</span>
            </p>
            <div class="track track-mpa">
              <span class="seg s1"></span>
              <span class="seg s3"></span>
            </div>
            <p class="marks">
              <span>0ms paint</span>
              <span class="ok">&#10003; every click works -- tiny loader, handlers on demand</span>
            </p>
          </div>
        </div>
        <p class="users-note">
          With JavaScript off, every page still renders and every form still posts.{' '}
          <b>This site runs on {BRAND} -- try it.</b>
        </p>
      </div>
    </section>
  );
}

function LedgerStrip({ loaderGzipBytes }: { loaderGzipBytes: number }): string {
  return (
    <p class="ledger-strip">
      <span>
        <span class="g">&#9679;</span> all build gates green
      </span>
      <span class="sep">&#9474;</span>
      <span>
        loader <b>{loaderGzipBytes.toLocaleString('en-US')} B</b> gzip -- measured this build
      </span>
      <span class="sep">&#9474;</span>
      <span>TTI = first paint</span>
      <span class="sep">&#9474;</span>
      <span>JS-off: every page</span>
      <span class="sep">&#9474;</span>
      <span>fixpoint compile</span>
      <a class="more" href="/guides/testing/">
        see how it's verified -&gt;
      </a>
    </p>
  );
}

function LandingFooter(): string {
  return (
    <footer class="l-footer">
      <span>{BRAND} -- interactive at first paint &middot; legible at every layer &middot; statically verifiable</span>
      <span class="links">
        <a href="/spec/">Spec</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="https://github.com/kovojs/kovo" rel="external">
          GitHub
        </a>
      </span>
    </footer>
  );
}
