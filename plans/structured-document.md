# Structured Document API

**Date:** 2026-06-24

**Status:** Completed implementation ledger.

**Goal:** replace the raw string-returning `DocumentTemplate` app authoring surface with a
structured, TSX-native document API. Kovo should continue to own the full document frame, required
framework parts, CSP accounting, query scripts, loader placement, deferred stream framing, and
output-safety rules, while apps author only approved document contributions.

**Normative anchors:** `SPEC.md` §4.8 output safety and trusted HTML escape hatch, §5.2 hard rules
7/8/10, §9.1 wire/script-data encoding, §9.5 document shell assembly, `rules/compiler-hard-rules.md`,
`rules/api-surface.md`, `plans/no-raw-strings.md`, and `plans/sources-sinks.md`.

## Context

Kovo's ordinary app authoring posture is TSX-first and safe-by-default. Component output contexts
already reject plain strings in unsafe raw-HTML sinks with KV236 unless the author explicitly uses
`trustedHtml(...)`. Route/page/layout raw string markup has already been narrowed by
`plans/no-raw-strings.md`.

Before this plan, the remaining document-shell exception was `DocumentTemplate`:

- [x] Confirm the former public template type returned an arbitrary string.
  - Evidence: prior `packages/server/src/document-core.ts` exposed
    `DocumentTemplate = (context: DocumentTemplateContext) => string`; the current file no longer
    exports that type.
- [x] Confirm former framework assembly verified required parts but not template-authored string
      safety.
  - Evidence: the template/enforcement path was removed from `packages/server/src/document-core.ts`;
    structured assembly now owns required shell parts directly.
- [x] Confirm the docs site no longer uses the raw string surface.
  - Evidence: `site/src/document-template.tsx` exports a structured `<Document>` declaration.
- [x] Confirm the docs site no longer relies on app-authored internal framework imports.
  - Evidence: `site/src/document-template.tsx` imports public document primitives from
    `@kovojs/server`.
- [x] Confirm the explicit prior plan left `DocumentTemplate` as the remaining exception.
  - Evidence: `plans/no-raw-strings.md` records `@kovojs/server#DocumentTemplate` as an explicit
    low-level raw-markup exception and recommends revisiting it only with product direction.

## External Reference

Next.js is useful prior art but not a contract for Kovo:

- In the Pages Router, `pages/_document.tsx` returns JSX using framework-owned primitives:
  `Html`, `Head`, `Main`, and `NextScript`. Next documents those primitives as required for proper
  rendering, and `_document` is server-only.
- In the App Router, the root layout is natural JSX (`<html><body>{children}</body></html>`), while
  metadata is usually declared through structured `metadata` / `generateMetadata` exports that
  generate head tags.
- Scripts use a dedicated `next/script` component with explicit loading strategies, and Next has
  diagnostics for common misuse such as raw `<script>` in `next/head` or inline scripts missing an
  identifier.

Kovo should borrow the shape: TSX-native document authoring and dedicated primitives for scripts,
preloads, metadata, and shell additions. Kovo should not inherit the weaker parts of the React/Next
escape-hatch model where arbitrary raw HTML remains easy to hide.

Reference docs:

- Next custom document: `https://nextjs.org/docs/pages/building-your-application/routing/custom-document`
- Next metadata: `https://nextjs.org/docs/app/getting-started/metadata-and-og-images`
- Next script component: `https://nextjs.org/docs/app/api-reference/components/script`

## Product Direction

The desired authoring shape should feel like an app shell, not a low-level serializer:

```tsx
createApp({
  document: (
    <Document lang="en">
      <Head>
        <FontPreload href="/fonts/inter-latin-wght-normal.woff2" />
        <InlineScript id="theme" run="beforePaint">
          {themeScript}
        </InlineScript>
      </Head>

      <BodyEnd>
        <SearchDialog />
      </BodyEnd>
    </Document>
  ),
});
```

