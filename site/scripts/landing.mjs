/**
 * Landing page (plan W4): the fixed tagline, then three proof sections, each
 * backed by a W3-captured artifact — claims are toolchain output, not copy.
 * The hero's centerpiece is the FW227 teaching error, captured from the real
 * compiler on every build.
 */

const inlineCode = (text) =>
  `<code class="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] dark:border-slate-700 dark:bg-slate-800">${text}</code>`;

const specChip = (anchor, label) => `<a class="spec-chip" href="/spec/#${anchor}">${label}</a>`;

function proofSection({ artifact, body, eyebrow, flip, title }) {
  return `<section class="border-t border-slate-900/10 py-24 dark:border-slate-50/10">
    <div class="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 ${flip ? 'lg:[&>*:first-child]:order-2' : ''}">
      <div>
        <p class="mb-4"><span class="inline-flex rounded-full border border-jiso-600/30 bg-jiso-50 px-3 py-1 text-xs font-semibold tracking-widest text-jiso-700 uppercase dark:border-jiso-400/30 dark:bg-jiso-950 dark:text-jiso-300">${eyebrow}</span></p>
        <h2 class="mb-5 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-white">${title}</h2>
        ${body}
      </div>
      <div class="min-w-0">${artifact}</div>
    </div>
  </section>`;
}

