# Easy Deployment

Make the path from a working local Kovo dev app to a deployed app on **Vercel**,
**Cloudflare**, or a **VPS** a short, predictable sequence: `kovo build` → run the
platform's native deploy tool. Normative behavior is governed by `SPEC.md` (esp.
§9.5 request shell, §5.2 compiler 1:1 emit, §6.6 immutable client URLs, §9.3
stateless server). This plan adds the build + preset surface that does not yet
exist; it does not change framework semantics.

## Goal

A Kovo app author who has `vp dev` working locally can deploy by:

```bash
kovo build                   # auto-detects the host (Vercel/CF), or:
vercel deploy --prebuilt     # or: wrangler deploy   |   docker build … / scp
```

On a VPS or to override detection, name the preset (no extra package — presets ship
inside `@kovojs/server`):

```ts
// kovo.config.ts
import { node } from '@kovojs/server/build';
export default { preset: node() };
```

`kovo build` produces a **self-contained production artifact** — no Vite-from-source
at request time — shaped by the selected preset for the chosen platform.

## Non-goals (v1)

- **No `kovo deploy` wrapper.** Kovo stops at emitting platform-native artifacts;
  the user runs `vercel` / `wrangler` / their own SSH/CI. (We document the
  one-liners and keep zero credential handling.)
- **No DB provisioning, migrations, pooling, or seeding orchestration.** The
  deployment surface owns only the **`DATABASE_URL` env convention** and how a
  driver is wired per target. Migrations/pooling/provisioning stay the app's
  concern (referenced in docs, not run by Kovo).
- **No true V8-isolate edge in v1.** The request path uses `node:crypto`
  (CSRF/CSP) and the data plane is TCP Postgres (Drizzle `pg-core`); a pure-isolate
  Cloudflare Worker would require a WebCrypto refactor + an HTTP DB driver. v1
  targets the Node runtime everywhere (incl. Cloudflare via `nodejs_compat` /
  Containers). Edge is tracked as a deferred follow-up, not built here.

## Locked decisions (owner answers, 2026-06-16)

- [x] **Edge ambition: Node-first, edge-ready later.** v1 targets = VPS/Node +
      Vercel (Node serverless) + Cloudflare (Workers `nodejs_compat` or Containers).
      True isolate-edge deferred.
- [x] **Preset model (Nitro-style), not separate packages.** The config keeps the
      value ergonomics (`preset: vercel()`), but targets are **built into the engine,
      `@kovojs/server`**, behind a build-time subpath — _not_ shipped as `@kovojs/
adapter-*` packages. Selection is host **auto-detection** (`VERCEL` / `CF_PAGES`
      env) with `kovo.config` / `KOVO_PRESET` as override. (Supersedes the earlier
      "adapter packages" answer: same authoring ergonomics, Nitro's packaging —
      presets are thin build-time descriptors, the heavy lifting is centralized, and
      `@kovojs/server` already houses build-time-only code like static export behind
      subpaths.)
- [x] **Deploy step: build artifacts, hand off to native tooling.** No CLI
      wrapping of `vercel`/`wrangler`.
- [x] **DB scope: connection convention only.** `DATABASE_URL` env + per-target
      driver-wiring docs; nothing else owned by Kovo.

## Current state — what exists vs. the gap

**Exists (reuse, do not rebuild):**

- Web-standard request shell. `createApp()` returns the aggregate; the public
  currency is `Request → Response` (`SPEC.md` §9.5). Evidence:
  `packages/server/src/api/app-shell/core.ts`, `app-shell/node.ts`.
- Node adapter. `toNodeHandler(handler)` bridges a Web handler to
  `node:http` `(req,res)`, already resolving origin from `Host` /
  `x-forwarded-proto`. Evidence: `packages/server/src/node.ts`.
- A build pipeline that assembles a runnable shell **from a built client
  manifest** — no Vite needed at request time:
  `createKovoAppShellViteBuild` / `…FromBundle` / `…FromManifestFile`. Evidence:
  `packages/server/src/vite-build.ts:179,204,220`. These are `@internal`
  ("Exported only for in-repo build/host config, not app authors").
- Static export. `exportStaticApp` replays synthetic GETs through the same
  handler (`SPEC.md` §9.5 export; `app-shell/static-export.ts`). Mature; the
  fully-static L0/L1 path is essentially solved.
- Canonical app entry convention: `src/app-shell.ts` exporting `default app`
  (the `createApp()` aggregate) + a request handler. Evidence:
  `packages/create-kovo/templates/src/app-shell.ts`,
  `examples/commerce/src/app-shell.ts:367-373`.
- Client asset build + Vite manifest (`build.manifest: true`), assets under
  `/assets/*`, immutable client modules under `/c/__v/<version>/*` that must persist across
  deploys (`SPEC.md` §6.6). Evidence: `examples/commerce/vite.config.ts`,
  `templates/docs/deployment.md`.

**The gap (what this plan builds):**

