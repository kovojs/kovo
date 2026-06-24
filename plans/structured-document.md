# Structured Document API

**Date:** 2026-06-24

**Status:** Draft implementation roadmap.

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

The remaining document-shell exception is `DocumentTemplate`:

- [x] Confirm the current public template type returns an arbitrary string.
  - Evidence: `packages/server/src/document-core.ts` defines
    `export type DocumentTemplate = (context: DocumentTemplateContext) => string`.
- [x] Confirm framework assembly currently verifies required parts but not template-authored string
      safety.
  - Evidence: `packages/server/src/document-core.ts` calls the template, then
    `enforceDocumentTemplateParts(...)` checks that `parts.head`, `parts.queryScripts`, and
    `parts.body` appear in the returned string.
- [x] Confirm the docs site currently uses the raw string surface.
  - Evidence: `site/src/document-template.ts` concatenates the full document shell, inline scripts,
    font preload strings, and search dialog HTML in `siteDocumentTemplate`.
- [x] Confirm the docs site also relies on an app-authored internal framework import.
  - Evidence: `site/src/document-template.ts` imports `escapeAttribute` from
    `@kovojs/server/internal/html`, conflicting with `SPEC.md` §5.2 rule 8 for app-authored public
    imports.
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

- [ ] Preserve Kovo ownership of required document structure.
  - Required outcome: app code cannot omit `parts.head`, query scripts, loader, build/session meta,
    route body, deferred close tags, or hydration contracts by forgetting to include a placeholder.
- [ ] Keep document authoring TSX-native.
  - Required outcome: document additions are authored as TSX/JSX values or typed helper values, not
    as full-document string concatenation.
- [ ] Make unsafe document contributions explicit and auditable.
  - Required outcome: inline scripts, inline styles, raw HTML, unusual URL sinks, and shell-level
    escape hatches are surfaced through named helpers and enrolled in `kovo explain --trust`.
- [ ] Avoid a generic "slot soup" API.
  - Required outcome: common needs such as fonts, meta tags, scripts, body-end UI, and shell
    attributes have first-class primitives; authors should not need to think in raw insertion
    offsets for normal work.
- [ ] Keep partial/deferred documents byte-compatible with full documents.
  - Required outcome: deferred streams use the same structured document model and cannot drift from
    ordinary document assembly.
- [ ] Make migration honest.
  - Required outcome: existing `DocumentTemplate` users get a teaching diagnostic or compatibility
    window with an explicit `UnsafeDocumentTemplate`-style escape, not a silent behavioral change.

## Proposed Public API Shape

- [ ] Add a structured `document` option to `createApp()`.
  - Candidate:
    `document: DocumentConfig | ((context: DocumentAuthoringContext) => DocumentConfig)`.
  - `DocumentConfig` is produced by `<Document>...</Document>` or a non-JSX object form for callers
    that do not use TSX.
- [ ] Add document primitives under a documented public entrypoint.
  - Candidate exports: `Document`, `Head`, `BodyStart`, `BodyEnd`, `HtmlAttrs`, `BodyAttrs`,
    `Meta`, `Link`, `Stylesheet`, `FontPreload`, `ModulePreload`, `InlineScript`, `InlineStyle`.
- [ ] Make `<Document>` a declaration boundary, not a normal component.
  - Required outcome: it can collect document facts, but it cannot render arbitrary children around
    the route body or replace Kovo-owned shell parts.
- [ ] Define natural placement semantics.
  - `Head` contributes app-wide head nodes.
  - `BodyStart` contributes immediately after `<body>`.
  - `BodyEnd` contributes after the route body and before `</body>`.
  - `HtmlAttrs` and `BodyAttrs` expose a constrained attribute allowlist.
- [ ] Define request-aware context carefully.
  - Candidate context: route path metadata, build environment, CSP collector, and document-level
    state that is already safe to expose.
  - Exclude raw `parts.head`, `parts.body`, `parts.queryScripts`, and internal rendered strings from
    public app authoring.

## Safety Model

- [ ] Route all document child text through the same escaping model as server JSX.
  - Plain strings inside structured document primitives are text unless a primitive explicitly
    consumes code, CSS, or trusted markup.
- [ ] Make inline scripts a typed sink.
  - `InlineScript` requires a stable `id`, a loading/execution posture such as `beforePaint` /
    `afterInteractive`, and CSP hash/nonce enrollment.
  - Plain inline script strings are allowed only through this primitive, not arbitrary `<script>`
    element text in document TSX.
- [ ] Make inline styles a typed sink.
  - `InlineStyle` requires source metadata and CSP enrollment; dynamic values must be compiler-owned
    or explicitly trusted.
