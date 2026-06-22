# Icons — `@kovojs/icons`, the lucide-react equivalent for Kovo

**Goal:** Ship a first-party, tree-shakeable icon library — `@kovojs/icons` — that is to Kovo what
`lucide-react` is to React: the full Lucide glyph set, one component per icon, imported per-subpath
(`import { ArrowRight } from '@kovojs/icons/arrow-right'`), authored as native Kovo server-rendered
SVG. v1 generates the **entire Lucide set (1737 icons)** from a committed generator and ships as an
**installable library** (no copy-in registry) exposing a **StyleX `style`-channel API** (no `size`
prop).

**Status: DELIVERED (package) — purely additive.** The icons package is complete and fully gated
(see Checklist + Latest verification). Consumer migration of the repo's existing inline SVGs is
**deferred** with reasons (§7).

**Locked decisions (user, 2026-06-21):** full Lucide set (ISC), generated; installable library only;
`style`/StyleInput API (no `size` prop); migrate existing inline SVGs.

**Branch / worktree:** `agent/icons` (worktree `../kovo-icons`), merged to `main`.

---

## Architecture facts that shaped the design (verified)

- **SVG is plain host markup**; attributes emit **VERBATIM** (kebab, not React camelCase) —
  `packages/compiler/src/scan/parse.ts:1312`, `packages/server/src/jsx-runtime.ts:216` (SPEC §4.2).
- **Styling channel is `class`**, merged per SPEC §4.6 (class concatenates; scalars author-wins).
- **No React `ref`/`forwardRef`** (SPEC §4.5) — target via `id`/`class`/`data-*`.
- **Icons render synchronously as plain function components.** The `@kovojs/server` JSX runtime calls a
  function component directly (`type(props)`, `jsx-runtime.ts:106`), so a host `<svg>` renders to a
  string inline. A `component({ render })` wrapper renders **asynchronously** (`renderKovoComponent` →
  Promise) and yields `[object Promise]` when embedded in another component's synchronous render
  output (e.g. `@kovojs/ui` composes via `render(...) + ...`). Function components avoid this and need
  no `@kovojs/core`. (This was found and fixed during command-consumption testing.)
- **`JSX.IntrinsicElements` is untyped for SVG** (`jsx-runtime.ts:820`) ⇒ the package defines its own
  `IconProps`.
- **No `kovo.prefix`** needed (KV234/§6.1.1 only binds behavior-attribute primitives; icons are inert).

## Gate mechanics (verified against the scripts)

- **Manifest union** (`scripts/public-packages.test.mjs:42,116`): every `packages/*` dir classified
  once; `apiBoundary.public ∪ generated ∪ internal` == `exports` keys. The generator writes `exports`
  and `apiBoundary.public` in lockstep ⇒ passes by construction. `private` must be false.
- **api-surface** (`scripts/api-surface-gate.mjs`): a public export is a violation only if it lacks a
  JSDoc summary; `@internal`/`@generated` are hard failures. Every icon has a JSDoc ⇒ **0 new**
  baseline entries.
- **Duplicate-symbol gate is PER-PACKAGE** (`scripts/exported-symbols.mjs:131`) ⇒ bare PascalCase
  names (`Search`, `Badge`, `Table`) are safe even though `@kovojs/ui` also exports `Badge`/`Table`.
- **Publish** (`scripts/build-publish.mjs`): never hand-write `publishConfig`/`build:dist` — run
  `node scripts/build-publish.mjs --write` (then `vp fmt` the package.json, which oxfmt key-orders).

---

## 1. Package layout

```
scripts/build-icons.mjs   # the generator (repo-level, alongside build-publish.mjs; source of truth, §2)
packages/icons/
  package.json            # @kovojs/icons, type:module, files:[dist]; deps @kovojs/server + @kovojs/style
  NOTICE                  # Lucide ISC attribution (icons derived from Lucide)
  README.md
  tsconfig.json           # extends ../../tsconfig.json
  src/
    index.tsx             # `export type { IconProps } from './icon-base.js'` — root `.`, no glyphs (mirrors @kovojs/ui)
    icon-base.ts          # IconProps + iconRootAttrs() merge + a11y/forward logic (internal, NOT a subpath)
    icons.test.ts         # determinism + render/a11y/style assertions (§5)
    <icon>.tsx            # 1737 generated function components, one per Lucide glyph (committed source)
```