- [x] **Production serve path is switched over for the template/example path.**
      `kovo build` emits self-contained Node output and the template/commerce
      production serve story uses the generated preset output; Vite
      `middlewareMode` remains scoped to dev/demo checks.
  - Evidence: `examples/commerce/package.json` uses
    `kovo build ./src/app-shell.tsx --preset node` for `build`,
    `node dist/server/server.mjs` for `start`, and
    `pnpm run build && node dist/server/server.mjs` for `serve:prod`, while
    `examples/commerce/scripts/serve.mjs` is only `serve:dev`.
    `packages/create-kovo/templates/docs/deployment.md` documents `kovo build`
    plus native Node/Vercel/Cloudflare deploy flows and states that `vp dev` /
    `serve:dev` are not the production serve path.
- [x] **App-author build command exists for the Node preset.** `packages/cli/src/
index.ts` dispatches `kovo build`, loads `.mjs` and `.ts` app modules through
      build-time Vite SSR, runs the client manifest build, writes the neutral
      build, and emits `node()` output. Evidence: `packages/cli/src/
index.kovo-build.test.ts`.
- [x] **Preset interface exists for build-time Node output.** `packages/server/src/
build.ts` exposes `KovoPreset`, `PresetContext`, `PresetDiagnostic`,
      `defineConfig()`, and `node()` through `@kovojs/server/build`; `kovo build`
      reads `kovo.config.ts`, `KOVO_PRESET`, and host env before selecting a
      preset. Evidence: `packages/server/src/build.test.ts` and
      `packages/cli/src/index.kovo-build.test.ts`.
- [x] **Serverless platform bundling is addressed for the v1 Node-first targets.**
      Client assets and the Node server bundle are solved, and the server entry is
      placed into Vercel Functions and Cloudflare Workers output.
  - Evidence: `packages/server/src/build.ts` emits `.vercel/output` with
    `functions/kovo.func/handler.mjs`, `index.cjs`, `.vc-config.json`, and static
    assets, and emits Cloudflare `worker.mjs`, `server/handler.mjs`, `client/`,
    and `wrangler.toml`. `packages/server/src/build.test.ts` and
    `packages/cli/src/index.kovo-build.test.ts` verify Vercel and Cloudflare
    preset output shape and runtime wrappers.

---

## Key API design

### 1. The deployment artifact (platform-neutral core)

`kovo build` always first produces a **neutral build** in `dist/.kovo/`:

```
dist/.kovo/
  server/            # bundled server: app-shell + user server modules + deps
    handler.mjs      # exports default: (Request) => Promise<Response>
    app.mjs          # the createApp() aggregate (re-exported)
  client/
    assets/          # /assets/* (css, hashed static)  — long-lived immutable
    c/               # /c/*  versioned client modules   — immutable, retain across deploys
  manifest.json      # vite client manifest + route hints + client-module index
  routes.json        # route table + per-route export policy (L0/L1 vs dynamic)
  meta.json          # kovo + node version, build hash, static-only flag
```

This is the single source each **preset** transforms (Nitro's `.output/`, Kovo's
`dist/.kovo/`). It is produced by promoting the already-existing internal pipeline
(`createKovoAppShellViteBuildFromManifestFile` + `toNodeHandler`) into a supported,
app-author-facing build, plus a **server-bundle step** (esbuild/rollup via
vite-plus) that turns `src/app-shell.ts` into `server/handler.mjs` with no Vite
dependency.

Design rule: the neutral build's `handler.mjs` is the _only_ runtime contract.
Every preset is "wrap this `Request → Response` handler + place these static
files." This keeps the per-platform code tiny and the portability guarantee honest.

### 2. The preset interface (built into `@kovojs/server`, not a separate package)

Following Nitro: presets are **thin build-time descriptors that live in the engine**
(`@kovojs/server`, behind a build-time subpath such as `@kovojs/server/build`),
_not_ `@kovojs/adapter-*` packages. The same package already houses build-time-only
code (static export, the Vite build pipeline, the node adapter) behind subpaths the
runtime handler never imports, so presets add no weight to the production bundle.
There is **no `@kovojs/adapters` package and no `adapter-kit`** — shared types and
helpers fold into the same subpath.

```ts
// @kovojs/server/build  (build-time only)
export interface KovoPreset {
  name: string; // 'node' | 'vercel' | 'cloudflare'
  /** Validate target constraints against the neutral build before emit. */
  inspect?(build: NeutralBuild): PresetDiagnostic[];
  /** Transform dist/.kovo into platform-native output. */
  emit(build: NeutralBuild, ctx: PresetContext): Promise<void>;
}

export interface PresetContext {
  outDir: string; // platform-conventional location
  log: (msg: string) => void;
  readNeutral: () => NeutralBuild; // server bundle, client assets, manifests
  declaredEnv: string[]; // always includes 'DATABASE_URL' if data plane present
}
```

