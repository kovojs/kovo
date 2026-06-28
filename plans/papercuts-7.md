# Papercuts 7

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
confirmed framework/dev-tooling papercuts found during the second exhaustive
dogfood pass after `plans/papercuts-6.md`.

Meta-theme: the papercuts-6 fixes held, but deeper app workflows exposed missing
public-surface plumbing, incomplete export asset discovery, and misleading graph
diagnostics.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628c`:
`base-pristine`, `style-headless-regression`, `optimistic-live`,
`static-deploy-skew`, `files-capability`, and `drizzle-depth`.

The fresh baseline passed `pnpm run check`, `pnpm run test`, `pnpm run build:prod`,
and a dev HTTP smoke. Security/soundness findings from the Drizzle track are filed
separately in `plans/bugz-8.md`.

## Issues

### A. Static Export

- [ ] **Static export copies public assets referenced from HTML but misses public assets referenced from exported CSS.** (med, framework; found by `static-deploy-skew`)
  - Observed behavior: the exported stylesheet contains `background:url(/static-bg.txt)`,
    and `dist/.kovo-client/static-bg.txt` exists, but
    `dist/export-static-audit/static-bg.txt` is absent. HTML-referenced public
    assets from the same app are copied.
  - Root cause: `packages/server/src/static-export.ts:109` scans only
    `documentReferencedStaticAssetPaths(...)`, and
    `packages/server/src/static-export.ts:132-160` extracts HTML attributes but
    never parses emitted CSS `url(...)` references.
  - Why it matters: SPEC §9.5 says static export writes referenced static assets.
    CSS-referenced `public/` assets work in dev/build but 404 on the static host.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/static-deploy-skew`,
    `rg static-bg dist/export-static-audit/assets/styles.css` finds the URL, while
    `test -f dist/export-static-audit/static-bg.txt` fails.
  - Acceptance: static export discovers and copies public-root assets referenced
    by emitted CSS assets, without re-copying or escaping URLs outside the public
    asset root.

### B. File / Capability Downloads

- [ ] **`ctx.signUrl` always mints default `/_kovo/storage` URLs, so documented custom `createStorageDownloadEndpoint({ basePath })` links are dead.** (med, framework; found by `files-capability`)
  - Observed behavior: mounting `createStorageDownloadEndpoint({ basePath:
'/downloads', ... })` while rendering a route with `ctx.signUrl(...)` produces
    `/_kovo/storage/...` links; dereferencing them returns 404 when the default
    endpoint is not mounted.
  - Root cause: `packages/server/src/app-document.ts:56-59` constructs route
    `signUrl` with only the app CSRF-derived secret, so route context never sees a
    custom storage endpoint `basePath`; `createSignUrl` supports `basePath` in
    `packages/server/src/capability-route.ts:139-177`, but app routes cannot align
    it with a custom endpoint mount. The public guide shows this composition at
    `site/content/guides/security.md:391`.
  - Why it matters: the documented public API shape does not compose; apps need a
    custom route or default mount to make capability links work.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/files-capability`,
    the documented custom endpoint shape rendered a `/_kovo/storage/...` href and
    `curl` returned `404`; the same app's default endpoint path passed
    `pnpm run check`.
  - Acceptance: `ctx.signUrl` can be configured or derived from mounted storage
    endpoints so custom `basePath` routes mint matching URLs and audiences, or the
    documented custom-basePath pattern is replaced with a supported API.

- [ ] **Stored upload filename metadata is not used by `respond.storedFile` / `createStorageDownloadEndpoint`.** (low, framework; found by `files-capability`)
  - Observed behavior: `s.file().store()` stores sanitized filename metadata, but
    the capability download response emits `Content-Disposition: attachment`
    without a filename unless the endpoint is configured with one static
    `storedFile.filename` for all objects.
  - Root cause: `packages/server/src/schema.ts:552-557` stores sanitized
    `metadata.filename`, while `packages/server/src/response.ts:334-349` and
    `packages/server/src/capability-route.ts:297-303` forward only the static
    `options.filename`, not per-object storage metadata.
  - Why it matters: framework storage preserves safe client filenames but the
    default download helper drops them, pushing apps toward custom endpoints for a
    routine safe download behavior.
  - Repro evidence: upload `note.txt` through `s.file().store()` in
    `/Users/mini/kovo-dogfood-20260628c/files-capability`; the signed download
    returns `Content-Disposition: attachment`, not `attachment; filename="note.txt"`.
  - Acceptance: stored-file responses use sanitized per-object filename metadata
    by default when no explicit static filename override is supplied.

### C. Graph / Explain Diagnostics

- [ ] **Build graph mutation `invalidates` are inconsistent with query read sets and optimistic coverage.** (med, dev-tooling; found by `optimistic-live`)
  - Observed behavior: `kovo explain query queries/contact-detail-query` says the
    detail query is invalidated by contact mutations, but
    `kovo explain mutation mutations/update-contact --optimistic` prints only
    `invalidates: queries/contacts-query` while also showing optimistic coverage
    for `queries/contact-detail-query`. The generated graph also copies live
    target queries onto unrelated mutations such as auth sign-in.
  - Root cause: `packages/cli/src/commands/build-export.ts:658` builds
    `MutationExplain.invalidates` from `mutation.registry.queries` plus all live
    target queries, while `packages/cli/src/commands/build-export.ts:686`
    separately includes optimistic map query keys.
  - Why it matters: SPEC §10.4 / §10.6 make the graph/explain surface the
    auditable proof for invalidation and optimistic coverage. Contradictory output
    makes stale-UI review less trustworthy.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/optimistic-live`,
    `pnpm exec kovo explain query queries/contact-detail-query` includes
    `invalidated-by` contact mutations, while
    `pnpm exec kovo explain mutation mutations/update-contact --optimistic`
    omits `queries/contact-detail-query` from `invalidates` but includes it in
    optimistic coverage.
  - Acceptance: mutation explain/graph invalidates use one derived source of truth
    that includes proven query read-set intersections/optimistic keys and does not
    copy unrelated live target queries onto every mutation.