This is a declarative configuration surface, not an arbitrary replacement for the route document.
Kovo must still inject and order the framework-owned parts: doctype, `<html>`, required meta,
build/session meta, page hints, query scripts, loader, route body, deferred shell close, CSP hashes,
and any render-plan/version metadata.

## Design Principles

- [x] Preserve Kovo ownership of required document structure.
  - Required outcome: app code cannot omit `parts.head`, query scripts, loader, build/session meta,
    route body, deferred close tags, or hydration contracts by forgetting to include a placeholder.
  - Evidence: `packages/server/src/document-core.ts` keeps doctype/html/head/body/query/loader/defer
    assembly framework-owned, and `packages/server/src/document.test.ts` proves structured documents
    still include loader, query scripts, route body, and deferred close.
- [x] Keep document authoring TSX-native.
  - Required outcome: document additions are authored as TSX/JSX values or typed helper values, not
    as full-document string concatenation.
  - Evidence: `site/src/document-template.tsx` now exports `<Document>...</Document>` instead of a
    string-returning `DocumentTemplate`; `pnpm --filter @kovojs/site run build` passed.
- [x] Make unsafe document contributions explicit and auditable.
  - Required outcome: inline scripts, inline styles, raw HTML, unusual URL sinks, and shell-level
    escape hatches are surfaced through named helpers and enrolled in `kovo explain --trust`.
  - Evidence: `packages/server/src/document-structured.ts` exposes `InlineScript`, `InlineStyle`,
    and URL-checked link primitives; `packages/core/src/internal/source-sink-registry.ts` records the
    document shell output sink; no raw document HTML escape hatch was added.
- [x] Avoid a generic "slot soup" API.
  - Required outcome: common needs such as fonts, meta tags, scripts, body-end UI, and shell
    attributes have first-class primitives; authors should not need to think in raw insertion
    offsets for normal work.
  - Evidence: `packages/server/src/document-structured.ts` exports first-class document primitives;
    `packages/server/src/api/app.test.ts` asserts the public API surface.
- [x] Keep partial/deferred documents byte-compatible with full documents.
  - Required outcome: deferred streams use the same structured document model and cannot drift from
    ordinary document assembly.
  - Evidence: `packages/server/src/document.test.ts` verifies structured `BodyEnd` is emitted in
    the deferred close frame after deferred fragments and before `</body>`.
- [x] Make migration honest.
  - Required outcome: `DocumentTemplate` is removed before v1; app document customization uses
    structured primitives rather than a silent compatibility template.
  - Evidence: `packages/server/src/app-types.ts` no longer exposes `template`, `packages/server/src/api/rendering.ts`
    no longer exports template types, and `site/content/guides/request-shell.md` documents structured
    documents as the only app authoring path.

## Proposed Public API Shape

- [x] Add a structured `document` option to `createApp()`.
  - Candidate:
    `document: DocumentConfig | ((context: DocumentAuthoringContext) => DocumentConfig)`.
  - `DocumentConfig` is produced by `<Document>...</Document>` or a non-JSX object form for callers
    that do not use TSX.
  - Evidence: `packages/server/src/app-types.ts` accepts `DocumentDeclaration` and
    `packages/server/src/app.ts` normalizes it into app document options; `pnpm run check:api-surface`
    passed.
- [x] Add document primitives under a documented public entrypoint.
  - Candidate exports: `Document`, `Head`, `BodyStart`, `BodyEnd`, `HtmlAttrs`, `BodyAttrs`,
    `Meta`, `Link`, `Stylesheet`, `FontPreload`, `ModulePreload`, `InlineScript`, `InlineStyle`.
  - Evidence: `packages/server/src/api/rendering.ts` and `packages/server/src/index.ts` export the
    structured primitives and public document types; `packages/server/src/api/app.test.ts` asserts
    the public barrel.
- [x] Make `<Document>` a declaration boundary, not a normal component.
  - Required outcome: it can collect document facts, but it cannot render arbitrary children around
    the route body or replace Kovo-owned shell parts.
  - Evidence: `packages/server/src/document.test.ts` rejects unsupported `<Document>` children and
    proves app code contributes facts, not route-body placeholders.
