# Structured Document API

**Date:** 2026-06-24

**Status:** Draft implementation roadmap. Committed to **Option 3** (typed config object: helper-built
head items + JSX body slots, Kovo owns the frame). Static-only. Breaking change — no compatibility
window for the old string `DocumentTemplate`.

**Goal:** replace the string-returning `DocumentTemplate` document surface with a structured,
TSX-native document API. Kovo owns the full document frame (doctype, `<html>`, `<head>`, `<body>`,
required meta, loader, query scripts, deferred framing, CSP accounting); apps contribute only typed,
audited document facts.

**Normative anchors:** `SPEC.md` §4.8 output safety and trusted HTML escape hatch, §5.2 hard rules
7/8/10, §9.1 wire/script-data encoding, §9.5 document shell assembly, `rules/compiler-hard-rules.md`,
`rules/api-surface.md`, `plans/no-raw-strings.md`, and `plans/sources-sinks.md`.

## Problem Statement

The earlier "raw string template" framing is **partly stale**: the docs site already authors its
shell as TSX. The real residual problems are narrower and sharper:

1. **The app owns the frame.** `site/src/document-template.tsx` hand-writes `<!doctype>`, `<html>`,
   `<head>`, `<meta charset>`, `<body>` and threads framework output back in by hand via
   `{trustedHtml(parts.head)}`, `{trustedHtml(parts.queryScripts.join(''))}`, `{trustedHtml(parts.body)}`.
   Kovo's only guard is `enforceDocumentTemplateParts` doing `html.includes(part)`
   (`packages/server/src/document-core.ts:449`) — a substring grep that cannot validate ordering or
   context, and which forces the deferred path to string-slice on `</body>`
   (`document-core.ts:438`).
2. **Inline scripts are untyped, un-accounted sinks.** The site emits three
   `<script rawHtml={trustedHtml(...)} />` tags (theme, search hotkey, API nav). They carry no `id`,
   no execution posture, and **are not enrolled in CSP** — the framework hashes the loader and query
   scripts but not these. A strict hash-CSP is therefore impossible today.

Option 3 fixes both structurally: Kovo assembles the frame (problem 1 disappears) and inline scripts
exist only as a typed helper whose hash is merged into the document CSP by construction (problem 2
disappears — raw `<script>` text becomes unexpressible).

### Confirmed current state

- [x] Public template type returns an arbitrary string.
  - Evidence: `packages/server/src/document-core.ts:50`
    `export type DocumentTemplate = (context: DocumentTemplateContext) => string`.
- [x] Framework assembly verifies required parts by substring inclusion, not structure.
  - Evidence: `document-core.ts:449` `enforceDocumentTemplateParts` filters
    `requiredDocumentTemplateParts(...)` by `!html.includes(value)`; deferred framing slices on
    `lastIndexOf('</body>')` (`document-core.ts:438`).
- [x] The docs site authors the shell as TSX but owns the frame and threads framework parts by hand.
  - Evidence: `site/src/document-template.tsx:164-202` returns
    `` `<!doctype html>${String(<html>…{trustedHtml(parts.head)}…{trustedHtml(parts.body)}…</html>)}` ``.
- [x] The site's inline scripts ride `trustedHtml`, not a CSP-accounted sink.
  - Evidence: `site/src/document-template.tsx:170-172`
    `<script rawHtml={trustedHtml(THEME_SCRIPT)} />` ×3; none appear in `assembleDocumentParts` CSP
    merge (`document-core.ts:241-245`).
- [x] (Corrected) The site no longer imports `escapeAttribute` from `@kovojs/server/internal/html`.
  - Evidence: `site/src/document-template.tsx:1-6` imports only `trustedHtml` from `@kovojs/browser`
    and the `DocumentTemplate` type from `@kovojs/server`. The prior plan's internal-import claim is
    obsolete and has been dropped.
- [x] `document` is currently a thin options object on `createApp`.
  - Evidence: `packages/server/src/app-types.ts:159` `document?: AppDocumentOptions`; `app.ts:104`
    `document: options.document ?? {}`. Only `lang` is exercised today (`app-document.test.ts:288`).

## Decisions (locked)

- **Surface: Option 3.** `document` is a typed config **object**. Head contributions are built by
  typed helper functions (`inlineScript`, `inlineStyle`, `fontPreload`); body contributions are
  natural JSX slots (`bodyStart`, `bodyEnd`). Kovo owns the frame. Rationale: identical security to a
  `<Document>` JSX boundary, but the closed-world constraint lives in the **type signature** (the
  invalid move does not typecheck) instead of a post-build compiler diagnostic — best for both human
  and AI authors — and it needs no new compiler pass.
- **Resolution: static-only.** `document` is evaluated once at app construction. No
  `(ctx) => DocumentConfig` form. This keeps inline-script/style CSP hashes stable and keeps the
  document exportable. Route-varying head continues to flow through route meta/hints.
