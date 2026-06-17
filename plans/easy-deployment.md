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
  `@kovojs/server`**, behind a build-time subpath — *not* shipped as `@kovojs/
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
  `/assets/*`, immutable client modules under `/c/*?v=…` that must persist across
  deploys (`SPEC.md` §6.6). Evidence: `examples/commerce/vite.config.ts`,
  `templates/docs/deployment.md`.

**The gap (what this plan builds):**

- [ ] **No self-contained production server.** Every "serve" path today is Vite
  `middlewareMode` from source — the Docker image even keeps dev deps on purpose.
  Evidence: `examples/commerce/scripts/serve.mjs` (`createViteServer`),
  `Dockerfile` ("the runtime is Vite SSR … we do NOT prune to production deps").
- [ ] **No app-author build command.** `kovo` CLI has `add/explain/check/audit/
  export/mcp` but no `build`. Evidence: `packages/cli/src/index.ts:123`.
- [ ] **No preset interface and no presets.** Nothing reads `kovo.config`
  `preset:` / detects the host / emits Vercel/Cloudflare/Node output. `kovo.config`
  currently only carries `packagePrefixes` / `mergeClientModules` (`SPEC.md` §5.2,
  §6.1.1).
- [ ] **Server-module bundling for serverless is unaddressed.** Client asset
  bundling is solved; bundling the *server* entry (app-shell + user server
  modules + deps) into one deployable function/worker is not.

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

Design rule: the neutral build's `handler.mjs` is the *only* runtime contract.
Every preset is "wrap this `Request → Response` handler + place these static
files." This keeps the per-platform code tiny and the portability guarantee honest.

### 2. The preset interface (built into `@kovojs/server`, not a separate package)

Following Nitro: presets are **thin build-time descriptors that live in the engine**
(`@kovojs/server`, behind a build-time subpath such as `@kovojs/server/build`),
*not* `@kovojs/adapter-*` packages. The same package already houses build-time-only
code (static export, the Vite build pipeline, the node adapter) behind subpaths the
runtime handler never imports, so presets add no weight to the production bundle.
There is **no `@kovojs/adapters` package and no `adapter-kit`** — shared types and
helpers fold into the same subpath.

```ts
// @kovojs/server/build  (build-time only)
export interface KovoPreset {
  name: string;                       // 'node' | 'vercel' | 'cloudflare'
  /** Validate target constraints against the neutral build before emit. */
  inspect?(build: NeutralBuild): PresetDiagnostic[];
  /** Transform dist/.kovo into platform-native output. */
  emit(build: NeutralBuild, ctx: PresetContext): Promise<void>;
}