- [x] Define natural placement semantics.
  - `Head` contributes app-wide head nodes.
  - `BodyStart` contributes immediately after `<body>`.
  - `BodyEnd` contributes after the route body and before `</body>`.
  - `HtmlAttrs` and `BodyAttrs` expose a constrained attribute allowlist.
  - Evidence: `packages/server/src/document.test.ts` verifies `Head`, `BodyStart`, `BodyEnd`,
    `HtmlAttrs`, and `BodyAttrs` placement in full and deferred documents.
- [x] Define request-aware context carefully.
  - Decision: keep the initial `DocumentAuthoringContext` request-independent and exclude raw
    `parts.head`, `parts.body`, `parts.queryScripts`, and internal rendered strings from public app
    authoring.
  - Evidence: `packages/server/src/document-structured.ts` exposes `DocumentAuthoringContext` but
    `packages/server/src/app.ts` resolves declarations without request/rendered shell parts.

## Safety Model

- [x] Route all document child text through the same escaping model as server JSX.
  - Plain strings inside structured document primitives are text unless a primitive explicitly
    consumes code, CSS, or trusted markup.
  - Evidence: `packages/server/src/document.test.ts` proves plain body-start/body-end strings escape
    as text instead of markup.
- [x] Make inline scripts a typed sink.
  - `InlineScript` requires a stable `id`, a loading/execution posture such as `beforePaint` /
    `afterInteractive`, and CSP hash/nonce enrollment.
  - Plain inline script strings are allowed only through this primitive, not arbitrary `<script>`
    element text in document TSX.
  - Evidence: `packages/server/src/document-structured.ts` implements `InlineScript`, rejects missing
    IDs and non-primitive `Head` children, and `packages/server/src/document.test.ts` verifies CSP hash
    enrollment.
- [x] Make inline styles a typed sink.
  - `InlineStyle` requires source metadata and CSP enrollment; dynamic values must be compiler-owned
    or explicitly trusted.
  - Evidence: `packages/server/src/document-structured.ts` implements `InlineStyle` with required
    source metadata; `packages/server/src/document.test.ts` verifies CSP style hashes.
- [x] Enforce URL-bearing attributes through the existing URL-scheme allowlist.
  - Applies to `Link`, `FontPreload`, `ModulePreload`, `Stylesheet`, metadata image URLs, and any
    constrained shell attributes that can carry URLs.
  - Evidence: `packages/server/src/document.test.ts` verifies `FontPreload` rejects
    `javascript:` URLs; source/sink inventory records the document URL sink.
- [x] Enroll raw HTML escape hatches in `kovo explain --trust`.
  - Decision: omit a raw document-HTML escape hatch from this API. Plain `string` document children
    are escaped text in body placements and rejected in `Head`/`Document` structure.
  - Evidence: `packages/server/src/document.test.ts` proves body strings are escaped, rejects raw
    `<script>`/raw `<Document>` children, and `rg -n "UnsafeDocumentHtml|DocumentTemplate" packages/server/src`
    finds no raw document escape surface.
- [x] Forbid app-authored imports from internal document helpers.
  - `escapeAttribute` and other HTML internals stay internal/generated-only; structured primitives
    should remove the need for app authors to import them.
  - Evidence: `site/src/document-template.tsx` imports only public `@kovojs/server` primitives and
    `pnpm run check:imports` passed.

## Compiler And Runtime Work

- [x] Extend the parser/model to recognize structured document declarations.
  - Decision: no compiler-only syntax was introduced; structured document declarations are ordinary
    TSX/runtime declarations that produce branded `DocumentConfig` facts.
  - Evidence: `packages/server/src/document-structured.ts` owns the typed fact model, and
    `pnpm --filter @kovojs/site run build` plus the structured document integration spec verify
    app-authored TSX declarations flow through the build/runtime path.
