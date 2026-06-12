/**
 * Landing page (plan W4, redesigned): terminal-ledger composition — wordmark
 * hero with the rename-cascade panel, the radio-driven "break it" pipeline
 * (SPEC §7 L0: zero JavaScript), the agents/users split, and the ledger strip.
 *
 * Honesty note: the loader byte count comes from the W3 capture (measured
 * from the shipping artifact every build). The cascade, FW402/FW223 panels,
 * and the `BRAND_CLI check` framing are *designed illustrations* of the
 * intended DX — FW227 is a real diagnostic today (SPEC §4.8); the cascade
 * codes and code-frame presentation are aspirational and not claimed as
 * live captures anywhere in the copy.
 *
 * The landing brands the framework as BRAND (display-only rename for now);
 * packages, docs, and the spec keep the repo name until the rename lands.
 */

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

function landingHeader() {
  return `<header>
    <div class="bar">
      <a href="/" class="logo"><span class="mark">&#9670;</span> ${BRAND_CAPS}</a>
      <nav>${NAV.map((item) => `<a href="${item.href}">${item.label}</a>`).join('')}</nav>
      <span class="right">
        <button type="button" on:click="/c/search.js#open">&#8984;K</button>
        <a href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
      </span>
    </div>
  </header>`;
}

function hero() {
  return `<section class="hero">
    <div>
      <h1 class="stencil">${BRAND_CAPS}<span class="cursor">&#9646;</span></h1>
      <p class="tagline">The web framework that <em>hands your agent the fix</em> <span class="dd">&mdash; database to DOM.</span></p>
      <p class="sub">${BRAND} is built from the ground up so AI coding agents get a precise error and know <b>exactly what to fix</b>. And it's delightful for your users: pages are real HTML, <b>interactive at first paint</b>.</p>
      <span class="nojs">&#10003; No JS required on load</span>
      <div class="try">
        <div class="cmd"><span><span class="dollar">$</span> <code>pnpm create ${BRAND_CLI} my-app</code></span><button type="button" class="code-copy" on:click="/c/code.js#copy">copy</button></div>
        <a class="go" href="/tutorial/">Start the tutorial</a>
      </div>
    </div>
    <div class="term">
      <div class="term-head"><span>one rename, every layer caught</span><span>${BRAND_CLI} check</span></div>
      <pre><span class="t-dim">$ git diff db/schema.ts</span>
<span class="t-del">-  price: integer('price'),</span>
<span class="t-add">+  priceCents: integer('price_cents'),</span>

<span class="t-dim">$ ${BRAND_CLI} check</span>

<span class="t-err">&#10007;</span> <span class="t-loc">server/queries/product.ts:14</span> <span class="badge b-query">QUERY</span>
  projection reads dropped column <b>price</b>
  <span class="t-fix">&rarr; select priceCents, or alias: price: products.priceCents</span>

<span class="t-err">&#10007;</span> <span class="t-loc">src/product-card.tsx:13</span> <span class="badge b-bind">BINDING</span>
  data-bind <b>"product.price"</b> has no source in the query
  <span class="t-fix">&rarr; bind product.priceCents &mdash; format in a derive</span>

<span class="t-err">&#10007;</span> <span class="t-loc">src/cart/checkout.tsx:31</span> <span class="badge b-form">FORM</span>
  field <b>price</b> is not in the cart/add mutation schema

<span class="t-err">&#10007;</span> <span class="t-loc">src/routes/sale.ts:8</span> <span class="badge b-route">ROUTE</span>
  redirect builds <b>/sale?max=price</b> against a dropped param

<div class="cascade-sum"><span><b>4 errors</b> &middot; 4 files &middot; each with its fix</span><span class="t-ok">0 guesses</span></div></pre>
    </div>
  </section>`;
}