**Selection — auto-detect first (Nitro's headline UX), config as override:**

1. `kovo build` sniffs the host env (`VERCEL`, `CF_PAGES`, …) and picks the preset
   with **zero config** on those platforms.
2. `KOVO_PRESET=cloudflare` env override (CI ergonomics).
3. `kovo.config.ts` explicit `preset:` — wins over detection, carries typed options:

```ts
export default {
  preset: vercel({ runtime: 'nodejs', regions: ['iad1'] }),
  // packagePrefixes, mergeClientModules … unchanged (SPEC §5.2, §6.1.1)
};
```

Design decisions to lock in code review:

- **Preset is a value, not a string.** `vercel()` returns a configured `KovoPreset`;
  options (`runtime`, `regions`, container vs function) stay typed per preset
  without a central union. (Same authoring ergonomics as Astro/SvelteKit; Nitro's
  in-engine packaging.)
- **One preset per build.** Multi-target is "run `kovo build` per config" — keeps
  output dirs unambiguous.
- **Presets never see Vite.** They consume `dist/.kovo/` only.
- **`inspect()` is where targets fail loudly.** e.g. the Cloudflare preset asserts
  `nodejs_compat` / Container mode and that no banned API is in the server bundle;
  a future edge preset rejects TCP DB drivers here, not at deploy time.

### 3. The three v1 presets

- [x] **`node`** → `dist/server/` standalone: a Node entry that
      `toNodeHandler(handler)` behind `node:http`, serves `client/assets` + `client/c`
      with correct cache headers, honors `PORT`/`HOST`, plus a generated `Dockerfile`
      (prod deps only — the key improvement over today's dev-dep image) and an
      optional `systemd` unit. Covers VPS, Fly, Railway, Render.
  - Evidence: `packages/server/src/build.ts` implements `node().emit()` with
    generated `server.mjs`, immutable static serving, `PORT`/`HOST`, and a default
    Dockerfile. `packages/server/src/build.test.ts` verifies route fallback,
    `/c/`, `/assets/`, immutable headers, forwarded proto, and Dockerfile output.
    `packages/cli/src/index.kovo-build.test.ts` verifies the generated node output
    boots without Vite at request time.
- [x] **`vercel`** → Vercel **Build Output API v3** (`.vercel/output/`): a Node
      serverless function wrapping `handler.mjs`, static assets as `output/static/*`
      with immutable cache config, `config.json` routing. `vercel deploy --prebuilt`.
      (`runtime: 'nodejs'` only in v1; `edge` reserved.)
  - Evidence: `packages/server/src/build.ts` implements `vercel().emit()` with
    Build Output API v3 `static`, `functions/kovo.func`, `config.json`, and
    immutable `/assets|/c` routing. `packages/server/src/build.test.ts` verifies
    the golden output and function wrapper, and
    `packages/cli/src/index.kovo-build.test.ts` verifies Vercel auto-detection and
    static-only Vercel output.
- [x] **`cloudflare`** → a Worker entry (`export default { fetch }`) delegating to
      `handler.mjs` under `compatibility_flags = ["nodejs_compat"]`, static assets via
      Workers Assets/`[site]`, generated `wrangler.toml`. `inspect()` warns when the
      data plane needs TCP (recommend Hyperdrive/Containers). `wrangler deploy`.
  - Evidence: `packages/server/src/build.ts` implements `cloudflare().emit()` with
    `worker.mjs`, `server/handler.mjs`, `client/`, `wrangler.toml`,
    `compatibility_flags = ["nodejs_compat"]`, and Workers Assets. The same file
    implements `cloudflare().inspect()` warnings/errors for `DATABASE_URL` and
    unsupported Node APIs. `packages/server/src/build.test.ts`,
    `packages/cli/src/index.kovo-build.test.ts`, and the recorded
    `wrangler deploy --dry-run` evidence in Phase 3 verify the preset.

### 4. Cross-cutting contracts

- [ ] **Static-or-dynamic auto-detection.** `routes.json` carries each route's
      export policy (already computed for static export, `SPEC.md` §9.5/KV229). If
      _all_ routes are L0/L1-exportable, the neutral build also emits a fully static
      tree and presets prefer static output (Vercel static, CF Pages/Assets, plain
      Nginx) — no server function needed. Mixed apps get both: static where provable,
      the function for the rest.
  - Partial evidence: `packages/server/src/build.ts` now attempts a neutral static
    export only when the app has no endpoints, mutations, or queries; if export
    diagnostics are empty, `KovoNeutralBuild.staticOutput` points at the static tree
    and `node()`, `vercel()`, and `cloudflare()` prefer it over a server handler.
    `packages/server/src/build.test.ts` verifies the neutral static tree includes
    HTML, `/c/` client modules, and `/assets/` files, verifies `node()` still emits
    a runnable server for explicitly selected Node deployments, and verifies the
    edge/static-host presets omit their function/worker entry for a proven static-only app.
    `packages/cli/src/index.kovo-build.test.ts` verifies `VERCEL=1` static-only
    apps emit `.vercel/output/static` with no function. Gap: mixed apps still emit
    dynamic preset output only; per-route static plus function routing remains open.
- [x] **Immutable `/c/` retention across deploys (`SPEC.md` §6.6).** Versioned
      client-module URLs must survive deploys until referencing documents age out.
      Each preset documents/implements "don't overwrite, accrete": e.g. the node preset
      serves a retained `c/` dir; Vercel/CF rely on content-hash immutability +
      guidance to not purge old versions. This is a real correctness constraint, not a
      nicety — surfaced in preset docs and `inspect()` warnings.
  - Evidence: `packages/create-kovo/templates/docs/deployment.md` documents that
    `/c/__v/<version>/*` client handler modules are immutable and that old versioned
    artifacts must stay published until referencing documents age out.
    `packages/server/src/build.ts` emits a `client-module-retention` warning from
    `node().inspect()`, `vercel().inspect()`, and `cloudflare().inspect()` whenever
    the neutral build contains `/c/` client modules. `packages/server/src/build.test.ts`
    verifies all three built-in presets emit that warning, and the existing node,
    Vercel, and Cloudflare preset tests verify emitted `/c/` files keep
    `public, max-age=31536000, immutable` cache behavior.
  - Evidence: `packages/server/src/client-modules.ts` and
    `packages/compiler/src/lower/handlers.ts` now emit canonical
    `/c/__v/<version>/...` client-module hrefs while retaining legacy
    `/c/name.js?v=...` request resolution. `packages/server/src/build.test.ts`,
    `packages/cli/src/index.kovo-build.test.ts`, and
    `packages/server/src/static-export-output-targets.test.ts` verify Vite,
    neutral, preset, and static-export outputs physically write retained
    `c/__v/<version>/...` artifacts.
  - Evidence: `corepack pnpm exec vitest --run examples/gallery/src/interactive-gallery.compile.test.ts examples/gallery/src/interactive-gallery.artifacts.test.ts examples/gallery/src/interactive-gallery.static-export.test.ts examples/commerce/src/app-shell.test.ts examples/reference/src/app-shell.test.ts packages/create-kovo/src/index.test.ts packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/state-bindings.test.ts packages/compiler/src/output-context-raw-html.test.ts packages/compiler/src/vite.test.ts packages/conformance-fixtures/src/generated-module-fixtures.test.ts packages/conformance-fixtures/src/diagnostic-output-fixtures.test.ts packages/conformance-fixtures/src/vite-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts packages/test/src/integration/semantic-snapshot.test.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/build.test.ts` passed with 122 tests across 17 files.
  - Evidence: `corepack pnpm exec vitest --run site/tutorial/steps site/src site/scripts packages/server/src/hints.test.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-client-module-refs.test.ts packages/server/src/static-export-document-client-modules.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-request.test.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-export-replay.test.ts packages/server/src/vite-plugin-build.test.ts packages/server/src/node.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-dev-middleware.test.ts packages/server/src/vite-build-wiring.test.ts` passed with 156 tests across 27 files.
- [x] **Env & origin.** Convention: `PORT`, `HOST`, `NODE_ENV`, and `DATABASE_URL`
      (only env Kovo names for the data plane). Origin/proto already handled via
      `Host`/`x-forwarded-proto` in `node.ts`; presets set `origin` appropriately for
      proxied platforms. Secrets beyond `DATABASE_URL` are pass-through env, undocumented
      by Kovo per the locked DB decision.
  - Evidence: `packages/server/src/build.ts` emits a node preset `server.mjs`
    that reads `process.env.PORT ?? "3000"` and `process.env.HOST ?? "0.0.0.0"`,
    uses `Host` plus `x-forwarded-proto` to construct the Web `Request` URL, and
    emits a Dockerfile with `ENV NODE_ENV=production`.
    `packages/server/src/build.test.ts` verifies the generated node server passes
    `x-forwarded-proto` through to the bundled handler's request origin.
    `packages/server/src/node.ts` keeps the shared Node adapter origin logic for
    host/proto and explicit `origin` overrides. `packages/server/src/build.ts`
    emits a Vercel function wrapper that uses `x-forwarded-proto` plus `host`,
    and a Cloudflare Worker that forwards the platform `Request` directly.
    `packages/server/src/build.test.ts` and
    `packages/cli/src/index.kovo-build.test.ts` verify `DATABASE_URL` inspection
    warnings for Cloudflare TCP database deployments. `packages/cli/src/index.ts`
    infers `DATABASE_URL` from the bundled request handler and passes it through
    `PresetContext.declaredEnv`; `packages/cli/src/index.kovo-build.test.ts`
    verifies a configured preset receives `declaredEnv=["DATABASE_URL"]` during
    both inspection and emission. `packages/create-kovo/templates/docs/deployment.md`
    documents `PORT`, `HOST`, `NODE_ENV`, and `DATABASE_URL` as Kovo-owned
    deployment environment variables and leaves app-specific secrets to the host.
- [x] **Edge-readiness audit (deferred, tracked).** Catalogue every `node:`
      import on the request path (`node:crypto` in `csrf.ts`/`csp.ts`, `node:stream`
      in `node.ts`) so the Phase 5 isolate-edge work has a scoped worklist. The likely
      mechanism is **`unenv`** (Nitro's approach: swap Node built-ins for
      runtime-appropriate implementations at build time) rather than a hand WebCrypto
      rewrite. Audit only in this plan; no refactor.
  - Evidence: `rg -n "from 'node:|from \"node:|import\\('node:" packages/server/src
packages/runtime/src packages/core/src -g '*.ts'` was run in this session. The
    request-path audit is: `packages/server/src/csrf.ts` imports `node:crypto`
    for HMAC CSRF tokens and timing-safe equality; `packages/server/src/csp.ts`
    imports `node:crypto` for CSP hashes; `packages/server/src/client-modules.ts`
    and `packages/server/src/vite-build.ts` import `node:crypto` for build/client
    module version hashes; `packages/server/src/jsx-context.ts` imports
    `node:async_hooks` for request-scoped JSX context; `packages/server/src/node.ts`
    imports `node:stream`, `node:http`, and `node:stream/web` for the Node adapter;
    the generated node preset in `packages/server/src/build.ts` imports
    `node:fs`, `node:fs/promises`, `node:http`, `node:path`, `node:stream`, and
    `node:url`. The remaining `node:` hits are build/dev/test/static-export paths,
    not true isolate request-path support. Phase 5 keeps the `unenv`/WebCrypto/HTTP
    DB implementation work open.

---

## Phased checklist

### Phase 0 — Neutral build + `kovo build` skeleton

- [x] Expose a supported build-time neutral artifact API while keeping low-level
      Vite helpers internal; define `NeutralBuild` shape and write `dist/.kovo/`
      layout.
  - Evidence: `packages/server/src/build.ts` adds the public build-time
    `@kovojs/server/build` subpath with `KovoNeutralBuild`,
    `writeKovoNeutralBuild()`, `KovoPreset`, `PresetContext`, `PresetDiagnostic`,
    and `node()`. The neutral writer reuses
    `createKovoAppShellViteBuildFromManifestFile()` / `writeKovoAppShellViteBuildOutput()`
    to emit `client/c/*`, Vite manifest assets under `client/assets/*`,
    `manifest.json`, `routes.json`, `meta.json`, and an optional
    `server/handler.mjs`. `packages/server/src/build.test.ts` verifies the layout
    against a small app + Vite manifest fixture, including static-only neutral
    output. `packages/server/package.json` exports `./build`, and
    `public-packages.json` classifies it as a public API reference surface. The
    lower-level `createKovoAppShellViteBuild*` helpers remain internal by design;
    app authors use `kovo build` or `@kovojs/server/build`.
- [x] Add server-bundle step: `src/app-shell.ts` → `server/handler.mjs`
      (`Request → Response`), no Vite at runtime. Verify a bundled handler serves a
      route + a `/_m/` mutation + a `/c/` module with **zero dev deps installed**.
  - Evidence: `packages/cli/src/index.ts` bundles the supplied app
    module into a `server/handler.mjs` source using `vite-plus` SSR build, with
    `@kovojs/*` packages externalized so framework runtime remains a production
    dependency instead of being inlined. `packages/cli/src/index.kovo-build.test.ts`
    runs `kovo build <app-module> --out <dir>`, boots the emitted
    `dist/server/server.mjs`, and verifies a route, `/_m/` mutation, and `/_q/`
    query response without Vite in the request path.
  - Additional evidence: `packages/cli/src/index.kovo-build.test.ts` boots the
    emitted node preset output copied into a runtime root with only production
    Kovo package roots (`@kovojs/core`, `@kovojs/runtime`, `@kovojs/server`) plus
    throwing `vite`/`vite-plus` guard packages, then verifies a route, a `/_m/`
    mutation, an immutable `/c/__v/cart-v1/cart.client.js` response, and an
    immutable Vite-built `/assets/*.css` response. Verification: `corepack pnpm
exec vitest --run packages/server/src/client-modules.test.ts
packages/server/src/build.test.ts packages/server/src/api/app.test.ts
packages/server/src/static-export-client-module-refs.test.ts
packages/cli/src/index.kovo-build.test.ts
packages/cli/src/index.kovo-export.test.ts`; `corepack pnpm exec tsc -p
tsconfig.json --noEmit --pretty false`; `corepack pnpm run
check:api-surface`; `corepack pnpm run check:exports`; `corepack pnpm run
check:imports`; `corepack pnpm run check:publish`; `git diff --check`.
- [x] Wire `kovo build` into `packages/cli` (a thin wrapper, exactly like
      `kovo export` over `exportStaticApp`); it reads `kovo.config.ts` + host env,
      runs client build → server bundle → neutral emit → preset.
  - Evidence: `packages/cli/src/index.ts` dispatches async `kovo build`,
    parses `<app-module>`, `--out`, and `--preset <name>`, writes the neutral
    artifact with the bundled handler plus a Vite client manifest, loads
    `kovo.config.ts` through Vite SSR, selects the preset from explicit CLI flag
    → `KOVO_PRESET` → `kovo.config.ts` `preset:` → host env (`VERCEL`,
    `CF_PAGES`/`CLOUDFLARE`) → `node`, preserves configured `node()` options,
    and emits the built-in `node()` preset. `vercel`/`cloudflare` selection fails
    loudly until their Phase 2/3 emitters land instead of silently producing Node
    output. The app aggregate is loaded through a build-time Vite SSR server, so
    TypeScript app entries such as `src/app-shell.ts` work without requiring app
    authors to precompile or hand-author `.mjs` fixtures. `packages/server/src/
build.ts` defaults neutral-build client modules to
    `app.clientModules.entries()`, so app-registered `/c/*` modules are emitted
    without a parallel hand-authored build list.
    `packages/cli/src/commands-manifest.ts` / `commands-manifest.test.ts` pin the
    CLI docs/usage surface, and `packages/cli/package.json` declares the runtime
    `vite-plus` dependency needed by the build command. Verification: `corepack
pnpm exec vitest --run packages/server/src/client-modules.test.ts
packages/server/src/build.test.ts packages/server/src/api/app.test.ts
packages/server/src/static-export-client-module-refs.test.ts
packages/cli/src/index.kovo-build.test.ts
packages/cli/src/index.kovo-export.test.ts`; `corepack pnpm exec tsc -p
tsconfig.json --noEmit --pretty false`; `corepack pnpm run
check:api-surface`; `corepack pnpm run check:exports`; `corepack pnpm run
check:imports`; `corepack pnpm run check:publish`; `git diff --check`.
- [x] Evidence target: a test that boots `server/handler.mjs` in a clean
      `node_modules` (prod deps only) and asserts route/mutation/asset responses.
  - Evidence: `corepack pnpm exec vitest --run
packages/cli/src/index.kovo-build.test.ts` covers the emitted node preset
    `server.mjs` importing `server/handler.mjs` from a runtime root with only
    production Kovo package roots and throwing `vite`/`vite-plus` guard packages;
    it verifies route, mutation, and immutable asset responses.

### Phase 1 — Preset interface + `node` preset (in `@kovojs/server/build`)

- [x] `KovoPreset` / `PresetContext` types + the build-time subpath export on
      `@kovojs/server`; preset **selection** (`--preset` → `KOVO_PRESET` →
      `kovo.config.ts` `preset:` → host auto-detect). No separate package.
  - Evidence: `packages/server/package.json` exports `./build`;
    `public-packages.json` classifies it as a public API reference surface; and
    `packages/server/src/build.ts` exposes `KovoPreset`, `PresetContext`,
    `PresetDiagnostic`, `KovoConfig`, `defineConfig()`, and `node()`.
    `packages/cli/src/index.ts` loads `kovo.config.ts` through Vite SSR, validates
    `preset:` as a Kovo preset value, preserves configured `node()` options, and
    implements the `--preset` → `KOVO_PRESET` → config → host → default selection
    ladder for known preset names. `packages/cli/src/index.kovo-build.test.ts`
    verifies `kovo.config.ts` `node({ dockerfile: false })` beats `VERCEL=1` host
    auto-detection and suppresses the node preset Dockerfile, while existing tests
    keep CLI flag and `KOVO_PRESET` precedence. Verification: `corepack pnpm exec
vitest --run packages/cli/src/index.kovo-build.test.ts packages/server/src/build.test.ts`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `corepack pnpm run check:api-surface`; `corepack pnpm run check:exports`;
    `corepack pnpm run check:publish`; `corepack pnpm exec vp check --fix`.
- [x] `node` preset: standalone server + asset serving + cache headers + prod-only
      `Dockerfile`. Replace the example/demo Vite-from-source serve story with this as
      the recommended prod path (keep Vite serve for dev only).
  - Evidence: `packages/server/src/build.ts` implements `node().emit()`
    for a neutral build with `server/handler.mjs`, copying `client/` and
    `server/`, writing `server.mjs`, serving immutable `/c/*` and `/assets/*`
    before falling back to the Web `Request → Response` handler, honoring
    `PORT`/`HOST`, and emitting a minimal Dockerfile by default. The focused
    `packages/server/src/build.test.ts` test imports the emitted `server.mjs`
    directly and verifies route fallback, client-module serving, asset serving,
    content types, and `public, max-age=31536000, immutable` cache headers without
    Vite in the request path. The Docker evidence target below proves the generated
    Dockerfile. `examples/commerce/package.json` uses `kovo build` for production
    `build`/`serve:prod`, and `packages/create-kovo/templates/docs/deployment.md`
    documents `kovo build` as the production path while keeping Vite serve dev-only.
- [x] Evidence: container builds with pruned prod deps; `curl` of a route, a
      `/assets/*` (immutable cache header), and a `/_m/` mutation succeed.
  - Evidence: `packages/cli/src/index.ts` now bundles `@kovojs/*` into
    `server/handler.mjs` through Vite SSR `noExternal`, leaving the emitted
    `dist/server/` Docker context without `node_modules`. The opt-in Docker test
    in `packages/cli/src/index.kovo-build.test.ts` runs `kovo build`, asserts the
    generated node output has a `Dockerfile` and no `node_modules`, builds the
    image, runs the container, and verifies a route, `/_m/` mutation, immutable
    `/c/__v/cart-v1/cart.client.js`, and immutable Vite-built `/assets/*.css`.
    Verification: `KOVO_TEST_DOCKER=1 corepack pnpm exec vitest --run
packages/cli/src/index.kovo-build.test.ts -t "generated node Dockerfile"`.

### Phase 2 — `vercel` preset

- [x] Emit `.vercel/output/` (Build Output API v3): Node function + static.
  - Evidence: `packages/server/src/build.ts` exposes `vercel()` from
    `@kovojs/server/build`; `vercel().emit()` copies neutral `client/` into
    `.vercel/output/static`, writes `functions/kovo.func/handler.mjs`,
    `functions/kovo.func/index.cjs`, `functions/kovo.func/.vc-config.json`
    (`runtime: "nodejs22.x"`, `launcherType: "Nodejs"`), and
    `.vercel/output/config.json` with `version: 3`, immutable `/assets|/c`
    headers, filesystem routing, and catch-all function routing. Verification:
    `corepack pnpm exec vitest --run packages/server/src/build.test.ts
packages/cli/src/index.kovo-build.test.ts`.
- [x] Auto-detect on `VERCEL` env; static-only apps emit pure static (no function).
  - Evidence: `packages/cli/src/index.ts` allows the `vercel` preset, selects
    `vercel()` for `VERCEL=1` and `KOVO_PRESET=vercel`, and writes
    `.vercel/output` as the preset output directory.
    `packages/cli/src/index.kovo-build.test.ts` verifies Vercel host
    auto-detection emits Build Output API files, verifies `KOVO_PRESET=cloudflare`
    still wins over `VERCEL=1`, and verifies a `VERCEL=1` static-only app emits
    `.vercel/output/static/index.html`, `.kovo/meta.json` with `staticOnly: true`,
    `config.json` with `version: 3`, and no `functions/kovo.func/index.cjs`.
    `packages/server/src/build.test.ts` verifies `vercel().emit()` prefers
    `KovoNeutralBuild.staticOutput` and omits the Vercel function for a proven
    static-only neutral build.
- [ ] Evidence: `vercel build`/`--prebuilt` dry-run validates the output dir;
      golden-file test on `config.json` + function manifest.
  - Partial evidence: golden-file coverage exists in `packages/server/src/
build.test.ts` and `packages/cli/src/index.kovo-build.test.ts` for
    `config.json`, `.vc-config.json`, copied static assets, and the generated
    Node function wrapper. `corepack pnpm dlx vercel --version` succeeded with
    Vercel CLI 54.14.2 in this session. Gap: `corepack pnpm dlx vercel deploy
    --prebuilt --no-wait --token dummy --cwd <generated dist> --yes --debug`
    checks token validity before local prebuilt-output validation and exits with
    `The token provided via --token argument is not valid`; this still needs a
    real Vercel token/project or another local validator before the item can be
    checked off.

### Phase 3 — `cloudflare` preset

- [x] Worker entry + `wrangler.toml` with `nodejs_compat`; Workers Assets for
      static; `inspect()` TCP-DB warning + Containers/Hyperdrive guidance.
  - Evidence: `packages/server/src/build.ts` exposes `cloudflare()` from
    `@kovojs/server/build`; `cloudflare().emit()` writes `worker.mjs`,
    `server/handler.mjs`, `client/`, and `wrangler.toml` with
    `compatibility_flags = ["nodejs_compat"]`, `assets.binding = "ASSETS"`, and
    `run_worker_first = true`. `packages/server/src/build.test.ts` verifies the
    emitted layout, immutable asset header behavior through a fake `ASSETS`
    binding, and dynamic fallback to the bundled Web handler. `cloudflare().inspect()`
    warns when the bundle or declared env references `DATABASE_URL`, directing TCP
    database deployments to Hyperdrive, Cloudflare Containers, or an HTTP database
    driver.
- [x] Auto-detect on `CF_PAGES` env.
  - Evidence: `packages/cli/src/index.ts` selects the Cloudflare preset for
    `CF_PAGES` / `CLOUDFLARE`, and `packages/cli/src/index.kovo-build.test.ts`
    verifies `CF_PAGES=1` emits `dist/cloudflare/wrangler.toml` and that
    `KOVO_PRESET=cloudflare` wins over `VERCEL=1`.
- [x] Evidence: `wrangler deploy --dry-run` validates; `inspect()` unit tests for
      the banned-API and DB-driver diagnostics.
  - Evidence: a repo-local temporary app was built with
    `node_modules/.bin/jiti packages/cli/src/bin.ts build <app> --out <dir>
--preset cloudflare`, then `corepack pnpm dlx wrangler deploy --dry-run
--outdir <dir>/wrangler-out` was run from the emitted `dist/cloudflare`
    directory. Wrangler 4.101.0 read the emitted assets, reported the `ASSETS`
    binding, and exited due to `--dry-run`. `packages/server/src/build.test.ts`
    verifies `cloudflare().inspect()` emits the `cloudflare-tcp-database` warning
    and `cloudflare-unsupported-node-api` error; `packages/cli/src/index.kovo-build.test.ts`
    verifies the warning is printed by `kovo build` and the unsupported API blocks
    Cloudflare output.

### Phase 4 — Templates, docs, examples

- [x] `create-kovo` template ships a `kovo.config.ts` with a default `node` preset
  - commented Vercel/CF alternatives (and a note that those auto-detect); rewrite
    `templates/docs/deployment.md` around `kovo build` + native deploy.
  - Evidence: `packages/create-kovo/templates/kovo.config.ts` defaults to
    `node()` and comments `vercel()` / `cloudflare()` alternatives; `packages/
create-kovo/templates/docs/deployment.md` documents `npm run build:prod`,
    generated `dist/server`, Vercel Build Output API, and Cloudflare Wrangler
    flows. `corepack pnpm exec vitest --run packages/create-kovo/src/index.test.ts`
    verifies the scaffolded file list, package scripts, production serve path,
    static export path, and export diagnostics.
- [x] Port one example (commerce) to `kovo build` for its real prod serve; keep
      the per-session demo path (`SPEC.md` §9.5) as a separate concern.
  - Evidence: `examples/commerce/package.json` uses `kovo build ./src/app-shell.tsx
--preset node` for `build` / `serve:prod`, keeps `build:demo` and
    `serve:demo` for the hosted per-session demo path, and leaves
    `scripts/serve.mjs` as `serve:dev`. Verification: `corepack pnpm -C
examples/commerce run build`, then `HOST=127.0.0.1 PORT=64721 node
examples/commerce/dist/server/server.mjs`, followed by fetches of `/cart`
    (HTTP 200) and `/assets/<css>` (HTTP 200 with `public, max-age=31536000,
immutable`).
- [x] Update root `Dockerfile`/`cloudbuild.yaml` notes to point at preset output
      where appropriate (or scope them explicitly to the multi-tenant demo).
  - Evidence: `Dockerfile` and `cloudbuild.yaml` now scope the root Cloud Run image
    to hosted framework demos and direct app-author production deploys to
    `kovo build` preset artifacts (`dist/server`, `.vercel/output`, or
    `dist/cloudflare`).

### Phase 5 (deferred, not built here) — Isolate-edge

- [ ] `unenv`-based Node-builtin abstraction (`csrf.ts`/`csp.ts`/`node.ts`) instead
      of a hand WebCrypto rewrite; remove hard `node:` from the request path.
- [ ] HTTP DB driver abstraction (Hyperdrive/Neon/D1); `vercel` preset `edge`
      runtime + a true-isolate Cloudflare mode.

---

## Risks & open questions

- **Server bundling correctness.** User server modules can pull in native/ESM-only
  deps; the bundler must externalize what it can't bundle and the node preset must
  ship them. Validate against a real example, not a toy.
- **Drizzle/PGlite in the bundle.** PGlite (WASM) is demo-only; real apps use TCP
  Postgres. The node/vercel presets must not accidentally bundle PGlite's WASM for
  prod apps. Driver wiring stays app-owned (locked DB decision) but the bundler
  needs sane externals defaults.
- **`/c/` retention vs. content-hash deploys.** On Vercel/CF, immutable content
  hashing mostly gives retention for free, but a deploy that _removes_ an old hash
  breaks in-flight documents. Decide whether `inspect()` should hard-fail or warn.
- **Static auto-detection false negatives.** A route that is provably static today
  may flip to dynamic after edits; the build must re-derive policy each run and
  never serve a stale static page for a now-dynamic route.

## Proving commands (fill as phases land)

- Neutral build layout smoke: `corepack pnpm exec vitest --run
packages/server/src/build.test.ts packages/server/src/api/app.test.ts
scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs
site/scripts/api-ref.test.mjs`; `corepack pnpm exec tsc -p tsconfig.json
--noEmit --pretty false`; `corepack pnpm run check:exports`; `corepack pnpm
run check:imports`; `corepack pnpm run check:api-surface`; `corepack pnpm run
check:publish`; `git diff --check`.
- Neutral build prod-dep boot test: `corepack pnpm exec vitest --run
packages/cli/src/index.kovo-build.test.ts`; `corepack pnpm exec tsc -p
tsconfig.json --noEmit --pretty false`; `git diff --check`.
- Node preset emitted-server smoke: `corepack pnpm exec vitest --run
packages/server/src/build.test.ts`; `corepack pnpm exec tsc -p tsconfig.json
--noEmit --pretty false`; `corepack pnpm run check:exports`; `corepack pnpm run
check:api-surface`; `corepack pnpm exec vitest --run
scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs
site/scripts/api-ref.test.mjs`; `corepack pnpm run check:publish`;
  `git diff --check`.
- `kovo build` route/query/mutation smoke: `corepack pnpm exec vitest --run
packages/cli/src/index.kovo-build.test.ts packages/cli/src/commands-manifest.test.ts`;
  `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- `kovo build` + node preset container, pruned deps: _(Phase 1, still open)_
- `vercel build --prebuilt` dry-run + golden config: golden config/function/static
  coverage is in `corepack pnpm exec vitest --run packages/server/src/build.test.ts
packages/cli/src/index.kovo-build.test.ts`; Vercel CLI dry-run remains open.
- `wrangler deploy --dry-run` + `inspect()` diagnostics: _(Phase 3)_
- Example commerce served via the node preset (no Vite at runtime): _(Phase 4)_
