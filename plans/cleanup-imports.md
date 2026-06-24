# Cleanup Import Boundary Exceptions

## Goal

Remove the remaining app-facing import-boundary exceptions. Delete hand-authored verifier graph
fixtures from examples, replace app-authored internal runtime usage with public APIs or real compiled
artifacts, and keep real behavior tests that exercise auth, request-shell, route, mutation, static
export, and docs-site build behavior.

## Scope

- Target all remaining app-facing exceptions:
  - `examples/crm/src/graph.ts -> @kovojs/core/internal/graph`
  - `examples/stackoverflow/src/graph.ts -> @kovojs/core/internal/graph`
  - `examples/reference/src/app.ts -> @kovojs/core/internal/graph`
  - `examples/stackoverflow/src/interactive-app.tsx -> @kovojs/server/internal/wire`
  - `site/scripts/capture.mjs -> @kovojs/browser/internal/inline-loader`
  - `site/scripts/export-static.mjs -> @kovojs/compiler/package-styles`
  - `site/content/guides/streaming.md -> @kovojs/browser/generated`
- Do not add a public graph type to `@kovojs/core` just to preserve these examples.
- Do not replace the deleted checks with new hand-authored verifier graph fixtures.
- Do not make compiler-emitted ABI subpaths app-authored public APIs just to satisfy docs snippets.

## Checklist

- [ ] Remove the CRM verifier graph fixture.
  - Delete `examples/crm/src/graph.test.ts`.
  - Delete `examples/crm/src/graph.ts`.
  - Remove the `createCrmGraph` / `crmGraphDeclarations` export from `examples/crm/src/index.ts`.
  - Verify CRM still has meaningful non-graph example coverage through its remaining tests or package
    checks.

- [ ] Remove the StackOverflow verifier graph fixture.
  - Delete `examples/stackoverflow/src/kovo-graph.test.ts`.
  - Delete `examples/stackoverflow/src/graph.ts`.
  - Remove the `createSoGraph` / `soGraphDeclarations` export from
    `examples/stackoverflow/src/app.ts`.
  - Verify StackOverflow still has meaningful non-graph example coverage through its remaining tests
    or package checks.

- [ ] Keep the reference app but remove its hand-authored graph audit fixture.
  - Remove `referenceGraph` from `examples/reference/src/app.ts`.
  - Remove the graph-audit test block from `examples/reference/src/app.test.ts`.
  - Remove the `referenceGraph` source assertion from `examples/reference/src/app-shell.test.ts`.
  - Keep the no-JS Better Auth, CSRF, request-shell, guarded-route, and static-export tests.

- [ ] Resolve the StackOverflow source live-target renderer exception.
  - Current exception: `examples/stackoverflow/src/interactive-app.tsx ->
@kovojs/server/internal/wire`.
  - Purpose today: the source-served StackOverflow app manually recreates live-target renderers and
    root stamps that compiled/lowered components normally own.
  - Chosen resolution: stop hand-authoring live-target renderer wiring in app source and run the
    StackOverflow live example through the real compiler/build path that produces the needed server
    renderer artifacts at build/test time. Keep generated artifacts out of git; materialize them in
    a temp/build directory as part of the example's serve/test/build flow.
  - Avoid: exporting `componentLiveTargetRenderer` as a general app API without a design decision,
    because it exposes stamp/wire details the compiler is supposed to own.
  - Implementation shape to evaluate:
    - Compile `QuestionListRegion` and `QuestionDetailRegion` through the same component compiler
      path used by app builds.
    - Load/register the emitted live-target renderer modules from the build/temp output.
    - Remove manual component-name assignment and `stampSourceRegionRoot` stamping from
      `interactive-app.tsx`.
    - Keep source-authored routes/layouts, but let compiled component artifacts own live-target
      identities, renderer metadata, and runtime stamps.
  - Verification: StackOverflow interactive route tests still prove enhanced mutations refresh the
    question list/detail regions, and `node scripts/import-boundary.mjs` no longer needs this
    exception.

- [ ] Resolve the docs capture inline-loader exception.
  - Current exception: `site/scripts/capture.mjs -> @kovojs/browser/internal/inline-loader`.
  - Purpose today: the docs capture script measures or displays the real inline loader source/budget.
  - Preferred resolution: consume a public build/server facade that already owns inline-loader access
    rather than importing the browser internal subpath from the site script. Candidate directions:
    expose a small public command/library result from `@kovojs/server` or `@kovojs/cli` for the loader
    budget capture, or move the capture into a package-owned test/artifact and have the site read that
    public artifact.
  - Avoid: making `@kovojs/browser/internal/inline-loader` public to apps; browser package tests
    intentionally keep inline-loader helpers off app-authored surfaces.
  - Verification: site capture output remains byte-accurate enough for the docs claim, the inline
    loader budget still has package-level coverage, and import-boundary no longer needs this
    exception.

- [ ] Resolve the site package-CSS extraction exception.
  - Current exception: `site/scripts/export-static.mjs -> @kovojs/compiler/package-styles`.
  - Purpose today: the docs site build extracts `@kovojs/ui` component CSS on demand without
    committing generated CSS artifacts.
  - Preferred resolution: call the public CLI/build facade instead of importing
    `@kovojs/compiler/package-styles` from a site script. `kovo compile package-css ...` is already a
    public command path; keep direct `package-styles` imports inside compiler/server/CLI packages.
  - If an in-process API is necessary for performance or error handling, expose it from a public
    non-internal package surface with explicit API-surface review and docs, then update the site to
    consume that public facade.
  - Verification: `pnpm --filter @kovojs/site run build` still generates `/assets/kovo-ui.css`
    without committing it, and import-boundary no longer needs this exception.

- [ ] Resolve the streaming-guide generated-runtime docs exception.
  - Current exception: `site/content/guides/streaming.md -> @kovojs/browser/generated`.
  - Purpose today: the guide shows `applyDeferredStreamResponseToRuntime`, which lives on the
    compiler-emitted ABI subpath.
  - Preferred resolution: update the documentation to show the public
    `@kovojs/browser/client` surface, or state that programmatic deferred-stream application is
    compiler/runtime internals only and remove the app-authored import snippet.
  - If programmatic stream application is intended for app authors, move only that helper to
    `@kovojs/browser/client` with tests proving the generated ABI remains available for emitted code.
  - Verification: docs examples no longer teach app authors to import `@kovojs/browser/generated`,
    streaming docs still describe the loader-owned path accurately, and import-boundary no longer
    needs the generated exception.

- [ ] Remove the now-obsolete import-boundary exceptions.
  - Delete each exception from `scripts/import-boundary.mjs` only after its owning cleanup is complete.
  - Confirm stale exception detection still catches any missed allowlist cleanup.

- [ ] Verify the cleanup.
  - Run `node scripts/import-boundary.mjs`.
  - Run the affected example tests for CRM, StackOverflow, and Reference.
  - Run `pnpm --filter @kovojs/site run build` for the site capture/export changes.
  - Run `node scripts/no-committed-generated.mjs`.
  - Run focused formatting checks for touched files.

## Notes

The reference app's purpose is Better Auth and request-shell integration coverage: session mapping,
credential sign-in, sign-out, CSRF, guards, no-JS form behavior, Vite middleware, shared Node handler,
and static-export boundaries. Its hand-authored `referenceGraph` object is verifier-fixture coverage,
not core reference-app behavior, so it should be removed rather than migrated.