function breakIt() {
  return `<section class="breakit">
    <p class="sec-label">How it works</p>
    <h2 class="pipe-title">Build-time checks from backend to frontend</h2>
    <p class="pipe-sub">Every layer below is checked against the next at build time. Don't take our word for it &mdash; break something:</p>

    <input type="radio" name="brk" id="brk-col" checked />
    <input type="radio" name="brk" id="brk-query" />
    <input type="radio" name="brk" id="brk-bind" />

    <div class="choices">
      <label for="brk-col"><b>01</b> rename the column</label>
      <label for="brk-query"><b>02</b> reshape the query</label>
      <label for="brk-bind"><b>03</b> typo the binding</label>
    </div>

    <div class="pipe">
      <div class="node node-1"><p class="nl">Database</p><pre>products = <span class="fn">table</span>({
  details: <span class="hl">nullable</span>(json),
  price: <span class="fn">integer</span>()
})</pre></div>
      <div class="link link-1"><span class="chk chk-ok">&#10003; typed</span><span class="chk chk-bad">&#10007; FW402</span><span class="wire"></span></div>
      <div class="node node-2"><p class="nl">Server query</p><pre><span class="fn">query</span>(<span class="st">'product'</span>, {
  reads: [product],
  load: &hellip;  <span class="hl">&rarr; shape</span>
})</pre></div>
      <div class="link link-2"><span class="chk chk-ok">&#10003; typed</span><span class="chk chk-bad">&#10007; FW223</span><span class="wire"></span></div>
      <div class="node node-3"><p class="nl">Client data</p><pre>&lt;script fw-query=<span class="st">"product"</span>&gt;
{"price": <span class="hl">1299</span>}</pre></div>
      <div class="link link-3"><span class="chk chk-ok">&#10003; typed</span><span class="chk chk-bad">&#10007; FW227</span><span class="wire"></span></div>
      <div class="node node-4"><p class="nl">Rendered UI</p><pre>&lt;h2 data-bind=
  <span class="st">"product.price"</span>&gt;</pre></div>
    </div>

    <div class="caught">
      <div class="case case-col term">
        <div class="term-head"><span>${BRAND_CLI} check &mdash; caught at the database &rarr; query junction</span></div>
        <pre><span class="t-err">&#10007; FW402</span> &mdash; <b>query 'product' reads a column that no longer exists</b>

  server/queries/product.ts:14 &mdash; <span class="t-loc">select(products.<span class="sq">price</span>)</span>
  <span class="t-fix">&rarr; the column is now priceCents &mdash; select it, or alias: price: products.priceCents</span>
  <span class="t-dim">every query is compiled against the live schema, so a rename can't reach production</span></pre>
      </div>
      <div class="case case-query term">
        <div class="term-head"><span>${BRAND_CLI} check &mdash; caught at the query &rarr; client junction</span></div>
        <pre><span class="t-err">&#10007; FW223</span> &mdash; <b>the page depends on data the query no longer ships</b>

  src/product-card.tsx:13 &mdash; <span class="t-loc">data-bind="product.<span class="sq">price</span>"</span>
  <span class="t-fix">&rarr; the projection now ships priceCents &mdash; update the binding, or restore the field</span>
  <span class="t-dim">bindings are typed against the query's emitted shape, not against hope</span></pre>
      </div>
      <div class="case case-bind term">
        <div class="term-head"><span>${BRAND_CLI} check &mdash; caught at the client &rarr; UI junction</span></div>
        <pre><span class="t-err">&#10007; FW227</span> &mdash; <b>binding path 'product.pricee' does not exist</b>

  src/product-card.tsx:13 &mdash; <span class="t-loc">data-bind="product.<span class="sq">pricee</span>"</span>
  <span class="t-fix">&rarr; did you mean product.price?</span>
  <span class="t-dim">the DOM is part of the type system: a typo in an attribute is a build error</span></pre>
      </div>
    </div>
    <p class="breakit-foot"><span>this demo is plain HTML and CSS &mdash; radio buttons and :has(). <b>that's the point.</b></span><span>L0 on the interaction ladder</span></p>
  </section>`;
}

function split() {
  return `<section class="split">
    <div class="half agents">
      <p class="hl-label">For agents</p>
      <h3>Errors worth reading</h3>
      <p class="lead">Every diagnostic teaches: the line, the reason, the fixes &mdash; so the loop is <b>edit &rarr; check &rarr; fixed</b>, not edit &rarr; deploy &rarr; bug report. The behavior graph is queryable too: <code>${BRAND_CLI} explain mutation cart/add</code> answers "what refreshes?" with diffable output for CI.</p>
      <div class="term">
        <div class="term-head">$ ${BRAND_CLI} check</div>
        <pre><span class="t-dim">13 &#9474;</span>  render: () =&gt; &lt;h2&gt;{product.<span class="sq">details.name</span>}&lt;/h2&gt;

<span class="t-err">&#10007; FW227</span> &mdash; <b>product.details can be null here</b>
  <span class="t-fix">fix 1</span>  {product.details<span class="t-ok">?.</span>name}
  <span class="t-fix">fix 2</span>  make the projection non-null in the query

<span class="t-ok">&#10003; caught in 0.4s &mdash; before anything ran</span></pre>
      </div>
    </div>

    <div class="half users">
      <p class="hl-label">For users</p>
      <h3>No uncanny valley</h3>
      <p class="lead">No hydration means no window where the page <b>looks ready but isn't</b>. A button works the moment it paints.</p>
      <div class="timelines">
        <div class="tl">
          <p class="who"><span>Typical SPA</span><span class="bad">interactive at 3.2s</span></p>
          <div class="track track-spa"><span class="seg s1"></span><span class="seg s2"></span><span class="seg s3"></span></div>
          <p class="marks"><span>0ms paint</span><span class="warn">&#9888; looks ready, ignores clicks</span><span>3.2s</span></p>
        </div>
        <div class="tl">
          <p class="who"><span>${BRAND}</span><span class="good">interactive at first paint</span></p>
          <div class="track track-mpa"><span class="seg s1"></span><span class="seg s3"></span></div>
          <p class="marks"><span>0ms paint</span><span class="ok">&#10003; every click works &mdash; tiny loader, handlers on demand</span></p>
        </div>
      </div>
      <p class="users-note">With JavaScript off, every page still renders and every form still posts. <b>This site runs on ${BRAND} &mdash; try it.</b></p>
    </div>
  </section>`;
}

function ledgerStrip(loader) {
  return `<p class="ledger-strip">
    <span><span class="g">&#9679;</span> all build gates green</span><span class="sep">&#9474;</span>
    <span>loader <b>${loader.gzipBytes.toLocaleString('en-US')} B</b> gzip &mdash; measured this build</span><span class="sep">&#9474;</span>
    <span>TTI = first paint</span><span class="sep">&#9474;</span>
    <span>JS-off: every page</span><span class="sep">&#9474;</span>
    <span>fixpoint compile</span>
    <a class="more" href="/guides/testing/">see how it's verified &rarr;</a>
  </p>`;
}

function landingFooter() {
  return `<footer class="l-footer">
    <span>${BRAND} &mdash; interactive at first paint &middot; legible at every layer &middot; statically verifiable</span>
    <span class="links">
      <a href="/spec/">Spec</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
    </span>
  </footer>`;
}

export function renderLanding(captures) {
  return `<div class="landing">
    ${landingHeader()}
    <div class="wrap">
      ${hero()}
      ${breakIt()}
      ${split()}
      ${ledgerStrip(captures.loader)}
      ${landingFooter()}
    </div>
  </div>`;
}
