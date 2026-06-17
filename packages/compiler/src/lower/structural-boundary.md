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

## Registered Lowerers

| Lowerer | File | Boundary class | Notes |
| --- | --- | --- | --- |
| `lowerStructuralJsx` | `structural-jsx.ts` | `jsx-ir-owner` | Owns structural element/tag/attribute/child rewrites: primitive spreads, primitive `asChild`/attrs composition, `Link` tag/attribute lowering, platform behavior substitution attributes, `viewTransitionName` style lowering, inline binding stamps, mixed-text wrapper insertion, and generated helper imports. |
| `platformBehaviorLowering` | `platform.ts` | `legacy-structural-entrypoint` | Legacy source-patch entrypoint retained for direct lowerer tests. The production compile path routes platform behavior substitutions through `lowerStructuralJsx`; do not add production call sites. |
| `navigationHrefLowering` | `navigation.ts` | `structural-debt` | Currently rewrites authored `href={href(...)}` attributes and standalone `href()` calls as source patches. Attribute rewrites overlap JSX structure and must migrate into JSX IR; standalone expression rewrites need a typed terminal classification if retained. |
| `navigationLinkLowering` | `navigation.ts` | `legacy-structural-entrypoint` | Test-only legacy lowerer for `<Link>` tag/attribute patches. The production compile path routes `Link` lowering through `lowerStructuralJsx`; do not add production call sites. |
| `viewTransitionLowering` | `view-transitions.ts` | `legacy-structural-entrypoint` | Test-only legacy lowerer for static `viewTransitionName` style patches. The production compile path routes static and dynamic view-transition lowering through `lowerStructuralJsx`; do not add production call sites. |
| `lowerPrimitiveAttributeSpreads` | `primitive-spreads.ts` | `legacy-structural-entrypoint` | Legacy spread/composition patcher superseded by `lowerStructuralJsx`; do not add production call sites. |
| `lowerInlineAttributeDerives` | `inline-derives.ts` | `legacy-structural-entrypoint` | Legacy inline binding/text patcher superseded by `lowerStructuralJsx`; do not add production call sites. |

## Guard

`packages/compiler/src/structural-boundary.test.ts` scans `packages/compiler/src/lower/*.ts` and
fails if a lowerer imports `SourceReplacement` but is not registered above. Registering a lowerer here
is not approval to add a new source-patch phase; the `Boundary class` must document whether the
lowerer is JSX IR-owned, terminal-only, structural debt, or legacy/test-only.