export function renderLanding(captures) {
  const { loader } = captures;

  const hero = `<section class="relative overflow-hidden">
    <div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <div class="absolute -top-44 right-[-12%] h-[36rem] w-[52rem] rounded-full bg-jiso-200/50 blur-3xl dark:bg-jiso-500/10"></div>
      <div class="absolute top-40 left-[-18%] h-[28rem] w-[42rem] rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10"></div>
    </div>
    <div class="relative mx-auto grid max-w-7xl items-center gap-16 px-4 pt-20 pb-24 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
      <div>
        <p class="mb-6 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span class="rounded-full border border-jiso-600/30 bg-jiso-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-jiso-700 dark:border-jiso-400/30 dark:bg-jiso-950 dark:text-jiso-300">Pre-v1</span>
          Built in the open — every claim below is CI-checked.
        </p>
        <h1 class="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-[3.4rem] sm:leading-[1.08] dark:text-white">
          The TypeScript web framework where <span class="bg-gradient-to-r from-teal-600 to-sky-600 bg-clip-text text-transparent dark:from-teal-300 dark:to-sky-400">agents get build-time errors</span> and <span class="bg-gradient-to-r from-sky-600 to-teal-600 bg-clip-text text-transparent dark:from-sky-400 dark:to-teal-300">users get instant pages</span>.
        </h1>
        <p class="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
          Every handler, navigation target, form field, and data dependency in a Jiso app is
          provable by TypeScript plus static graph queries — and auditable by reading the page
          source and the Network panel.
        </p>
        <div class="mt-9 flex flex-wrap items-center gap-4">
          <a href="/docs/installation/" class="rounded-full bg-jiso-600 px-6 py-3 font-semibold text-white shadow-lg shadow-jiso-600/25 transition hover:bg-jiso-500">Get started</a>
          <a href="/tutorial/" class="rounded-full border border-slate-300 px-6 py-3 font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500">Start the tutorial</a>
        </div>
        <dl class="mt-12 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dt class="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Always-loaded JS</dt>
            <dd class="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">${(loader.gzipBytes / 1024).toFixed(1)}<span class="text-base text-slate-500"> KB gz</span></dd>
          </div>
          <div>
            <dt class="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Hydration</dt>
            <dd class="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">none</dd>
          </div>
          <div>
            <dt class="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Time to interactive</dt>
            <dd class="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">= first paint</dd>
          </div>
        </dl>
      </div>
      <div class="relative min-w-0">
        <div class="absolute -inset-6 rounded-3xl bg-gradient-to-br from-teal-500/15 to-sky-500/15 blur-2xl" aria-hidden="true"></div>
        <div class="artifact-hero relative">${captures.teachingError}</div>
        <p class="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">Real compiler output — recaptured from the toolchain on every build of this site.</p>
      </div>
    </div>
  </section>`;

  const agents = proofSection({
    eyebrow: 'For agents',
    title: 'Your agent finds out at build time, not in production',
    body: `<div class="space-y-4 text-slate-600 dark:text-slate-400">
      <p>
        An agent editing a Jiso app learns it broke something the same way ${inlineCode('tsc')}
        reports a type error: before anything runs. Binding paths are checked against real query
        shapes, links against the route table, form fields against mutation schemas. Rename a
        route and every ${inlineCode('&lt;Link&gt;')}, GET form, and redirect goes red under
        ${inlineCode('vp check')}. ${specChip('6-4', 'SPEC §6.4')}
      </p>
      <p>
        Every diagnostic is a teaching error — what broke, why the spec requires it, and the
        fixes. The capture in the hero above is one of them, produced by the real compiler when
        this site was built.
      </p>
      <p>
        The whole behavior graph is queryable, too. <a class="font-medium text-jiso-600 underline decoration-jiso-600/40 underline-offset-3 hover:decoration-jiso-600 dark:text-jiso-400" href="/guides/fw-explain/">fw explain</a>
        answers &ldquo;what refreshes when this mutation commits?&rdquo; with stable, diffable
        output an agent can assert on in CI.
      </p>
    </div>`,
    artifact: captures.fwExplain,
  });

  const users = proofSection({
    flip: true,
    eyebrow: 'For users',
    title: 'Pages are interactive the moment they paint',
    body: `<div class="space-y-4 text-slate-600 dark:text-slate-400">
      <p>
        Jiso is a multi-page app with no client router and no hydration: the HTML the server
        sends <em>is</em> the application. Time-to-interactive equals first contentful paint —
        there is no gap to optimize, and CI proves it with an automated 100-navigation browser
        gate. ${specChip('16', 'SPEC §16')}
      </p>
      <p>
        The only JavaScript on every page is a ${loader.gzipBytes}-byte (gzipped)
        event-delegation loader. Handler modules load on first interaction — and the number you
        just read was measured from the shipping artifact when this page was built.
        ${specChip('4-4', 'SPEC §4.4')}
      </p>
      <p>
        Turn JavaScript off and every page still renders, every form still posts. The app
        degrades to a working website, not a blank screen — this site is built with Jiso, so
        try it. ${specChip('8', 'SPEC §8')}
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
    title: 'Debug from the Network panel, not the framework source',
    body: `<div class="space-y-4 text-slate-600 dark:text-slate-400">
      <p>
        The wire is the documentation. Mutations are named form POSTs; responses are readable
        HTML fragments and query JSON. The trace on the right is the pinned wire fixture for
        &ldquo;add to cart&rdquo; — exactly what the Network panel shows, byte-for-byte what CI
        asserts. ${specChip('2', 'Constitution #4')}
      </p>
      <p>
        View-source works. Handler refs are visible attributes
        (${inlineCode('on:click="/c/cart.js#Cart$add"')}), dependencies are
        ${inlineCode('fw-deps')} stamps, state is a JSON attribute. Names appear in HTML and
        wire traffic, so they structurally cannot be minified away.
      </p>
      <p>
        Replay a duplicate POST and ${inlineCode('FW-Idem')} answers from the idempotency log;
        ${inlineCode('FW-Changes')} tells you exactly which domains a commit touched.
        ${specChip('9-1', 'SPEC §9.1')}
      </p>
    </div>`,
    artifact: captures.wireTrace,
  });

  const cta = `<section class="px-4 pb-24 sm:px-6">
    <div class="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-20 text-center dark:border dark:border-slate-800">
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-jiso-500/20 blur-3xl"></div>
      </div>
      <div class="relative mx-auto max-w-2xl">
        <h2 class="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Build something legible</h2>
        <p class="mt-4 text-lg text-slate-300">
          The tutorial builds a working e-commerce app in eight chapters — and every code block
          in it compiles and tests in this repo&rsquo;s CI.
        </p>
        <div class="mt-9 flex flex-wrap justify-center gap-4">
          <a href="/tutorial/" class="rounded-full bg-jiso-500 px-6 py-3 font-semibold text-white shadow-lg shadow-jiso-500/30 transition hover:bg-jiso-400">Start the tutorial</a>
          <a href="/docs/installation/" class="rounded-full border border-slate-600 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-400">Read the docs</a>
        </div>
      </div>
    </div>
  </section>`;

  return `${hero}${agents}${users}${developers}${cta}`;
}