- [ ] Enforce URL-bearing attributes through the existing URL-scheme allowlist.
  - Applies to `Link`, `FontPreload`, `ModulePreload`, `Stylesheet`, metadata image URLs, and any
    constrained shell attributes that can carry URLs.
- [ ] Enroll raw HTML escape hatches in `kovo explain --trust`.
  - Candidate: `<UnsafeDocumentHtml reason="...">{trustedHtml(...)}</UnsafeDocumentHtml>`.
  - Plain `string` raw HTML must not be accepted.
- [ ] Forbid app-authored imports from internal document helpers.
  - `escapeAttribute` and other HTML internals stay internal/generated-only; structured primitives
    should remove the need for app authors to import them.

## Compiler And Runtime Work

- [ ] Extend the parser/model to recognize structured document declarations.
  - The model should produce typed document facts rather than source-string fragments.
- [ ] Add server document assembly support for structured document facts.
  - Keep existing `assembleDocumentParts(...)` as the owner of framework parts, but consume app
    additions from a typed model.
- [ ] Add deferred document assembly support.
  - The structured API must support `renderDeferredDocument(...)` without requiring string slicing
    around `</body>`.
- [ ] Add CSP integration.
  - Inline script/style primitives must merge their hashes/nonces with existing loader/query/defer
    CSP metadata.
- [ ] Add diagnostics for invalid document structure.
  - Examples: duplicate `<Document>`, unknown child under `<Document>`, raw `<script>` text outside
    `InlineScript`, direct `dangerouslySetInnerHTML`, unsafe URL, unsupported shell attribute,
    missing inline script `id`, or request-derived dynamic code in an inline script.
- [ ] Add public/import-boundary diagnostics.
  - App-authored `@kovojs/server/internal/*`, `@kovojs/*/generated`, and app-local generated imports
    remain invalid per `SPEC.md` §5.2 rule 8.
- [ ] Add `kovo explain document`.
  - Output should show document contributions, their source files, placement, CSP entries,
    script/style trust posture, and raw/trusted escape hatches.

## Migration Work

- [ ] Migrate the docs site from `site/src/document-template.ts` to the structured API.
  - Convert font preloads to `FontPreload`.
  - Convert the theme, search-hotkey, and API-nav inline scripts to `InlineScript`.
  - Convert the search dialog from raw string HTML to TSX.
  - Remove the app-authored import from `@kovojs/server/internal/html`.
- [ ] Decide the compatibility posture for existing `DocumentTemplate`.
  - Options: remove before v1, deprecate with a KV424/KV235-style teaching diagnostic, or keep only
    as an explicitly named unsafe API with trust metadata.
- [ ] Update docs and examples.
  - Replace raw document template examples with structured document examples.
  - Add a migration note from `DocumentTemplate` to structured document primitives.
- [ ] Update `plans/no-raw-strings.md` or archive note when the exception is closed.
  - The old plan currently records `DocumentTemplate` as the explicit remaining exception.

## Verification Plan

- [ ] Add type-level tests rejecting raw string full-document templates in app-authored source.
- [ ] Add compiler tests for structured document lowering and diagnostics.
- [ ] Add server tests proving required framework parts cannot be omitted.
- [ ] Add deferred document tests proving full/deferred shell parity.
- [ ] Add CSP tests proving inline document scripts/styles are hashed or nonce-enrolled.
- [ ] Add source/sink tests proving document-level raw HTML/script/style/URL sinks are inventoried.
- [ ] Add import-boundary tests proving app-authored internal document helper imports fail.
- [ ] Add site build/static export tests after migrating the docs site.
- [ ] Add `git diff --check` and relevant public API gates before checkpoint commits.

## Open Questions

- [ ] Should `document` accept only JSX or also a typed object form for non-TSX app entries?
- [ ] Should `InlineScript` accept source text children, an imported function, or both?
- [ ] Should Kovo allow direct `<script>` under structured `Head`, or require `InlineScript` always?
- [ ] Should `HtmlAttrs` / `BodyAttrs` be allowlist-only, or should arbitrary `data-*` be accepted?
- [ ] Should the compatibility escape be named `unsafeDocumentTemplate(...)`,
      `rawDocumentTemplate(...)`, or omitted entirely before v1?
- [ ] Should `DocumentTemplate` become internal-only immediately once the structured API exists?

## Latest Verification

- `rg -n "DocumentTemplate|document:\\s*\\{|trustedHtml|escapeAttribute" packages site --glob '!node_modules'`
- `nl -ba site/src/document-template.ts | sed -n '1,220p'`
- `nl -ba packages/server/src/document-core.ts | sed -n '24,60p;160,180p;394,466p'`
- `nl -ba SPEC.md | sed -n '360,377p;493,506p;930,938p;1298,1310p;1348,1353p'`