### D. UI Primitive Plumbing

- [ ] **`@kovojs/ui` `CommandItem` cannot consume the `listboxId` required by the command ID fix.** (low, framework; found by `style-headless-regression`)
  - Observed behavior: after `plans/papercuts-6.md`, headless command item ID
    synthesis requires `listboxId` for id-less items. `CommandInput` accepts
    `listboxId`, but `CommandItem` does not expose or forward it, so
    `CommandItem.definition.render({ itemValue, items, listboxId })` still throws
    the headless `requires listboxId` diagnostic.
  - Root cause: `packages/ui/src/command.tsx:155` omits `listboxId` from
    `CommandItemProps`, and `packages/ui/src/command.tsx:618-624` omits it from
    the `commandItemAttributes(...)` call.
  - Why it matters: SPEC §4.6 requires valid primitive IDREF relationships; the
    styled command path makes the required safe construction awkward compared with
    combobox/select/autocomplete.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628c/style-headless-regression`,
    `pnpm exec vitest run src/style-headless-regression.test.ts` passes a test
    proving `CommandItem` with structural `listboxId` still throws.
  - Acceptance: styled `CommandItem` exposes and forwards `listboxId` to
    `commandItemAttributes`, and duplicate command instances can use unique
    listbox IDs without explicit per-item IDs.

### E. Drizzle Diagnostics

- [ ] **Nested RQB relation projections false-positive when relation name differs from table export.** (med, framework; found by `drizzle-depth`)
  - Observed behavior: `projectSecretExtrasProbe` correctly gets KV410 for raw
    extras, but also incorrectly gets KV406 for `notes.id` even though `notes`
    uses `columns: { id: true }`.
  - Root cause: `packages/drizzle/src/static/query-shapes.ts:188-194` recurses
    with the relation property name as the table key; `packages/drizzle/src/static/query-shapes.ts:167-173`
    then looks up `columnShapes['notes.id']` instead of the relation target table
    such as `projectNotes` / `project_notes`.
  - Why it matters: natural relation aliases produce noisy KV406 diagnostics,
    obscuring the real raw-extras diagnostic and making RQB diagnostics harder to
    trust.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`,
    `pnpm run check` emits `KV406 queries/project-secret-extras-probe.notes.id`
    at `src/queries.ts:124`.
  - Acceptance: nested RQB projection extraction resolves relation property names
    to the target table when checking declared columns, so legitimate
    `columns: { id: true }` projections do not emit KV406.

## Refuted / Not Carried Forward

- Papercuts-6 style token fix: invalid `AT&TAccent` / `R&D_gap2` token names now
  throw clear CSS-invalid token diagnostics; forged `createTheme` var references
  are rejected.
- Papercuts-6 headless fallback fix: duplicate rendered instances have unique IDs
  when explicit owner list IDs are supplied; missing owner IDs now fail closed.
- HTML-referenced public assets and `kovo export --skip-non-exportable`: both
  papercuts-5 findings remain fixed.
- Live API honesty: `live: true` and `<kovo-live query=...>` are rejected at type
  level in this technical-preview state rather than silently no-oping.
- File upload form encoding and default capability headers: multipart form
  encoding and private/no-store/nosniff download headers are present.

## Latest Verification

- In `/Users/mini/kovo-dogfood-20260628c/base-pristine`, `pnpm run check`,
  `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke passed.
- In `/Users/mini/kovo-dogfood-20260628c/static-deploy-skew`, static export
  writes HTML-referenced public assets but leaves CSS `url(/static-bg.txt)`
  unresolved in the export directory.
- In `/Users/mini/kovo-dogfood-20260628c/files-capability`, `pnpm run check`
  passed for the file/capability app.
- In `/Users/mini/kovo-dogfood-20260628c/style-headless-regression`,
  `pnpm exec vitest run src/style-headless-regression.test.ts` passed.
- In `/Users/mini/kovo-dogfood-20260628c/drizzle-depth`, `pnpm run check` exits
  with expected deliberate diagnostics and reproduces the RQB relation projection
  false positive.