- [x] Add server document assembly support for structured document facts.
  - Keep existing `assembleDocumentParts(...)` as the owner of framework parts, but consume app
    additions from a typed model.
  - Evidence: `packages/server/src/document-core.ts` merges structured document head/body facts into
    default document assembly without exposing `parts.*` to app code.
- [x] Add deferred document assembly support.
  - The structured API must support `renderDeferredDocument(...)` without requiring string slicing
    around `</body>`.
  - Evidence: `packages/server/src/document-core.ts` emits structured `BodyEnd` in the deferred close
    frame; `packages/server/src/document.test.ts` verifies deferred placement.
- [x] Add CSP integration.
  - Inline script/style primitives must merge their hashes/nonces with existing loader/query/defer
    CSP metadata.
  - Evidence: `packages/server/src/document.test.ts` verifies structured script/style CSP hashes are
    present alongside loader/query/defer CSP metadata.
- [x] Add diagnostics for invalid document structure.
  - Examples: duplicate `<Document>`, unknown child under `<Document>`, raw `<script>` text outside
    `InlineScript`, direct `dangerouslySetInnerHTML`, unsafe URL, unsupported shell attribute,
    missing inline script `id`, or request-derived dynamic code in an inline script.
  - Evidence: `packages/server/src/document.test.ts` covers teaching errors for missing inline script
    IDs, unsafe font preload URLs, unsupported shell attributes, raw `<script>` under `Head`, and raw
    document children.
- [x] Add public/import-boundary diagnostics.
  - App-authored `@kovojs/server/internal/*`, `@kovojs/*/generated`, and app-local generated imports
    remain invalid per `SPEC.md` §5.2 rule 8.
  - Evidence: `pnpm run check:imports` passed after the site migrated off internal document helpers.
- [x] Add `kovo explain document`.
  - Output should show document contributions, their source files, placement, CSP entries,
    script/style trust posture, and raw/trusted escape hatches.
  - Evidence: `packages/cli/src/graph-output.ts` adds `kovo explain document`, backed by the
    document source/sink row and document-owned trust escapes; `pnpm exec vitest --run
packages/cli/src/index.kovo-explain.test.ts packages/cli/src/commands-manifest.test.ts` passed.

## Migration Work

- [x] Migrate the docs site from `site/src/document-template.ts` to the structured API.
  - Convert font preloads to `FontPreload`.
  - Convert the theme, search-hotkey, and API-nav inline scripts to `InlineScript`.
  - Convert the search dialog from raw string HTML to TSX.
  - Remove the app-authored import from `@kovojs/server/internal/html`.
  - Evidence: `site/src/document-template.tsx` now uses `Document`, `Head`, `FontPreload`,
    `InlineScript`, and `BodyEnd`; `pnpm --filter @kovojs/site run build` passed.
- [x] Decide the compatibility posture for existing `DocumentTemplate`.
  - Decision: remove before v1; do not keep a compatibility escape under the old name.
  - Evidence: `packages/server/src/document-core.ts`, `packages/server/src/app-types.ts`, and the
    public barrels no longer contain `DocumentTemplate`; `packages/server/src/app-guards.ts` rejects
    app aggregates with a `document.template` property.
- [x] Update docs and examples.
  - Replace raw document template examples with structured document examples.
  - State that `document.template` is unsupported and structured document primitives are the
    migration path.
  - Evidence: `site/content/guides/request-shell.md` documents a structured document example and
    states that `document.template` is not an app authoring surface.
- [x] Update `plans/no-raw-strings.md` or archive note when the exception is closed.
  - The old plan currently records `DocumentTemplate` as the explicit remaining exception.
  - Evidence: `plans/no-raw-strings.md` records the exception as closed and directs future document
    escape hatches to named, audited trust boundaries.

## Verification Plan

- [x] Add type-level tests rejecting raw string full-document templates in app-authored source.
  - Evidence: `packages/server/src/api/app.test.ts` has an `@ts-expect-error` regression for
    `createApp({ document: { template } })`; `vp check --fix` and `pnpm run check` passed.