- **Primitive set: minimal.** `inlineScript`, `fontPreload`, `bodyStart`/`bodyEnd`,
  `htmlAttrs`/`bodyAttrs`, and the `rawHead` escape hatch. `<meta>`, `<link>`, stylesheets, and
  modulepreloads stay in the existing route-meta/hints path and `createApp({ stylesheets })` — the
  document API does not duplicate them. **`inlineStyle` is deliberately omitted** (see Resolved
  Questions): no current consumer, and the surface stays minimal per `rules/api-surface.md`.
- **Attribute model.** `htmlAttrs`/`bodyAttrs` allow safe global attributes by category
  (`lang`/`dir`/`class`/`id`/`data-*`); `data-*` is open (escaped values, low risk) and need not be
  declared. `on*`, `style`, and `srcdoc` are excluded structurally; URL-bearing attributes are
  scheme-checked. The `data-kovo-*` / `kovo-*` namespace is reserved for the framework and rejected
  in app attrs.
- **Body wrapping: before/after only.** `bodyStart`/`bodyEnd` inject around the route body; no app
  wrapper element. Root containers/chrome remain the job of layouts and route regions.
- **Compatibility: none. Breaking change.** Remove the string `DocumentTemplate`,
  `DocumentTemplateContext`, the `template?` option, `enforceDocumentTemplateParts`, and the
  `</body>`-slicing deferred path. The docs site is the only consumer and is migrated in the same
  change. No deprecation window, no `unsafeDocumentTemplate`.

## Public API Shape

```tsx
createApp({
  document: {
    lang: "en",
    htmlAttrs: { "data-theme": "dark" },          // constrained allowlist
    head: [
      fontPreload("/fonts/inter-latin-wght-normal.woff2"),
      inlineScript({ id: "theme", run: "beforePaint", source: THEME_SCRIPT }),
    ],
    bodyEnd: <SearchDialog />,                      // natural JSX, server-escaped
  },
});
```

- [ ] Replace `AppDocumentOptions` with the structured shape.
  - Candidate:
    ```ts
    interface AppDocumentOptions {
      lang?: string;
      htmlAttrs?: DocumentHtmlAttrs;   // lang/dir/class/id/data-*; no on*/style/srcdoc; URL attrs scheme-checked
      bodyAttrs?: DocumentBodyAttrs;   // class/id/data-*; data-kovo-*/kovo-* reserved
      head?: readonly DocumentHeadItem[];
      bodyStart?: DocumentNode;        // injected immediately after <body>
      bodyEnd?: DocumentNode;          // injected after the route body, before </body>
    }
    ```
  - `DocumentHeadItem` is an opaque branded type returned only by the head helpers; a plain string or
    raw JSX element is not assignable to it.
- [ ] Add the head-item helpers under a documented public entrypoint (`@kovojs/server`).
  - `inlineScript({ id, run, source }): DocumentHeadItem` — `run: 'beforePaint' | 'afterInteractive'`;
    `source: string` is static text (v1 accepts only a string, never a stringified function), hashed
    for CSP at construction.
  - `fontPreload(href, opts?): DocumentHeadItem` — `as="font"`, `type="font/woff2"`, `crossorigin`
    defaults; `href` scheme-checked.
  - `rawHead(value: TrustedHtml, { reason }): DocumentHeadItem` — the single audited head escape
    hatch; rejects plain `string`; enrolled in `kovo explain --trust`.
- [ ] Keep body slots as ordinary server JSX.
  - `bodyStart`/`bodyEnd` go through the same JSX escaping/KV236 model as component output; a
    `SearchDialog` component or `trustedHtml(...)` works exactly as elsewhere. No document-specific
    body primitive is needed.

## Safety Model

- [ ] Inline scripts are a typed sink only.
  - `inlineScript` is the only way to emit inline script text; raw `<script>` text in document config
    is unexpressible (no slot accepts it). Each `inlineScript` merges its `cspSha256` hash into the
    document CSP metadata via `mergeCspInlineMetadata`, so a strict hash-CSP is complete by
    construction.
- [ ] URL-bearing values pass the existing URL-scheme allowlist.
  - Applies to `fontPreload` href and any URL-bearing `htmlAttrs`.
- [ ] Attribute sinks are categorically constrained.
  - `htmlAttrs`/`bodyAttrs` reject `on*`, `style`, and `srcdoc`; scheme-check URL attrs; reject the
    reserved `data-kovo-*`/`kovo-*` namespace. Dynamic styling goes through `style.create`, not an
    inline `style` attr.
- [ ] (Accepted gap) Inline `<style>` has no CSP-complete path in v1.
  - `inlineStyle` is omitted, so inline CSS would ride `rawHead(trustedHtml(...))`, which is not
    auto-hashed (hashing arbitrary trusted markup would require parsing it). This is an accepted
    consequence of leaving `inlineStyle` out; add the typed `style-src`-hashing helper when a real
    inline-`<style>` consumer appears.
- [ ] Raw HTML only through `rawHead(trustedHtml(...))` (head) or `trustedHtml(...)` in body JSX.
  - Plain `string` raw HTML is never accepted; both are enrolled in `kovo explain --trust`.
