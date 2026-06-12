# Compiler Hard Rules

`SPEC.md` section 5.2 is normative. This page keeps the implementation checklist visible in the repo docs.

The compiler must preserve these rules:

1. Source-derived names. Extracted handlers use stable names such as `Component$fnName` or `Component$element_event`; hashes belong only in cache-busting URLs or equivalent deployment metadata. `fw explain component` must print each handler's capture channels (`ctx`, `element-params`, `module-scope`) beside its emitted ref and params.
2. One-to-one file mapping. An input component file emits its matching server and client modules. Production merging is opt-in, never the default.
3. Fixpoint invariant. The compiler emits valid Jiso source, so `compile(compile(source))` must equal `compile(source)`, and the browser-free render-equivalence gate must prove `render(source)` equals `render(compile(source))`. This proves compiler output, not a second app-authoring surface.
4. Platform behavior emission. Proven platform equivalents should lower to declarative HTML behavior and be reported by `fw explain`.
5. Teaching errors. Diagnostics must show the intended lowering, why it failed, and the available fixes.
6. TSX-only authoring. App source is TSX. Lowered IR is compiler output for fixpoint, render-equivalence, and devtools verification; hand-authored string-rendered or lowered IR in app source is FW235.

These rules are release gates, not style preferences.
