# Structural IR Ownership Boundary

This document registers every `packages/compiler/src/lower/**` lowerer that emits
`SourceReplacement` patches. The compiler follows SPEC.md §5.2: app authors write TSX, lowered IR is
compiler output, and post-parse phases decide from typed model facts and spans.

## Ownership Rule

Transformations must be represented in the JSX IR when they rewrite authored JSX element structure:
tag names, closing tags, attribute names, attribute values, attribute ordering, spread expansion,
wrapper unwrapping, inserted children, removed children, generated binding stamps, or generated
derive/style helper imports needed by those structural rewrites. These transforms overlap by writer
and location, so they need the JSX IR's typed tree and writer/provenance model before source patches
are rendered.

Terminal `SourceReplacement` patches are allowed only after structural JSX rewriting is complete, and
only for generated artifact emission that does not overlap authored structural rewrites: server
handler refs, component descriptor assignments, client-href versioning for already-generated state
derive stamps, or other span patches over compiler-owned emitted IR slots. A terminal patch may not
change an authored tag, unwrap JSX, remove children, expand a spread, or compete with an authored
attribute writer.

Terminal stamp phases outside `lower/**` must expose typed facts before rendering source patches.
`emit/server.ts` emits `ServerRenderStampWriteFact` records for `kovo-c`, `kovo-deps`, and
`kovo-state`, and reports KV231 when author JSX competes with host identity/state or handler-param
stamp writers. `compile.ts` collects `StateDeriveReferenceFact` records from compiler-generated
state derive placeholders before terminal client-href versioning.

## Registered Lowerers

| Lowerer                            | File                   | Boundary class                 | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowerStructuralJsx`               | `structural-jsx.ts`    | `jsx-ir-owner`                 | Owns structural element/tag/attribute/child rewrites: primitive spreads, primitive `asChild`/attrs composition, `Link` tag/attribute lowering, platform behavior substitution attributes, static `href={href(...)}`/`href={...}` attribute lowering, `viewTransitionName` style lowering, inline binding stamps, mixed-text wrapper insertion, and generated helper imports. |
| `navigationStandaloneHrefLowering` | `navigation.ts`        | `terminal-only`                | Production terminal patch for standalone `href(...)` call expressions that are not inside a JSX `href` attribute. It does not rewrite JSX tags or attributes.                                                                                                                                                                                                                |

## Guard

`packages/compiler/src/structural-boundary.test.ts` scans `packages/compiler/src/lower/*.ts` and
fails if a lowerer imports `SourceReplacement` but is not registered above. Registering a lowerer here
is not approval to add a new source-patch phase; the `Boundary class` must document whether the
lowerer is JSX IR-owned, terminal-only, structural debt, or legacy/test-only.