export interface PresetContext {
  outDir: string;                     // platform-conventional location
  log: (msg: string) => void;
  readNeutral: () => NeutralBuild;    // server bundle, client assets, manifests
  declaredEnv: string[];              // always includes 'DATABASE_URL' if data plane present
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

- [ ] **`node`** → `dist/server/` standalone: a Node entry that
  `toNodeHandler(handler)` behind `node:http`, serves `client/assets` + `client/c`
  with correct cache headers, honors `PORT`/`HOST`, plus a generated `Dockerfile`
  (prod deps only — the key improvement over today's dev-dep image) and an
  optional `systemd` unit. Covers VPS, Fly, Railway, Render.
- [ ] **`vercel`** → Vercel **Build Output API v3** (`.vercel/output/`): a Node
  serverless function wrapping `handler.mjs`, static assets as `output/static/*`
  with immutable cache config, `config.json` routing. `vercel deploy --prebuilt`.
  (`runtime: 'nodejs'` only in v1; `edge` reserved.)
- [ ] **`cloudflare`** → a Worker entry (`export default { fetch }`) delegating to
  `handler.mjs` under `compatibility_flags = ["nodejs_compat"]`, static assets via
  Workers Assets/`[site]`, generated `wrangler.toml`. `inspect()` warns when the
  data plane needs TCP (recommend Hyperdrive/Containers). `wrangler deploy`.

### 4. Cross-cutting contracts

- [ ] **Static-or-dynamic auto-detection.** `routes.json` carries each route's
  export policy (already computed for static export, `SPEC.md` §9.5/KV229). If
  *all* routes are L0/L1-exportable, the neutral build also emits a fully static
  tree and presets prefer static output (Vercel static, CF Pages/Assets, plain
  Nginx) — no server function needed. Mixed apps get both: static where provable,
  the function for the rest.
- [ ] **Immutable `/c/` retention across deploys (`SPEC.md` §6.6).** Versioned
  client-module URLs must survive deploys until referencing documents age out.
  Each preset documents/implements "don't overwrite, accrete": e.g. the node preset
  serves a retained `c/` dir; Vercel/CF rely on content-hash immutability +
  guidance to not purge old versions. This is a real correctness constraint, not a
  nicety — surfaced in preset docs and `inspect()` warnings.
- [ ] **Env & origin.** Convention: `PORT`, `HOST`, `NODE_ENV`, and `DATABASE_URL`
  (only env Kovo names for the data plane). Origin/proto already handled via
  `Host`/`x-forwarded-proto` in `node.ts`; presets set `origin` appropriately for
  proxied platforms. Secrets beyond `DATABASE_URL` are pass-through env, undocumented
  by Kovo per the locked DB decision.
- [ ] **Edge-readiness audit (deferred, tracked).** Catalogue every `node:`
  import on the request path (`node:crypto` in `csrf.ts`/`csp.ts`, `node:stream`
  in `node.ts`) so the Phase 5 isolate-edge work has a scoped worklist. The likely
  mechanism is **`unenv`** (Nitro's approach: swap Node built-ins for
  runtime-appropriate implementations at build time) rather than a hand WebCrypto
  rewrite. Audit only in this plan; no refactor.

---

## Phased checklist

### Phase 0 — Neutral build + `kovo build` skeleton
- [ ] Promote `createKovoAppShellViteBuild*` from `@internal` to a supported
  build entry; define `NeutralBuild` shape and write `dist/.kovo/` layout.
- [ ] Add server-bundle step: `src/app-shell.ts` → `server/handler.mjs`
  (`Request → Response`), no Vite at runtime. Verify a bundled handler serves a
  route + a `/_m/` mutation + a `/c/` module with **zero dev deps installed**.
- [ ] Wire `kovo build` into `packages/cli` (a thin wrapper, exactly like
  `kovo export` over `exportStaticApp`); it reads `kovo.config.ts` + host env,
  runs client build → server bundle → neutral emit → preset.
- [ ] Evidence target: a test that boots `server/handler.mjs` in a clean
  `node_modules` (prod deps only) and asserts route/mutation/asset responses.

### Phase 1 — Preset interface + `node` preset (in `@kovojs/server/build`)
- [ ] `KovoPreset` / `PresetContext` types + the build-time subpath export on
  `@kovojs/server`; preset **selection** (host auto-detect → `KOVO_PRESET` →
  `kovo.config` `preset:`). No separate package.
- [ ] `node` preset: standalone server + asset serving + cache headers + prod-only
  `Dockerfile`. Replace the example/demo Vite-from-source serve story with this as
  the recommended prod path (keep Vite serve for dev only).
- [ ] Evidence: container builds with pruned prod deps; `curl` of a route, a
  `/assets/*` (immutable cache header), and a `/_m/` mutation succeed.

### Phase 2 — `vercel` preset
- [ ] Emit `.vercel/output/` (Build Output API v3): Node function + static.
- [ ] Auto-detect on `VERCEL` env; static-only apps emit pure static (no function).
- [ ] Evidence: `vercel build`/`--prebuilt` dry-run validates the output dir;
  golden-file test on `config.json` + function manifest.

### Phase 3 — `cloudflare` preset
- [ ] Worker entry + `wrangler.toml` with `nodejs_compat`; Workers Assets for
  static; `inspect()` TCP-DB warning + Containers/Hyperdrive guidance.
- [ ] Auto-detect on `CF_PAGES` env.
- [ ] Evidence: `wrangler deploy --dry-run` validates; `inspect()` unit tests for
  the banned-API and DB-driver diagnostics.

### Phase 4 — Templates, docs, examples
- [ ] `create-kovo` template ships a `kovo.config.ts` with a default `node` preset
  + commented Vercel/CF alternatives (and a note that those auto-detect); rewrite
  `templates/docs/deployment.md` around `kovo build` + native deploy.
- [ ] Port one example (commerce) to `kovo build` for its real prod serve; keep
  the per-session demo path (`SPEC.md` §9.5) as a separate concern.
- [ ] Update root `Dockerfile`/`cloudbuild.yaml` notes to point at preset output
  where appropriate (or scope them explicitly to the multi-tenant demo).

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
  hashing mostly gives retention for free, but a deploy that *removes* an old hash
  breaks in-flight documents. Decide whether `inspect()` should hard-fail or warn.
- **Static auto-detection false negatives.** A route that is provably static today
  may flip to dynamic after edits; the build must re-derive policy each run and
  never serve a stale static page for a now-dynamic route.

## Proving commands (fill as phases land)

- Neutral build prod-dep boot test: _(Phase 0)_
- `kovo build` + node preset container, pruned deps: _(Phase 1)_
- `vercel build --prebuilt` dry-run + golden config: _(Phase 2)_
- `wrangler deploy --dry-run` + `inspect()` diagnostics: _(Phase 3)_
- Example commerce served via the node preset (no Vite at runtime): _(Phase 4)_