- Per-icon **subpath** = kebab Lucide name (`@kovojs/icons/arrow-right`); **symbol** = bare PascalCase
  (`ArrowRight`). Root `.` exports only the `IconProps` type — no barrel, inherent tree-shaking.
- Deps: `@kovojs/server` (JSX runtime) + `@kovojs/style` (`StyleInput`), `workspace:*`. **No**
  `@kovojs/core` (function components don't use `component()`), **no** `@kovojs/headless-ui`.
- `lucide-static@1.21.0` is a **pinned devDependency** (generator input only); generated `.tsx` are
  self-contained and committed ⇒ **no runtime Lucide dependency**.

## 2. The generator — `scripts/build-icons.mjs`

Deterministic (no `Date.now`/random). It:

1. Reads every glyph from the pinned `lucide-static` `icon-nodes.json`
   (`{ "<name>": [["<tag>", {attrs}], ...] }`), extracting each glyph's child elements.
2. Emits one `src/<kebab>.tsx` per icon as a synchronous function component:

   ```tsx
   /** @jsxImportSource @kovojs/server */
   import { iconRootAttrs, type IconProps } from './icon-base.js';

   /** Arrow Right icon (Lucide). https://lucide.dev/icons/arrow-right */
   export function ArrowRight(props: IconProps = {}): string {
     return (
       <svg {...iconRootAttrs(props)}>
         <path d="M5 12h14"></path>
         <path d="m12 5 7 7-7 7"></path>
       </svg>
     );
   }
   ```

   Child SVG attrs are emitted verbatim (kebab); self-closing children become paired tags at render
   (`<path></path>`), byte-identical under the render-equivalence gate (SPEC §5.2.2).

3. Rewrites `package.json` `exports` (`.` + every `./<icon>`) and the `@kovojs/icons`
   `public-packages.json` `apiBoundary.public` in lockstep.
4. **Name sanitation:** kebab→PascalCase (`a-arrow-down`→`AArrowDown`, `arrow-down-0-1`→`ArrowDown01`);
   `Icon`-prefix if a name would start with a digit; throws on symbol collision. Canonical Lucide
   names only (deprecated aliases skipped — a possible follow-up).

`--check` parses arrays (formatting-insensitive) and exits 1 on any drift. The generator
re-serializes `public-packages.json`/`package.json` with `JSON.stringify`, so after running it (and
`node scripts/build-publish.mjs --write`) run `vp fmt packages/icons/package.json public-packages.json`
to restore oxfmt's inline short-arrays.

## 3. `IconProps` & authoring contract (`src/icon-base.ts`)

- `IconProps` (public, documented, exported from root `.`): `style?: style.StyleInput` for
  sizing/coloring (no `size` prop), `class?`, `id?`, `title?`, `role?`, and pass-through
  `aria-*`/`data-*`.
- Default root attrs (Lucide parity): `width=24 height=24 viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width=2 stroke-linecap/linejoin="round"`. Color via `currentColor`;
  resize via `style` (StyleX CSS width/height overrides the default attrs).
- `iconRootAttrs(props)` merge order (SPEC §4.6 author-last): defaults → a11y → `style.attrs(style)` →
  forwarded `aria-*`/`data-*`/`id`/`role`/`title` → concatenated `class`.
- **a11y default = decorative** (`aria-hidden="true" focusable="false"`); an `aria-label`/`title`/`role`
  promotes to `role="img"` and drops `aria-hidden`.

## 4. Manifest & publish wiring

`public-packages.json`: `@kovojs/icons` `{ dir:"icons", visibility:"public", kind:"library",
apiBoundary:{ public:[".", …1737 subpaths], generated:[], internal:[] } }`, no `apiRef` (mirrors
`@kovojs/ui`). `package.json` mirrors `@kovojs/ui`: `version 0.1.1` (lockstep), `private` false, no
`kovo` block; `publishConfig`/`build:dist`/`prepack` generated by `build-publish.mjs`.

## 5. Tests (`packages/icons/src/icons.test.ts`) — 6 passing

- [x] **Determinism** — `node scripts/build-icons.mjs --check` → `1737 icon(s) up to date`.
- [x] **Render** — `ArrowRight({})` emits `<svg … viewBox="0 0 24 24" fill="none" stroke="currentColor"
stroke-width="2" width="24" …><path d="M5 12h14"></path>…` (verbatim kebab).
- [x] **a11y default** — decorative carries `aria-hidden="true" focusable="false"`; `aria-label` flips
      to `role="img"` and drops `aria-hidden`/`focusable`.
- [x] **Style channel** — `style.attrs` class applies and an extra `class` concatenates (SPEC §4.6);
      `id`/`data-*` forward; an explicit `role` is author-wins.

## 6. Showcase / a11y

Decorative `aria-hidden` icons are trivially axe-clean; the render test asserts the decorative and
`role="img"` outputs. A dedicated gallery/site demo page is **deferred** with the consumer migration
(§7) to keep this PR additive (it would touch an app's compile path).

## 7. Consumer migration of existing inline SVGs — DEFERRED (with reasons)

The repo has ~5 inline SVGs. On inspection only **two** are faithful Lucide copies, and migrating
them entangles this additive PR with unrelated debt, so v1 ships the library standalone:

- [ ] **`@kovojs/ui/command`** (`command.tsx:437`, search → `@kovojs/icons/search`). Faithful and
      **verified working** (rendered the `@kovojs/icons` Search inline, sized via `inputIcon`, decorative).
      Deferred because: (a) `@kovojs/ui`'s StyleX snapshot suite is **pervasively pre-existing-red on
      `main`** (16 failures across 9 files incl. `field`/`accordion`/`slider`/`tooltip` — confirmed via
      HEAD baseline, no icons involvement), so regenerating `command.stylex` would fold this PR into
      that unrelated debt; (b) it requires extending `@kovojs/ui`'s copy-in registry allowlist
      (`build-registry.mjs` + `copy-in.test.ts`). Both belong in a focused `@kovojs/ui` change.
- [ ] **`site` chrome** (`chrome.tsx:40-41`): `SOURCE_ICON` is exactly Lucide `code` (faithful);
      `THEME_ICON` is a bespoke combined-path sun (not Lucide-identical). Deferred to avoid the
      app-compiler path + a visible docs-site restyle in a v1 icons PR.
- [ ] **`devtool`** (`render.mjs:218`): **infeasible** — `render.mjs` is plain `.mjs` run under node
      (MCP server), and `@kovojs/icons/*` resolves to `.tsx` source, which node can't load without a
      TSX runtime.
- [ ] **`examples/stackoverflow`** (`chrome.tsx:469`): `searchIcon` is StackOverflow's own **filled**
      brand glyph (single path, `fill=currentColor`, 18×18), not Lucide — same rationale that keeps the
      SO brand logo inline.

## 8. Risks / notes

- **1738 build entries**: `build:dist` is a ~35 KB `vp pack … --dts` (under macOS ARG_MAX); built 1738
  entries → 6954 dist files in 7.5 s. Runs only at `prepack`/publish.
- **vitest startup is slow** (~40 s) for the 1737-file package — vite project scan, not test time
  (tests run in <0.2 s). Watch CI wall-clock; not a correctness issue.
- **Large generated diff**: review the generator, not the 1737-line output.

---

## Checklist

- [x] **Scaffold** `packages/icons/` (package.json, NOTICE, tsconfig, index.tsx, icon-base.ts, README).
- [x] **Generator** `scripts/build-icons.mjs` → 1737 function-component `src/*.tsx` + `exports` +
      manifest, in lockstep. Deterministic (`--check`).
- [x] **Publish wiring** — `build-publish.mjs --write` → `publishConfig`/`build:dist`/`prepack`;
      `vp pack` built 1738 entries → dist.
- [x] **Tests** (§5) — 6 passed.
- [ ] **Consumer migration** (§7) — DEFERRED with documented reasons (faithful only: command + site
      `code`; devtool infeasible; SO/site-sun bespoke; `@kovojs/ui` snapshots pre-existing-red).
- [ ] **Showcase app page** (§6) — DEFERRED with migration; covered by render tests for v1.

## Latest verification (worktree `../kovo-icons`, all green)

- `tsc --noEmit -p packages/icons/tsconfig.json` — 1737 files typecheck clean (2.4s, tsgo).
- `vp fmt --list-different packages/icons` — clean (generated files + package.json formatter-conformant).
- `node scripts/build-icons.mjs --check` — `1737 icon(s) up to date`.
- `pnpm run check:exports` — no duplicate public symbols.
- `pnpm run check:api-surface` — `needing-attention=1338 (baseline=1338, fixed-this-run=0)` → **0 new**.
- `pnpm exec vitest --run scripts/public-packages.test.mjs` — 11 passed.
- `pnpm --filter @kovojs/icons exec vitest --run src/icons.test.ts` — 6 passed.
- `pnpm --filter @kovojs/icons run build:dist` — 1738 entries → 6954 dist files.