- [ ] App-authored imports from `@kovojs/server/internal/*` stay invalid (SPEC §5.2 rule 8). The
  structured helpers remove every current reason to reach for them.

## Compiler And Runtime Work

This is largely a **runtime value API**; the heavy lifting is server-side assembly, not a new
compiler pass.

- [ ] Server: own the frame in `assembleDocumentParts`.
  - Compose the default frame from framework parts **plus** the app's `head`/`bodyStart`/`bodyEnd`/
    attrs. Remove `DocumentTemplate`, `DocumentTemplateContext`, the `template?` option,
    `enforceDocumentTemplateParts`, and `requiredDocumentTemplateParts`.
- [ ] Server: render head items to markup + CSP at construction.
  - `inlineScript` → hashed `<script>` with `cspHashAttribute`; `fontPreload` → `<link rel=preload>`;
    merge all hashes into the document CSP alongside loader/query/defer.
- [ ] Server: structured deferred framing.
  - `renderDeferredDocument` builds `shell`/`closeHtml` from the structured model (the route body and
    `bodyEnd` straddle the boundary) instead of slicing on `</body>`.
- [ ] Types: brand `DocumentHeadItem` so the wrong move fails to typecheck.
  - A plain `string`, a raw JSX element, or `dangerouslySetInnerHTML` must not be assignable to a
    head slot; this is the primary enforcement surface for AI/human authors.
- [ ] Diagnostics (runtime + type, not a new compiler pass where avoidable).
  - Duplicate `inlineScript` `id`; missing `id`; non-allowlisted `htmlAttrs`/`bodyAttrs`; unsafe URL;
    plain-string raw HTML. Prefer type errors; fall back to construction-time throws.
- [ ] `kovo explain document`.
  - Enumerate document contributions, source files, placement, CSP entries, script/style execution
    posture, and raw/trusted escape hatches — statically, from the constructed-once config.

## Migration Work (same change, no compat)

- [ ] Migrate `site/src/document-template.tsx` to the structured config.
  - Font preloads → `fontPreload`; theme/search-hotkey/API-nav scripts → `inlineScript`; search
    dialog stays a JSX component in `bodyEnd`.
  - Delete the hand-authored frame and all `trustedHtml(parts.*)` threading.
- [ ] Remove the string `DocumentTemplate` surface and its tests/fixtures; replace with structured
  equivalents.
- [ ] Update docs/examples and `plans/no-raw-strings.md` (close the `DocumentTemplate` exception).

## Verification Plan

- [ ] Type-level tests: a plain string / raw JSX / `dangerouslySetInnerHTML` is rejected in a head
  slot, and the old string `DocumentTemplate` no longer typechecks.
- [ ] Server tests: required framework parts (loader, query scripts, build/session meta, route body)
  are present and correctly ordered without any app-side placeholder.
- [ ] Deferred tests: full vs deferred shell parity via the structured model (no `</body>` slicing).
- [ ] CSP tests: every `inlineScript` hash is merged into the document CSP.
- [ ] Source/sink tests: document raw-HTML/script/style/URL sinks are inventoried in
  `kovo explain --trust`.
- [ ] Import-boundary test: app-authored `@kovojs/server/internal/*` document imports fail.
- [ ] Site build/static-export test after migration.
- [ ] `git diff --check` + public API gates before checkpoint commits.

## Resolved Questions

- **`inlineScript` source: static string only (v1).** No stringified-function form. Reasons: the
  emitted bytes equal the hashed bytes (stable, dev=prod CSP hash, no build-stage coupling), and the
  `fn` form's headline benefit is undercut by the closure-capture trap — a stringified function that
  references outer scope typechecks but fails at runtime, exactly the constraint-not-in-types
  anti-pattern this API avoids. Keep the signature open so a guarded `fn` form (with a strict
  no-free-variables diagnostic) can be added later without breaking `source`.
- **Attributes: category allowlist, `data-*` open.** Permit `lang`/`dir`/`class`/`id`/`data-*`;
  exclude `on*`/`style`/`srcdoc`; scheme-check URL attrs; reserve `data-kovo-*`/`kovo-*`. `data-*`
  need not be declared (values are escaped → low risk; declaration is ceremony for negligible gain).
- **`inlineStyle`: omitted from v1.** No current consumer (site uses `style.create`), and
  `rules/api-surface.md` favors a minimal surface. Accepted consequence: inline `<style>` has no
  CSP-complete typed path until the helper is added (see Safety Model).

## Latest Verification

- `nl -ba packages/server/src/document-core.ts | sed -n '36,180p;394,477p'`
- `nl -ba site/src/document-template.tsx | sed -n '1,6p;160,235p'`
- `rg -n "DocumentTemplate|document:|enforceDocumentTemplateParts" packages site --glob '!node_modules'`
- `nl -ba SPEC.md | sed -n '925,941p'` (§9.5 request shell)
