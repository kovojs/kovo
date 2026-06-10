# Compiler Hard Rules

`SPEC.md` section 5.2 is normative. This page keeps the implementation checklist visible in the repo docs.

The compiler must preserve these rules:

1. Source-derived names. Extracted handlers use stable names such as `Component$fnName` or `Component$element_event`; hashes belong only in cache-busting URLs or equivalent deployment metadata.
2. One-to-one file mapping. An input component file emits its matching server and client modules. Production merging is opt-in, never the default.
3. Fixpoint invariant. Generated IR is authorable Jiso source, so `compile(compile(source))` must equal `compile(source)`.
4. Platform behavior emission. Proven platform equivalents should lower to declarative HTML behavior and be reported by `fw explain`.
5. Teaching errors. Diagnostics must show the intended lowering, why it failed, and the available fixes.

These rules are release gates, not style preferences.
