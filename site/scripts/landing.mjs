/**
 * Landing page (plan W4): the fixed tagline, then three proof sections, each
 * backed by a W3-captured artifact — claims are toolchain output, not copy.
 */

function proofSection({ artifact, body, eyebrow, flip, title }) {
  return `<section class="border-t border-slate-200 py-20">
    <div class="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 ${flip ? 'lg:[&>*:first-child]:order-2' : ''}">
      <div>
        <p class="mb-2 text-sm font-semibold tracking-wide text-jiso-accent-dark uppercase">${eyebrow}</p>
        <h2 class="mb-4 text-3xl font-bold tracking-tight text-jiso-ink">${title}</h2>
        ${body}
      </div>
      <div class="min-w-0">${artifact}</div>
    </div>
  </section>`;
}

export function renderLanding(captures) {
  const { loader } = captures;

  const hero = `<section class="relative overflow-hidden">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_70%_-10%,#e6f4f4,transparent)]"></div>
    <div class="relative mx-auto max-w-7xl px-4 pt-24 pb-20 sm:px-6">
      <h1 class="max-w-3xl text-4xl font-extrabold tracking-tight text-jiso-ink sm:text-5xl">
        The TypeScript web framework where <span class="text-jiso-accent-dark">agents get build-time errors</span> and <span class="text-jiso-accent-dark">users get instant pages</span>.
      </h1>
      <p class="mt-6 max-w-2xl text-lg text-slate-600">
        Every handler wiring, navigation target, form field, and data dependency in a Jiso app is
        provable by TypeScript plus static graph queries — and auditable by reading the page source
        and the Network panel.
      </p>
      <div class="mt-8 flex flex-wrap items-center gap-4">
        <a href="/docs/installation/" class="rounded-lg bg-jiso-accent-dark px-5 py-2.5 font-semibold text-white hover:bg-jiso-accent">Get started</a>
        <code class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-sm text-slate-700">$ pnpm create jiso my-app</code>
      </div>
      <p class="mt-6 text-sm text-slate-500">
        Server-rendered MPA &middot; zero hydration &middot; ${loader.gzipBytes} bytes of always-loaded JS (gzipped, budget ${loader.budget})
      </p>
    </div>
  </section>`;

  const agents = proofSection({
    eyebrow: 'For agents',
    title: 'Agents get build-time errors',
    body: `<div class="space-y-4 text-slate-600">
      <p>
        An agent editing a Jiso app finds out it broke something the same way <code class="rounded bg-slate-100 px-1 font-mono text-sm">tsc</code> reports a type error:
        before anything runs. Binding paths are checked against real query shapes, links against the
        route table, form fields against mutation schemas — rename a route and every
        <code class="rounded bg-slate-100 px-1 font-mono text-sm">&lt;Link&gt;</code>, GET form, and redirect goes red under
        <code class="rounded bg-slate-100 px-1 font-mono text-sm">vp check</code> (<a class="text-jiso-accent-dark underline" href="/spec/#6-4">SPEC §6.4</a>).
      </p>
      <p>
        Every diagnostic is a teaching error: what broke, why the spec requires it, and the fixes.
        This capture is real compiler output, regenerated on every build of this site.
      </p>
      <p>
        And the whole behavior graph is queryable: <a class="text-jiso-accent-dark underline" href="/guides/fw-explain/">fw explain</a>
        answers "what refreshes when this mutation commits?" with stable, diffable output an agent can assert on in CI.
      </p>
    </div>`,
    artifact: `${captures.teachingError}<div class="mt-6">${captures.fwExplain}</div>`,
  });

  const users = proofSection({
    flip: true,
    eyebrow: 'For users',
    title: 'Users get instant pages',
    body: `<div class="space-y-4 text-slate-600">
      <p>
        Jiso is a multi-page app with no client router and no hydration: the HTML the server sends
        is the application, interactive at first paint. Time-to-interactive <em>is</em> first
        contentful paint — there is no gap to optimize, which CI proves with an automated
        100-navigation browser gate (<a class="text-jiso-accent-dark underline" href="/spec/#16">SPEC §16</a>).
      </p>
      <p>
        The only always-loaded JavaScript is a ${loader.gzipBytes}-byte (gzipped) event-delegation
        loader (<a class="text-jiso-accent-dark underline" href="/spec/#4-4">SPEC §4.4</a>). Handler modules load on first
        interaction — the number you see above is measured from the shipping artifact at build time.
      </p>
      <p>
        With JavaScript disabled, every page still renders and every form still posts: the MPA
        degrades to a working website, not a blank screen
        (<a class="text-jiso-accent-dark underline" href="/spec/#8">SPEC §8</a>). This site is built with Jiso — turn JS off and keep browsing.
      </p>
    </div>`,
    artifact: `<figure class="artifact">
      <figcaption class="artifact-title">measured at build time, from the shipping artifact</figcaption>
      <pre class="artifact-body"><span class="tok-dim">$ node -e "gzipSync(jisoLoaderSource).byteLength"</span>

<span class="tok-code">${loader.gzipBytes}</span> bytes gzipped <span class="tok-dim">(raw ${loader.rawBytes}B, budget ${loader.budget}B — pinned by packages/runtime tests)</span>

<span class="tok-dim"># what it does: capture-phase event delegation,
# url#export handler imports on first interaction,
# query hydration, update plan, enhanced forms.
# what it is not: a router, a renderer, a vdom.</span></pre>
    </figure>`,
  });

  const developers = proofSection({
    eyebrow: 'For developers',
    title: 'Developers get a great debugging experience',
    body: `<div class="space-y-4 text-slate-600">
      <p>
        The wire is the documentation (<a class="text-jiso-accent-dark underline" href="/spec/#2">Constitution #4</a>).
        Mutations are named form POSTs; responses are readable HTML fragments and query JSON. The
        trace on the right is the pinned wire fixture for "add to cart" — what you'd actually see
        in the Network panel, byte-for-byte what CI asserts.
      </p>
      <p>
        View-source works: handler refs are visible attributes
        (<code class="rounded bg-slate-100 px-1 font-mono text-sm">on:click="/c/cart.js#Cart$add"</code>), dependencies are
        <code class="rounded bg-slate-100 px-1 font-mono text-sm">fw-deps</code> stamps, state is a JSON attribute. Names appear in
        HTML and wire traffic, so they structurally cannot be minified away — debugging never
        requires decompiling the framework.
      </p>
      <p>
        Replay a duplicate POST and <code class="rounded bg-slate-100 px-1 font-mono text-sm">FW-Idem</code> answers from the
        idempotency log; <code class="rounded bg-slate-100 px-1 font-mono text-sm">FW-Changes</code> tells you exactly which
        domains a commit touched (<a class="text-jiso-accent-dark underline" href="/spec/#9-1">SPEC §9.1</a>).
      </p>
    </div>`,
    artifact: captures.wireTrace,
  });

  const cta = `<section class="border-t border-slate-200 bg-jiso-terminal py-20 text-center">
    <div class="mx-auto max-w-2xl px-4">
      <h2 class="text-3xl font-bold tracking-tight text-white">Build something legible</h2>
      <p class="mt-4 text-slate-300">
        Start with the tutorial — it builds a working e-commerce app step by step, and every step
        compiles and tests in this repo's CI.
      </p>
      <div class="mt-8 flex justify-center gap-4">
        <a href="/tutorial/" class="rounded-lg bg-jiso-accent px-5 py-2.5 font-semibold text-white hover:bg-jiso-accent-dark">Start the tutorial</a>
        <a href="/docs/installation/" class="rounded-lg border border-slate-600 px-5 py-2.5 font-semibold text-slate-200 hover:border-slate-400">Read the docs</a>
      </div>
    </div>
  </section>`;

  return `${hero}${agents}${users}${developers}${cta}`;
}