- [x] Add compiler tests for structured document lowering and diagnostics.
  - Decision: no compiler-only lowering was added; structured documents are TSX/runtime config.
    Build/integration coverage is the relevant verification for this shape.
  - Evidence: `pnpm --filter @kovojs/site run build` compiled the docs site's structured document
    declaration, and the Playwright structured-document-shell spec passed against a TSX fixture.
- [x] Add server tests proving required framework parts cannot be omitted.
  - Evidence: `packages/server/src/document.test.ts` verifies structured documents keep loader, query
    scripts, route body, body-start/body-end contributions, and framework-owned head/body framing.
- [x] Add deferred document tests proving full/deferred shell parity.
  - Evidence: `packages/server/src/document.test.ts` verifies structured `BodyEnd` is emitted in the
    deferred close frame after streamed fragments.
- [x] Add CSP tests proving inline document scripts/styles are hashed or nonce-enrolled.
  - Evidence: `packages/server/src/document.test.ts` verifies `InlineScript` and `InlineStyle` hashes
    are present in `document.csp` and emitted hash attributes.
- [x] Add source/sink tests proving document-level raw HTML/script/style/URL sinks are inventoried.
  - Evidence: `packages/core/src/internal/source-sink-registry.ts` includes `document.shell.output`
    and `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts` passed.
- [x] Add import-boundary tests proving app-authored internal document helper imports fail.
  - Evidence: `pnpm run check:imports` passed after `site/src/document-template.tsx` migrated to
    public `@kovojs/server` document primitives only.
- [x] Add site build/static export tests after migrating the docs site.
  - Evidence: `pnpm --filter @kovojs/site run build` passed with `html=107` and `diagnostics=0`.
- [x] Add `git diff --check` and relevant public API gates before checkpoint commits.
  - Evidence: `git diff --check`, `pnpm run check:api-surface`, `pnpm run check:exports`, and
    `pnpm run check` passed.

## Open Questions

- [x] Should `document` accept only JSX or also a typed object form for non-TSX app entries?
  - Decision: accept the typed object/function form too; `Document(...)` returns branded
    `DocumentConfig`, and `CreateAppOptions.document` accepts `DocumentDeclaration`.
- [x] Should `InlineScript` accept source text children, an imported function, or both?
  - Decision: accept source text children for the initial API; imported-function handling remains
    outside this plan.
- [x] Should Kovo allow direct `<script>` under structured `Head`, or require `InlineScript` always?
  - Decision: require `InlineScript`; raw `<script>`/rendered HTML under `Head` throws.
- [x] Should `HtmlAttrs` / `BodyAttrs` be allowlist-only, or should arbitrary `data-*` be accepted?
  - Decision: allowlisted structural attributes plus arbitrary `data-*`; unsupported event/style
    shell attributes throw.
- [x] Should the compatibility escape be named `unsafeDocumentTemplate(...)`,
      `rawDocumentTemplate(...)`, or omitted entirely before v1?
  - Decision: omit it entirely before v1; no public string-returning template escape remains.
- [x] Should `DocumentTemplate` become internal-only immediately once the structured API exists?
  - Decision: remove it rather than keep an internal alias; internal document rendering now uses
    structured assembly directly.

## Latest Verification

- `vp check --fix`
- `pnpm exec vitest --run packages/server/src/document.test.ts packages/server/src/api/app.test.ts packages/server/src/static-export-handler-doc.test.ts packages/cli/src/sources-sinks.test.ts packages/cli/src/index.kovo-explain.test.ts packages/cli/src/commands-manifest.test.ts`
- `pnpm exec playwright test -c tests/integration/playwright.config.ts tests/integration/specs/structured-document-shell.spec.ts`
- `pnpm run check:api-surface`
- `pnpm run check:exports`
- `pnpm run check:imports`
- `pnpm --filter @kovojs/site run build`
- `pnpm run check`
- `rg -n "^- \[ \]" plans/structured-document.md plans/no-raw-strings.md`
- `git diff --check`
